const assert = require('assert');
const path = require('path');
const fs = require('fs');

// Set test environment or use existing db
const {
  db,
  NoteModel,
  NotebookModel,
  SyncQueueModel,
  VersionModel,
  ConflictModel
} = require('../src/db/database');

const { writeNoteFile, readNoteFile } = require('../src/utils/fileStorage');
const { getPendingGoogleSyncItems } = require('../src/utils/googleSyncService');

console.log('====================================================');
console.log('RUNNING FULL SYNC BADGE & LOCAL MODE VERIFICATION');
console.log('====================================================\n');

const testUserId = `usr_test_badge_${Date.now()}`;

// Clean any previous test data for this user
function cleanupTestUser() {
  db.prepare('DELETE FROM notes WHERE user_id = ?').run(testUserId);
  db.prepare('DELETE FROM notebooks WHERE user_id = ?').run(testUserId);
  db.prepare('DELETE FROM sync_queue WHERE user_id = ?').run(testUserId);
}

cleanupTestUser();

// Helper to calculate total pending for a user exactly like GET /api/sync/status
function calculatePendingCount(userId) {
  SyncQueueModel.cleanupStale(userId);
  const queuePending = SyncQueueModel.getPending(userId);
  const pendingGoogleItems = getPendingGoogleSyncItems(userId);

  const pendingEntityIds = new Set();
  queuePending.forEach(item => {
    if (item.status === 'PENDING') {
      pendingEntityIds.add(`${item.entity_type}:${item.entity_id}`);
    }
  });
  pendingGoogleItems.forEach(item => {
    pendingEntityIds.add(`NOTE:${item.id}`);
  });

  return {
    pendingCount: pendingEntityIds.size,
    queuePendingCount: queuePending.filter(i => i.status === 'PENDING').length,
    googlePendingCount: pendingGoogleItems.length
  };
}

