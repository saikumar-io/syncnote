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
  reconstructVersionContent
} = require('../utils/versionControl');
const { discoverDevicesUDP } = require('../utils/lanDiscoveryService');
const {
  checkPeerReachable,
  sendPairingRequest,
  pollPairingStatus,
  sendEncryptedLanSync,
  sendEncryptedLanUnpair,
  sendEncryptedLanHeartbeat
} = require('../utils/lanTransport');

// In-memory store for active pairing PIN codes (5 min expiration)
const activePairingCodes = new Map();

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
 * Ingest incoming notes and notebooks from a paired peer,
 * passing through the existing note storage and version control engine.
 * Ensures complete idempotency and zero duplicate versions.
 */
function applyIncomingNotesAndNotebooks(incomingNotes = [], incomingNotebooks = [], senderDevice, currentUserId) {
  const appliedNotes = [];
  const conflicts = [];

  const syncTx = db.transaction(() => {
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
          // If local has default placeholder name, adopt the peer's specific name; otherwise preserve local name
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

        // Contents differ: check if remote note is an update of latest local checkpoint
        const latestLocalVersion = VersionModel.getLatestForNote(existing.id, currentUserId);
        const isFastForward = Boolean(
          latestLocalVersion &&
          (remoteNote.parent_version_id === latestLocalVersion.id ||
           remoteNote.previous_content_hash === latestLocalVersion.content_hash ||
           localContent.trim().length === 0)
        );

        if (isFastForward) {
          // Safe fast-forward update from peer (Case 3)
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

          appliedNotes.push({ id: existing.id, action: 'UPDATED' });
        } else {
          // Case 4: Concurrent Conflict: Both sides modified independently
          conflicts.push({
            noteId: existing.id,
            title: existing.title,
            localContent,
            remoteContent,
            localUpdated: existing.updated_at,
            remoteUpdated: remoteNote.updated_at,
            deviceName: senderDevice.device_name || senderDevice.deviceName || 'Remote Peer'
          });

          // Existing conflict handling: Create conflict copy note preserving both versions
          const conflictTitle = `${existing.title} (LAN Conflict from ${senderDevice.device_name || senderDevice.deviceName || 'Peer'})`;
          const conflictPath = getNoteFilePath(conflictTitle, 'General Notes');
          writeNoteFile(conflictPath, remoteContent);

          const conflictNoteId = `note_conflict_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
          const diffHunks = computeLineDiffHunks('', remoteContent);
          const conflictVerId = `v1_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

          NoteModel.create(
            conflictNoteId,
            conflictTitle,
            conflictPath,
            existing.notebook_id,
            remoteHash,
            conflictVerId,
            currentUserId,
            remoteNote.sync_mode || 'lan'
          );

          VersionModel.createCheckpointTransaction({
            id: conflictVerId,
            note_id: conflictNoteId,
            version_number: 1,
            parent_version_id: null,
            message: `Conflict copy created from ${senderDevice.device_name || senderDevice.deviceName || 'Peer'}`,
            device_id: senderDevice.id || senderDevice.deviceId,
            created_at: new Date().toISOString(),
            content_hash: remoteHash,
            is_snapshot: 0,
            is_auto: 0
          }, diffHunks, conflictNoteId, currentUserId);

          SessionModel.upsert(conflictNoteId, conflictVerId, remoteHash, 'clean', currentUserId);
          appliedNotes.push({ id: existing.id, action: 'CONFLICT_COPY_CREATED', conflictNoteId });
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
        appliedNotes.push({ id: remoteNote.id, action: 'CREATED' });
      }
    }

    return { appliedNotes, conflicts };
  });

  return syncTx();
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
 * POST /api/lan/pair/request
 * Peer-to-Peer: Remote device submits explicit pairing request to this device.
 */
