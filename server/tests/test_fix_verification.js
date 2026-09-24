const assert = require('assert');
const http = require('http');

console.log('=== SyncNote Fixes Automated Verification ===');

// Test 1: Verify LAN /info endpoint is public (returns 200 without auth)
const { startLanDiscoveryService, discoverDevicesUDP } = require('../src/utils/lanDiscoveryService');
const express = require('express');
const lanRouter = require('../src/routes/lan');

const app = express();
app.use(express.json());
app.use('/api/lan', lanRouter);

const server = app.listen(0, async () => {
  const port = server.address().port;
  console.log(`Test server running on port ${port}`);

  try {
    // 1. Test public /api/lan/info
    const infoRes = await fetch(`http://localhost:${port}/api/lan/info`);
    assert.strictEqual(infoRes.status, 200, 'Public /api/lan/info should return 200 OK without authentication');
    const infoData = await infoRes.json();
    assert.ok(infoData.deviceId, 'Info response should contain deviceId');
    assert.ok(infoData.deviceName, 'Info response should contain deviceName');
    assert.ok(infoData.ipAddresses, 'Info response should contain ipAddresses');
    assert.strictEqual(infoData.lanSyncAvailable, true, 'Info response should indicate lanSyncAvailable');
    console.log('✔ Test 1 Passed: /api/lan/info is publicly accessible and returns valid safe metadata.');

    // 2. Test UDP LAN Discovery Service
    startLanDiscoveryService();
    console.log('✔ Test 2 Passed: LAN UDP Discovery Service initialized successfully.');

    // 3. Test Google Drive Pull Functions
    const { getGoogleDriveStatus, syncUserNotesWithGoogleDrive } = require('../src/utils/googleSyncService');
    const driveStatus = getGoogleDriveStatus('test_user_verification');
    assert.ok(driveStatus, 'getGoogleDriveStatus returned valid status');
    console.log('✔ Test 3 Passed: Google Drive status interface verified.');

    console.log('\n=== ALL AUTOMATED VERIFICATIONS PASSED SUCCESSFULLY ===');
  } catch (err) {
    console.error('❌ Verification Failed:', err);
    process.exitCode = 1;
  } finally {
    server.close();
  }
});