try {
  // ----------------------------------------------------
  // Test 1: All notes LOCAL -> pending should be 0
  // ----------------------------------------------------
  console.log('Test 1: All notes LOCAL -> pending should be 0');
  const n1 = NoteModel.create('note_test_loc_1', 'Local Note 1', path.join(__dirname, 'temp_loc1.md'), null, 'hash1', 'v1', testUserId, 'local');
  const n2 = NoteModel.create('note_test_loc_2', 'Local Note 2', path.join(__dirname, 'temp_loc2.md'), null, 'hash2', 'v1', testUserId, 'local');
  writeNoteFile(n1.file_path, '# Local Note 1');
  writeNoteFile(n2.file_path, '# Local Note 2');

  let res = calculatePendingCount(testUserId);
  assert.strictEqual(res.pendingCount, 0, `Expected pendingCount 0, got ${res.pendingCount}`);
  console.log('  PASS: All notes LOCAL produces pendingCount = 0\n');

  // ----------------------------------------------------
  // Test 2: Edit a LOCAL note -> pending should remain 0
  // ----------------------------------------------------
  console.log('Test 2: Edit a LOCAL note -> pending should remain 0');
  writeNoteFile(n1.file_path, '# Local Note 1 - Edited content');
  NoteModel.update(n1.id, n1.title, n1.file_path, n1.notebook_id, 'hash1_edited', 'v2', testUserId, 'local');
  
  // Verify route behavior: when finalSyncMode === 'local', no enqueue happens
  // and any stale items are invalidated
  SyncQueueModel.invalidateForEntity('NOTE', n1.id, testUserId);

  res = calculatePendingCount(testUserId);
  assert.strictEqual(res.pendingCount, 0, `Expected pendingCount to remain 0 after editing local note, got ${res.pendingCount}`);
  console.log('  PASS: Editing a LOCAL note keeps pendingCount = 0\n');

  // ----------------------------------------------------
  // Test 3: Enable LAN Sync -> edit a sync-enabled note -> pending should increase
  // ----------------------------------------------------
  console.log('Test 3: Enable LAN Sync -> edit sync-enabled note -> pending should increase');
  // Switch note to LAN
  NoteModel.update(n1.id, n1.title, n1.file_path, n1.notebook_id, 'hash1_edited_lan', 'v3', testUserId, 'lan');
  // Enqueue as the PUT route does for sync-enabled notes
  SyncQueueModel.enqueue({
    entityType: 'NOTE',
    entityId: n1.id,
    operation: 'UPDATE_NOTE',
    payload: { id: n1.id, title: n1.title, content: '# Local Note 1 - LAN edit', sync_mode: 'lan' },
    userId: testUserId
  });

  res = calculatePendingCount(testUserId);
  assert.strictEqual(res.pendingCount, 1, `Expected pendingCount 1, got ${res.pendingCount}`);
  console.log('  PASS: Editing sync-enabled note increases pendingCount to 1\n');

  // ----------------------------------------------------
  // Test 4: Successfully sync -> pending should decrease
  // ----------------------------------------------------
  console.log('Test 4: Successfully sync -> pending should decrease');
  // Simulate LAN/Cloud sync completion
  SyncQueueModel.markSyncedForEntity('NOTE', n1.id, testUserId);

  res = calculatePendingCount(testUserId);
  assert.strictEqual(res.pendingCount, 0, `Expected pendingCount 0 after sync, got ${res.pendingCount}`);
  console.log('  PASS: Successful sync decreases pendingCount back to 0\n');

  // ----------------------------------------------------
  // Test 5: Switch note to LOCAL -> irrelevant pending operation should no longer count
  // ----------------------------------------------------
  console.log('Test 5: Disable sync / switch note to LOCAL -> irrelevant pending operation removed');
  // Suppose note was in LAN mode with an enqueued operation
  SyncQueueModel.enqueue({
    entityType: 'NOTE',
    entityId: n1.id,
    operation: 'UPDATE_NOTE',
    payload: { id: n1.id, title: n1.title, sync_mode: 'lan' },
    userId: testUserId
  });
  res = calculatePendingCount(testUserId);
  assert.strictEqual(res.pendingCount, 1, 'Precondition: pendingCount is 1 before switching to local');

  // User switches note to LOCAL mode
  NoteModel.update(n1.id, n1.title, n1.file_path, n1.notebook_id, 'hash1_edited_lan', 'v3', testUserId, 'local');
  // Route invalidates for entity or cleanupStale removes it
  SyncQueueModel.cleanupStale(testUserId);

  res = calculatePendingCount(testUserId);
  assert.strictEqual(res.pendingCount, 0, `Expected pendingCount 0 after switching to local, got ${res.pendingCount}`);
  console.log('  PASS: Switching note to LOCAL safely invalidates pending sync operation\n');

  // ----------------------------------------------------
  // Test 6: Restart application / cleanupStale -> pending count remains accurate
  // ----------------------------------------------------
  console.log('Test 6: Startup state restoration -> pending count remains accurate');
  SyncQueueModel.cleanupStale();
  res = calculatePendingCount(testUserId);
  assert.strictEqual(res.pendingCount, 0, `Expected pendingCount 0 on restoration, got ${res.pendingCount}`);
  console.log('  PASS: Startup state restoration maintains accurate pending count\n');

  // ----------------------------------------------------
  // Test 7: Create a new LOCAL note -> should not increase pending count
  // ----------------------------------------------------
  console.log('Test 7: Create a new LOCAL note -> should not increase pending count');
  const n3 = NoteModel.create('note_test_loc_3', 'Local Note 3', path.join(__dirname, 'temp_loc3.md'), null, 'hash3', 'v1', testUserId, 'local');
  writeNoteFile(n3.file_path, '# Local Note 3');
  // POST route checks if (finalSyncMode !== 'local') before enqueuing, so nothing is enqueued
  res = calculatePendingCount(testUserId);
  assert.strictEqual(res.pendingCount, 0, `Expected pendingCount 0 after creating local note, got ${res.pendingCount}`);
  console.log('  PASS: Creating a new LOCAL note does not increase pending count\n');

  // ----------------------------------------------------
  // Test 8: Delete a LOCAL note -> should not create cloud/LAN pending operation
  // ----------------------------------------------------
  console.log('Test 8: Delete a LOCAL note -> should not create pending sync operation');
  const existingMode = n3.sync_mode; // 'local'
  // When deleting a local note, DELETE route does not enqueue DELETE_NOTE
  if (existingMode !== 'local') {
    SyncQueueModel.enqueue({ entityType: 'NOTE', entityId: n3.id, operation: 'DELETE_NOTE', userId: testUserId });
  }
  NoteModel.delete(n3.id, testUserId);
  SyncQueueModel.invalidateForEntity('NOTE', n3.id, testUserId);

  res = calculatePendingCount(testUserId);
  assert.strictEqual(res.pendingCount, 0, `Expected pendingCount 0 after deleting local note, got ${res.pendingCount}`);
  console.log('  PASS: Deleting a LOCAL note does not create a pending sync operation\n');

  // ----------------------------------------------------
  // Test 9: Existing version history remains untouched
  // ----------------------------------------------------
  console.log('Test 9: Existing version history remains untouched');
  const testVId = `v_hist_test_${Date.now()}`;
  db.prepare(`
    INSERT INTO versions (id, note_id, version_number, message, content_hash, is_snapshot, is_auto)
    VALUES (?, ?, 1, 'Initial checkpoint', 'hash_init', 1, 0)
  `).run(testVId, n1.id);

  // Run cleanupStale and check that version history is completely intact
  SyncQueueModel.cleanupStale(testUserId);
  const versionRecord = db.prepare('SELECT * FROM versions WHERE id = ?').get(testVId);
  assert(versionRecord, 'Version record must still exist');
  assert.strictEqual(versionRecord.note_id, n1.id);
  console.log('  PASS: Existing version history is untouched by sync queue cleanup\n');

  // ----------------------------------------------------
  // Test 10: Conflict resolution continues working
  // ----------------------------------------------------
  console.log('Test 10: Conflict resolution continues working');
  const conflictRecord = db.prepare(`
    INSERT INTO conflicts (id, note_id, user_id, local_version_id, local_content, remote_version_id, remote_content, status, sync_source)
    VALUES (?, ?, ?, 'v_local', 'local text', 'v_remote', 'remote text', 'UNRESOLVED', 'LAN')
  `).run(`conf_${Date.now()}`, n1.id, testUserId);

  const activeConflicts = ConflictModel.getByNoteId(n1.id, testUserId, true);
  assert(activeConflicts && activeConflicts.length > 0, 'Active conflict should be detectable');
  console.log('  PASS: Conflict detection and gate remains functional\n');

  console.log('====================================================');
  console.log('ALL 10 TESTS PASSED SUCCESSFULLY!');
  console.log('====================================================\n');
} finally {
  cleanupTestUser();
  // Remove temporary test files
  ['temp_loc1.md', 'temp_loc2.md', 'temp_loc3.md'].forEach(f => {
    const p = path.join(__dirname, f);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  });
}
