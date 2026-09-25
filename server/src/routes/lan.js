const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const os = require('os');
const http = require('http');
const { requireAuth } = require('../middleware/authMiddleware');
const { 
  db,
  LanPairingModel, 
  LanPairingRequestModel,
  NoteModel, 
  NotebookModel,
  VersionModel,
  SessionModel
} = require('../db/database');
const { 
  writeNoteFile, 
  readNoteFile, 
  getNoteFilePath, 
  calculateHash, 
  generateVersionId 
} = require('../utils/fileStorage');
const {
  getPublicDeviceProfile,
  deriveSharedSessionKey,
  getNextOutgoingSequence,
  resetDeviceSequence,
  encryptLanPayload,
  decryptLanPayload
} = require('../utils/deviceCrypto');
const {
  computeLineDiffHunks,
  reconstructVersionContent,
  findCommonAncestor,
  detectAncestryRelationship
} = require('../utils/versionControl');
const { createOrRecordConflict } = require('../services/conflictResolutionService');
const { discoverDevicesUDP } = require('../utils/lanDiscoveryService');
const {
  httpRequest,
  checkPeerReachable,
  sendPairingRequest,
  pollPairingStatus,
  sendEncryptedLanSync,
  sendEncryptedLanUnpair,
  sendEncryptedLanHeartbeat,
  sendLanConnect
} = require('../utils/lanTransport');

function getLocalIpAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        addresses.push(net.address);
      }
    }
  }
  return addresses;
}

/**
 * Generate a lightweight metadata manifest of local notes and notebooks
 * for synchronization comparison without transmitting note markdown file contents.
 */
function getLocalSyncManifest(userId, peerDeviceId = null) {
  const currentUserId = userId || 'usr_local_default';
  const selectedNoteIds = peerDeviceId ? LanPairingModel.getDeviceSelectedNotes(peerDeviceId) : [];
  let eligibleNotes = NoteModel.getAll(currentUserId).filter(n => n.sync_mode === 'lan' || n.sync_mode === 'both');

  if (selectedNoteIds && selectedNoteIds.length > 0) {
    eligibleNotes = eligibleNotes.filter(n => selectedNoteIds.includes(n.id));
  }

  const notebooks = NotebookModel.getAll(currentUserId);

  return {
    notes: eligibleNotes.map(n => ({
      id: n.id,
      title: n.title || 'Untitled Note',
      content_hash: n.content_hash || '',
      current_version_id: n.current_version_id || null,
      notebook_id: n.notebook_id || null,
      updated_at: n.updated_at || null,
      sync_mode: n.sync_mode
    })),
    notebooks: notebooks.map(nb => ({
      id: nb.id,
      name: (nb.name || '').trim(),
      updated_at: nb.updated_at || null
    }))
  };
}

/**
 * Compare local and remote sync manifests using the exact same version/content comparison criteria
 * as applyIncomingNotesAndNotebooks, without downloading file contents.
 */
function compareSyncManifests(localManifest, remoteManifest) {
  const localNotes = localManifest?.notes || [];
  const localNotebooks = localManifest?.notebooks || [];
  const remoteNotes = remoteManifest?.notes || [];
  const remoteNotebooks = remoteManifest?.notebooks || [];

  const localNotesMap = new Map(localNotes.map(n => [n.id, n]));
  const remoteNotesMap = new Map(remoteNotes.map(n => [n.id, n]));
  const allNoteIds = new Set([...localNotesMap.keys(), ...remoteNotesMap.keys()]);

  let notesToSync = 0;
  for (const id of allNoteIds) {
    const local = localNotesMap.get(id);
    const remote = remoteNotesMap.get(id);

    if (!local || !remote) {
      // Exists on one device but not the other -> needs sync
      notesToSync++;
      continue;
    }

    // Both devices have the note: check if content hash, title, or notebook differs
    const hashDiffers = (local.content_hash || '') !== (remote.content_hash || '');
    const titleDiffers = (local.title || '') !== (remote.title || '');
    const notebookDiffers = (local.notebook_id || null) !== (remote.notebook_id || null);

    if (hashDiffers || titleDiffers || notebookDiffers) {
      notesToSync++;
    }
  }

  const localNbMap = new Map(localNotebooks.map(nb => [nb.id, nb]));
  const remoteNbMap = new Map(remoteNotebooks.map(nb => [nb.id, nb]));
  const allNbIds = new Set([...localNbMap.keys(), ...remoteNbMap.keys()]);

  let notebooksToSync = 0;
  for (const id of allNbIds) {
    const local = localNbMap.get(id);
    const remote = remoteNbMap.get(id);

    if (!local || !remote) {
      // Exists on one device but not the other -> needs sync
      notebooksToSync++;
      continue;
    }

    // Both have notebook: check if name differs
    const nameDiffers = (local.name || '').trim() !== (remote.name || '').trim();
    if (nameDiffers) {
      notebooksToSync++;
    }
  }

  return {
    notesToSync,
    notebooksToSync,
    isUpToDate: notesToSync === 0 && notebooksToSync === 0
  };
}

/**
 * Ingest incoming notes and notebooks from a paired peer,
 * passing through the existing note storage and version control engine.
 * Integrates with AI-Assisted Semantic Conflict Resolution.
 * Ensures complete idempotency and zero duplicate versions.
 */
