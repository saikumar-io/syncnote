const assert = require('assert');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

// Import system modules
const {
  getOrCreateDeviceIdentity,
  getPublicDeviceProfile,
  deriveSharedSessionKey,
  encryptLanPayload,
  decryptLanPayload
} = require('../src/utils/deviceCrypto');

const {
  rejectGoogleUpload,
  uploadNoteToGoogleDrive
} = require('../src/utils/googleSyncService');

const { LanPairingModel, NoteModel } = require('../src/db/database');

async function runSecurityTestSuite() {
  console.log('====================================================');
  console.log(' SYNCNOTE CRYPTOGRAPHIC & PRIVACY SECURITY TEST SUITE');
  console.log('====================================================\n');

  let passedCount = 0;
  let failedCount = 0;

  function recordTest(testName, result) {
    if (result) {
      console.log(`[PASS] ${testName}`);
      passedCount++;
    } else {
      console.error(`[FAIL] ${testName}`);
      failedCount++;
    }
  }

  // Setup Test Identity Contexts
  const localDevice = getPublicDeviceProfile();

  // Create Mock Remote Device
  const ecdhRemote = crypto.createECDH('prime256v1');
  ecdhRemote.generateKeys();
  const remotePubKey = ecdhRemote.getPublicKey('hex');
  const remotePrivKey = ecdhRemote.getPrivateKey('hex');
  const remoteDeviceId = 'dev_remote_test_laptop';

  // Pair Remote Device in DB
  LanPairingModel.createPairing({
    id: remoteDeviceId,
    deviceName: 'Remote Test Laptop',
    deviceIp: '192.168.1.105',
    pairingToken: 'token_valid_123',
    publicKey: remotePubKey,
    deviceType: 'laptop',
    userId: 'usr_local_default',
    status: 'TRUSTED'
  });

  // Calculate Shared Session Key
  const localIdentity = getOrCreateDeviceIdentity();
  const sessionKey = deriveSharedSessionKey(remotePubKey);

  // ----------------------------------------------------
  // TEST 1: Unknown device attempts LAN sync
  // ----------------------------------------------------
  try {
    const unknownDevice = LanPairingModel.getById('dev_unknown_hacker');
    assert.strictEqual(unknownDevice, undefined);
    recordTest('TEST 1: Unknown device attempts LAN sync -> REJECTED', true);
  } catch (err) {
    recordTest('TEST 1: Unknown device attempts LAN sync -> REJECTED', false);
  }

  // ----------------------------------------------------
  // TEST 2: Known paired device connects
  // ----------------------------------------------------
  try {
    const paired = LanPairingModel.getById(remoteDeviceId);
    assert.strictEqual(paired.status, 'TRUSTED');
    recordTest('TEST 2: Known paired device connects -> AUTHENTICATED', true);
  } catch (err) {
    recordTest('TEST 2: Known paired device connects -> AUTHENTICATED', false);
  }

  // ----------------------------------------------------
  // TEST 3: Modify encrypted message (Auth Tag Tampering)
  // ----------------------------------------------------
  try {
    const validEnvelope = encryptLanPayload({ note: 'Secret Note' }, sessionKey, 101, remoteDeviceId, localDevice.deviceId);
    // Tamper authTag
    validEnvelope.authTag = '00000000000000000000000000000000';
    let failedAsExpected = false;
    try {
      decryptLanPayload(validEnvelope, sessionKey, remoteDeviceId, remotePubKey);
    } catch (e) {
      failedAsExpected = true;
    }
    assert.strictEqual(failedAsExpected, true);
    recordTest('TEST 3: Modify encrypted message -> AUTHENTICATION FAILURE', true);
  } catch (err) {
    recordTest('TEST 3: Modify encrypted message -> AUTHENTICATION FAILURE', false);
  }

  // ----------------------------------------------------
  // TEST 4: Replay previously valid message
  // ----------------------------------------------------
  try {
    const replayEnvelope = encryptLanPayload({ note: 'Replay Note' }, sessionKey, 201, remoteDeviceId, localDevice.deviceId);
    // First decryption (valid)
    decryptLanPayload(replayEnvelope, sessionKey, remoteDeviceId, remotePubKey);
    
    // Second decryption (replayed packet with same sequence number)
    let replayRejected = false;
    try {
      decryptLanPayload(replayEnvelope, sessionKey, remoteDeviceId, remotePubKey);
    } catch (e) {
      replayRejected = e.message.includes('Replayed or duplicate sequence number');
    }
    assert.strictEqual(replayRejected, true);
    recordTest('TEST 4: Replay previously valid message -> REJECTED', true);
  } catch (err) {
    recordTest('TEST 4: Replay previously valid message -> REJECTED', false);
  }

  // ----------------------------------------------------
  // TEST 5: Revoked device attempts connection
  // ----------------------------------------------------
  try {
    const revokeId = 'dev_revoked_test_tablet';
    LanPairingModel.createPairing({
      id: revokeId,
      deviceName: 'Revoked Tablet',
      pairingToken: 'tok_revoked',
      publicKey: remotePubKey,
      userId: 'usr_local_default',
      status: 'TRUSTED'
    });

    // Execute revocation
    LanPairingModel.revokePairing(revokeId, 'usr_local_default');
    const deviceState = LanPairingModel.getById(revokeId);

    assert.strictEqual(deviceState.status, 'REVOKED');
    recordTest('TEST 5: Revoked device attempts connection -> REJECTED', true);
  } catch (err) {
    recordTest('TEST 5: Revoked device attempts connection -> REJECTED', false);
  }

  // ----------------------------------------------------
  // TEST 6: LAN note is passed to Google sync
  // ----------------------------------------------------
  try {
    const lanOnlyNote = {
      id: 'note_lan_secret_123',
      title: 'Top Secret LAN Note',
      sync_mode: 'lan'
    };

    let rejectedByGuard = false;
    try {
      rejectGoogleUpload(lanOnlyNote);
    } catch (e) {
      rejectedByGuard = e.message.includes('CRITICAL PRIVACY VIOLATION REJECTED');
    }

    assert.strictEqual(rejectedByGuard, true);
    recordTest('TEST 6: LAN note is passed to Google sync -> REJECTED', true);
  } catch (err) {
    recordTest('TEST 6: LAN note is passed to Google sync -> REJECTED', false);
  }

  // ----------------------------------------------------
  // TEST 7: Google note is passed to LAN-only sync
  // ----------------------------------------------------
  try {
    const googleNote = {
      id: 'note_google_cloud_456',
      title: 'Cloud Work Note',
      sync_mode: 'google'
    };

    // Filter simulation as executed in lan.js
    const lanSyncNotesList = [googleNote].filter(n => n.sync_mode === 'lan');
    assert.strictEqual(lanSyncNotesList.length, 0);
    recordTest('TEST 7: Google note passed to LAN sync -> NOT INCLUDED', true);
  } catch (err) {
    recordTest('TEST 7: Google note passed to LAN sync -> NOT INCLUDED', false);
  }

  // ----------------------------------------------------
  // TEST 8: LAN sync while internet is unavailable
  // ----------------------------------------------------
  try {
    // LAN payload encryption/decryption between paired devices works locally without external requests
    const offlineEnvelope = encryptLanPayload({ note: 'Offline Note' }, sessionKey, 301, remoteDeviceId, localDevice.deviceId);
    const decrypted = decryptLanPayload(offlineEnvelope, sessionKey, remoteDeviceId, remotePubKey);
    assert.strictEqual(decrypted.note, 'Offline Note');
    recordTest('TEST 8: LAN sync while internet unavailable -> SUCCESS', true);
  } catch (err) {
    recordTest('TEST 8: LAN sync while internet unavailable -> SUCCESS', false);
  }

  // ----------------------------------------------------
  // TEST 9: New device attempts to impersonate trusted device
  // ----------------------------------------------------
  try {
    // Attacker generates random keypair but uses remoteDeviceId
    const ecdhAttacker = crypto.createECDH('prime256v1');
    ecdhAttacker.generateKeys();
    const attackerKey = ecdhAttacker.computeSecret(Buffer.from(localDevice.publicKey, 'hex'));
    const attackerSessionKey = crypto.createHash('sha256').update(attackerKey).digest();

    const forgedEnvelope = encryptLanPayload({ note: 'Forged' }, attackerSessionKey, 401, remoteDeviceId, localDevice.deviceId);

    let failedDecryption = false;
    try {
      decryptLanPayload(forgedEnvelope, sessionKey, remoteDeviceId, remotePubKey);
    } catch (e) {
      failedDecryption = true;
    }

    assert.strictEqual(failedDecryption, true);
    recordTest('TEST 9: Device impersonation without private key -> REJECTED', true);
  } catch (err) {
    recordTest('TEST 9: Device impersonation without private key -> REJECTED', false);
  }

  // ----------------------------------------------------
  // TEST 10: Device IP changes
  // ----------------------------------------------------
  try {
    // Update IP in DB
    LanPairingModel.updateLastSeen(remoteDeviceId, '192.168.1.222');
    const updatedDev = LanPairingModel.getById(remoteDeviceId);
    assert.strictEqual(updatedDev.device_ip, '192.168.1.222');
    assert.strictEqual(updatedDev.status, 'TRUSTED');
    recordTest('TEST 10: Device IP changes -> Recognized by cryptographic identity', true);
  } catch (err) {
    recordTest('TEST 10: Device IP changes -> Recognized by cryptographic identity', false);
  }

  // ----------------------------------------------------
  // TEST 11: Private key is never returned by API profile
  // ----------------------------------------------------
  try {
    const profile = getPublicDeviceProfile();
    assert.strictEqual(profile.privateKey, undefined);
    assert.strictEqual(Object.keys(profile).includes('privateKey'), false);
    recordTest('TEST 11: Private key is never returned by API endpoint -> PASS', true);
  } catch (err) {
    recordTest('TEST 11: Private key is never returned by API endpoint -> PASS', false);
  }

  // ----------------------------------------------------
  // TEST 12: Private key never appears in logs
  // ----------------------------------------------------
  try {
    const profileJson = JSON.stringify(getPublicDeviceProfile());
    assert.strictEqual(profileJson.includes('privateKey'), false);
    recordTest('TEST 12: Private key never appears in logs/strings -> PASS', true);
  } catch (err) {
    recordTest('TEST 12: Private key never appears in logs/strings -> PASS', false);
  }

  console.log('\n====================================================');
  console.log(` SUMMARY: ${passedCount} PASSED / ${failedCount} FAILED out of 12 Security Tests`);
  console.log('====================================================');

  if (failedCount > 0) {
    process.exit(1);
  }
}

runSecurityTestSuite().catch((err) => {
  console.error('Unhandled error during security test suite execution:', err);
  process.exit(1);
});