router.post('/pair/request', (req, res) => {
  try {
    const { 
      requesterDeviceId, 
      requesterDeviceName, 
      requesterDeviceType, 
      requesterPublicKey, 
      requesterUserId, 
      requesterPort 
    } = req.body || {};

    if (!requesterDeviceId || !requesterPublicKey) {
      return res.status(400).json({ error: 'Missing required pairing parameters (requesterDeviceId, requesterPublicKey).' });
    }

    const localProfile = getPublicDeviceProfile();
    if (requesterDeviceId === localProfile.deviceId) {
      return res.status(400).json({ error: 'Cannot pair a device with itself.' });
    }

    const requesterIp = req.ip || req.socket?.remoteAddress;

    // Check if already paired with TRUSTED status
    const alreadyPaired = LanPairingModel.getById(requesterDeviceId);
    if (alreadyPaired && alreadyPaired.status === 'TRUSTED') {
      // Re-validate and update public key, IP, port in case peer reconnected or renewed keys
      LanPairingModel.createPairing({
        id: requesterDeviceId,
        deviceName: requesterDeviceName || alreadyPaired.device_name,
        deviceIp: requesterIp,
        devicePort: requesterPort || alreadyPaired.device_port || 5000,
        pairingToken: alreadyPaired.pairing_token,
        publicKey: requesterPublicKey || alreadyPaired.public_key,
        deviceType: requesterDeviceType || alreadyPaired.device_type || 'desktop',
        userId: currentUserId,
        status: 'TRUSTED'
      });
      resetDeviceSequence(requesterDeviceId);
      return res.json({
        success: true,
        requestId: `req_already_paired_${Date.now()}`,
        status: 'APPROVED',
        approved: true,
        alreadyPaired: true,
        message: 'Device already paired and trusted.',
        localDevice: localProfile,
        pairingToken: alreadyPaired.pairing_token
      });
    }

    // Persist pending pairing request for explicit local user approval
    const existingReq = LanPairingRequestModel.getByRequesterId(requesterDeviceId, requesterUserId || 'usr_local_default');
    if (existingReq && existingReq.status === 'PENDING') {
      const isRecent = (Date.now() - new Date(existingReq.created_at).getTime()) < 60000;
      const sameKey = existingReq.requester_public_key === requesterPublicKey;
      if (isRecent && sameKey) {
        return res.json({
          success: true,
          requestId: existingReq.id,
          status: 'PENDING',
          message: 'Pairing request already pending approval.'
        });
      }
    }

    const newReq = LanPairingRequestModel.create({
      requesterDeviceId,
      requesterDeviceName: requesterDeviceName || 'SyncNote Device',
      requesterDeviceType: requesterDeviceType || 'desktop',
      requesterDeviceIp: requesterIp,
      requesterPort: requesterPort || 5000,
      requesterPublicKey,
      requesterUserId: requesterUserId || 'usr_local_default',
      targetUserId: 'usr_local_default'
    });

    console.log(`[LAN Pairing] Received pairing request from '${requesterDeviceName}' (${requesterDeviceId}). Awaiting user approval.`);

    return res.json({
      success: true,
      requestId: newReq.id,
      status: 'PENDING',
      message: 'Pairing request received. Waiting for user approval on this device.'
    });
  } catch (err) {
    console.error('Error handling pairing request:', err);
    return res.status(500).json({ error: 'Failed to process pairing request', details: err.message });
  }
});

/**
 * GET /api/lan/pair/status/:requestId
 * Peer-to-Peer: Remote requester polls for approval status
 */