async function applyIncomingNotesAndNotebooks(incomingNotes = [], incomingNotebooks = [], senderDevice, currentUserId) {
  const appliedNotes = [];
  const conflicts = [];

  // 1. Ingest Notebooks
  for (const nb of incomingNotebooks) {
    if (!nb || !nb.id) continue;
    const existingNb = NotebookModel.getById(nb.id, currentUserId);
    if (!existingNb) {
      // Case 2: Notebook does not exist locally -> Create normally
      NotebookModel.create(nb.id, nb.name || 'General Notes', currentUserId);
    } else {
      // Notebook already exists locally
      const incomingName = (nb.name || '').trim();
      const localName = (existingNb.name || '').trim();

      // Case 1 & Case 5: Identical state or empty incoming name -> completely idempotent
      if (!incomingName || incomingName === localName) {
        continue;
      }

      // Case 3 & Case 4: Names differ - determine if update is warranted
      const incomingTime = nb.updated_at ? new Date(nb.updated_at).getTime() : (nb.created_at ? new Date(nb.created_at).getTime() : 0);
      const localTime = existingNb.updated_at ? new Date(existingNb.updated_at).getTime() : (existingNb.created_at ? new Date(existingNb.created_at).getTime() : 0);

      if (incomingTime > localTime) {
        // Case 3: Incoming state is newer -> update notebook name
        NotebookModel.rename(nb.id, incomingName, currentUserId);
      } else if (incomingTime < localTime) {
        // Local is newer -> Preserve local state, do not overwrite
        continue;
      } else {
        // Case 4: Equal/unknown timestamp with different names
        if (localName === 'General Notes' || localName === 'New Notebook') {
          NotebookModel.rename(nb.id, incomingName, currentUserId);
        }
      }
    }
  }

  // 2. Ingest Notes (Strict policy: only notes marked 'lan' or 'both')
  for (const remoteNote of incomingNotes) {
    if (!remoteNote || !remoteNote.id) continue;
    const mode = remoteNote.sync_mode;
    if (mode !== 'lan' && mode !== 'both') {
      continue; // Strictly skip local or cloud-only notes
    }

    const existing = NoteModel.getById(remoteNote.id, currentUserId);
    const remoteContent = typeof remoteNote.content === 'string' ? remoteNote.content : '';
    const remoteHash = remoteNote.content_hash || calculateHash(remoteContent);

    if (existing) {
      const localContent = readNoteFile(existing.file_path);
      const localHash = calculateHash(localContent);

      // IDEMPOTENCY CHECK (Case 1 & Case 5): Identical content -> SKIP completely! No duplicate version.
      if (localHash === remoteHash || localContent === remoteContent) {
        if ((remoteNote.title && remoteNote.title !== existing.title) || 
            (remoteNote.notebook_id && remoteNote.notebook_id !== existing.notebook_id)) {
          NoteModel.update(
            existing.id,
            remoteNote.title || existing.title,
            existing.file_path,
            remoteNote.notebook_id || existing.notebook_id,
            existing.content_hash,
            existing.current_version_id,
            currentUserId,
            remoteNote.sync_mode || existing.sync_mode
          );
        }
        appliedNotes.push({ id: existing.id, action: 'UNCHANGED' });
        continue;
      }

      // Contents differ: Determine ancestry and branch relationships
      const latestLocalVersion = VersionModel.getLatestForNote(existing.id, currentUserId);

      // Check ancestry relationships using existing version control tree
      let ancestry = { relationship: 'NO_COMMON_ANCESTOR', commonAncestorId: null };
      if (latestLocalVersion) {
        ancestry = detectAncestryRelationship(
          latestLocalVersion.id,
          remoteNote.current_version_id || remoteNote.parent_version_id,
          VersionModel,
          currentUserId
        );
      }

      // Check if remote is a fast-forward update of latest local checkpoint (Case A / Case 3)
      const isFastForward = Boolean(
        ancestry.relationship === 'A_ANCESTOR_OF_B' ||
        (latestLocalVersion && (
          remoteNote.parent_version_id === latestLocalVersion.id ||
          remoteNote.previous_content_hash === latestLocalVersion.content_hash ||
          localContent.trim().length === 0
        ))
      );

      // Check if local is ahead of remote (Case B)
      const isLocalAhead = Boolean(
        ancestry.relationship === 'B_ANCESTOR_OF_A' ||
        (latestLocalVersion && remoteNote.current_version_id && latestLocalVersion.parent_version_id === remoteNote.current_version_id)
      );

      if (isFastForward) {
        // Safe fast-forward update from peer (Normal sync: Case A / Case 3, NO AI required)
        writeNoteFile(existing.file_path, remoteContent);
        const nextVerNum = (latestLocalVersion ? latestLocalVersion.version_number : 0) + 1;
        const diffHunks = computeLineDiffHunks(localContent, remoteContent);
        const newVerId = remoteNote.current_version_id || `v${nextVerNum}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

        const versionData = {
          id: newVerId,
          note_id: existing.id,
          version_number: nextVerNum,
          parent_version_id: latestLocalVersion ? latestLocalVersion.id : null,
          message: `Updated via LAN sync from ${senderDevice.device_name || senderDevice.deviceName || 'Peer'}`,
          device_id: senderDevice.id || senderDevice.deviceId,
          created_at: remoteNote.updated_at || new Date().toISOString(),
          content_hash: remoteHash,
          is_snapshot: 0,
          is_auto: 0
        };

        VersionModel.createCheckpointTransaction(versionData, diffHunks, existing.id, currentUserId);
        SessionModel.upsert(existing.id, newVerId, remoteHash, 'clean', currentUserId);

        NoteModel.update(
          existing.id,
          remoteNote.title || existing.title,
          existing.file_path,
          remoteNote.notebook_id || existing.notebook_id,
          remoteHash,
          newVerId,
          currentUserId,
          remoteNote.sync_mode || existing.sync_mode
        );

        NoteModel.updateSyncMetadata(existing.id, currentUserId, {
          lastSyncedHash: remoteHash,
          lastSyncedAt: new Date().toISOString(),
          syncState: 'SYNCED',
          syncError: null
        });

        appliedNotes.push({ id: existing.id, action: 'UPDATED' });
      } else if (isLocalAhead) {
        // Local is ahead of remote (Normal sync: Case B, NO AI required)
        appliedNotes.push({ id: existing.id, action: 'UNCHANGED_LOCAL_AHEAD' });
      } else {
        // Case C: Concurrent Conflict: Both devices modified independently from a common ancestor
        let commonAncestorId = ancestry.commonAncestorId;
        let ancestorContent = '';

        try {
          if (!commonAncestorId && remoteNote.parent_version_id) {
            const knownParent = VersionModel.getById(remoteNote.parent_version_id, currentUserId);
            if (knownParent) commonAncestorId = knownParent.id;
          }

          if (commonAncestorId) {
            ancestorContent = reconstructVersionContent(commonAncestorId, VersionModel, currentUserId);
          } else if (latestLocalVersion && latestLocalVersion.parent_version_id) {
            ancestorContent = reconstructVersionContent(latestLocalVersion.parent_version_id, VersionModel, currentUserId);
          }
        } catch (ancErr) {
          console.warn(`[LAN Sync Ancestry Notice]:`, ancErr.message);
        }

        // Record persistent conflict and invoke modular local Ollama service
        const conflictRecord = await createOrRecordConflict({
          noteId: existing.id,
          userId: currentUserId,
          ancestorVersionId: commonAncestorId,
          ancestorContent,
          localVersionId: existing.current_version_id,
          localContent,
          remoteVersionId: remoteNote.current_version_id,
          remoteContent,
          remoteDeviceId: senderDevice.id || senderDevice.deviceId,
          remoteDeviceName: senderDevice.device_name || senderDevice.deviceName || 'Peer Device',
          syncSource: 'LAN'
        });

        conflicts.push({
          conflictId: conflictRecord.id,
          noteId: existing.id,
          title: existing.title,
          localContent,
          remoteContent,
          ancestorContent,
          aiStatus: conflictRecord.ai_status,
          aiSummary: conflictRecord.ai_summary,
          aiChanges: conflictRecord.ai_changes,
          aiSuggestedMerge: conflictRecord.ai_suggested_merge,
          aiReasoning: conflictRecord.ai_reasoning,
          localUpdated: existing.updated_at,
          remoteUpdated: remoteNote.updated_at,
          deviceName: senderDevice.device_name || senderDevice.deviceName || 'Remote Peer'
        });

        appliedNotes.push({ id: existing.id, action: 'CONFLICT_RECORDED', conflictId: conflictRecord.id });
      }
    } else {
      // Case 2: New note: Safe import from peer
      const noteTitle = remoteNote.title || 'Untitled Note';
      const filePath = getNoteFilePath(noteTitle, 'General Notes');
      writeNoteFile(filePath, remoteContent);

      const v1Id = remoteNote.current_version_id || `v1_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const diffHunks = computeLineDiffHunks('', remoteContent);

      NoteModel.create(
        remoteNote.id,
        noteTitle,
        filePath,
        remoteNote.notebook_id || null,
        remoteHash,
        v1Id,
        currentUserId,
        remoteNote.sync_mode || 'lan'
      );

      VersionModel.createCheckpointTransaction({
        id: v1Id,
        note_id: remoteNote.id,
        version_number: 1,
        parent_version_id: null,
        message: `Imported via LAN sync from ${senderDevice.device_name || senderDevice.deviceName || 'Peer'}`,
        device_id: senderDevice.id || senderDevice.deviceId,
        created_at: remoteNote.created_at || new Date().toISOString(),
        content_hash: remoteHash,
        is_snapshot: 0,
        is_auto: 0
      }, diffHunks, remoteNote.id, currentUserId);

      SessionModel.upsert(remoteNote.id, v1Id, remoteHash, 'clean', currentUserId);
      NoteModel.updateSyncMetadata(remoteNote.id, currentUserId, {
        lastSyncedHash: remoteHash,
        lastSyncedAt: new Date().toISOString(),
        syncState: 'SYNCED',
        syncError: null
      });
      appliedNotes.push({ id: remoteNote.id, action: 'CREATED' });
    }
  }

  return { appliedNotes, conflicts };
}

/* ==========================================================================
   UNAUTHENTICATED P2P LAN ENDPOINTS
   (Authenticated cryptographically via Device Identity / ECDH & AES-256-GCM)
   ========================================================================== */

/**
 * GET /api/lan/info
 * Public discovery endpoint: returns only safe metadata.
 * Never exposes note contents, passwords, tokens, or private keys.
 */
router.get('/info', (req, res) => {
  const profile = getPublicDeviceProfile();
  return res.json({
    deviceId: profile.deviceId,
    deviceName: profile.deviceName,
    deviceType: profile.deviceType,
    publicKey: profile.publicKey,
    protocolVersion: '1.0.0',
    syncnoteVersion: '1.0.0',
    port: parseInt(process.env.PORT || '5000', 10),
    ipAddresses: getLocalIpAddresses(),
    lanSyncAvailable: true
  });
});

/**
 * POST /api/lan/connect
 * Inbound peer-to-peer connection: When a peer on the same LAN initiates pairing,
 * it exchanges public cryptographic device profiles to establish mutual trust.
 * An explicit pair request clears any prior revocation and establishes fresh trust.
 */
router.post('/connect', (req, res) => {
  try {
    const { deviceId, deviceName, deviceType, publicKey, port, userId } = req.body || {};
    const localProfile = getPublicDeviceProfile();

    if (!deviceId || !publicKey) {
      return res.status(400).json({ error: 'Missing deviceId or publicKey.' });
    }

    if (deviceId === localProfile.deviceId) {
      return res.status(400).json({ error: 'Cannot connect to self.' });
    }

    const peerIp = req.ip || req.socket?.remoteAddress;

    // Establish fresh TRUSTED pairing (resets sequence tracking and clears prior revocation)
    const pairedDevice = LanPairingModel.createPairing({
      id: deviceId,
      deviceName: deviceName || 'SyncNote Device',
      deviceIp: peerIp,
      devicePort: port || 5000,
      pairingToken: crypto.randomBytes(32).toString('hex'),
      publicKey,
      deviceType: deviceType || 'desktop',
      userId: userId || 'usr_local_default',
      status: 'TRUSTED'
    });

    resetDeviceSequence(deviceId);
    console.log(`[LAN Connect] Established mutual trust with peer '${pairedDevice.device_name}' (${deviceId})`);

    return res.json({
      success: true,
      connected: true,
      localDevice: localProfile,
      pairedDevice
    });
  } catch (err) {
    console.error('Error handling LAN connect:', err);
    return res.status(500).json({ error: 'Connection failed', details: err.message });
  }
});

/**
 * POST /api/lan/pair
 * Initiated when user on this machine clicks [Pair] on a discovered peer.
 * Sends an explicit authenticated pairing request to peer's /api/lan/pair/request.
 * Does NOT mark the device as paired until peer approves (or if already trusted).
 */
router.post('/pair', async (req, res) => {
  try {
    const { targetDeviceId, targetIp, targetPort, targetPublicKey, targetDeviceName, targetDeviceType } = req.body || {};
    const localProfile = getPublicDeviceProfile();
    const currentUserId = req.user ? req.user.id : 'usr_local_default';

    if (!targetDeviceId || !targetIp) {
      return res.status(400).json({ error: 'targetDeviceId and targetIp are required.' });
    }

    if (targetDeviceId === localProfile.deviceId) {
      return res.status(400).json({ error: 'Cannot pair a device with itself.' });
    }

    const peerPort = targetPort || 5000;

    // Check if device is ALREADY paired and trusted locally
    const existing = LanPairingModel.getById(targetDeviceId);
    if (existing && existing.status === 'TRUSTED') {
      return res.json({
        success: true,
        status: 'APPROVED',
        approved: true,
        alreadyPaired: true,
        pairedDevice: existing
      });
    }

    // 1. Send pairing request to target peer
    let pairReqRes;
    try {
      pairReqRes = await sendPairingRequest(targetIp, peerPort, localProfile, currentUserId);
    } catch (err) {
      console.warn(`[LAN Pair] Pairing request error to ${targetIp}:${peerPort}: ${err.message}`);
      return res.status(502).json({ error: `Could not reach device at ${targetIp}:${peerPort}: ${err.message}` });
    }

    // If the remote peer was already paired with us and immediately approved
    if (pairReqRes && pairReqRes.status === 'APPROVED') {
      const finalPublicKey = targetPublicKey || pairReqRes.localDevice?.publicKey;
      const pairedDev = LanPairingModel.createPairing({
        id: targetDeviceId,
        deviceName: targetDeviceName || pairReqRes.localDevice?.deviceName || 'SyncNote Device',
        deviceIp: targetIp,
        devicePort: peerPort,
        pairingToken: pairReqRes.pairingToken || crypto.randomBytes(32).toString('hex'),
        publicKey: finalPublicKey,
        deviceType: targetDeviceType || pairReqRes.localDevice?.deviceType || 'desktop',
        userId: currentUserId,
        status: 'TRUSTED'
      });

      resetDeviceSequence(targetDeviceId);
      console.log(`[LAN Pair] Automatically restored mutual trust with already-approved '${pairedDev.device_name}' (${targetDeviceId})`);

      return res.json({
        success: true,
        status: 'APPROVED',
        approved: true,
        pairedDevice: pairedDev
      });
    }

    // Remote peer created a PENDING request waiting for its user's approval
    console.log(`[LAN Pair] Request submitted to ${targetIp}:${peerPort}. Awaiting user approval on peer. Request ID: ${pairReqRes.requestId}`);

    return res.json({
      success: true,
      status: 'PENDING',
      requestId: pairReqRes.requestId,
      targetDeviceId,
      targetDeviceName: targetDeviceName || pairReqRes.localDevice?.deviceName || 'SyncNote Device',
      targetDeviceType: targetDeviceType || pairReqRes.localDevice?.deviceType || 'desktop',
      targetIp,
      targetPort: peerPort,
      targetPublicKey: targetPublicKey || pairReqRes.localDevice?.publicKey
    });
  } catch (err) {
    console.error('Error during LAN pair:', err);
    return res.status(500).json({ error: `Pairing failed: ${err.message}` });
  }
});

/**
 * POST /api/lan/pair/request
 * Inbound pairing request from a remote peer:
 * Creates a PENDING pairing request in database so the local user can Approve or Reject.
 * Never marks device as TRUSTED automatically unless already trusted.
 */
router.post('/pair/request', (req, res) => {
  try {
    const { requesterDeviceId, requesterDeviceName, requesterDeviceType, requesterPublicKey, requesterPort, requesterUserId } = req.body || {};
    const localProfile = getPublicDeviceProfile();

    if (!requesterDeviceId || !requesterPublicKey) {
      return res.status(400).json({ error: 'Missing requesterDeviceId or requesterPublicKey.' });
    }

    if (requesterDeviceId === localProfile.deviceId) {
      return res.status(400).json({ error: 'Cannot connect to self.' });
    }

    const peerIp = req.ip || req.socket?.remoteAddress;

    // Check if requester is ALREADY trusted
    const existing = LanPairingModel.getById(requesterDeviceId);
    if (existing && existing.status === 'TRUSTED') {
      return res.json({
        success: true,
        status: 'APPROVED',
        approved: true,
        alreadyPaired: true,
        localDevice: localProfile,
        pairingToken: existing.pairing_token
      });
    }

    // Create a PENDING request in lan_pairing_requests table
    const pendingReq = LanPairingRequestModel.create({
      requesterDeviceId,
      requesterDeviceName: requesterDeviceName || 'SyncNote Device',
      requesterDeviceType: requesterDeviceType || 'desktop',
      requesterDeviceIp: peerIp,
      requesterPort: requesterPort || 5000,
      requesterPublicKey,
      requesterUserId: requesterUserId || 'usr_local_default',
      targetUserId: 'usr_local_default'
    });

    console.log(`[LAN Pairing] Created pending pairing request ${pendingReq.id} from '${requesterDeviceName}' (${requesterDeviceId})`);

    return res.json({
      success: true,
      status: 'PENDING',
      requestId: pendingReq.id,
      localDevice: localProfile
    });
  } catch (err) {
    console.error('Error handling pairing request:', err);
    return res.status(500).json({ error: 'Pairing request failed', details: err.message });
  }
});

/**
 * GET /api/lan/pair/status/:requestId
 * Remote peer polls this endpoint to check if the local user approved or rejected pairing
 */
router.get('/pair/status/:requestId', (req, res) => {
  try {
    const { requestId } = req.params;
    const pairingReq = LanPairingRequestModel.getById(requestId);
    if (!pairingReq) {
      return res.status(404).json({ error: 'Pairing request not found' });
    }

    const localProfile = getPublicDeviceProfile();

    if (pairingReq.status === 'APPROVED') {
      return res.json({
        success: true,
        status: 'APPROVED',
        approved: true,
        pairingToken: pairingReq.pairing_token,
        localDevice: localProfile
      });
    }

    if (pairingReq.status === 'REJECTED') {
      return res.json({
        success: true,
        status: 'REJECTED',
        approved: false
      });
    }

    return res.json({
      success: true,
      status: 'PENDING',
      approved: false
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to retrieve pairing request status', details: err.message });
  }
});

/**
 * POST /api/lan/sync
 * Authenticated & Encrypted Inbound LAN Sync endpoint (AES-256-GCM with replay protection)
 */
router.post('/sync', async (req, res) => {
  try {
    const { envelope, plainSyncRequest } = req.body || {};
    const localProfile = getPublicDeviceProfile();

    let decryptedPayload = null;
    let senderDevice = null;

    if (envelope) {
      const { senderDeviceId } = envelope;

      // 1. Check if sender is in trusted paired devices list
      senderDevice = LanPairingModel.getById(senderDeviceId);
      if (!senderDevice || senderDevice.status !== 'TRUSTED') {
        console.warn(`[LAN Sync Security Reject] Device '${senderDeviceId}' is not paired or has been REVOKED.`);
        return res.status(403).json({
          error: 'SECURITY REJECTED: Sender device is not paired or has been revoked.',
          code: 'UNPAIRED_DEVICE'
        });
      }

      if (!senderDevice.public_key) {
        return res.status(403).json({ error: 'SECURITY REJECTED: Missing sender public key.' });
      }

      // 2. Derive Shared AES-256 session key using sender public key
      const sessionKey = deriveSharedSessionKey(senderDevice.public_key);

      // 3. Decrypt payload & verify sequence number / authTag / signature
      try {
        decryptedPayload = decryptLanPayload(envelope, sessionKey, senderDeviceId, senderDevice.public_key);
      } catch (cryptoErr) {
        console.error(`[LAN Sync Security Reject] Cryptographic verification failed: ${cryptoErr.message}`);
        return res.status(401).json({
          error: `SECURITY REJECTED: Cryptographic verification failed (${cryptoErr.message})`,
          code: 'CRYPTO_FAILURE'
        });
      }
    } else if (plainSyncRequest) {
      // Fallback for token-verified direct testing requests
      const pairingToken = req.headers['x-lan-pairing-token'];
      if (!pairingToken) {
        return res.status(401).json({ error: 'SECURITY REJECTED: Missing LAN pairing authorization header.' });
      }
      senderDevice = LanPairingModel.getByToken(pairingToken);
      if (!senderDevice || senderDevice.status !== 'TRUSTED') {
        return res.status(403).json({ error: 'SECURITY REJECTED: Invalid or revoked LAN pairing token.' });
      }
      decryptedPayload = plainSyncRequest;
    } else {
      return res.status(400).json({ error: 'Missing sync payload parameters.' });
    }

    const currentUserId = senderDevice.user_id || 'usr_local_default';

    // 4. Update sender device last seen and IP
    LanPairingModel.updateLastSeen(senderDevice.id, req.ip, senderDevice.device_port);

    // 5. Ingest incoming notes and notebooks through existing sync and version control engine
    const { appliedNotes, conflicts } = await applyIncomingNotesAndNotebooks(
      decryptedPayload.notes || [],
      decryptedPayload.notebooks || [],
      senderDevice,
      currentUserId
    );

    // 6. Gather local notes eligible for LAN sync (strictly sync_mode === 'lan' || sync_mode === 'both')
    const selectedNoteIds = LanPairingModel.getDeviceSelectedNotes(senderDevice.id);
    let localNotes = NoteModel.getAll(currentUserId).filter(n => n.sync_mode === 'lan' || n.sync_mode === 'both');

    if (selectedNoteIds && selectedNoteIds.length > 0) {
      localNotes = localNotes.filter(n => selectedNoteIds.includes(n.id));
    }

    const localNotesWithContent = localNotes.map(n => {
      const latestVer = VersionModel.getLatestForNote(n.id, currentUserId);
      return {
        ...n,
        content: readNoteFile(n.file_path),
        parent_version_id: latestVer ? latestVer.parent_version_id : null,
        current_version_id: latestVer ? latestVer.id : n.current_version_id
      };
    });
    const localNotebooks = NotebookModel.getAll(currentUserId);

    const responseData = {
      appliedCount: appliedNotes.length,
      conflictCount: conflicts.length,
      conflicts,
      localLanNotes: localNotesWithContent,
      localNotebooks
    };

    // 7. Encrypt response back to sender
    if (senderDevice && senderDevice.public_key) {
      const sessionKey = deriveSharedSessionKey(senderDevice.public_key);
      const seq = getNextOutgoingSequence(senderDevice.id);
      const encryptedResponse = encryptLanPayload(responseData, sessionKey, seq, localProfile.deviceId, senderDevice.id);

      return res.json({
        success: true,
        encryptedEnvelope: encryptedResponse
      });
    }

    return res.json({
      success: true,
      data: responseData
    });
  } catch (err) {
    console.error('Error during LAN Sync:', err);
    return res.status(500).json({ error: 'LAN Sync failed', details: err.message });
  }
});

/**
 * POST /api/lan/unpair
 * Authenticated & Encrypted Inbound P2P LAN Unpair control endpoint (AES-256-GCM with replay protection)
 * Receives remote unpair control request, verifies authentication, revokes pairing locally, and returns UNPAIR_ACK
 */
router.post('/unpair', (req, res) => {
  try {
    const { envelope } = req.body || {};
    const localProfile = getPublicDeviceProfile();

    if (!envelope || !envelope.senderDeviceId) {
      return res.status(400).json({ error: 'Missing envelope or senderDeviceId.' });
    }

    const { senderDeviceId } = envelope;

    // 1. Check if sender exists in paired devices table
    const senderDevice = LanPairingModel.getById(senderDeviceId);
    if (!senderDevice) {
      console.warn(`[LAN Unpair Security Reject] Unrecognized sender device '${senderDeviceId}' attempted unpair.`);
      return res.status(403).json({
        error: 'SECURITY REJECTED: Sender device is not recognized.',
        code: 'UNRECOGNIZED_DEVICE'
      });
    }

    if (!senderDevice.public_key) {
      return res.status(403).json({ error: 'SECURITY REJECTED: Missing sender public key.' });
    }

    // 2. Derive Shared AES-256 session key using sender public key
    const sessionKey = deriveSharedSessionKey(senderDevice.public_key);

    // 3. Decrypt payload & verify sequence number / authTag / signature
    let decryptedPayload;
    try {
      decryptedPayload = decryptLanPayload(envelope, sessionKey, senderDeviceId, senderDevice.public_key);
    } catch (cryptoErr) {
      console.error(`[LAN Unpair Security Reject] Cryptographic verification failed: ${cryptoErr.message}`);
      return res.status(401).json({
        error: `SECURITY REJECTED: Cryptographic verification failed (${cryptoErr.message})`,
        code: 'CRYPTO_FAILURE'
      });
    }

    // 4. Validate control message payload
    if (!decryptedPayload || decryptedPayload.type !== 'UNPAIR_REQUEST') {
      return res.status(400).json({ error: 'Invalid control message type. Expected UNPAIR_REQUEST.' });
    }

    if (decryptedPayload.targetDeviceId && decryptedPayload.targetDeviceId !== localProfile.deviceId) {
      return res.status(400).json({ error: 'targetDeviceId mismatch.' });
    }

    // 5. Revoke the requesting device locally (idempotent: safe if already revoked)
    LanPairingModel.revokePairing(senderDeviceId, senderDevice.user_id);
    console.log(`[LAN Unpair] Successfully revoked pairing for peer '${senderDevice.device_name}' (${senderDeviceId}) upon remote request.`);

    // 6. Return authenticated encrypted acknowledgement (UNPAIR_ACK)
    const ackSeq = getNextOutgoingSequence(senderDevice.id);
    const ackPayload = {
      type: 'UNPAIR_ACK',
      status: 'REVOKED',
      ackDeviceId: localProfile.deviceId,
      requestId: decryptedPayload.requestId || null,
      timestamp: Date.now()
    };

    const encryptedAck = encryptLanPayload(
      ackPayload,
      sessionKey,
      ackSeq,
      localProfile.deviceId,
      senderDevice.id
    );

    // Reset sequence tracking after encrypting the acknowledgement
    resetDeviceSequence(senderDeviceId);

    return res.json({
      success: true,
      encryptedEnvelope: encryptedAck,
      message: `Device '${senderDevice.device_name}' revoked successfully.`
    });
  } catch (err) {
    console.error('Error during LAN unpair:', err);
    return res.status(500).json({ error: 'LAN unpair failed', details: err.message });
  }
});

/**
 * POST /api/lan/heartbeat
 * Authenticated & Encrypted Inbound P2P LAN Heartbeat endpoint (AES-256-GCM with replay protection)
 * Responds to lightweight presence checks without transferring any notes or version data.
 */
router.post('/heartbeat', (req, res) => {
  try {
    const { envelope } = req.body || {};
    const localProfile = getPublicDeviceProfile();

    if (!envelope || !envelope.senderDeviceId) {
      return res.status(400).json({ error: 'Missing envelope or senderDeviceId.' });
    }

    const { senderDeviceId } = envelope;

    // 1. Verify sender exists in paired devices table and is TRUSTED
    const senderDevice = LanPairingModel.getById(senderDeviceId);
    if (!senderDevice || senderDevice.status !== 'TRUSTED') {
      return res.status(403).json({
        error: 'SECURITY REJECTED: Sender device is not paired or has been revoked.',
        code: 'UNPAIRED_DEVICE'
      });
    }

    if (!senderDevice.public_key) {
      return res.status(403).json({ error: 'SECURITY REJECTED: Missing sender public key.' });
    }

    // 2. Derive Shared AES-256 session key
    const sessionKey = deriveSharedSessionKey(senderDevice.public_key);

    // 3. Decrypt payload & verify sequence number, authTag, signature, and timestamp
    let decryptedPayload;
    try {
      decryptedPayload = decryptLanPayload(envelope, sessionKey, senderDeviceId, senderDevice.public_key);
    } catch (cryptoErr) {
      return res.status(401).json({
        error: `SECURITY REJECTED: Cryptographic verification failed (${cryptoErr.message})`,
        code: 'CRYPTO_FAILURE'
      });
    }

    if (!decryptedPayload || decryptedPayload.type !== 'HEARTBEAT') {
      return res.status(400).json({ error: 'Invalid control message type. Expected HEARTBEAT.' });
    }

    // 4. Update last seen timestamp & IP for this sender device
    const peerIp = req.ip || req.socket?.remoteAddress;
    LanPairingModel.updateLastSeen(senderDevice.id, peerIp, senderDevice.device_port);

    // Compute lightweight sync comparison using existing metadata criteria
    const currentUserId = senderDevice.user_id || 'usr_local_default';
    const localManifest = getLocalSyncManifest(currentUserId, senderDevice.id);
    const remoteManifest = {
      notes: decryptedPayload.notes || [],
      notebooks: decryptedPayload.notebooks || []
    };
    const syncComparison = compareSyncManifests(localManifest, remoteManifest);

    // 5. Generate lightweight encrypted HEARTBEAT_ACK
    const ackSeq = getNextOutgoingSequence(senderDevice.id);
    const ackPayload = {
      type: 'HEARTBEAT_ACK',
      ackDeviceId: localProfile.deviceId,
      timestamp: Date.now(),
      notes: localManifest.notes,
      notebooks: localManifest.notebooks,
      notesToSync: syncComparison.notesToSync,
      notebooksToSync: syncComparison.notebooksToSync
    };

    const encryptedAck = encryptLanPayload(
      ackPayload,
      sessionKey,
      ackSeq,
      localProfile.deviceId,
      senderDevice.id
    );

    return res.json({
      success: true,
      encryptedEnvelope: encryptedAck
    });
  } catch (err) {
    return res.status(500).json({ error: 'Heartbeat failed', details: err.message });
  }
});

/* ==========================================================================
   AUTHENTICATED CLIENT UI ENDPOINTS (User must be logged in locally)
   ========================================================================== */

router.use(requireAuth);

/**
 * GET /api/lan/discover
 * Discover nearby SyncNote instances on the local subnet via UDP Broadcast
 */
router.get('/discover', async (req, res) => {
  try {
    const localProfile = getPublicDeviceProfile();
    const currentUserId = req.user ? req.user.id : 'usr_local_default';
    const pairedDevices = LanPairingModel.getPairedDevices(currentUserId);
    const pairedMap = new Map();
    pairedDevices.forEach(d => pairedMap.set(d.id, d));

    const discoveredMap = new Map();

    try {
      const udpDevices = await discoverDevicesUDP(1000);
      for (const dev of udpDevices) {
        if (dev.deviceId && dev.deviceId !== localProfile.deviceId) {
          discoveredMap.set(dev.deviceId, dev);
        }
      }
    } catch (e) {
      console.warn('[LAN Discovery UDP Warning]:', e.message);
    }

    const discovered = Array.from(discoveredMap.values()).map(dev => {
      const targetId = dev.deviceId || dev.id;
      const isPaired = pairedMap.has(targetId);
      return {
        id: targetId,
        deviceId: targetId,
        deviceName: dev.deviceName || 'SyncNote Device',
        deviceType: dev.deviceType || 'desktop',
        ip: dev.ip || (Array.isArray(dev.ipAddresses) ? dev.ipAddresses[0] : null),
        port: dev.port || 5000,
        publicKey: dev.publicKey,
        isPaired,
        isOnline: true,
        lastSeen: new Date().toISOString()
      };
    });

    return res.json({
      success: true,
      localDevice: localProfile,
      discovered
    });
  } catch (err) {
    console.error('LAN discovery error:', err);
    return res.status(500).json({ error: 'LAN discovery failed', details: err.message });
  }
});

/**
 * GET /api/lan/pair/pending
 * Returns list of pending inbound pairing requests awaiting user approval
 */
router.get('/pair/pending', (req, res) => {
  try {
    const userId = req.user ? req.user.id : 'usr_local_default';
    const pending = LanPairingRequestModel.getPendingForUser(userId);
    return res.json({
      success: true,
      pending: pending.map(r => ({
        id: r.id,
        requesterDeviceId: r.requester_device_id,
        requesterDeviceName: r.requester_device_name,
        requesterDeviceType: r.requester_device_type,
        requesterDeviceIp: r.requester_device_ip,
        requesterPort: r.requester_port,
        createdAt: r.created_at
      }))
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch pending pairing requests', details: err.message });
  }
});

/**
 * POST /api/lan/pair/approve
 * User explicitly clicks [Approve] on an incoming pairing prompt.
 * Marks the request as APPROVED and creates a TRUSTED pairing in database.
 */
router.post('/pair/approve', (req, res) => {
  try {
    const { requestId } = req.body || {};
    const userId = req.user ? req.user.id : 'usr_local_default';

    if (!requestId) {
      return res.status(400).json({ error: 'requestId is required.' });
    }

    const pairingReq = LanPairingRequestModel.getById(requestId);
    if (!pairingReq) {
      return res.status(404).json({ error: 'Pairing request not found.' });
    }

    const pairingToken = pairingReq.pairing_token || crypto.randomBytes(32).toString('hex');

    // 1. Mark request as APPROVED
    LanPairingRequestModel.approve(requestId, pairingToken);

    // 2. Add requester to lan_paired_devices as TRUSTED
    const pairedDev = LanPairingModel.createPairing({
      id: pairingReq.requester_device_id,
      deviceName: pairingReq.requester_device_name,
      deviceIp: pairingReq.requester_device_ip,
      devicePort: pairingReq.requester_port || 5000,
      pairingToken,
      publicKey: pairingReq.requester_public_key,
      deviceType: pairingReq.requester_device_type || 'desktop',
      userId,
      status: 'TRUSTED'
    });

    resetDeviceSequence(pairingReq.requester_device_id);
    console.log(`[LAN Pair Approval] User approved device '${pairedDev.device_name}' (${pairedDev.id})`);

    return res.json({
      success: true,
      message: 'Pairing approved',
      pairedDevice: pairedDev
    });
  } catch (err) {
    console.error('Error approving pairing request:', err);
    return res.status(500).json({ error: 'Failed to approve pairing', details: err.message });
  }
});

/**
 * POST /api/lan/pair/reject
 * User explicitly clicks [Reject] on an incoming pairing prompt.
 */
router.post('/pair/reject', (req, res) => {
  try {
    const { requestId } = req.body || {};
    if (!requestId) {
      return res.status(400).json({ error: 'requestId is required.' });
    }

    const pairingReq = LanPairingRequestModel.getById(requestId);
    if (!pairingReq) {
      return res.status(404).json({ error: 'Pairing request not found.' });
    }

    LanPairingRequestModel.reject(requestId);
    console.log(`[LAN Pair Rejection] User rejected pairing request ${requestId} from '${pairingReq.requester_device_name}'`);

    return res.json({
      success: true,
      message: 'Pairing request rejected'
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to reject pairing', details: err.message });
  }
});

/**
 * POST /api/lan/pair/check-status
 * Requester polls status of an outgoing pairing request to remote peer.
 * When approved by remote peer, this node saves the device as TRUSTED locally.
 */
router.post('/pair/check-status', async (req, res) => {
  try {
    const { remoteIp, remotePort, requestId, targetDeviceId, targetDeviceName, targetDeviceType, targetPublicKey } = req.body || {};
    const currentUserId = req.user ? req.user.id : 'usr_local_default';

    if (!remoteIp || !requestId) {
      return res.status(400).json({ error: 'remoteIp and requestId are required.' });
    }

    const peerPort = remotePort || 5000;
    const statusRes = await pollPairingStatus(remoteIp, peerPort, requestId);

    if (statusRes && statusRes.status === 'APPROVED') {
      const finalPublicKey = targetPublicKey || statusRes.localDevice?.publicKey;
      const pairedDev = LanPairingModel.createPairing({
        id: targetDeviceId,
        deviceName: targetDeviceName || statusRes.localDevice?.deviceName || 'SyncNote Device',
        deviceIp: remoteIp,
        devicePort: peerPort,
        pairingToken: statusRes.pairingToken || crypto.randomBytes(32).toString('hex'),
        publicKey: finalPublicKey,
        deviceType: targetDeviceType || statusRes.localDevice?.deviceType || 'desktop',
        userId: currentUserId,
        status: 'TRUSTED'
      });

      resetDeviceSequence(targetDeviceId);
      console.log(`[LAN Pair] Pairing approved remotely by '${pairedDev.device_name}' (${targetDeviceId}). Now paired locally.`);

      return res.json({
        success: true,
        status: 'APPROVED',
        approved: true,
        pairedDevice: pairedDev
      });
    }

    if (statusRes && statusRes.status === 'REJECTED') {
      console.log(`[LAN Pair] Pairing request was rejected by remote device (${targetDeviceId}).`);
      return res.json({
        success: true,
        status: 'REJECTED',
        approved: false
      });
    }

    return res.json({
      success: true,
      status: 'PENDING',
      approved: false
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to poll pairing status', details: err.message });
  }
});

/**
 * GET /api/lan/devices
 * List all trusted & paired LAN devices for the user with reachability status.
 * Uses lightweight encrypted heartbeat to check reachability without altering pairing.
 */
router.get('/devices', async (req, res) => {
  try {
    const userId = req.user ? req.user.id : 'usr_local_default';
    const localProfile = getPublicDeviceProfile();
    const devices = LanPairingModel.getPairedDevices(userId);

    // Check reachability and lightweight sync comparison using authenticated heartbeat (~2s timeout)
    const deviceStatuses = await Promise.all(devices.map(async (d) => {
      let isOnline = false;
      let notesToSync = 0;
      let notebooksToSync = 0;

      if (d.device_ip && d.public_key) {
        try {
          const localManifest = getLocalSyncManifest(userId, d.id);
          const hb = await sendEncryptedLanHeartbeat(d.device_ip, d.device_port || 5000, localProfile, d, localManifest);
          if (hb && hb.ok) {
            isOnline = true;
            LanPairingModel.updateLastSeen(d.id, d.device_ip, d.device_port || 5000);
            if (hb.remoteNotes || hb.remoteNotebooks) {
              const comp = compareSyncManifests(localManifest, { notes: hb.remoteNotes || [], notebooks: hb.remoteNotebooks || [] });
              notesToSync = comp.notesToSync;
              notebooksToSync = comp.notebooksToSync;
            } else {
              notesToSync = hb.notesToSync ?? 0;
              notebooksToSync = hb.notebooksToSync ?? 0;
            }
          }
        } catch (e) {
          isOnline = false;
        }
      }

      return {
        id: d.id,
        deviceName: d.device_name,
        deviceType: d.device_type || 'desktop',
        deviceIp: d.device_ip,
        devicePort: d.device_port || 5000,
        status: d.status,
        pairedAt: d.created_at,
        lastSeen: isOnline ? new Date().toISOString() : d.last_seen,
        isOnline,
        notesToSync: isOnline ? notesToSync : null,
        notebooksToSync: isOnline ? notebooksToSync : null,
        isUpToDate: isOnline ? (notesToSync === 0 && notebooksToSync === 0) : false,
        publicKeyFingerprint: d.public_key ? d.public_key.substring(0, 16) + '...' : null,
        selectedNoteIds: LanPairingModel.getDeviceSelectedNotes(d.id)
      };
    }));

    return res.json({
      success: true,
      localDevice: localProfile,
      devices: deviceStatuses
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to list LAN devices', details: err.message });
  }
});

/**
 * GET /api/lan/devices/presence
 * Automatic background presence checking for every paired device.
 * Runs lightweight authenticated encrypted heartbeat in parallel (~2s timeout).
 * Updates last_seen timestamp in database for online peers.
 * Calculates pending sync count (notesToSync, notebooksToSync) without downloading note contents.
 */
router.get('/devices/presence', async (req, res) => {
  try {
    const userId = req.user ? req.user.id : 'usr_local_default';
    const devices = LanPairingModel.getPairedDevices(userId);
    const localProfile = getPublicDeviceProfile();

    const presenceList = await Promise.all(devices.map(async (d) => {
      if (!d.device_ip || !d.public_key) {
        return {
          id: d.id,
          deviceName: d.device_name,
          isOnline: false,
          lastSeen: d.last_seen,
          error: 'Missing IP or public key',
          notesToSync: null,
          notebooksToSync: null,
          isUpToDate: false
        };
      }

      try {
        const peerPort = d.device_port || 5000;
        const localManifest = getLocalSyncManifest(userId, d.id);
        const hbResult = await sendEncryptedLanHeartbeat(d.device_ip, peerPort, localProfile, d, localManifest);

        if (hbResult && hbResult.ok) {
          const nowIso = new Date().toISOString();
          LanPairingModel.updateLastSeen(d.id, d.device_ip, peerPort);
          let notesToSync = hbResult.notesToSync ?? 0;
          let notebooksToSync = hbResult.notebooksToSync ?? 0;

          if (hbResult.remoteNotes || hbResult.remoteNotebooks) {
            const comp = compareSyncManifests(localManifest, { notes: hbResult.remoteNotes || [], notebooks: hbResult.remoteNotebooks || [] });
            notesToSync = comp.notesToSync;
            notebooksToSync = comp.notebooksToSync;
          }

          return {
            id: d.id,
            deviceName: d.device_name,
            isOnline: true,
            lastSeen: nowIso,
            latencyMs: hbResult.latencyMs,
            notesToSync,
            notebooksToSync,
            isUpToDate: notesToSync === 0 && notebooksToSync === 0
          };
        } else {
          return {
            id: d.id,
            deviceName: d.device_name,
            isOnline: false,
            lastSeen: d.last_seen,
            error: hbResult?.error || 'Unreachable',
            notesToSync: null,
            notebooksToSync: null,
            isUpToDate: false
          };
        }
      } catch (err) {
        return {
          id: d.id,
          deviceName: d.device_name,
          isOnline: false,
          lastSeen: d.last_seen,
          error: err.message,
          notesToSync: null,
          notebooksToSync: null,
          isUpToDate: false
        };
      }
    }));

    return res.json({
      success: true,
      presence: presenceList
    });
  } catch (err) {
    return res.status(500).json({ error: 'Presence check failed', details: err.message });
  }
});

/**
 * GET /api/lan/devices/:id/sync-status
 * On-demand check for pending sync changes with a specific paired device
 */
router.get('/devices/:id/sync-status', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user ? req.user.id : 'usr_local_default';
    const localProfile = getPublicDeviceProfile();
    const peer = LanPairingModel.getById(id);

    if (!peer || peer.status !== 'TRUSTED') {
      return res.status(404).json({ error: 'Device not found or not paired.' });
    }

    if (!peer.device_ip || !peer.public_key) {
      return res.json({
        success: true,
        deviceId: id,
        isOnline: false,
        notesToSync: null,
        notebooksToSync: null,
        isUpToDate: false
      });
    }

    const localManifest = getLocalSyncManifest(userId, id);
    const peerPort = peer.device_port || 5000;
    const hb = await sendEncryptedLanHeartbeat(peer.device_ip, peerPort, localProfile, peer, localManifest);

    if (hb && hb.ok) {
      LanPairingModel.updateLastSeen(peer.id, peer.device_ip, peerPort);
      let notesToSync = hb.notesToSync ?? 0;
      let notebooksToSync = hb.notebooksToSync ?? 0;
      if (hb.remoteNotes || hb.remoteNotebooks) {
        const comp = compareSyncManifests(localManifest, { notes: hb.remoteNotes || [], notebooks: hb.remoteNotebooks || [] });
        notesToSync = comp.notesToSync;
        notebooksToSync = comp.notebooksToSync;
      }
      return res.json({
        success: true,
        deviceId: id,
        isOnline: true,
        notesToSync,
        notebooksToSync,
        isUpToDate: notesToSync === 0 && notebooksToSync === 0
      });
    } else {
      return res.json({
        success: true,
        deviceId: id,
        isOnline: false,
        notesToSync: null,
        notebooksToSync: null,
        isUpToDate: false
      });
    }
  } catch (err) {
    return res.status(500).json({ error: 'Failed to check device sync status', details: err.message });
  }
});

/**
 * GET /api/lan/devices/:id/notes
 * Fetch allowed notes for LAN sync with a specific paired device
 */
router.get('/devices/:id/notes', (req, res) => {
  const { id } = req.params;
  const selectedNoteIds = LanPairingModel.getDeviceSelectedNotes(id);
  return res.json({ success: true, deviceId: id, selectedNoteIds });
});

/**
 * POST /api/lan/devices/:id/notes
 * Save allowed note IDs for LAN sync with a specific paired device
 */
router.post('/devices/:id/notes', (req, res) => {
  const { id } = req.params;
  const { noteIds } = req.body || {};
  const updated = LanPairingModel.setDeviceSelectedNotes(id, Array.isArray(noteIds) ? noteIds : []);
  return res.json({ success: true, deviceId: id, selectedNoteIds: updated });
});

/**
 * PATCH /api/lan/devices/:id
 * Rename a paired LAN device
 */
router.patch('/devices/:id', (req, res) => {
  const { id } = req.params;
  const { deviceName } = req.body || {};
  if (!deviceName) return res.status(400).json({ error: 'Device name is required.' });
  const updated = LanPairingModel.renameDevice(id, deviceName);
  return res.json({ success: true, device: updated });
});

/**
 * DELETE /api/lan/devices/:id
 * Revoke/Unpair a LAN device (Immediate rejection of future LAN sync requests)
 */
router.delete('/devices/:id', async (req, res) => {
  const { id } = req.params;
  const userId = req.user ? req.user.id : 'usr_local_default';
  const localProfile = getPublicDeviceProfile();

  const existing = LanPairingModel.getById(id);
  if (!existing) {
    return res.status(404).json({ error: 'Device not found.' });
  }

  // STEP 1: Immediately revoke pairing locally so future sync attempts are blocked
  LanPairingModel.revokePairing(id, userId);
  console.log(`[LAN Revocation] Revoked LAN trust locally for device ${id}`);

  // STEP 2: If peer has an IP address and public key, send authenticated UNPAIR_REQUEST
  let remoteNotified = false;
  let remoteMessage = '';

  if (existing.device_ip && existing.public_key) {
    try {
      const peerPort = existing.device_port || 5000;
      await sendEncryptedLanUnpair(existing.device_ip, peerPort, localProfile, existing);
      remoteNotified = true;
      remoteMessage = 'Device unpaired';
      console.log(`[LAN Revocation] Remote device '${existing.device_name}' (${id}) acknowledged unpair.`);
    } catch (err) {
      console.warn(`[LAN Revocation] Remote device '${existing.device_name}' was offline or unreachable: ${err.message}`);
      remoteNotified = false;
      remoteMessage = 'Device removed locally. Remote revocation will be enforced when the device reconnects.';
    } finally {
      resetDeviceSequence(id);
    }
  } else {
    resetDeviceSequence(id);
    remoteNotified = false;
    remoteMessage = 'Device removed locally. Remote revocation will be enforced when the device reconnects.';
  }

  return res.json({
    success: true,
    deviceId: id,
    deviceName: existing.device_name,
    remoteNotified,
    message: remoteMessage
  });
});

/**
 * POST /api/lan/sync/outbound
 * Trigger outbound encrypted LAN sync from this node to a paired peer
 */
router.post('/sync/outbound', async (req, res) => {
  try {
    const deviceId = req.body?.deviceId || req.body?.targetDeviceId;
    const currentUserId = req.user ? req.user.id : 'usr_local_default';
    const localProfile = getPublicDeviceProfile();

    if (!deviceId) {
      return res.status(400).json({ error: 'deviceId is required to initiate outbound LAN sync.' });
    }

    const peer = LanPairingModel.getById(deviceId);
    if (!peer || peer.status !== 'TRUSTED') {
      return res.status(403).json({ error: 'Device is not paired or has been unshared/revoked.' });
    }

    if (!peer.device_ip) {
      return res.status(400).json({ error: 'Peer IP address is unknown. Discover peer first.' });
    }

    // 1. Gather notes with sync_mode === 'lan' or sync_mode === 'both'
    const selectedNoteIds = LanPairingModel.getDeviceSelectedNotes(peer.id);
    let eligibleNotes = NoteModel.getAll(currentUserId).filter(n => n.sync_mode === 'lan' || n.sync_mode === 'both');

    if (selectedNoteIds && selectedNoteIds.length > 0) {
      eligibleNotes = eligibleNotes.filter(n => selectedNoteIds.includes(n.id));
    }

    const notesWithContent = eligibleNotes.map(n => {
      const latestVer = VersionModel.getLatestForNote(n.id, currentUserId);
      return {
        ...n,
        content: readNoteFile(n.file_path),
        parent_version_id: latestVer ? latestVer.parent_version_id : null,
        current_version_id: latestVer ? latestVer.id : n.current_version_id
      };
    });
    const notebooks = NotebookModel.getAll(currentUserId);

    // 2. Transmit encrypted payload over LAN transport
    const peerPort = peer.device_port || 5000;
    let remoteData;
    try {
      remoteData = await sendEncryptedLanSync(
        peer.device_ip,
        peerPort,
        localProfile,
        peer,
        { notes: notesWithContent, notebooks }
      );
    } catch (syncErr) {
      console.warn(`[LAN Outbound Sync] Sync to peer '${peer.id}' failed: ${syncErr.message}`);
      throw syncErr;
    }

    // 3. Ingest received peer changes through existing note and version control engine
    const { appliedNotes, conflicts } = await applyIncomingNotesAndNotebooks(
      remoteData.localLanNotes || [],
      remoteData.localNotebooks || [],
      peer,
      currentUserId
    );

    // 4. Update last seen timestamp
    LanPairingModel.updateLastSeen(peer.id, peer.device_ip, peerPort);

    return res.json({
      success: true,
      deviceId: peer.id,
      deviceName: peer.device_name,
      appliedCount: appliedNotes.length,
      conflictCount: conflicts.length,
      conflicts,
      details: appliedNotes
    });
  } catch (err) {
    console.error('Error during outbound LAN sync:', err);
    return res.status(500).json({ error: `Outbound LAN sync failed: ${err.message}` });
  }
});

module.exports = router;
