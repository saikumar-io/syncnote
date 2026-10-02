const assert = require('assert');
const path = require('path');
const {
  db,
  NoteModel,
  SyncQueueModel,
  GoogleDriveAuthModel
} = require('../src/db/database');
const {
  getGoogleDriveStatus,
  getPendingGoogleSyncItems,
  checkGoogleDriveReachability
} = require('../src/utils/googleSyncService');
const { writeNoteFile } = require('../src/utils/fileStorage');

console.log('========================================================');
console.log('RUNNING GLOBAL SYNC STATUS & DRIVE CONNECTION STATE TESTS');
console.log('========================================================\n');

const testUserId = `usr_test_status_${Date.now()}`;

function cleanup() {
  db.prepare('DELETE FROM notes WHERE user_id = ?').run(testUserId);
  db.prepare('DELETE FROM sync_queue WHERE user_id = ?').run(testUserId);
  db.prepare('DELETE FROM google_drive_auths WHERE user_id = ?').run(testUserId);
}

cleanup();

// Logic replicating the frontend calculateStatus helper
function calculateGlobalSyncStatus({
  currentlyConnected,
  activeSyncing,
  unresolvedConflicts = [],
  googleDriveStatus,
  failedCount = 0,
  pendingCount = 0
}) {
  const isAuthReq = Boolean(
    googleDriveStatus?.authRequired || 
    googleDriveStatus?.syncState === 'AUTHENTICATION REQUIRED'
  );
  const isDriveConnected = Boolean(googleDriveStatus?.connected) && !isAuthReq;

  if (!currentlyConnected) {
    return 'OFFLINE';
  } else if (activeSyncing) {
    return 'SYNCING';
  } else if (unresolvedConflicts.length > 0) {
    return 'CONFLICT';
  } else if (isAuthReq) {
    return 'AUTH_REQUIRED';
  } else if (failedCount > 0) {
    return 'ERROR';
  } else if (pendingCount > 0) {
    return 'PENDING';
  } else if (!isDriveConnected) {
    return 'DRIVE_DISCONNECTED';
  } else {
    return 'SYNCED';
  }
}

// Logic replicating GlobalSyncIndicator.jsx badge text
function getBadgeText(syncStatus, pendingCount, googleDriveStatus) {
  const isDriveConnected = Boolean(googleDriveStatus?.connected);
  const isAuthRequired = Boolean(
    googleDriveStatus?.authRequired || 
    googleDriveStatus?.syncState === 'AUTHENTICATION REQUIRED' || 
    syncStatus === 'AUTH_REQUIRED'
  );

  if (syncStatus === 'CONFLICT') return 'Conflict';
  if (syncStatus === 'SYNCING') return 'Syncing...';
  if (syncStatus === 'OFFLINE') return 'Offline';
  if (syncStatus === 'AUTH_REQUIRED' || isAuthRequired) return 'Drive Authentication Required';
  if (syncStatus === 'ERROR' || syncStatus === 'FAILED') return 'Sync error';
  if (pendingCount > 0 || syncStatus === 'PENDING') return `${pendingCount} pending`;
  if (syncStatus === 'DRIVE_DISCONNECTED' || syncStatus === 'DISCONNECTED' || !isDriveConnected) return 'Drive Disconnected';
  return 'Synced';
}

