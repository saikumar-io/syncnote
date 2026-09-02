const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const os = require('os');
const http = require('http');
const { requireAuth } = require('../middleware/authMiddleware');
const { 
  LanPairingModel, 
  NoteModel, 
  NotebookModel,
  VersionModel
} = require('../db/database');
const { writeNoteFile, readNoteFile, getNoteFilePath, calculateHash, generateVersionId } = require('../utils/fileStorage');
const {
  getPublicDeviceProfile,
  deriveSharedSessionKey,
  encryptLanPayload,
  decryptLanPayload
} = require('../utils/deviceCrypto');

// In-memory store for active pairing PIN codes (5 min expiration)
const activePairingCodes = new Map();
// Sequence counter for outgoing LAN sync messages
let outgoingSequenceCounter = 1;

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

// Require authentication for all LAN endpoints
router.use(requireAuth);

/**
 * GET /api/lan/info
 * Returns local device public identity profile (NEVER includes private key)
 */
router.get('/info', (req, res) => {
  const profile = getPublicDeviceProfile();
  return res.json({
    ...profile,
    syncnoteVersion: '1.0.0',
    port: process.env.PORT || 5000,
    ipAddresses: getLocalIpAddresses(),
    lanSyncAvailable: true,
    userId: req.user ? req.user.id : 'usr_local_default',
    userEmail: req.user ? req.user.email : 'local@syncnote'
  });
});

/**
 * GET /api/lan/discover
 * Discover nearby SyncNote instances on the local subnet
 */
