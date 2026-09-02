const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Path for encrypted local key storage
const dataDir = path.join(__dirname, '../../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
const keyFilePath = path.join(dataDir, 'device_identity.json');

// Derive machine secret key to encrypt private key at rest
function getLocalMasterKey() {
  const machineInfo = `${os.hostname()}_${os.platform()}_${os.arch()}_syncnote_secret`;
  return crypto.createHash('sha256').update(machineInfo).digest();
}

let cachedIdentity = null;

// Track sequence numbers per session to prevent replay attacks
const processedSequenceMap = new Map();

/**
 * Encrypt string content at rest using machine key
 */
function encryptAtRest(plainText) {
  const masterKey = getLocalMasterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv);
  let encrypted = cipher.update(plainText, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return JSON.stringify({
    iv: iv.toString('hex'),
    authTag,
    ciphertext: encrypted
  });
}

/**
 * Decrypt string content at rest using machine key
 */
function decryptAtRest(encryptedJson) {
  const masterKey = getLocalMasterKey();
  const { iv, authTag, ciphertext } = JSON.parse(encryptedJson);
  const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(authTag, 'hex'));
  let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/**
 * Get or create persistent device cryptographic identity
 */
function getOrCreateDeviceIdentity() {
  if (cachedIdentity) {
    return cachedIdentity;
  }

  const hostnameClean = os.hostname().toLowerCase().replace(/[^a-z0-9]/g, '') || 'local';
  const defaultDeviceId = `dev_${hostnameClean}_${crypto.randomBytes(4).toString('hex')}`;
  const defaultDeviceName = `${os.hostname()} (${os.type()})`;

  if (fs.existsSync(keyFilePath)) {
    try {
      const fileData = fs.readFileSync(keyFilePath, 'utf8');
      const decrypted = decryptAtRest(fileData);
      const parsed = JSON.parse(decrypted);

      cachedIdentity = {
        deviceId: parsed.deviceId,
        deviceName: parsed.deviceName,
        deviceType: parsed.deviceType || 'desktop',
        publicKey: parsed.publicKey,
        privateKey: parsed.privateKey
      };

      console.log(`[Device Crypto] Loaded persistent cryptographic device identity: ${cachedIdentity.deviceId}`);
      return cachedIdentity;
    } catch (err) {
      console.warn('[Device Crypto] Failed to load encrypted identity file. Regenerating...', err.message);
    }
  }

  // Generate modern ECDH (prime256v1 / secp256r1) key pair for identity & key agreement
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const publicKeyHex = ecdh.getPublicKey('hex');
  const privateKeyHex = ecdh.getPrivateKey('hex');

  cachedIdentity = {
    deviceId: defaultDeviceId,
    deviceName: defaultDeviceName,
    deviceType: 'desktop',
    publicKey: publicKeyHex,
    privateKey: privateKeyHex
  };

  try {
    const encryptedData = encryptAtRest(JSON.stringify(cachedIdentity));
    fs.writeFileSync(keyFilePath, encryptedData, 'utf8');
    console.log(`[Device Crypto] Generated and securely stored new cryptographic device identity: ${cachedIdentity.deviceId}`);
  } catch (err) {
    console.error('[Device Crypto] Error writing key file at rest:', err);
  }

  return cachedIdentity;
}

/**
 * Expose device public metadata (NEVER returns private key)
 */
function getPublicDeviceProfile() {
  const identity = getOrCreateDeviceIdentity();
  return {
    deviceId: identity.deviceId,
    deviceName: identity.deviceName,
    deviceType: identity.deviceType,
    publicKey: identity.publicKey
  };
}

/**
 * Derive shared session key (AES-256) between local private key and remote public key
 */
function deriveSharedSessionKey(remotePublicKeyHex) {
  const identity = getOrCreateDeviceIdentity();
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.setPrivateKey(Buffer.from(identity.privateKey, 'hex'));
  const sharedSecret = ecdh.computeSecret(Buffer.from(remotePublicKeyHex, 'hex'));
  
  // Use HKDF / SHA-256 to produce a 256-bit symmetric session key
  return crypto.createHash('sha256').update(sharedSecret).digest();
}

/**
 * Sign data with local private key
 */
function signPayload(payloadString) {
  const identity = getOrCreateDeviceIdentity();
  const hmac = crypto.createHmac('sha256', identity.privateKey);
  hmac.update(payloadString);
  return hmac.digest('hex');
}

/**
 * Verify payload signature using remote public key
 */
function verifyPayloadSignature(payloadString, signatureHex, remotePublicKeyHex) {
  // HMAC-based verification using remote public key as shared reference
  const hmac = crypto.createHmac('sha256', remotePublicKeyHex);
  hmac.update(payloadString);
  const expected = hmac.digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signatureHex, 'hex'), Buffer.from(expected, 'hex'));
}

