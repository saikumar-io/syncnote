const http = require('http');
const {
  getPublicDeviceProfile,
  deriveSharedSessionKey,
  getNextOutgoingSequence,
  encryptLanPayload,
  decryptLanPayload
} = require('./deviceCrypto');

/**
 * Perform HTTP request with timeout
 */
function httpRequest(options, postData = null, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      ...options,
      timeout: timeoutMs
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, data, raw: true });
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Connection timeout after ${timeoutMs}ms to ${options.hostname}:${options.port}`));
    });

    if (postData) {
      req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
    }
    req.end();
  });
}

/**
 * Check if a peer is reachable on LAN
 */
async function checkPeerReachable(remoteIp, remotePort = 5000, timeoutMs = 1500) {
  try {
    const res = await httpRequest({
      hostname: remoteIp,
      port: remotePort,
      path: '/api/lan/info',
      method: 'GET'
    }, null, timeoutMs);

    return res.status === 200 && res.data && res.data.deviceId;
  } catch (err) {
    return false;
  }
}

/**
 * Send an explicit connection handshake to a discovered peer on LAN
 */
async function sendLanConnect(remoteIp, remotePort = 5000, localProfile, localUserId = 'usr_local_default') {
  const payload = {
    deviceId: localProfile.deviceId,
    deviceName: localProfile.deviceName,
    deviceType: localProfile.deviceType || 'desktop',
    publicKey: localProfile.publicKey,
    port: parseInt(process.env.PORT || '5000', 10),
    userId: localUserId
  };

  const res = await httpRequest({
    hostname: remoteIp,
    port: remotePort,
    path: '/api/lan/connect',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    }
  }, payload, 2500);

  return res;
}

/**
 * Send an explicit pairing request to a remote device
 */
async function sendPairingRequest(remoteIp, remotePort = 5000, localProfile, localUserId) {
  const payload = {
    requesterDeviceId: localProfile.deviceId,
    requesterDeviceName: localProfile.deviceName,
    requesterDeviceType: localProfile.deviceType || 'desktop',
    requesterPublicKey: localProfile.publicKey,
    requesterUserId: localUserId || 'usr_local_default',
    requesterPort: parseInt(process.env.PORT || '5000', 10)
  };

  const res = await httpRequest({
    hostname: remoteIp,
    port: remotePort,
    path: '/api/lan/pair/request',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    }
  }, payload, 4000);

  if (res.status >= 200 && res.status < 300) {
    return res.data;
  }

  throw new Error(res.data?.error || `Pairing request failed with status ${res.status}`);
}

/**
 * Poll pairing status for a submitted pairing request
 */
async function pollPairingStatus(remoteIp, remotePort = 5000, requestId) {
  const res = await httpRequest({
    hostname: remoteIp,
    port: remotePort,
    path: `/api/lan/pair/status/${encodeURIComponent(requestId)}`,
    method: 'GET'
  }, null, 3000);

  if (res.status === 200) {
    return res.data;
  }

  throw new Error(res.data?.error || `Pairing status query failed with status ${res.status}`);
}

/**
 * Send encrypted LAN synchronization payload to a remote paired device
 */
async function sendEncryptedLanSync(remoteIp, remotePort = 5000, localProfile, remoteDevice, syncPayload) {
  if (!remoteDevice.public_key) {
    throw new Error(`Cannot perform secure LAN sync: Missing public key for device '${remoteDevice.deviceName || remoteDevice.id}'`);
  }

  // 1. Derive shared symmetric AES-256 session key via ECDH key agreement
  const sessionKey = deriveSharedSessionKey(remoteDevice.public_key);
  const seq = getNextOutgoingSequence(remoteDevice.id);

  // 2. Encrypt payload into tamper-evident AES-256-GCM envelope
  const envelope = encryptLanPayload(
    syncPayload,
    sessionKey,
    seq,
    localProfile.deviceId,
    remoteDevice.id
  );

  // 3. Transmit envelope to peer endpoint
  const res = await httpRequest({
    hostname: remoteIp,
    port: remotePort,
    path: '/api/lan/sync',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    }
  }, { envelope }, 8000);

  if (res.status === 403) {
    throw new Error(res.data?.error || 'LAN Sync rejected: Device is not paired or has been unshared/revoked.');
  }

  if (res.status !== 200) {
    throw new Error(res.data?.error || `LAN Sync failed with HTTP ${res.status}`);
  }

  // 4. Decrypt received response envelope if encrypted
  if (res.data && res.data.encryptedEnvelope) {
    try {
      const decrypted = decryptLanPayload(
        res.data.encryptedEnvelope,
        sessionKey,
        remoteDevice.id,
        remoteDevice.public_key
      );
      return decrypted;
    } catch (cryptoErr) {
      throw new Error(`Failed to decrypt LAN sync response from peer: ${cryptoErr.message}`);
    }
  }

  if (res.data && res.data.data) {
    return res.data.data;
  }

  return res.data;
}

/**
 * Send an authenticated encrypted unpair control message to a remote paired device
 */
async function sendEncryptedLanUnpair(remoteIp, remotePort = 5000, localProfile, remoteDevice, unpairPayload = {}) {
  if (!remoteDevice.public_key) {
    throw new Error(`Cannot send secure unpair: Missing public key for device '${remoteDevice.deviceName || remoteDevice.id}'`);
  }

  const sessionKey = deriveSharedSessionKey(remoteDevice.public_key);
  const seq = getNextOutgoingSequence(remoteDevice.id);
  const requestId = unpairPayload.requestId || `unpair_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  const controlMessage = {
    type: 'UNPAIR_REQUEST',
    requestId,
    requestingDeviceId: localProfile.deviceId,
    targetDeviceId: remoteDevice.id,
    protocolVersion: '1.0.0',
    timestamp: Date.now()
  };

  const envelope = encryptLanPayload(
    controlMessage,
    sessionKey,
    seq,
    localProfile.deviceId,
    remoteDevice.id
  );

  const res = await httpRequest({
    hostname: remoteIp,
    port: remotePort,
    path: '/api/lan/unpair',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    }
  }, { envelope }, 2500); // 2.5s timeout for fast offline handling

  if (res.status !== 200) {
    throw new Error(res.data?.error || `Remote unpair failed with HTTP ${res.status}`);
  }

  if (res.data && res.data.encryptedEnvelope) {
    try {
      const decrypted = decryptLanPayload(
        res.data.encryptedEnvelope,
        sessionKey,
        remoteDevice.id,
        remoteDevice.public_key
      );
      return decrypted;
    } catch (cryptoErr) {
      console.warn(`[LAN Unpair Transport] Note: Decrypting peer ack failed: ${cryptoErr.message}`);
      return res.data;
    }
  }

  return res.data;
}