try {
  // ----------------------------------------------------
  // Test 1: Google Drive DISCONNECTED & pendingCount === 0
  // MUST NOT show "Synced", MUST show "Drive Disconnected"
  // ----------------------------------------------------
  console.log('Test 1: Drive DISCONNECTED & pendingCount === 0');
  let drive = getGoogleDriveStatus(testUserId);
  assert.strictEqual(drive.connected, false, 'Expected Drive to be disconnected initially');
  
  let status = calculateGlobalSyncStatus({
    currentlyConnected: true,
    activeSyncing: false,
    googleDriveStatus: drive,
    failedCount: 0,
    pendingCount: 0
  });
  assert.strictEqual(status, 'DRIVE_DISCONNECTED', `Expected DRIVE_DISCONNECTED, got ${status}`);
  let badgeText = getBadgeText(status, 0, drive);
  assert.strictEqual(badgeText, 'Drive Disconnected', `Expected 'Drive Disconnected', got '${badgeText}'`);
  assert.notStrictEqual(badgeText, 'Synced', 'Badge must NOT say Synced when Drive is disconnected!');
  console.log('  PASS: Drive Disconnected correctly produces "Drive Disconnected" and NOT "Synced"\n');

  // ----------------------------------------------------
  // Test 2: Google Drive CONNECTED & pendingCount === 0
  // Shows "Synced"
  // ----------------------------------------------------
  console.log('Test 2: Drive CONNECTED & pendingCount === 0');
  GoogleDriveAuthModel.upsert({
    userId: testUserId,
    email: 'user@example.com',
    accessToken: 'ya29.test_real_access_token',
    refreshToken: '1//test_real_refresh_token',
    folderId: 'folder_real_123',
    folderName: 'SyncNote',
    status: 'CONNECTED',
    authError: null
  });

  drive = getGoogleDriveStatus(testUserId);
  assert.strictEqual(drive.connected, true, 'Expected Drive to be connected');

  status = calculateGlobalSyncStatus({
    currentlyConnected: true,
    activeSyncing: false,
    googleDriveStatus: drive,
    failedCount: 0,
    pendingCount: 0
  });
  assert.strictEqual(status, 'SYNCED', `Expected SYNCED, got ${status}`);
  badgeText = getBadgeText(status, 0, drive);
  assert.strictEqual(badgeText, 'Synced', `Expected 'Synced', got '${badgeText}'`);
  console.log('  PASS: Drive Connected with 0 pending correctly produces "Synced"\n');

  // ----------------------------------------------------
  // Test 3: Sync is currently running
  // Shows "Syncing..."
  // ----------------------------------------------------
  console.log('Test 3: Upload / sync running');
  status = calculateGlobalSyncStatus({
    currentlyConnected: true,
    activeSyncing: true,
    googleDriveStatus: drive,
    failedCount: 0,
    pendingCount: 1
  });
  assert.strictEqual(status, 'SYNCING', `Expected SYNCING, got ${status}`);
  badgeText = getBadgeText(status, 1, drive);
  assert.strictEqual(badgeText, 'Syncing...', `Expected 'Syncing...', got '${badgeText}'`);
  console.log('  PASS: Upload running produces "Syncing..."\n');

  // ----------------------------------------------------
  // Test 4: Uploads / operations waiting (pendingCount > 0)
  // Shows "Pending"
  // ----------------------------------------------------
  console.log('Test 4: Operations waiting (pendingCount = 3)');
  status = calculateGlobalSyncStatus({
    currentlyConnected: true,
    activeSyncing: false,
    googleDriveStatus: drive,
    failedCount: 0,
    pendingCount: 3
  });
  assert.strictEqual(status, 'PENDING', `Expected PENDING, got ${status}`);
  badgeText = getBadgeText(status, 3, drive);
  assert.strictEqual(badgeText, '3 pending', `Expected '3 pending', got '${badgeText}'`);
  console.log('  PASS: Pending operations produce "3 pending"\n');

  // ----------------------------------------------------
  // Test 5: Drive Authentication Expired
  // Shows "Drive Authentication Required"
  // ----------------------------------------------------
  console.log('Test 5: Drive Authentication Expired');
  GoogleDriveAuthModel.setAuthRequired(testUserId, 'Google Drive authentication expired.');
  drive = getGoogleDriveStatus(testUserId);
  assert.strictEqual(drive.authRequired, true, 'Expected authRequired to be true');
  assert.strictEqual(drive.connected, false, 'Expected connected to be false when auth expired');

  status = calculateGlobalSyncStatus({
    currentlyConnected: true,
    activeSyncing: false,
    googleDriveStatus: drive,
    failedCount: 0,
    pendingCount: 0
  });
  assert.strictEqual(status, 'AUTH_REQUIRED', `Expected AUTH_REQUIRED, got ${status}`);
  badgeText = getBadgeText(status, 0, drive);
  assert.strictEqual(badgeText, 'Drive Authentication Required', `Expected 'Drive Authentication Required', got '${badgeText}'`);
  console.log('  PASS: Expired auth produces "Drive Authentication Required"\n');

  // ----------------------------------------------------
  // Test 6: Network connection unavailable (Offline)
  // Shows "Offline"
  // ----------------------------------------------------
  console.log('Test 6: Network connection unavailable');
  status = calculateGlobalSyncStatus({
    currentlyConnected: false,
    activeSyncing: false,
    googleDriveStatus: drive,
    failedCount: 0,
    pendingCount: 0
  });
  assert.strictEqual(status, 'OFFLINE', `Expected OFFLINE, got ${status}`);
  badgeText = getBadgeText(status, 0, drive);
  assert.strictEqual(badgeText, 'Offline', `Expected 'Offline', got '${badgeText}'`);
  console.log('  PASS: Offline connection produces "Offline"\n');

  // ----------------------------------------------------
  // Test 7: Synchronization operation failed
  // Shows "Sync error"
  // ----------------------------------------------------
  console.log('Test 7: Synchronization operation failed (failedCount > 0)');
  // Reset drive to connected
  GoogleDriveAuthModel.upsert({
    userId: testUserId,
    email: 'user@example.com',
    accessToken: 'ya29.test_real_access_token',
    refreshToken: '1//test_real_refresh_token',
    folderId: 'folder_real_123',
    folderName: 'SyncNote',
    status: 'CONNECTED',
    authError: null
  });
  drive = getGoogleDriveStatus(testUserId);

  status = calculateGlobalSyncStatus({
    currentlyConnected: true,
    activeSyncing: false,
    googleDriveStatus: drive,
    failedCount: 1,
    pendingCount: 0
  });
  assert.strictEqual(status, 'ERROR', `Expected ERROR, got ${status}`);
  badgeText = getBadgeText(status, 0, drive);
  assert.strictEqual(badgeText, 'Sync error', `Expected 'Sync error', got '${badgeText}'`);
  console.log('  PASS: Sync failure produces "Sync error"\n');

  // ----------------------------------------------------
  // Test 8: Drive Disconnect action resets state
  // ----------------------------------------------------
  console.log('Test 8: Explicit Disconnect Google Drive');
  const { disconnectGoogleDrive } = require('../src/utils/googleSyncService');
  disconnectGoogleDrive(testUserId);
  drive = getGoogleDriveStatus(testUserId);
  assert.strictEqual(drive.connected, false, 'Expected Drive to be disconnected');
  assert.strictEqual(drive.syncState, 'DISABLED', 'Expected syncState to be DISABLED');

  status = calculateGlobalSyncStatus({
    currentlyConnected: true,
    activeSyncing: false,
    googleDriveStatus: drive,
    failedCount: 0,
    pendingCount: 0
  });
  assert.strictEqual(status, 'DRIVE_DISCONNECTED', `Expected DRIVE_DISCONNECTED, got ${status}`);
  badgeText = getBadgeText(status, 0, drive);
  assert.strictEqual(badgeText, 'Drive Disconnected', `Expected 'Drive Disconnected', got '${badgeText}'`);
  console.log('  PASS: Disconnect Google Drive returns to "Drive Disconnected"\n');

  // ----------------------------------------------------
  // Test 9: checkGoogleDriveReachability returns connected: false when Drive is disconnected
  // ----------------------------------------------------
  console.log('Test 9: checkGoogleDriveReachability returns connected: false when Drive is disconnected');
  checkGoogleDriveReachability(testUserId).then(reach => {
    assert.strictEqual(reach.connected, false, `Expected connected: false, got ${reach.connected}`);
    assert.strictEqual(reach.driveConnected, false, `Expected driveConnected: false, got ${reach.driveConnected}`);
    console.log('  PASS: Reachability reports connected: false when Drive is disconnected\n');

    cleanup();

    console.log('========================================================');
    console.log('ALL GLOBAL SYNC STATUS & DRIVE STATE TESTS PASSED! (100%)');
    console.log('========================================================\n');
  });

} catch (err) {
  cleanup();
  console.error('\nTEST FAILED:', err);
  process.exit(1);
}