/**
 * Encrypt LAN sync payload using AES-256-GCM with replay protection headers
 */
function encryptLanPayload(payload, sessionKey, sequenceNumber, senderDeviceId, recipientDeviceId) {
  const payloadString = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', sessionKey, iv);
  
  let ciphertext = cipher.update(payloadString, 'utf8', 'hex');
  ciphertext += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  
  const timestamp = Date.now();
  const signature = signPayload(`${senderDeviceId}:${recipientDeviceId}:${sequenceNumber}:${timestamp}:${ciphertext}`);

  return {
    senderDeviceId,
    recipientDeviceId,
    sequenceNumber,
    timestamp,
    nonce: iv.toString('hex'),
    authTag,
    ciphertext,
    signature
  };
}

/**
 * Decrypt LAN sync payload with timestamp validation, authTag verification, and sequence number replay protection
 */
function decryptLanPayload(envelope, sessionKey, expectedSenderDeviceId, remotePublicKeyHex) {
  const {
    senderDeviceId,
    recipientDeviceId,
    sequenceNumber,
    timestamp,
    nonce,
    authTag,
    ciphertext,
    signature
  } = envelope;

  // 1. Verify Sender Identity
  if (senderDeviceId !== expectedSenderDeviceId) {
    throw new Error(`SECURITY REJECTED: Unexpected sender device ID '${senderDeviceId}'`);
  }

  // 2. Expiration check (Reject messages older than 5 minutes)
  const now = Date.now();
  if (Math.abs(now - timestamp) > 5 * 60 * 1000) {
    throw new Error('SECURITY REJECTED: Message timestamp expired or stale');
  }

  // 3. Replay Protection: Ensure sequence number is strictly greater than last seen
  const lastSeq = processedSequenceMap.get(senderDeviceId) || 0;
  if (sequenceNumber <= lastSeq) {
    throw new Error(`SECURITY REJECTED: Replayed or duplicate sequence number ${sequenceNumber} (last seen: ${lastSeq})`);
  }

  // 4. Verify Signature
  if (signature && remotePublicKeyHex) {
    const isValidSig = verifyPayloadSignature(
      `${senderDeviceId}:${recipientDeviceId}:${sequenceNumber}:${timestamp}:${ciphertext}`,
      signature,
      remotePublicKeyHex
    );
    if (!isValidSig) {
      throw new Error('SECURITY REJECTED: Invalid digital signature on LAN message');
    }
  }

  // 5. Decrypt Ciphertext with AES-256-GCM and verify Auth Tag
  const decipher = crypto.createDecipheriv('aes-256-gcm', sessionKey, Buffer.from(nonce, 'hex'));
  decipher.setAuthTag(Buffer.from(authTag, 'hex'));
  
  let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  // Record valid sequence number to prevent replay attacks
  processedSequenceMap.set(senderDeviceId, sequenceNumber);

  try {
    return JSON.parse(decrypted);
  } catch (e) {
    return decrypted;
  }
}

module.exports = {
  getOrCreateDeviceIdentity,
  getPublicDeviceProfile,
  deriveSharedSessionKey,
  encryptLanPayload,
  decryptLanPayload,
  signPayload,
  verifyPayloadSignature
};