/**
 * Send lightweight authenticated encrypted heartbeat/presence ping to a remote paired device.
 * Heartbeat timeout: 2000ms.
 * Does NOT sync notes, versions, notebooks, or touch database.
 */
async function sendEncryptedLanHeartbeat(remoteIp, remotePort = 5000, localProfile, remoteDevice, localMetadata = {}) {
  if (!remoteDevice.public_key) {
    return { ok: false, error: 'Missing public key' };
  }

  const startTime = Date.now();
  try {
    const sessionKey = deriveSharedSessionKey(remoteDevice.public_key);
    const seq = getNextOutgoingSequence(remoteDevice.id);

    const heartbeatMessage = {
      type: 'HEARTBEAT',
      senderDeviceId: localProfile.deviceId,
      targetDeviceId: remoteDevice.id,
      timestamp: startTime,
      notes: localMetadata.notes || [],
      notebooks: localMetadata.notebooks || []
    };

    const envelope = encryptLanPayload(
      heartbeatMessage,
      sessionKey,
      seq,
      localProfile.deviceId,
      remoteDevice.id
    );

    const res = await httpRequest({
      hostname: remoteIp,
      port: remotePort,
      path: '/api/lan/heartbeat',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    }, { envelope }, 2000); // 2-second timeout

    if (res.status !== 200) {
      return { ok: false, error: res.data?.error || `HTTP ${res.status}` };
    }

    if (res.data && res.data.encryptedEnvelope) {
      try {
        const decrypted = decryptLanPayload(
          res.data.encryptedEnvelope,
          sessionKey,
          remoteDevice.id,
          remoteDevice.public_key
        );
        if (decrypted && decrypted.type === 'HEARTBEAT_ACK') {
          return {
            ok: true,
            latencyMs: Date.now() - startTime,
            timestamp: decrypted.timestamp || Date.now(),
            notesToSync: typeof decrypted.notesToSync === 'number' ? decrypted.notesToSync : 0,
            notebooksToSync: typeof decrypted.notebooksToSync === 'number' ? decrypted.notebooksToSync : 0,
            remoteNotes: decrypted.notes || [],
            remoteNotebooks: decrypted.notebooks || []
          };
        }
      } catch (cryptoErr) {
        return { ok: false, error: `Crypto decrypt failed: ${cryptoErr.message}` };
      }
    }

    return { ok: true, latencyMs: Date.now() - startTime, notesToSync: 0, notebooksToSync: 0 };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = {
  httpRequest,
  checkPeerReachable,
  sendPairingRequest,
  pollPairingStatus,
  sendEncryptedLanSync,
  sendEncryptedLanUnpair,
  sendEncryptedLanHeartbeat,
  sendLanConnect
};
