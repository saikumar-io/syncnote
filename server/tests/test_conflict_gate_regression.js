/**
 * ==============================================================================
 * SYNCNOTE CONFLICT GATE & CONCURRENT DIVERGENCE REGRESSION TEST SUITE
 * ==============================================================================
 *
 * Verifies Requirements from Section 13 & 14:
 *
 * TEST 1 (Section 13 Regression Test):
 * Initial state on BOTH devices:
 * Version V1:
 * hello
 * this is the original note
 *
 * Disconnect LAN.
 * DEVICE A changes it to:
 * hello
 * this is the original note
 * change from device A
 *
 * DEVICE B changes it to:
 * hello
 * this is the original note
 * change from device B
 *
 * Reconnect LAN.
 * Now sync.
 *
 * EXPECTED:
 * - Neither device silently overwrites the other.
 * - Conflict must be detected.
 * - Conflict record created and AI recommendation generated.
 * - Local content preserved (not overwritten by remote).
 * - Note remains unresolved until user chooses an action.
 *
 * TEST 2 (Section 14 Normal Sync Test):
 * Device A changes note.
 * Device B does NOT change it.
 * Sync.
 * EXPECTED:
 * - Normal fast-forward synchronization.
 * - NO conflict.
 * - NO AI request.
 * - Remote change applied cleanly.
 *
 * TEST 3 (Resolution Propagation):
 * User on Device A accepts AI merge.
 * Device B receives resolution.
 * EXPECTED:
 * - Device B applies resolution.
 * - Same final content on both devices.
 * - Conflict marked RESOLVED on both devices (no new conflict created).
 * ==============================================================================
 */

const assert = require('assert');
const http = require('http');
const path = require('path');
const fs = require('fs');

const {
  ConflictModel,
  NoteModel,
  NotebookModel,
  VersionModel,
  SessionModel,
  LanPairingModel,
  db
} = require('../src/db/database');

const {
  computeLineDiffHunks,
  reconstructVersionContent,
  detectAncestryRelationship
} = require('../src/utils/versionControl');

const {
  calculateHash,
  getNoteFilePath,
  writeNoteFile,
  readNoteFile
} = require('../src/utils/fileStorage');

const {
  createOrRecordConflict,
  resolveConflict
} = require('../src/services/conflictResolutionService');

const lanRouter = require('../src/routes/lan');
const { applyIncomingNotesAndNotebooks, buildNotesWithResolutionMetadata } = lanRouter;

let totalPassed = 0;
let totalFailed = 0;

function report(name, condition, details = '') {
  if (condition) {
    console.log(`[PASS] ${name}`);
    if (details) console.log(`       -> ${details}`);
    totalPassed++;
  } else {
    console.error(`[FAIL] ${name}`);
    if (details) console.error(`       -> ${details}`);
    totalFailed++;
  }
}

// Mock Ollama Daemon for reproducible local AI tests
let mockAiCalls = 0;
let mockServer = null;
let mockPort = 0;

function startMockOllama() {
  return new Promise((resolve) => {
    mockServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        if (req.url === '/api/tags' && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            models: [{ name: 'llama3.2:1b', size: 1300000000 }]
          }));
          return;
        }

        if (req.url === '/api/generate' && req.method === 'POST') {
          mockAiCalls++;
          const responsePayload = {
            model: 'llama3.2:1b',
            created_at: new Date().toISOString(),
            response: JSON.stringify({
              conflictDetected: true,
              summary: 'Both devices made concurrent additions to the note.',
              changesFromAncestor: [
                'Device A added: change from device A',
                'Device B added: change from device B'
              ],
              suggestedMerge: 'hello\nthis is the original note\nchange from device A\nchange from device B',
              reasoning: 'Both modifications are complementary additions; combining both preserves all data.'
            }),
            done: true
          };
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(responsePayload));
          return;
        }

        res.writeHead(404);
        res.end();
      });
    });

    mockServer.listen(0, '127.0.0.1', () => {
      mockPort = mockServer.address().port;
      process.env.OLLAMA_HOST = `http://127.0.0.1:${mockPort}`;
      process.env.OLLAMA_MODEL = 'llama3.2:1b';
      resolve();
    });
  });
}

