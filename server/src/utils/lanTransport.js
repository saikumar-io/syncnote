const http = require('http');
const {
  getPublicDeviceProfile,
  deriveSharedSessionKey,
  encryptLanPayload,
  decryptLanPayload
} = require('./deviceCrypto');

let outgoingSequence = 1;

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
  const seq = outgoingSequence++;

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

module.exports = {
  checkPeerReachable,
  sendPairingRequest,
  pollPairingStatus,
  sendEncryptedLanSync
};