router.get('/discover', async (req, res) => {
  try {
    const localIps = getLocalIpAddresses();
    const discovered = [];
    const currentUserId = req.user ? req.user.id : 'usr_local_default';
    const pairedDevices = LanPairingModel.getPairedDevices(currentUserId);
    const pairedMap = new Map();
    pairedDevices.forEach(d => pairedMap.set(d.id, d));

    const targetSubnets = localIps.map(ip => ip.substring(0, ip.lastIndexOf('.')));
    const scanPromises = [];

    for (const subnet of targetSubnets) {
      for (let i = 1; i <= 25; i++) {
        const targetIp = `${subnet}.${i}`;
        if (localIps.includes(targetIp)) continue;

        scanPromises.push(new Promise((resolve) => {
          const reqOpt = {
            hostname: targetIp,
            port: process.env.PORT || 5000,
            path: '/api/lan/info',
            method: 'GET',
            timeout: 600,
            headers: req.headers.cookie ? { 'Cookie': req.headers.cookie } : {}
          };

          const lanReq = http.request(reqOpt, (lanRes) => {
            let body = '';
            lanRes.on('data', chunk => body += chunk);
            lanRes.on('end', () => {
              try {
                if (lanRes.statusCode === 200) {
                  const data = JSON.parse(body);
                  if (data.deviceId && data.lanSyncAvailable) {
                    const isPaired = pairedMap.has(data.deviceId);
                    const pairedInfo = pairedMap.get(data.deviceId);
                    const status = isPaired ? 'Connected' : 'Not paired';

                    discovered.push({
                      ...data,
                      ip: targetIp,
                      status,
                      isPaired
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

    await Promise.all(scanPromises);

    return res.json({
      success: true,
      localDevice: getPublicDeviceProfile(),
      discovered
    });
  } catch (err) {
    return res.status(500).json({ error: 'LAN discovery failed', details: err.message });
  }
});

/**
 * POST /api/lan/pair/generate-code
 * Generate a single-use 6-digit cryptographic PIN code (5 min TTL)
 */
router.post('/pair/generate-code', (req, res) => {
  const profile = getPublicDeviceProfile();
  // Generate random 6-digit numeric PIN
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
  const { code, remoteDeviceId, remoteDeviceName, remotePublicKey, remoteDeviceType } = req.body || {};
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

  // Account restriction check (Requirement 11)
  if (stored.userId && currentUserId && stored.userId !== 'usr_local_default' && currentUserId !== 'usr_local_default' && stored.userId !== currentUserId) {
    return res.status(400).json({ error: 'This device belongs to a different SyncNote account.' });
  }

  // Single-use code invalidation
  activePairingCodes.delete(cleanCode);

  const pairingToken = crypto.randomBytes(32).toString('hex');
  const localProfile = getPublicDeviceProfile();

  // Create trusted pairing relationship in SQLite
  const pairedDevice = LanPairingModel.createPairing({
    id: remoteDeviceId,
    deviceName: remoteDeviceName || 'Remote SyncNote Device',
    deviceIp: req.ip,
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
  const { remoteDeviceId, remoteDeviceName, remotePublicKey, remoteDeviceType, remoteUserId } = req.body || {};
  const currentUserId = req.user ? req.user.id : 'usr_local_default';

  if (!remoteDeviceId || !remotePublicKey) {
    return res.status(400).json({ error: 'Missing required parameters for direct device pairing.' });
  }

  // Account restriction check (Requirement 11)
  if (remoteUserId && currentUserId && remoteUserId !== 'usr_local_default' && currentUserId !== 'usr_local_default' && remoteUserId !== currentUserId) {
    return res.status(400).json({ error: 'This device belongs to a different SyncNote account.' });
  }

  const pairingToken = crypto.randomBytes(32).toString('hex');
  const pairedDevice = LanPairingModel.createPairing({
    id: remoteDeviceId,
    deviceName: remoteDeviceName || 'SyncNote Device',
    deviceIp: req.ip,
    pairingToken,
    publicKey: remotePublicKey,
    deviceType: remoteDeviceType || 'desktop',
    userId: currentUserId,
    status: 'TRUSTED'
  });

  return res.json({
    success: true,
    message: 'Direct cryptographic device pairing established successfully!',
    pairedDevice
  });
});

/**
 * GET /api/lan/devices
 * List all trusted & paired LAN devices for the user
 */
router.get('/devices', (req, res) => {
  const userId = req.user ? req.user.id : 'usr_local_default';
  const devices = LanPairingModel.getPairedDevices(userId);
  const localProfile = getPublicDeviceProfile();

  return res.json({
    success: true,
    localDevice: localProfile,
    devices: devices.map(d => ({
      id: d.id,
      deviceName: d.device_name,
      deviceType: d.device_type || 'desktop',
      deviceIp: d.device_ip,
      status: d.status,
      pairedAt: d.created_at,
      lastSeen: d.last_seen,
      publicKeyFingerprint: d.public_key ? d.public_key.substring(0, 16) + '...' : null,
      selectedNoteIds: LanPairingModel.getDeviceSelectedNotes(d.id)
    }))
  });
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
 * Revoke a paired LAN device (Immediate rejection of future LAN sync requests)
 */
router.delete('/devices/:id', (req, res) => {
  const { id } = req.params;
  const userId = req.user ? req.user.id : 'usr_local_default';

  const existing = LanPairingModel.getById(id);
  if (!existing) {
    return res.status(404).json({ error: 'Device not found.' });
  }

  const revoked = LanPairingModel.revokePairing(id, userId);
  console.log(`[LAN Revocation] Revoked LAN trust for device ${id}`);

  return res.json({
    success: true,
    message: `Device '${existing.device_name}' revoked successfully. Future LAN sync requests will be rejected.`,
    deviceId: id
  });
});

/**
 * POST /api/lan/sync
 * Authenticated & Encrypted LAN Sync endpoint (AES-256-GCM with replay protection)
 */
router.post('/sync', (req, res) => {
  try {
    const { envelope, plainSyncRequest } = req.body || {};
    const currentUserId = req.user ? req.user.id : 'usr_local_default';
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
      // Fallback for direct token-verified local testing requests
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

    // 4. Update sender device last seen
    LanPairingModel.updateLastSeen(senderDevice.id, req.ip);

    // 5. STRICT ISOLATION FILTER: ONLY notes with sync_mode === "lan" may participate in LAN sync!
    const incomingNotes = (decryptedPayload.notes || []).filter(n => n.sync_mode === 'lan');
    const incomingNotebooks = decryptedPayload.notebooks || [];

    const appliedNotes = [];
    const conflicts = [];

    // Apply Notebooks
    for (const nb of incomingNotebooks) {
      const existingNb = NotebookModel.getById(nb.id, currentUserId);
      if (!existingNb) {
        NotebookModel.create(nb.id, nb.name, currentUserId);
      }
    }

    // Apply LAN Notes
    for (const remoteNote of incomingNotes) {
      // Double check note mode guarantee
      if (remoteNote.sync_mode !== 'lan') {
        continue; // Strictly skip non-lan notes
      }

      const existing = NoteModel.getById(remoteNote.id, currentUserId);

      if (existing) {
        const localContent = readNoteFile(existing.file_path);
        const contentChanged = localContent !== remoteNote.content;

        if (contentChanged) {
          conflicts.push({
            noteId: existing.id,
            title: existing.title,
            localContent,
            remoteContent: remoteNote.content,
            localUpdated: existing.updated_at,
            remoteUpdated: remoteNote.updated_at,
            deviceName: senderDevice.device_name
          });

          // Create conflict copy note preserving both versions
          const conflictTitle = `${existing.title} (LAN Conflict from ${senderDevice.device_name})`;
          const conflictPath = getNoteFilePath(conflictTitle, 'General Notes');
          writeNoteFile(conflictPath, remoteNote.content || '');

          NoteModel.create(
            `note_conflict_${Date.now()}`,
            conflictTitle,
            conflictPath,
            existing.notebook_id,
            calculateHash(remoteNote.content || ''),
            generateVersionId(),
            currentUserId,
            'lan'
          );
        } else {
          appliedNotes.push(existing.id);
        }
      } else {
        // Safe import for new LAN note
        const filePath = getNoteFilePath(remoteNote.title || 'Untitled LAN Note', 'General Notes');
        writeNoteFile(filePath, remoteNote.content || '');
        const hash = calculateHash(remoteNote.content || '');
        const verId = generateVersionId();

        NoteModel.create(
          remoteNote.id,
          remoteNote.title,
          filePath,
          remoteNote.notebook_id,
          hash,
          verId,
          currentUserId,
          'lan'
        );
        appliedNotes.push(remoteNote.id);
      }
    }

    // Prepare encrypted response payload containing local LAN notes (strictly sync_mode === 'lan')
    const localLanNotes = NoteModel.getAll(currentUserId)
      .filter(n => n.sync_mode === 'lan')
      .map(n => ({ ...n, content: readNoteFile(n.file_path) }));
    const localNotebooks = NotebookModel.getAll(currentUserId);

    const responseData = {
      appliedCount: appliedNotes.length,
      conflictCount: conflicts.length,
      conflicts,
      localLanNotes,
      localNotebooks
    };

    if (senderDevice && senderDevice.public_key) {
      const sessionKey = deriveSharedSessionKey(senderDevice.public_key);
      const seq = outgoingSequenceCounter++;
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

module.exports = router;
