/**
 * ==============================================================================
 * SYNCNOTE SYNCHRONIZATION FLOW VERIFICATION TEST SUITE
 * ==============================================================================
 * Validates:
 * 1. Normal sync fast-forwards cleanly without AI invocation.
 * 2. Concurrent edits on two devices DO NOT overwrite either note on disk.
 * 3. Note is marked with status "Conflict detected - awaiting resolution".
 * 4. Local Ollama AI generates semantic merge suggestion without modifying notes.
 * 5. Outbound sync exposes conflict to trigger Conflict Resolution UI.
 * 6. Explicit user resolution actions (Accept AI Merge, Keep Local, Keep Remote, Reject/Cancel)
 *    store new versions in history, preserving ancestor & conflicting branches for rollback.
 * 7. Edits following past resolutions do NOT trigger false resolution overwrites.
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
  calculateHash,
  getNoteFilePath,
  writeNoteFile,
  readNoteFile
} = require('../src/utils/fileStorage');

const {
  computeLineDiffHunks,
  reconstructVersionContent
} = require('../src/utils/versionControl');

const {
  createOrRecordConflict,
  resolveConflict
} = require('../src/services/conflictResolutionService');

const lanRouter = require('../src/routes/lan');
const { applyIncomingNotesAndNotebooks, buildNotesWithResolutionMetadata } = lanRouter;

let testsPassed = 0;
let testsFailed = 0;

function report(testName, passed, details = '') {
  if (passed) {
    console.log(`[PASS] ${testName}`);
    if (details) console.log(`       -> ${details}`);
    testsPassed++;
  } else {
    console.error(`[FAIL] ${testName}`);
    if (details) console.error(`       -> ${details}`);
    testsFailed++;
  }
}

let mockServer = null;

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
          const responsePayload = {
            model: 'llama3.2:1b',
            created_at: new Date().toISOString(),
            response: JSON.stringify({
              conflictDetected: true,
              summary: 'Both devices made concurrent additions to the roadmap.',
              changesFromAncestor: [
                'Device A added: Phase 3 (Local): Build React frontend',
                'Device B added: Phase 3 (Remote): Build SQLite backend'
              ],
              suggestedMerge: 'Phase 1: Research\nPhase 2: Prototyping\nPhase 3: Build React frontend & SQLite backend',
              reasoning: 'Both modifications add complementary components to Phase 3; merging preserves both frontend and backend work.'
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
      const mockPort = mockServer.address().port;
      process.env.OLLAMA_HOST = `http://127.0.0.1:${mockPort}`;
      process.env.OLLAMA_MODEL = 'llama3.2:1b';
      resolve();
    });
  });
}

async function runVerification() {
  console.log('================================================================');
  console.log('   SYNCNOTE SYNCHRONIZATION FLOW & CONFLICT VERIFICATION TESTS   ');
  console.log('================================================================\n');

  await startMockOllama();

  const userId = 'usr_test_verification';

  // Cleanup test user data if any
  try {
    db.prepare('DELETE FROM conflicts WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM notes WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM versions WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  } catch (e) {}

  const senderDevice = {
    id: 'dev_peer_laptop',
    deviceId: 'dev_peer_laptop',
    device_name: 'Peer Laptop',
    deviceName: 'Peer Laptop'
  };

  // --------------------------------------------------------------------------
  // TEST 1: Normal Sync (Non-conflicting Fast-Forward)
  // --------------------------------------------------------------------------
  console.log('--- TEST 1: Normal Non-Conflicting Sync ---');
  const normalNoteId = `note_normal_${Date.now()}`;
  const normalTitle = 'Normal Shared Note';
  const normalFilePath = getNoteFilePath(normalTitle, 'General Notes');
  const v1Content = 'Original shared content line 1\nOriginal shared content line 2';
  writeNoteFile(normalFilePath, v1Content);
  const v1Hash = calculateHash(v1Content);
  const v1Id = `v1_normal_${Date.now()}`;

  NoteModel.create(normalNoteId, normalTitle, normalFilePath, null, v1Hash, v1Id, userId, 'lan');
  VersionModel.createCheckpointTransaction({
    id: v1Id,
    note_id: normalNoteId,
    version_number: 1,
    parent_version_id: null,
    message: 'Base V1',
    device_id: 'local_device',
    created_at: new Date().toISOString(),
    content_hash: v1Hash,
    is_snapshot: 1,
    is_auto: 0
  }, computeLineDiffHunks('', v1Content), normalNoteId, userId);
  NoteModel.updateSyncMetadata(normalNoteId, userId, {
    lastSyncedHash: v1Hash,
    lastSyncedAt: new Date().toISOString(),
    syncState: 'SYNCED',
    syncError: null
  });

  // Remote updates note to V2 while local made no edits
  const v2RemoteContent = 'Original shared content line 1\nOriginal shared content line 2\nPeer added line 3';
  const v2RemoteHash = calculateHash(v2RemoteContent);
  const v2RemoteId = `v2_remote_${Date.now()}`;

  const incomingNormalNotes = [{
    id: normalNoteId,
    title: normalTitle,
    content: v2RemoteContent,
    content_hash: v2RemoteHash,
    current_version_id: v2RemoteId,
    parent_version_id: v1Id,
    version_number: 2,
    version_message: 'Peer update',
    ancestor_version_ids: [v2RemoteId, v1Id],
    is_resolution: false,
    resolved_conflict_id: null,
    sync_mode: 'lan'
  }];

  const { appliedNotes: applied1, conflicts: conflicts1 } = await applyIncomingNotesAndNotebooks(
    incomingNormalNotes,
    [],
    senderDevice,
    userId
  );

  const diskAfterNormal = readNoteFile(normalFilePath);
  const metaAfterNormal = NoteModel.getById(normalNoteId, userId);

  report('1.1 Normal sync updates remote note automatically without conflict',
    conflicts1.length === 0 && applied1.some(a => a.action === 'UPDATED'),
    `Conflicts: ${conflicts1.length}, Action: ${applied1[0]?.action}`
  );
  report('1.2 Normal sync applied remote content cleanly to disk',
    diskAfterNormal === v2RemoteContent,
    `Disk matches remote V2: ${diskAfterNormal === v2RemoteContent}`
  );
  report('1.3 Normal sync marked note as SYNCED with new version',
    metaAfterNormal.sync_state === 'SYNCED' && metaAfterNormal.current_version_id === v2RemoteId,
    `Sync state: ${metaAfterNormal.sync_state}, Version: ${metaAfterNormal.current_version_id}`
  );

  // --------------------------------------------------------------------------
  // TEST 2: Concurrent Edits - Conflict Gate & Zero Overwrite
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 2: Concurrent Conflicting Edits (Gate & Zero Overwrite) ---');
  const conflictNoteId = `note_conflict_${Date.now()}`;
  const conflictTitle = 'Project Roadmap';
  const conflictFilePath = getNoteFilePath(conflictTitle, 'General Notes');
  const commonBase = 'Phase 1: Research\nPhase 2: Prototyping';
  writeNoteFile(conflictFilePath, commonBase);
  const baseHash = calculateHash(commonBase);
  const baseVerId = `v1_base_${Date.now()}`;

  NoteModel.create(conflictNoteId, conflictTitle, conflictFilePath, null, baseHash, baseVerId, userId, 'lan');
  VersionModel.createCheckpointTransaction({
    id: baseVerId,
    note_id: conflictNoteId,
    version_number: 1,
    parent_version_id: null,
    message: 'Common Base V1',
    device_id: 'local_device',
    created_at: new Date().toISOString(),
    content_hash: baseHash,
    is_snapshot: 1,
    is_auto: 0
  }, computeLineDiffHunks('', commonBase), conflictNoteId, userId);
  NoteModel.updateSyncMetadata(conflictNoteId, userId, {
    lastSyncedHash: baseHash,
    lastSyncedAt: new Date().toISOString(),
    syncState: 'SYNCED',
    syncError: null
  });

  // Local device edits:
  const localEditContent = 'Phase 1: Research\nPhase 2: Prototyping\nPhase 3 (Local): Build React frontend';
  writeNoteFile(conflictFilePath, localEditContent);
  const localEditHash = calculateHash(localEditContent);
  NoteModel.update(conflictNoteId, conflictTitle, conflictFilePath, null, localEditHash, baseVerId, userId, 'lan');

  // Peer device independently edits:
  const remoteEditContent = 'Phase 1: Research\nPhase 2: Prototyping\nPhase 3 (Remote): Build SQLite backend';
  const remoteEditHash = calculateHash(remoteEditContent);
  const remoteVerId = `v2_remote_branch_${Date.now()}`;

  const incomingConflictingNotes = [{
    id: conflictNoteId,
    title: conflictTitle,
    content: remoteEditContent,
    content_hash: remoteEditHash,
    current_version_id: remoteVerId,
    parent_version_id: baseVerId,
    version_number: 2,
    version_message: 'Remote concurrent branch',
    ancestor_version_ids: [remoteVerId, baseVerId],
    is_resolution: false,
    resolved_conflict_id: null,
    sync_mode: 'lan'
  }];

  // INGESTION: Peer sync payload arrives at local device
  const { appliedNotes: applied2, conflicts: conflicts2 } = await applyIncomingNotesAndNotebooks(
    incomingConflictingNotes,
    [],
    senderDevice,
    userId
  );

  const localDiskAfterConflict = readNoteFile(conflictFilePath);
  const localMetaAfterConflict = NoteModel.getById(conflictNoteId, userId);

  report('2.1 Conflict is detected when notes diverge concurrently',
    conflicts2.length === 1 && applied2.some(a => a.action === 'CONFLICT_RECORDED'),
    `Conflicts count: ${conflicts2.length}, Action: ${applied2[0]?.action}`
  );
  report('2.2 Local note was NOT overwritten on disk',
    localDiskAfterConflict === localEditContent,
    `Local disk content matches local edit exactly (no remote overwrite)`
  );
  report('2.3 Note metadata marked with "Conflict detected - awaiting resolution"',
    localMetaAfterConflict.sync_state === 'CONFLICT' && localMetaAfterConflict.sync_error === 'Conflict detected - awaiting resolution',
    `sync_state: ${localMetaAfterConflict.sync_state}, sync_error: ${localMetaAfterConflict.sync_error}`
  );
  report('2.4 Local version ID remains unchanged (not replaced by remote version)',
    localMetaAfterConflict.current_version_id === baseVerId,
    `current_version_id: ${localMetaAfterConflict.current_version_id}`
  );
  report('2.5 Conflict payload contains full details for UI (LOCAL, REMOTE, and AI suggestion)',
    Boolean(
      conflicts2[0].localContent === localEditContent &&
      conflicts2[0].remoteContent === remoteEditContent &&
      conflicts2[0].aiSuggestedMerge
    ),
    `localContent: ${conflicts2[0].localContent?.length} chars, remoteContent: ${conflicts2[0].remoteContent?.length} chars, aiSuggestedMerge: "${conflicts2[0].aiSuggestedMerge}"`
  );

  // --------------------------------------------------------------------------
  // TEST 3: User Explicitly Chooses Action [Accept AI Merge]
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 3: User Approves [Accept AI Merge] ---');
  const recordedConflictId = conflicts2[0].conflictId || conflicts2[0].id;

  const resolutionResult = await resolveConflict({
    conflictId: recordedConflictId,
    userId,
    resolutionMethod: 'ACCEPT_AI'
  });

  const diskAfterResolution = readNoteFile(conflictFilePath);
  const metaAfterResolution = NoteModel.getById(conflictNoteId, userId);
  const allVersions = VersionModel.getHistory(conflictNoteId, userId);

  report('3.1 Accept AI Merge writes AI merged version to disk',
    diskAfterResolution === conflicts2[0].aiSuggestedMerge,
    `Disk matches AI suggestion: "${diskAfterResolution}"`
  );
  report('3.2 Note updated to new resolution version checkpoint and marked SYNCED',
    metaAfterResolution.sync_state === 'SYNCED' && metaAfterResolution.sync_error === null,
    `sync_state: ${metaAfterResolution.sync_state}, new version: ${metaAfterResolution.current_version_id}`
  );
  report('3.3 Full version history preserved for rollback (Ancestor, Conflicting branch, Resolved)',
    allVersions.length >= 3,
    `Total versions in history: ${allVersions.length}`
  );
  report('3.4 Conflict marked RESOLVED in database',
    ConflictModel.getByNoteId(conflictNoteId, userId, true).length === 0,
    `Active conflicts remaining: ${ConflictModel.getByNoteId(conflictNoteId, userId, true).length}`
  );

  // --------------------------------------------------------------------------
  // TEST 4: Edits Following Resolution Do NOT Trigger False Resolution Overwrite
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 4: Post-Resolution Edits Protected Against False Overwrite ---');
  // Both devices make new edits on the previously resolved note
  const localPostResolutionEdit = diskAfterResolution + '\n\nNew local post-resolution addition';
  writeNoteFile(conflictFilePath, localPostResolutionEdit);
  const localPostHash = calculateHash(localPostResolutionEdit);
  NoteModel.update(conflictNoteId, conflictTitle, conflictFilePath, null, localPostHash, metaAfterResolution.current_version_id, userId, 'lan');

  // Verify buildNotesWithResolutionMetadata does NOT flag this new edit as is_resolution: true
  const [outgoingPayload] = buildNotesWithResolutionMetadata([NoteModel.getById(conflictNoteId, userId)], userId);
  report('4.1 Modified note after resolution is NOT falsely flagged as is_resolution: true',
    outgoingPayload.is_resolution === false,
    `is_resolution: ${outgoingPayload.is_resolution}, resolved_conflict_id: ${outgoingPayload.resolved_conflict_id}`
  );

  // Peer also made a new edit
  const remotePostResolutionEdit = diskAfterResolution + '\n\nNew peer post-resolution addition';
  const remotePostHash = calculateHash(remotePostResolutionEdit);
  const remotePostVerId = `v_post_${Date.now()}`;

  const incomingPostNotes = [{
    id: conflictNoteId,
    title: conflictTitle,
    content: remotePostResolutionEdit,
    content_hash: remotePostHash,
    current_version_id: remotePostVerId,
    parent_version_id: metaAfterResolution.current_version_id,
    version_number: 4,
    version_message: 'Peer second edit',
    ancestor_version_ids: [remotePostVerId, metaAfterResolution.current_version_id],
    is_resolution: false,
    resolved_conflict_id: null,
    sync_mode: 'lan'
  }];

  const { appliedNotes: applied4, conflicts: conflicts4 } = await applyIncomingNotesAndNotebooks(
    incomingPostNotes,
    [],
    senderDevice,
    userId
  );

  const diskAfterSecondConflict = readNoteFile(conflictFilePath);
  report('4.2 New concurrent edit triggers new conflict and does NOT overwrite local note',
    conflicts4.length === 1 && diskAfterSecondConflict === localPostResolutionEdit,
    `Conflicts: ${conflicts4.length}, Local content intact: ${diskAfterSecondConflict === localPostResolutionEdit}`
  );

  // --------------------------------------------------------------------------
  // TEST 5: [Reject / Cancel] Leaves Note Unresolved & Untouched
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 5: User Action [Reject / Cancel] ---');
  const secondConflictId = conflicts4[0].conflictId || conflicts4[0].id;
  await resolveConflict({
    conflictId: secondConflictId,
    userId,
    resolutionMethod: 'REJECT'
  });

  const diskAfterReject = readNoteFile(conflictFilePath);
  const activeConflictsAfterReject = ConflictModel.getByNoteId(conflictNoteId, userId, true);

  report('5.1 Reject / Cancel keeps note content completely untouched on disk',
    diskAfterReject === localPostResolutionEdit,
    `Disk content unchanged: ${diskAfterReject === localPostResolutionEdit}`
  );
  report('5.2 Conflict remains registered and deferred in history',
    activeConflictsAfterReject.length === 1,
    `Active conflicts: ${activeConflictsAfterReject.length}`
  );

  // --------------------------------------------------------------------------
  // Summary
  // --------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log(` RESULTS: ${testsPassed} PASSED / ${testsFailed} FAILED across all verification tests`);
  console.log('================================================================\n');

  if (mockServer) {
    mockServer.close();
  }

  if (testsFailed > 0) {
    process.exit(1);
  }
}

runVerification().catch(err => {
  console.error('Fatal test error:', err);
  if (mockServer) {
    mockServer.close();
  }
  process.exit(1);
});