async function runTests() {
  console.log('================================================================');
  console.log('   SYNCNOTE CONFLICT GATE & CONCURRENT SYNC REGRESSION TESTS    ');
  console.log('================================================================');

  await startMockOllama();
  const testUserId = 'usr_regression_test';

  const remotePeer = {
    id: 'dev_peer_b',
    deviceId: 'dev_peer_b',
    device_name: 'Device B',
    deviceName: 'Device B',
    status: 'TRUSTED',
    device_ip: '127.0.0.1',
    device_port: 5000
  };

  // ---------------------------------------------------------------------------
  // TEST 1: SECTION 13 EXACT REGRESSION TEST (CONCURRENT EDITS)
  // ---------------------------------------------------------------------------
  console.log('\n--- TEST 1: Section 13 Regression Test (Concurrent Edits) ---');

  const v1Content = 'hello\nthis is the original note';
  const v1Hash = calculateHash(v1Content);
  const noteId = `note_reg_${Date.now()}`;
  const v1Id = `v1_${Date.now()}`;

  const noteFilePath = getNoteFilePath('Original Note', 'General Notes');
  writeNoteFile(noteFilePath, v1Content);

  NoteModel.create(
    noteId,
    'Original Note',
    noteFilePath,
    null,
    v1Hash,
    v1Id,
    testUserId,
    'lan'
  );

  VersionModel.createCheckpointTransaction({
    id: v1Id,
    note_id: noteId,
    version_number: 1,
    parent_version_id: null,
    message: 'Initial baseline V1',
    device_id: 'local_device',
    created_at: new Date().toISOString(),
    content_hash: v1Hash,
    is_snapshot: 1,
    is_auto: 0
  }, computeLineDiffHunks('', v1Content), noteId, testUserId);

  SessionModel.upsert(noteId, v1Id, v1Hash, 'clean', testUserId);

  // Both devices start with V1. LAN is disconnected.
  // Device A changes it to:
  const contentA = 'hello\nthis is the original note\nchange from device A';
  const hashA = calculateHash(contentA);
  writeNoteFile(noteFilePath, contentA);
  NoteModel.update(noteId, 'Original Note', noteFilePath, null, hashA, v1Id, testUserId, 'lan');

  // Device B changes it to:
  const contentB = 'hello\nthis is the original note\nchange from device B';
  const hashB = calculateHash(contentB);
  const v6BId = `v6b_${Date.now()}`;

  // Device B's incoming sync payload
  const incomingNotesFromB = [{
    id: noteId,
    title: 'Original Note',
    content: contentB,
    content_hash: hashB,
    current_version_id: v6BId,
    parent_version_id: v1Id,
    version_number: 2,
    sync_mode: 'lan',
    updated_at: new Date().toISOString()
  }];

  mockAiCalls = 0;

  // Reconnect LAN and sync
  const syncResult = await applyIncomingNotesAndNotebooks(
    incomingNotesFromB,
    [],
    remotePeer,
    testUserId
  );

  // Assertions for Section 13:
  // 1. Conflict must be detected
  report(
    '1.1 Conflict Detected',
    syncResult.conflicts.length === 1,
    `Conflicts count: ${syncResult.conflicts.length}`
  );

  // 2. Remote change must NOT silently overwrite local note
  const currentLocalContent = readNoteFile(noteFilePath);
  report(
    '1.2 Local Note NOT Overwritten',
    currentLocalContent === contentA,
    `Content matches Device A's edit, was not replaced by Device B`
  );

  // 3. current_version_id must NOT be updated to remote version
  const noteAfterSync = NoteModel.getById(noteId, testUserId);
  report(
    '1.3 current_version_id NOT updated to remote version',
    noteAfterSync.current_version_id !== v6BId,
    `Current version is: ${noteAfterSync.current_version_id} (not remote ${v6BId})`
  );

  // 4. Note syncState must be marked CONFLICT
  report(
    '1.4 Note sync state is CONFLICT',
    noteAfterSync.sync_state === 'CONFLICT',
    `sync_state: ${noteAfterSync.sync_state}`
  );

  // 5. Conflict record created in ConflictModel
  const activeConflicts = ConflictModel.getByNoteId(noteId, testUserId, true);
  report(
    '1.5 Active conflict record created in SQLite',
    activeConflicts.length === 1,
    `Conflict ID: ${activeConflicts[0]?.id}`
  );

  // 6. AI recommendation generated
  report(
    '1.6 Local AI recommendation generated',
    activeConflicts[0]?.ai_status === 'AVAILABLE' && mockAiCalls === 1,
    `AI status: ${activeConflicts[0]?.ai_status}, suggestedMerge: "${activeConflicts[0]?.ai_suggested_merge}"`
  );

  // ---------------------------------------------------------------------------
  // TEST 2: SECTION 14 NORMAL SYNC (ONE-SIDED EDIT -> FAST-FORWARD)
  // ---------------------------------------------------------------------------
  console.log('\n--- TEST 2: Section 14 Normal Sync (One-Sided Edit) ---');

  const normalNoteId = `note_normal_${Date.now()}`;
  const normalV1Id = `v1_normal_${Date.now()}`;
  const normalBaseContent = 'Initial shared content';
  const normalBaseHash = calculateHash(normalBaseContent);
  const normalFilePath = getNoteFilePath('Normal Note', 'General Notes');
  writeNoteFile(normalFilePath, normalBaseContent);

  NoteModel.create(
    normalNoteId,
    'Normal Note',
    normalFilePath,
    null,
    normalBaseHash,
    normalV1Id,
    testUserId,
    'lan'
  );

  VersionModel.createCheckpointTransaction({
    id: normalV1Id,
    note_id: normalNoteId,
    version_number: 1,
    parent_version_id: null,
    message: 'Normal baseline V1',
    device_id: 'local_device',
    created_at: new Date().toISOString(),
    content_hash: normalBaseHash,
    is_snapshot: 1,
    is_auto: 0
  }, computeLineDiffHunks('', normalBaseContent), normalNoteId, testUserId);

  // Device A (local) does NOT change the note (stays at normalBaseContent, normalV1Id).
  // Device B changes the note to:
  const remoteNewContent = 'Initial shared content\nAdded by Device B only';
  const remoteNewHash = calculateHash(remoteNewContent);
  const remoteNewVerId = `v2_normal_${Date.now()}`;

  const incomingNormalFromB = [{
    id: normalNoteId,
    title: 'Normal Note',
    content: remoteNewContent,
    content_hash: remoteNewHash,
    current_version_id: remoteNewVerId,
    parent_version_id: normalV1Id,
    version_number: 2,
    sync_mode: 'lan',
    updated_at: new Date().toISOString()
  }];

  const aiCallsBefore = mockAiCalls;

  const normalSyncResult = await applyIncomingNotesAndNotebooks(
    incomingNormalFromB,
    [],
    remotePeer,
    testUserId
  );

  // Assertions for Section 14:
  // 1. NO conflict created
  report(
    '2.1 No conflict created on one-sided edit',
    normalSyncResult.conflicts.length === 0,
    `Conflicts: ${normalSyncResult.conflicts.length}`
  );

  // 2. NO AI request invoked
  report(
    '2.2 No AI request invoked on fast-forward',
    mockAiCalls === aiCallsBefore,
    `AI calls during normal sync: ${mockAiCalls - aiCallsBefore}`
  );

  // 3. Remote change applied cleanly to disk
  const localNormalAfter = readNoteFile(normalFilePath);
  report(
    '2.3 Remote change applied cleanly to local note file',
    localNormalAfter === remoteNewContent,
    `Content matches incoming remote content`
  );

  // 4. Note metadata updated to remote version and SYNCED
  const normalNoteAfter = NoteModel.getById(normalNoteId, testUserId);
  report(
    '2.4 Note metadata updated to remote version and marked SYNCED',
    normalNoteAfter.current_version_id === remoteNewVerId && (normalNoteAfter.sync_state === 'SYNCED' || normalNoteAfter.sync_status === 'SYNCED'),
    `current_version_id: ${normalNoteAfter.current_version_id}, sync_state: ${normalNoteAfter.sync_state || normalNoteAfter.sync_status}`
  );

  // ---------------------------------------------------------------------------
  // TEST 3: RESOLUTION VIA [Accept AI Merge] AND PEER PROPAGATION
  // ---------------------------------------------------------------------------
  console.log('\n--- TEST 3: Accept AI Merge Resolution & Peer Convergence ---');

  const conflictToResolve = activeConflicts[0];
  const resolutionResult = await resolveConflict({
    conflictId: conflictToResolve.id,
    userId: testUserId,
    resolutionMethod: 'ACCEPT_AI',
    customContent: null
  });

  report(
    '3.1 User Accept AI Merge creates resolved Version',
    resolutionResult.success && resolutionResult.newVersionId,
    `Created resolved version: ${resolutionResult.newVersionId}`
  );

  const localContentAfterResolution = readNoteFile(noteFilePath);
  report(
    '3.2 Local note updated with AI merged content',
    localContentAfterResolution === conflictToResolve.ai_suggested_merge,
    `Local content matches AI merged content`
  );

  const activeConflictsAfterResolution = ConflictModel.getByNoteId(noteId, testUserId, true);
  report(
    '3.3 Local conflict marked RESOLVED',
    activeConflictsAfterResolution.length === 0,
    `Unresolved conflicts count: ${activeConflictsAfterResolution.length}`
  );

  // Now simulate Device B receiving the resolved version from Device A
  const resolvedPayload = {
    id: noteId,
    title: 'Original Note',
    content: localContentAfterResolution,
    content_hash: calculateHash(localContentAfterResolution),
    current_version_id: resolutionResult.newVersionId,
    parent_version_id: v1Id,
    is_resolution: true,
    resolved_conflict_id: conflictToResolve.id,
    resolution_method: 'ACCEPT_AI',
    sync_mode: 'lan',
    updated_at: new Date().toISOString()
  };

  // Device B applies the resolved payload
  const peerSyncResult = await applyIncomingNotesAndNotebooks(
    [resolvedPayload],
    [],
    { id: 'dev_peer_a', deviceName: 'Device A' },
    testUserId
  );

  report(
    '3.4 Peer receives and applies resolved version without new conflict',
    peerSyncResult.conflicts.length === 0,
    `Peer conflicts created: ${peerSyncResult.conflicts.length}`
  );

  const finalNote = NoteModel.getById(noteId, testUserId);
  report(
    '3.5 Final current_version_id converges on resolved version',
    finalNote.current_version_id === resolutionResult.newVersionId,
    `Final version: ${finalNote.current_version_id}`
  );

  // Cleanup mock server
  mockServer.close();

  console.log('\n================================================================');
  console.log(`REGRESSION TEST RESULTS: ${totalPassed} PASSED, ${totalFailed} FAILED`);
  console.log('================================================================');

  if (totalFailed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  if (mockServer) mockServer.close();
  process.exit(1);
});
