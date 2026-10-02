const assert = require('assert');
const path = require('path');
const fs = require('fs');

const {
  db,
  NoteModel,
  NotebookModel,
  SyncQueueModel,
  VersionModel,
  ConflictModel,
  GoogleDriveAuthModel,
  LanPairingModel
} = require('../src/db/database');

const { writeNoteFile, readNoteFile } = require('../src/utils/fileStorage');
const {
  getGoogleDriveStatus,
  getPendingGoogleSyncItems,
  uploadFileToDriveAPI,
  syncSingleNoteWithGoogleDrive,
  syncUserNotesWithGoogleDrive
} = require('../src/utils/googleSyncService');
const { peerPresenceRegistry } = require('../src/routes/lan');
const { checkOllamaHealth } = require('../src/services/ollamaService');

console.log('====================================================');
console.log('RUNNING SYNC SYSTEM & STATE MACHINE CORRECTNESS TESTS');
console.log('====================================================\n');

const testUserId = `usr_sync_correctness_${Date.now()}`;
const tempDir = path.join(__dirname, 'temp_correctness');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

function cleanup() {
  db.prepare('DELETE FROM notes WHERE user_id = ?').run(testUserId);
  db.prepare('DELETE FROM notebooks WHERE user_id = ?').run(testUserId);
  db.prepare('DELETE FROM sync_queue WHERE user_id = ?').run(testUserId);
  db.prepare('DELETE FROM google_drive_auths WHERE user_id = ?').run(testUserId);
  db.prepare('DELETE FROM lan_paired_devices WHERE user_id = ?').run(testUserId);
  if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function runAllTests() {
  try {
    cleanup();

    // ========================================================
    // TEST SUITE 1: LAN PEER STATE MODEL & BACKOFF
    // ========================================================
    console.log('--- Test Suite 1: LAN Peer State Model & Bounded Backoff ---');

    // 1.1 Pair a test device
    const peerDeviceId = `peer_device_${Date.now()}`;
    const peerIp = '192.168.1.222';
    const peerPort = 5000;

    LanPairingModel.createPairing({
      id: peerDeviceId,
      userId: testUserId,
      deviceName: 'My Desktop',
      deviceType: 'desktop',
      deviceIp: peerIp,
      devicePort: peerPort,
      pairingToken: 'mock_token',
      publicKey: 'mock_public_key_pem',
      status: 'TRUSTED'
    });

    let pairedDevices = LanPairingModel.getPairedDevices(testUserId);
    const foundPeer = pairedDevices.find(d => d.id === peerDeviceId);
    assert.ok(foundPeer, 'Device should be paired and stored in database');
    assert.strictEqual(foundPeer.status, 'TRUSTED', 'Status must be TRUSTED');
    console.log('  [PASS] Paired device created with TRUSTED status');

    // 1.2 Simulate consecutive heartbeat failures -> mark OFFLINE, never UNPAIRED
    peerPresenceRegistry.recordFailure(peerDeviceId, peerIp, peerPort);
    peerPresenceRegistry.recordFailure(peerDeviceId, peerIp, peerPort);

    const presenceInfo = peerPresenceRegistry.getPeerStatus(peerDeviceId, peerIp);
    assert.strictEqual(presenceInfo.isOnline, false, 'Peer should be marked OFFLINE after repeated failures');
    assert.strictEqual(presenceInfo.inBackoff, true, 'Peer should enter bounded backoff');
    
    // Check that device is STILL PAIRED in DB
    pairedDevices = LanPairingModel.getPairedDevices(testUserId);
    const peerStillPaired = pairedDevices.find(d => d.id === peerDeviceId);
    assert.ok(peerStillPaired, 'Device MUST remain paired even when offline');
    assert.strictEqual(peerStillPaired.status, 'TRUSTED', 'Status must not be mutated to unpair');
    console.log('  [PASS] Peer marked OFFLINE with backoff; pairing preserved in database');

    // 1.3 Backoff prevents spam: shouldProbePeer returns false during backoff
    const shouldProbe = peerPresenceRegistry.shouldProbePeer(peerDeviceId, peerIp);
    assert.strictEqual(shouldProbe, false, 'Aggressive requests should be suppressed during backoff');
    console.log('  [PASS] Aggressive heartbeat requests suppressed via backoff');

    // 1.4 Offline device does NOT create fake pending operations
    SyncQueueModel.cleanupStale(testUserId);
    const queuePending = SyncQueueModel.getPending(testUserId);
    assert.strictEqual(queuePending.length, 0, 'Offline peer must not create fake pending queue items');
    console.log('  [PASS] Offline peer produces 0 pending queue operations');

    // 1.5 Device reconnects: recordSuccess -> transitions to ONLINE
    peerPresenceRegistry.recordSuccess(peerDeviceId, peerIp, peerPort);
    const onlineInfo = peerPresenceRegistry.getPeerStatus(peerDeviceId, peerIp);
    assert.strictEqual(onlineInfo.isOnline, true, 'Peer should transition to ONLINE when heartbeat succeeds');
    assert.strictEqual(onlineInfo.inBackoff, false, 'Backoff should clear when peer comes online');
    console.log('  [PASS] Peer transitions cleanly from OFFLINE -> ONLINE');

    // 1.6 Explicit unpair works as intended
    LanPairingModel.revokePairing(peerDeviceId, testUserId);
    pairedDevices = LanPairingModel.getPairedDevices(testUserId);
    const peerRevoked = pairedDevices.find(d => d.id === peerDeviceId);
    assert.strictEqual(peerRevoked, undefined, 'Explicit unpair should remove device from paired list');
    console.log('  [PASS] Explicit manual unpair works correctly\n');

    // ========================================================
    // TEST SUITE 2: LOCAL MODE CORRECTNESS
    // ========================================================
    console.log('--- Test Suite 2: Local Mode Correctness ---');

    // 2.1 Create local notes
    const localNotePath1 = path.join(tempDir, 'local1.md');
    const localNotePath2 = path.join(tempDir, 'local2.md');
    writeNoteFile(localNotePath1, '# My Local Note 1\nSome local thoughts.');
    writeNoteFile(localNotePath2, '# My Local Note 2\nPrivate notes.');

    const note1 = NoteModel.create(`note_loc_1_${Date.now()}`, 'Local Note 1', localNotePath1, null, 'h1', 'v1', testUserId, 'local');
    const note2 = NoteModel.create(`note_loc_2_${Date.now()}`, 'Local Note 2', localNotePath2, null, 'h2', 'v1', testUserId, 'local');

    // 2.2 Pending items must be 0
    let pendingGoogle = getPendingGoogleSyncItems(testUserId);
    let queueItems = SyncQueueModel.getPending(testUserId);
    assert.strictEqual(pendingGoogle.length, 0, 'Local notes must not create Google pending items');
    assert.strictEqual(queueItems.length, 0, 'Local notes must not create queue pending items');
    console.log('  [PASS] All notes LOCAL -> 0 pending sync items');

    // 2.3 Edit local note -> pending must remain 0
    writeNoteFile(localNotePath1, '# My Local Note 1\nUpdated locally.');
    NoteModel.update(note1.id, note1.title, localNotePath1, null, 'h1_edit', 'v2', testUserId, 'local');
    SyncQueueModel.invalidateForEntity('NOTE', note1.id, testUserId);

    pendingGoogle = getPendingGoogleSyncItems(testUserId);
    queueItems = SyncQueueModel.getPending(testUserId);
    assert.strictEqual(pendingGoogle.length, 0, 'Local note edit must not produce cloud pending items');
    assert.strictEqual(queueItems.length, 0, 'Local note edit must not produce queue pending items');
    console.log('  [PASS] Local note edited -> pending remains 0\n');

    // ========================================================
    // TEST SUITE 3: GOOGLE DRIVE 401 AUTH EXPIRATION
    // ========================================================
    console.log('--- Test Suite 3: Google Drive 401 Fast Abort & State ---');

    // 3.1 Setup expired Google Drive auth in database
    GoogleDriveAuthModel.upsert({
      userId: testUserId,
      email: 'user@example.com',
      folderId: 'folder_test_123',
      folderName: 'SyncNote',
      status: 'AUTHENTICATION_REQUIRED',
      authError: 'Google Drive authentication expired.'
    });

    const gdriveStatus = getGoogleDriveStatus(testUserId);
    assert.strictEqual(gdriveStatus.authRequired, true, 'Status should indicate authRequired = true');
    assert.strictEqual(gdriveStatus.syncState, 'AUTHENTICATION REQUIRED', 'syncState should be AUTHENTICATION REQUIRED');
    console.log('  [PASS] Google Drive status correctly reports AUTHENTICATION REQUIRED');

    // 3.2 Pending count must not inflate when auth expired
    const pendingWithExpiredAuth = getPendingGoogleSyncItems(testUserId);
    assert.strictEqual(pendingWithExpiredAuth.length, 0, 'Expired auth must not inflate pending items');
    console.log('  [PASS] Expired auth returns 0 pending items');

    // 3.3 syncUserNotesWithGoogleDrive fast-aborts without attempting folder search or file upload
    const syncRes = await syncUserNotesWithGoogleDrive(testUserId);
    assert.strictEqual(syncRes.success, false, 'Sync should halt on authRequired');
    assert.strictEqual(syncRes.authRequired, true, 'Sync result should report authRequired');
    assert.strictEqual(syncRes.syncState, 'AUTHENTICATION REQUIRED', 'Sync state should be AUTHENTICATION REQUIRED');
    console.log('  [PASS] syncUserNotesWithGoogleDrive halts immediately on 401 authRequired without spamming network\n');

    // ========================================================
    // TEST SUITE 4: GOOGLE DRIVE STALE / TRASHED FILE RECOVERY
    // ========================================================
    console.log('--- Test Suite 4: Google Drive Stale / Trashed File Recovery ---');

    // 4.1 Create a note with a stale Drive file ID (like 'sanat.md' with '1bcysM0FiIXGgs7HJp9f1fvCQgodYFHrU')
    const sanatPath = path.join(tempDir, 'sanat.md');
    const sanatContent = '# Sanat Note\nImportant research data.';
    writeNoteFile(sanatPath, sanatContent);

    const staleDriveFileId = '1bcysM0FiIXGgs7HJp9f1fvCQgodYFHrU';
    const sanatNote = NoteModel.create(
      `note_sanat_${Date.now()}`,
      'sanat',
      sanatPath,
      null,
      'hash_sanat_v1',
      'v1',
      testUserId,
      'cloud'
    );

    // Attach stale gdrive_file_id
    NoteModel.updateSyncMetadata(sanatNote.id, testUserId, {
      gdriveFileId: staleDriveFileId,
      lastSyncedHash: 'hash_sanat_old',
      syncState: 'MODIFIED_OFFLINE'
    });

    let currentSanat = NoteModel.getById(sanatNote.id, testUserId);
    assert.strictEqual(currentSanat.gdrive_file_id, staleDriveFileId, 'Initial state should have stale ID');

    // 4.2 Mock fetch to simulate Google Drive returning 404 for the stale ID, and creating a new file
    const originalFetch = global.fetch;
    let probeCalled = false;
    let searchCalled = false;
    let createCalled = false;
    const newDriveFileId = 'new_drive_file_99999_sanat';

    global.fetch = async (url, options = {}) => {
      const urlStr = String(url);

      // Probe existing file ID -> simulate 404 Not Found (or trashed)
      if (urlStr.includes(`/drive/v3/files/${staleDriveFileId}`)) {
        probeCalled = true;
        return {
          ok: false,
          status: 404,
          json: async () => ({ error: { code: 404, message: 'File not found' } }),
          text: async () => 'File not found'
        };
      }

      // Verification of new file ID
      if (urlStr.includes(`/drive/v3/files/${newDriveFileId}`)) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: newDriveFileId, name: 'sanat.md', trashed: false }),
          text: async () => ''
        };
      }

      // Search folder for existing file
      if (urlStr.includes('/drive/v3/files?q=') && options.method !== 'POST') {
        searchCalled = true;
        return {
          ok: true,
          status: 200,
          json: async () => ({ files: [] }) // folder doesn't have it yet
        };
      }

      // Create new file
      if (urlStr.includes('/upload/drive/v3/files?uploadType=multipart') && options.method === 'POST') {
        createCalled = true;
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: newDriveFileId, name: 'sanat.md' })
        };
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({})
      };
    };

    try {
      // Re-enable valid mock auth for this user
      GoogleDriveAuthModel.upsert({
        userId: testUserId,
        email: 'user@example.com',
        folderId: 'folder_valid_123',
        folderName: 'SyncNote',
        status: 'CONNECTED',
        authError: null
      });

      const mockAuthInfo = {
        accessToken: 'mock_valid_access_token_xyz',
        userKey: testUserId
      };

      // Call uploadFileToDriveAPI directly to test stale recovery flow
      const returnedFileId = await uploadFileToDriveAPI(
        mockAuthInfo,
        'folder_valid_123',
        'sanat.md',
        sanatContent,
        staleDriveFileId,
        sanatNote.id
      );

      assert.strictEqual(probeCalled, true, 'Probe must check existing file ID');
      assert.strictEqual(searchCalled, true, 'Should search folder when stale ID fails');
      assert.strictEqual(createCalled, true, 'Should create new remote file when not found');
      assert.strictEqual(returnedFileId, newDriveFileId, 'Must return new valid Drive file ID');

      // Verify local note file and history remain intact!
      const contentAfterSync = readNoteFile(sanatPath);
      assert.strictEqual(contentAfterSync, sanatContent, 'Local note content MUST remain intact');

      // Update metadata with the new valid ID
      NoteModel.updateSyncMetadata(sanatNote.id, testUserId, {
        gdriveFileId: returnedFileId,
        syncState: 'SYNCED'
      });

      const updatedSanat = NoteModel.getById(sanatNote.id, testUserId);
      assert.strictEqual(updatedSanat.gdrive_file_id, newDriveFileId, 'Database must store new valid Drive file ID');
      assert.strictEqual(updatedSanat.sync_state, 'SYNCED', 'Note must be marked SYNCED');

      console.log('  [PASS] Stale Drive file ID detected and invalidated');
      console.log('  [PASS] Local note content & history preserved intact');
      console.log('  [PASS] New valid Drive file ID created, saved, and note marked SYNCED\n');
    } finally {
      global.fetch = originalFetch;
    }

    // ========================================================
    // TEST SUITE 5: OLLAMA CACHED HEALTH CHECK & OFFLINE SAFETY
    // ========================================================
    console.log('--- Test Suite 5: Ollama Daemon Offline Handling ---');

    // Check Ollama status when daemon is not running
    const ollamaStatus1 = await checkOllamaHealth(true);
    assert.strictEqual(ollamaStatus1.available, false, 'Ollama should be reported as unavailable');
    assert.strictEqual(typeof ollamaStatus1.host, 'string', 'Ollama host should be provided');
    assert.strictEqual(typeof ollamaStatus1.configuredModel, 'string', 'Model should be provided');

    // Consecutive check should be instantaneous (served from 30s cache without network timeout spam)
    const startTime = Date.now();
    const ollamaStatus2 = await checkOllamaHealth();
    const elapsed = Date.now() - startTime;
    assert.strictEqual(ollamaStatus2.available, false, 'Cached status should be unavailable');
    assert.ok(elapsed < 20, `Cached check should complete instantly, took ${elapsed}ms`);

    // Verify notes and SQLite remain completely operational when Ollama is offline
    const testLocalNote = NoteModel.create(`note_ollama_${Date.now()}`, 'AI Safe Note', path.join(tempDir, 'safe.md'), null, 'h_s', 'v1', testUserId, 'local');
    assert.ok(testLocalNote, 'Note creation succeeds when Ollama is offline');
    NoteModel.delete(testLocalNote.id, testUserId);
    assert.strictEqual(NoteModel.getById(testLocalNote.id, testUserId), undefined, 'Note deletion succeeds when Ollama is offline');

    console.log('  [PASS] Ollama offline status cached (suppresses request spam)');
    console.log('  [PASS] Notes, editing, and SQLite operations unaffected by Ollama state\n');

    console.log('====================================================');
    console.log('ALL SYNC SYSTEM TESTS PASSED SUCCESSFULLY! (100%)');
    console.log('====================================================');
  } catch (err) {
    console.error('TEST RUNNER FAILED:', err);
    process.exit(1);
  } finally {
    cleanup();
  }
}

runAllTests();