router.get('/pair/status/:requestId', (req, res) => {
  try {
    const { requestId } = req.params;
    const pairingReq = LanPairingRequestModel.getById(requestId);

    if (!pairingReq) {
      return res.status(404).json({ error: 'Pairing request not found or expired.' });
    }

    const localProfile = getPublicDeviceProfile();

    if (pairingReq.status === 'APPROVED') {
      return res.json({
        requestId: pairingReq.id,
        status: 'APPROVED',
        approved: true,
        pairingToken: pairingReq.pairing_token,
        localDevice: localProfile
      });
    }

    if (pairingReq.status === 'REJECTED') {
      return res.json({
        requestId: pairingReq.id,
        status: 'REJECTED',
        approved: false,
        message: 'Pairing request was declined by the user.'
      });
    }

    return res.json({
      requestId: pairingReq.id,
      status: 'PENDING',
      approved: false,
      message: 'Waiting for approval.'
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to query pairing status', details: err.message });
  }
});

/**
 * POST /api/lan/sync
 * Authenticated & Encrypted Inbound LAN Sync endpoint (AES-256-GCM with replay protection)
 */
router.post('/sync', (req, res) => {
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
    const { appliedNotes, conflicts } = applyIncomingNotesAndNotebooks(
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

    const localNotesWithContent = localNotes.map(n => ({
      ...n,
      content: readNoteFile(n.file_path)
    }));
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
    resetDeviceSequence(senderDeviceId);
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

    // 5. Generate lightweight encrypted HEARTBEAT_ACK
    const ackSeq = getNextOutgoingSequence(senderDevice.id);
    const ackPayload = {
      type: 'HEARTBEAT_ACK',
      ackDeviceId: localProfile.deviceId,
      timestamp: Date.now()
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
 * Discover nearby SyncNote instances on the local subnet via UDP Broadcast & Subnet Scanning
 */
router.get('/discover', async (req, res) => {
  try {
    const localIps = getLocalIpAddresses();
    const localProfile = getPublicDeviceProfile();
    const currentUserId = req.user ? req.user.id : 'usr_local_default';
    const pairedDevices = LanPairingModel.getPairedDevices(currentUserId);
    const pairedMap = new Map();
    pairedDevices.forEach(d => pairedMap.set(d.id, d));

    const discoveredMap = new Map();

    // 1. Run Background UDP Broadcast Probe (1.0s)
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

    // 2. Perform Subnet Scanning on standard ports (.1 to .254)
    const targetSubnets = localIps.map(ip => ip.substring(0, ip.lastIndexOf('.')));
    const scanPromises = [];
    const scanPort = parseInt(process.env.PORT || '5000', 10);

    for (const subnet of targetSubnets) {
      for (let i = 1; i <= 254; i++) {
        const targetIp = `${subnet}.${i}`;
        // Skip scanning own primary IP on same port
        if (localIps.includes(targetIp)) continue;

        scanPromises.push(new Promise((resolve) => {
          const reqOpt = {
            hostname: targetIp,
            port: scanPort,
            path: '/api/lan/info',
            method: 'GET',
            timeout: 400
          };

          const lanReq = http.request(reqOpt, (lanRes) => {
            let body = '';
            lanRes.on('data', chunk => body += chunk);
            lanRes.on('end', () => {
              try {
                if (lanRes.statusCode === 200) {
                  const data = JSON.parse(body);
                  if (data.deviceId && data.deviceId !== localProfile.deviceId && data.lanSyncAvailable) {
                    discoveredMap.set(data.deviceId, {
                      ...data,
                      ip: targetIp,
                      port: scanPort
                    });
                  }
                }
              } catch (e) {}
              resolve();
            });
          });

          lanReq.on('error', () => resolve());
          lanReq.on('timeout', () => { lanReq.destroy(); resolve(); });
          lanReq.end();
        }));
      }
    }

    // Also check localhost alternate test ports (e.g. 5000, 5002) for local multi-instance testing
    const testPorts = [5000, 5002].filter(p => p !== scanPort);
    for (const testPort of testPorts) {
      scanPromises.push(new Promise((resolve) => {
        const reqOpt = {
          hostname: '127.0.0.1',
          port: testPort,
          path: '/api/lan/info',
          method: 'GET',
          timeout: 400
        };

        const lanReq = http.request(reqOpt, (lanRes) => {
          let body = '';
          lanRes.on('data', chunk => body += chunk);
          lanRes.on('end', () => {
            try {
              if (lanRes.statusCode === 200) {
                const data = JSON.parse(body);
                if (data.deviceId && data.deviceId !== localProfile.deviceId) {
                  discoveredMap.set(data.deviceId, {
                    ...data,
                    ip: '127.0.0.1',
                    port: testPort
                  });
                }
              }
            } catch (e) {}
            resolve();
          });
        });

        lanReq.on('error', () => resolve());
        lanReq.on('timeout', () => { lanReq.destroy(); resolve(); });
        lanReq.end();
      }));
    }

    // Run scans in batches
    const BATCH_SIZE = 40;
    for (let b = 0; b < scanPromises.length; b += BATCH_SIZE) {
      const batch = scanPromises.slice(b, b + BATCH_SIZE);
      await Promise.all(batch);
    }

    // Format & annotate discovered devices
    const discovered = Array.from(discoveredMap.values()).map(dev => {
      const targetId = dev.deviceId || dev.id;
      const isPaired = pairedMap.has(targetId);

      if (isPaired && dev.ip) {
        LanPairingModel.updateLastSeen(targetId, dev.ip, dev.port || 5000);
      }

      return {
        ...dev,
        status: isPaired ? 'Connected' : 'Not paired',
        isPaired
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
 * UI: List pending pairing requests waiting for this user's approval
 */
router.get('/pair/pending', (req, res) => {
  try {
    const currentUserId = req.user ? req.user.id : 'usr_local_default';
    const pending = LanPairingRequestModel.getPendingForUser(currentUserId);
    return res.json({ success: true, pending });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch pending pairing requests', details: err.message });
  }
});

/**
 * POST /api/lan/pair/approve
 * UI: User explicitly approves an incoming pairing request
 */
router.post('/pair/approve', (req, res) => {
  try {
    const { requestId } = req.body || {};
    const currentUserId = req.user ? req.user.id : 'usr_local_default';

    if (!requestId) {
      return res.status(400).json({ error: 'Missing requestId parameter.' });
    }

    const pairingReq = LanPairingRequestModel.getById(requestId);
    if (!pairingReq) {
      return res.status(404).json({ error: 'Pairing request not found.' });
    }

    // Generate high-entropy pairing token
    const pairingToken = crypto.randomBytes(32).toString('hex');
    LanPairingRequestModel.approve(requestId, pairingToken);

    // Save as TRUSTED in lan_paired_devices table
    const pairedDevice = LanPairingModel.createPairing({
      id: pairingReq.requester_device_id,
      deviceName: pairingReq.requester_device_name,
      deviceIp: pairingReq.requester_device_ip,
      devicePort: pairingReq.requester_port || 5000,
      pairingToken,
      publicKey: pairingReq.requester_public_key,
      deviceType: pairingReq.requester_device_type || 'desktop',
      userId: currentUserId,
      status: 'TRUSTED'
    });

    resetDeviceSequence(pairingReq.requester_device_id);

    console.log(`[LAN Pairing Approval] User approved device '${pairingReq.requester_device_name}' (${pairingReq.requester_device_id})`);

    return res.json({
      success: true,
      message: `Device '${pairingReq.requester_device_name}' approved and paired.`,
      pairedDevice
    });
  } catch (err) {
    console.error('Error approving pairing request:', err);
    return res.status(500).json({ error: 'Failed to approve pairing request', details: err.message });
  }
});

/**
 * POST /api/lan/pair/reject
 * UI: User explicitly rejects an incoming pairing request
 */
router.post('/pair/reject', (req, res) => {
  try {
    const { requestId } = req.body || {};
    if (!requestId) return res.status(400).json({ error: 'Missing requestId parameter.' });

    const updated = LanPairingRequestModel.reject(requestId);
    return res.json({ success: true, message: 'Pairing request rejected.', request: updated });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to reject pairing request', details: err.message });
  }
});

/**
 * POST /api/lan/pair/send-request
 * UI: Send an explicit pairing request to a discovered remote peer
 */
router.post('/pair/send-request', async (req, res) => {
  try {
    const { remoteIp, remotePort, remoteDeviceId } = req.body || {};
    const localProfile = getPublicDeviceProfile();
    const currentUserId = req.user ? req.user.id : 'usr_local_default';

    if (!remoteIp) {
      return res.status(400).json({ error: 'Remote IP address is required.' });
    }

    const targetPort = remotePort || 5000;
    const requestResult = await sendPairingRequest(remoteIp, targetPort, localProfile, currentUserId);

    // If remote peer was already trusted or immediately approved:
    if (requestResult && (requestResult.status === 'APPROVED' || requestResult.alreadyPaired) && requestResult.localDevice) {
      const remoteDevId = requestResult.localDevice.deviceId || remoteDeviceId;
      const pairedDev = LanPairingModel.createPairing({
        id: remoteDevId,
        deviceName: requestResult.localDevice.deviceName || 'Remote Device',
        deviceIp: remoteIp,
        devicePort: targetPort,
        pairingToken: requestResult.pairingToken || crypto.randomBytes(32).toString('hex'),
        publicKey: requestResult.localDevice.publicKey,
        deviceType: requestResult.localDevice.deviceType || 'desktop',
        userId: currentUserId,
        status: 'TRUSTED'
      });
      resetDeviceSequence(remoteDevId);

      return res.json({
        success: true,
        status: 'APPROVED',
        approved: true,
        alreadyPaired: true,
        pairedDevice: pairedDev,
        remoteDeviceId: remoteDevId,
        remoteIp,
        remotePort: targetPort,
        ...requestResult
      });
    }

    return res.json({
      success: true,
      remoteDeviceId,
      remoteIp,
      remotePort: targetPort,
      ...requestResult
    });
  } catch (err) {
    return res.status(500).json({ error: `Pairing request failed: ${err.message}` });
  }
});

/**
 * POST /api/lan/pair/check-status
 * UI: Poll whether remote peer has approved our submitted pairing request
 */
router.post('/pair/check-status', async (req, res) => {
  try {
    const { remoteIp, remotePort, requestId, remoteDeviceId, remoteDeviceName, remotePublicKey, remoteDeviceType } = req.body || {};
    const currentUserId = req.user ? req.user.id : 'usr_local_default';

    if (!remoteIp || !requestId) {
      return res.status(400).json({ error: 'remoteIp and requestId are required.' });
    }

    const statusData = await pollPairingStatus(remoteIp, remotePort || 5000, requestId);

    if (statusData.status === 'APPROVED' && statusData.approved) {
      // Remote approved! Persist trusted peer record locally
      const pairedDev = LanPairingModel.createPairing({
        id: statusData.localDevice?.deviceId || remoteDeviceId,
        deviceName: statusData.localDevice?.deviceName || remoteDeviceName || 'Remote Device',
        deviceIp: remoteIp,
        devicePort: remotePort || 5000,
        pairingToken: statusData.pairingToken || crypto.randomBytes(32).toString('hex'),
        publicKey: statusData.localDevice?.publicKey || remotePublicKey,
        deviceType: statusData.localDevice?.deviceType || remoteDeviceType || 'desktop',
        userId: currentUserId,
        status: 'TRUSTED'
      });
      resetDeviceSequence(statusData.localDevice?.deviceId || remoteDeviceId);

      return res.json({
        success: true,
        status: 'APPROVED',
        pairedDevice: pairedDev
      });
    }

    return res.json(statusData);
  } catch (err) {
    return res.status(500).json({ error: `Failed to check pairing status: ${err.message}` });
  }
});

/**
 * POST /api/lan/pair/generate-code
 * Generate a single-use 6-digit cryptographic PIN code (5 min TTL)
 */
router.post('/pair/generate-code', (req, res) => {
  const profile = getPublicDeviceProfile();
  const num = crypto.randomInt(100000, 999999);
  const formattedCode = `${num.toString().slice(0, 3)} ${num.toString().slice(3)}`;
  const rawCode = num.toString();

  const codeData = {
    code: formattedCode,
    rawCode,
    deviceId: profile.deviceId,
    deviceName: profile.deviceName,
    publicKey: profile.publicKey,
    userId: req.user ? req.user.id : 'usr_local_default',
    createdAt: Date.now(),
    expiresAt: Date.now() + 5 * 60 * 1000
  };

  activePairingCodes.set(rawCode, codeData);

  return res.json({
    success: true,
    pairingCode: formattedCode,
    expiresInSeconds: 300,
    device: profile
  });
});

/**
 * POST /api/lan/pair/verify-code
 * Submit pairing PIN code from remote device to establish mutual cryptographic trust
 */
router.post('/pair/verify-code', (req, res) => {
  const { code, remoteDeviceId, remoteDeviceName, remotePublicKey, remoteDeviceType, remoteDevicePort } = req.body || {};
  const cleanCode = (code || '').replace(/\s+/g, '');
  const currentUserId = req.user ? req.user.id : 'usr_local_default';

  if (!cleanCode || !remoteDeviceId || !remotePublicKey) {
    return res.status(400).json({ error: 'Missing required pairing parameters (code, deviceId, publicKey)' });
  }

  const stored = activePairingCodes.get(cleanCode);

  if (!stored) {
    return res.status(400).json({ error: 'Invalid or expired pairing code. Please generate a new code.' });
  }

  if (Date.now() > stored.expiresAt) {
    activePairingCodes.delete(cleanCode);
    return res.status(400).json({ error: 'Pairing code has expired.' });
  }

  if (stored.userId && currentUserId && stored.userId !== 'usr_local_default' && currentUserId !== 'usr_local_default' && stored.userId !== currentUserId) {
    return res.status(400).json({ error: 'This device belongs to a different SyncNote account.' });
  }

  activePairingCodes.delete(cleanCode);

  const pairingToken = crypto.randomBytes(32).toString('hex');
  const localProfile = getPublicDeviceProfile();

  const pairedDevice = LanPairingModel.createPairing({
    id: remoteDeviceId,
    deviceName: remoteDeviceName || 'Remote SyncNote Device',
    deviceIp: req.ip,
    devicePort: remoteDevicePort || 5000,
    pairingToken,
    publicKey: remotePublicKey,
    deviceType: remoteDeviceType || 'desktop',
    userId: currentUserId,
    status: 'TRUSTED'
  });

  return res.json({
    success: true,
    message: 'Mutual cryptographic pairing completed successfully!',
    pairedDevice,
    localDevice: localProfile,
    pairingToken
  });
});

/**
 * POST /api/lan/pair/direct
 * Direct pairing with a discovered same-account device
 */
router.post('/pair/direct', (req, res) => {
  const { remoteDeviceId, remoteDeviceName, remotePublicKey, remoteDeviceType, remoteUserId, remoteDevicePort, remoteDeviceIp } = req.body || {};
  const currentUserId = req.user ? req.user.id : 'usr_local_default';

  if (!remoteDeviceId || !remotePublicKey) {
    return res.status(400).json({ error: 'Missing required parameters for direct device pairing.' });
  }

  if (remoteUserId && currentUserId && remoteUserId !== 'usr_local_default' && currentUserId !== 'usr_local_default' && remoteUserId !== currentUserId) {
    return res.status(400).json({ error: 'This device belongs to a different SyncNote account.' });
  }

  const pairingToken = crypto.randomBytes(32).toString('hex');
  const pairedDevice = LanPairingModel.createPairing({
    id: remoteDeviceId,
    deviceName: remoteDeviceName || 'SyncNote Device',
    deviceIp: remoteDeviceIp || req.ip,
    devicePort: remoteDevicePort || 5000,
    pairingToken,
    publicKey: remotePublicKey,
    deviceType: remoteDeviceType || 'desktop',
    userId: currentUserId,
    status: 'TRUSTED'
  });

  resetDeviceSequence(remoteDeviceId);

  return res.json({
    success: true,
    message: 'Direct cryptographic device pairing established successfully!',
    pairedDevice
  });
});

/**
 * GET /api/lan/devices
 * List all trusted & paired LAN devices for the user with reachability status
 */
router.get('/devices', async (req, res) => {
  try {
    const userId = req.user ? req.user.id : 'usr_local_default';
    const devices = LanPairingModel.getPairedDevices(userId);
    const localProfile = getPublicDeviceProfile();

    // Check reachability for devices using lightweight authenticated heartbeat
    const deviceStatuses = await Promise.all(devices.map(async (d) => {
      let isOnline = false;
      if (d.device_ip && d.public_key) {
        try {
          const hb = await sendEncryptedLanHeartbeat(d.device_ip, d.device_port || 5000, localProfile, d);
          if (hb && hb.ok) {
            isOnline = true;
            LanPairingModel.updateLastSeen(d.id, d.device_ip, d.device_port || 5000);
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
    return res.status(500).json({ error: 'Failed to list paired devices', details: err.message });
  }
});

/**
 * GET /api/lan/devices/presence
 * Automatic background presence checking for every paired device.
 * Runs lightweight authenticated encrypted heartbeat in parallel (~2s timeout).
 * Updates last_seen timestamp in database for online peers.
 * Never transfers notes, notebooks, or versions.
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
          error: 'Missing IP or public key'
        };
      }

      try {
        const peerPort = d.device_port || 5000;
        const hbResult = await sendEncryptedLanHeartbeat(d.device_ip, peerPort, localProfile, d);

        if (hbResult && hbResult.ok) {
          const nowIso = new Date().toISOString();
          LanPairingModel.updateLastSeen(d.id, d.device_ip, peerPort);
          return {
            id: d.id,
            deviceName: d.device_name,
            isOnline: true,
            lastSeen: nowIso,
            latencyMs: hbResult.latencyMs
          };
        } else if (hbResult && hbResult.revoked) {
          // Peer informed us that we were unpaired/revoked while offline
          console.warn(`[LAN Presence] Peer '${d.device_name}' (${d.id}) revoked pairing. Revoking locally.`);
          LanPairingModel.revokePairing(d.id, userId);
          return {
            id: d.id,
            deviceName: d.device_name,
            isOnline: false,
            revoked: true,
            error: 'UNPAIRED_DEVICE'
          };
        } else {
          return {
            id: d.id,
            deviceName: d.device_name,
            isOnline: false,
            lastSeen: d.last_seen,
            error: hbResult?.error || 'Unreachable'
          };
        }
      } catch (err) {
        return {
          id: d.id,
          deviceName: d.device_name,
          isOnline: false,
          lastSeen: d.last_seen,
          error: err.message
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
  resetDeviceSequence(id);
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
    }
  } else {
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

    const notesWithContent = eligibleNotes.map(n => ({
      ...n,
      content: readNoteFile(n.file_path)
    }));
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
      if (syncErr.message && (
        syncErr.message.includes('UNPAIRED_DEVICE') ||
        syncErr.message.includes('not paired') ||
        syncErr.message.includes('revoked')
      )) {
        console.warn(`[LAN Outbound Sync] Peer '${peer.id}' rejected connection as revoked. Revoking locally.`);
        LanPairingModel.revokePairing(peer.id, currentUserId);
      }
      throw syncErr;
    }

    // 3. Ingest received peer changes through existing note and version control engine
    const { appliedNotes, conflicts } = applyIncomingNotesAndNotebooks(
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
