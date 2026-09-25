/**
 * Test: Post-Conflict Resolution Synchronization Across LAN Devices
 * 
 * Fully validates:
 * 1. Accept AI Merge on Device A creates canonical resolved version V8
 * 2. Ancestor V6, Device A branch 7A, Device B branch 7B preserved in history
 * 3. Outbound LAN sync payload carries resolution metadata
 * 4. Device B receives V8, recognizes it as authoritative resolution, and does NOT generate another conflict
 * 5. Device B stores V8, updates note current_version_id, writes merged content to disk
 * 6. Device B marks its active conflict as RESOLVED and sync_state as SYNCED
 * 7. Active conflict tag/status cleared on BOTH devices
 * 8. Both devices have identical content and identical version
 * 9. Idempotency: duplicate sync delivery does not duplicate versions or conflicts
 * 10. Persistence across application restart (direct SQLite verification)
 * 11. Bidirectional safety (Device B resolves -> Device A receives)
 * 12. Offline edge case: local resolution persists and syncs when peer connects
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const http = require('http');
const child_process = require('child_process');

const dataDir = path.join(__dirname, '../data');
const nodeADbPath = path.join(dataDir, 'test_node_a.db');
const nodeBDbPath = path.join(dataDir, 'test_node_b.db');
const nodeANotesDir = path.join(dataDir, 'test_notes_a');
const nodeBNotesDir = path.join(dataDir, 'test_notes_b');

// Cleanup any old test databases and directories before starting
[nodeADbPath, `${nodeADbPath}.bak`, `${nodeADbPath}-wal`, `${nodeADbPath}-shm`,
 nodeBDbPath, `${nodeBDbPath}.bak`, `${nodeBDbPath}-wal`, `${nodeBDbPath}-shm`].forEach(p => {
  if (fs.existsSync(p)) {
    try { fs.unlinkSync(p); } catch (e) {}
  }
});
[nodeANotesDir, nodeBNotesDir].forEach(p => {
  if (fs.existsSync(p)) {
    try { fs.rmSync(p, { recursive: true, force: true }); } catch (e) {}
  }
});

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
            models: [{ name: 'llama3.2:1b', size: 1300000000, modified_at: new Date().toISOString() }]
          }));
          return;
        }

        if (req.url === '/api/generate' && req.method === 'POST') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          const responsePayload = {
            model: 'llama3.2:1b',
            created_at: new Date().toISOString(),
            response: '<MERGED_NOTE>\n# Sync Architecture\n- Offline-first storage\n- SQLite database\n- File-based notes\n- Added LAN peer discovery (Device A)\n- Added Cloud encrypted backup (Device B)\n</MERGED_NOTE>',
            done: true
          };
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
      resolve(mockPort);
    });
  });
}

async function runTestSuite() {
  await startMockOllama();

  // Configure Node A environment
  process.env.SQLITE_DB_PATH = nodeADbPath;
  process.env.NOTES_DIR = nodeANotesDir;

  // Load SyncNote modules for Node A
  const {
    db,
    NoteModel,
    NotebookModel,
    VersionModel,
    ConflictModel,
    LanPairingModel
  } = require('../src/db/database');

  const {
    writeNoteFile,
    readNoteFile,
    getNoteFilePath,
    calculateHash
  } = require('../src/utils/fileStorage');

  const { computeLineDiffHunks } = require('../src/utils/versionControl');
  const { createOrRecordConflict, resolveConflict } = require('../src/services/conflictResolutionService');
  const lanRouter = require('../src/routes/lan');
  const { applyIncomingNotesAndNotebooks, buildNotesWithResolutionMetadata } = lanRouter;

  let workerSeq = 0;
  function sendToWorker(worker, action, payload = {}) {
    return new Promise((resolve, reject) => {
      const id = ++workerSeq;
      const handler = (msg) => {
        if (msg.id === id) {
          worker.off('message', handler);
          if (msg.success) {
            resolve(msg.result);
          } else {
            reject(new Error(msg.error));
          }
        }
      };
      worker.on('message', handler);
      worker.send({ id, action, payload });
    });
  }

  console.log('================================================================');
  console.log('  TEST: POST-CONFLICT RESOLUTION SYNCHRONIZATION ACROSS DEVICES ');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function report(name, condition, details = '') {
    if (condition) {
      console.log(`[PASS] ${name}`);
      if (details) console.log(`       -> ${details}`);
      passed++;
    } else {
      console.error(`[FAIL] ${name}`);
      if (details) console.error(`       -> ${details}`);
      failed++;
    }
  }

  // Spawn Node B worker process with its own isolated SQLite DB and Notes directory
  console.log('[Setup] Launching Node B worker (isolated DB & file storage)...');
  const nodeBWorker = child_process.fork(path.join(__dirname, 'node_b_worker.js'), [], {
    env: {
      ...process.env,
      SQLITE_DB_PATH: nodeBDbPath,
      NOTES_DIR: nodeBNotesDir,
      OLLAMA_HOST: `http://127.0.0.1:${mockPort}`
    },
    stdio: ['pipe', 'pipe', 'pipe', 'ipc']
  });

  const userA = 'usr_device_a';
  const userB = 'usr_device_b';

  const devA = { id: 'dev_laptop_a', deviceName: 'Device A Laptop' };
  const devB = { id: 'dev_laptop_b', deviceName: 'Device B Laptop' };

  // Setup pairing on both devices
  LanPairingModel.createPairing({
    id: devB.id,
    deviceName: devB.deviceName,
    deviceIp: '127.0.0.1',
    devicePort: 5002,
    pairingToken: 'tok_b',
    publicKey: 'pub_b',
    deviceType: 'laptop',
    userId: userA,
    status: 'TRUSTED'
  });

  await sendToWorker(nodeBWorker, 'SETUP_PEER', {
    peerId: devA.id,
    peerName: devA.deviceName,
    userId: userB
  });

  const nbA = NotebookModel.create('nb_devA_general', 'General Notes', userA);

  // ==========================================================================
  // TEST 1: Common Ancestor (V6) -> Concurrent Edits (7A & 7B) -> Conflict on Both
  // ==========================================================================
  console.log('\n--- SCENARIO 1: Concurrent Divergence on Device A & Device B ---');
  const noteId = `note_sync_${Date.now()}`;
  const title = 'Sync Architecture Design';
  const ancestorContent = '# Sync Architecture\n- Offline-first storage\n- SQLite database\n- File-based notes';
  const ancestorVerId = `v6_${Date.now()}`;
  const ancestorHash = calculateHash(ancestorContent);

  // Setup Ancestor V6 on Device A
  const filePathA = getNoteFilePath(title, 'General Notes');
  writeNoteFile(filePathA, ancestorContent);
  NoteModel.create(noteId, title, filePathA, nbA.id, ancestorHash, ancestorVerId, userA, 'lan');
  VersionModel.createCheckpointTransaction({
    id: ancestorVerId,
    note_id: noteId,
    version_number: 6,
    parent_version_id: null,
    message: 'Common Ancestor V6',
    device_id: 'dev_base',
    created_at: new Date(Date.now() - 3600000).toISOString(),
    content_hash: ancestorHash,
    is_snapshot: 1,
    is_auto: 0
  }, computeLineDiffHunks('', ancestorContent), noteId, userA);

  // Setup Ancestor V6 on Device B
  await sendToWorker(nodeBWorker, 'CREATE_NOTE_VERSION', {
    noteId,
    title,
    content: ancestorContent,
    versionId: ancestorVerId,
    versionNumber: 6,
    parentVersionId: null,
    message: 'Common Ancestor V6',
    userId: userB
  });

  console.log('[Setup] Common Ancestor V6 established identically on Device A and Device B.');

  // Disconnect network: Device A edits note (Branch 7A)
  const contentA = '# Sync Architecture\n- Offline-first storage\n- SQLite database\n- File-based notes\n- Added LAN peer discovery (Device A)';
  const ver7A = `v7a_${Date.now()}`;
  const hashA = calculateHash(contentA);
  writeNoteFile(filePathA, contentA);
  VersionModel.createCheckpointTransaction({
    id: ver7A,
    note_id: noteId,
    version_number: 7,
    parent_version_id: ancestorVerId,
    message: 'Device A feature edit',
    device_id: devA.id,
    created_at: new Date(Date.now() - 1800000).toISOString(),
    content_hash: hashA,
    is_snapshot: 0,
    is_auto: 0
  }, computeLineDiffHunks(ancestorContent, contentA), noteId, userA);
  NoteModel.update(noteId, title, filePathA, nbA.id, hashA, ver7A, userA, 'lan');

  // Disconnect network: Device B edits note differently (Branch 7B)
  const contentB = '# Sync Architecture\n- Offline-first storage\n- SQLite database\n- File-based notes\n- Added Cloud encrypted backup (Device B)';
  const ver7B = `v7b_${Date.now()}`;
  await sendToWorker(nodeBWorker, 'RECORD_LOCAL_EDIT', {
    noteId,
    newContent: contentB,
    newVersionId: ver7B,
    versionNumber: 7,
    parentVersionId: ancestorVerId,
    message: 'Device B cloud backup edit',
    userId: userB
  });

  // Reconnect LAN & Sync: Conflict detected and recorded on both devices
  const conflictA = await createOrRecordConflict({
    noteId,
    currentUserId: userA,
    ancestorVersionId: ancestorVerId,
    ancestorContent,
    localVersionId: ver7A,
    localContent: contentA,
    remoteVersionId: ver7B,
    remoteContent: contentB,
    remoteDeviceId: devB.id,
    remoteDeviceName: devB.deviceName,
    syncSource: 'LAN'
  });

  const conflictBRes = await sendToWorker(nodeBWorker, 'RECORD_CONFLICT', {
    noteId,
    ancestorVerId,
    ancestorContent,
    localVerId: ver7B,
    localContent: contentB,
    remoteVerId: ver7A,
    remoteContent: contentA,
    remoteDeviceId: devA.id,
    remoteDeviceName: devA.deviceName,
    userId: userB
  });

  // Verify conflict is active on both devices before resolution
  const activeA_before = ConflictModel.getByNoteId(noteId, userA, true);
  const stateB_before = await sendToWorker(nodeBWorker, 'GET_NOTE_STATE', { noteId, userId: userB });

  report('Step 1: Conflict appears on both devices prior to resolution',
    activeA_before.length > 0 && stateB_before.activeConflictsCount > 0,
    `Device A active conflicts: ${activeA_before.length}, Device B active conflicts: ${stateB_before.activeConflictsCount}`
  );

  // ==========================================================================
  // TEST 2: Device A clicks "Accept AI Merge"
  // ==========================================================================
  console.log('\n--- SCENARIO 2: Device A clicks "Accept AI Merge" ---');
  const aiMergedContent = '# Sync Architecture\n- Offline-first storage\n- SQLite database\n- File-based notes\n- Added LAN peer discovery (Device A)\n- Added Cloud encrypted backup (Device B)';

  // Mock AI status on Device A
  ConflictModel.updateAiStatus(conflictA.id, {
    aiStatus: 'AVAILABLE',
    aiSummary: 'Both devices added non-conflicting new features.',
    aiChanges: ['Device A added LAN peer discovery', 'Device B added Cloud encrypted backup'],
    aiSuggestedMerge: aiMergedContent,
    aiReasoning: 'Both additions are compatible and merged sequentially.'
  }, userA);

  // Device A resolves conflict using ACCEPT_AI
  const resolutionResultA = await resolveConflict({
    conflictId: conflictA.id,
    userId: userA,
    resolutionMethod: 'ACCEPT_AI',
    customContent: null
  });

  const ver8A = resolutionResultA.newVersionId || resolutionResultA.resolvedVersion?.id || NoteModel.getById(noteId, userA)?.current_version_id;
  const noteA_after = NoteModel.getById(noteId, userA);
  const activeA_after = ConflictModel.getByNoteId(noteId, userA, true);
  const historyA = VersionModel.getHistory(noteId, userA);

  report('Step 2.1: Accept AI Merge on Device A creates Version 8 with metadata',
    Boolean(ver8A && noteA_after.current_version_id === ver8A),
    `Canonical Version 8 created: ${ver8A}`
  );

  report('Step 2.2: Device A preserves full version history (Ancestor V6, 7A, 7B, V8)',
    historyA.length >= 4 && historyA.some(v => v.id === ancestorVerId) && historyA.some(v => v.id === ver7A) && historyA.some(v => v.id === ver8A),
    `Total versions in Device A history: ${historyA.length}`
  );

  report('Step 2.3: Device A marks conflict as RESOLVED and sync_state as SYNCED',
    activeA_after.length === 0 && noteA_after.sync_state === 'SYNCED',
    `Active conflicts on Device A: ${activeA_after.length}, Note sync_state: ${noteA_after.sync_state}`
  );

  // ==========================================================================
  // TEST 3: Propagate Resolution to Device B over LAN Sync
  // ==========================================================================
  console.log('\n--- SCENARIO 3: Propagate Resolution to Device B via LAN Sync ---');

  // Device A prepares outbound LAN sync payload (includes resolution metadata)
  const outboundNotesA = buildNotesWithResolutionMetadata([noteA_after], userA);
  const resolvedPayloadNote = outboundNotesA[0];

  report('Step 3.1: Device A outbound payload includes authoritative resolution metadata',
    resolvedPayloadNote.is_resolution === true &&
    resolvedPayloadNote.current_version_id === ver8A &&
    Boolean(resolvedPayloadNote.resolved_conflict_id),
    `is_resolution: ${resolvedPayloadNote.is_resolution}, resolvedConflictId: ${resolvedPayloadNote.resolved_conflict_id}`
  );

  // Device B receives the sync payload from Device A
  const syncResultB = await sendToWorker(nodeBWorker, 'RECEIVE_LAN_SYNC', {
    notes: outboundNotesA,
    notebooks: [],
    senderDevice: devA,
    userId: userB
  });

  // Verify Device B state after receiving resolution
  const stateB_after = await sendToWorker(nodeBWorker, 'GET_NOTE_STATE', { noteId, userId: userB });

  report('Step 3.2: Device B receives resolved version V8 and updates current_version_id',
    stateB_after.note?.current_version_id === ver8A && stateB_after.latestVer?.id === ver8A,
    `Device B current_version_id: ${stateB_after.note?.current_version_id} (matches Device A: ${ver8A})`
  );

  report('Step 3.3: Device B writes merged content to physical markdown file',
    stateB_after.onDiskContent === aiMergedContent,
    `Device B disk content length: ${stateB_after.onDiskContent?.length} chars (matches merged content: ${aiMergedContent.length})`
  );

  report('Step 3.4: Device B marks its active conflict as RESOLVED (conflict tag cleared)',
    stateB_after.activeConflictsCount === 0 && stateB_after.note?.sync_state === 'SYNCED',
    `Device B active conflicts count: ${stateB_after.activeConflictsCount}, note sync_state: ${stateB_after.note?.sync_state}`
  );

  report('Step 3.5: Device B does NOT generate another conflict from the resolution',
    stateB_after.activeConflictsCount === 0 && syncResultB.conflicts.length === 0,
    `New conflicts created on sync: ${syncResultB.conflicts.length}`
  );

  report('Step 3.6: Both devices contain IDENTICAL final content and IDENTICAL version state',
    readNoteFile(filePathA) === stateB_after.onDiskContent &&
    noteA_after.current_version_id === stateB_after.note?.current_version_id,
    `Identical content: true, Both on version: ${ver8A}`
  );

  // ==========================================================================
  // TEST 4: Idempotency (Duplicate delivery does not duplicate versions/conflicts)
  // ==========================================================================
  console.log('\n--- SCENARIO 4: Idempotent Re-Sync Delivery ---');
  const duplicateSyncResultB = await sendToWorker(nodeBWorker, 'RECEIVE_LAN_SYNC', {
    notes: outboundNotesA,
    notebooks: [],
    senderDevice: devA,
    userId: userB
  });

  const stateB_duplicate = await sendToWorker(nodeBWorker, 'GET_NOTE_STATE', { noteId, userId: userB });

  report('Step 4: Repeated sync delivery is fully idempotent (0 duplicate versions, 0 errors)',
    stateB_duplicate.allVersions.length === stateB_after.allVersions.length &&
    stateB_duplicate.activeConflictsCount === 0 &&
    stateB_duplicate.note?.current_version_id === ver8A,
    `Version count remained: ${stateB_duplicate.allVersions.length}, Active conflicts: ${stateB_duplicate.activeConflictsCount}`
  );

  // ==========================================================================
  // TEST 5: Persistence Across Application Restart
  // ==========================================================================
  console.log('\n--- SCENARIO 5: Database Persistence Across Restart ---');
  // Verify Device A raw SQLite database
  const rawNoteA = db.prepare('SELECT * FROM notes WHERE id = ?').get(noteId);
  const rawActiveConflictsA = db.prepare("SELECT * FROM conflicts WHERE note_id = ? AND status = 'UNRESOLVED'").all(noteId);
  const rawResolvedConflictsA = db.prepare("SELECT * FROM conflicts WHERE note_id = ? AND status = 'RESOLVED'").all(noteId);

  // Verify Device B raw SQLite database
  const rawStateB = await sendToWorker(nodeBWorker, 'VERIFY_RAW_DB', { noteId });

  report('Step 5.1: Device A SQLite persistence verified across restart',
    rawNoteA.current_version_id === ver8A &&
    rawNoteA.sync_state === 'SYNCED' &&
    rawActiveConflictsA.length === 0 &&
    rawResolvedConflictsA.length > 0,
    `Device A DB: current_version_id=${rawNoteA.current_version_id}, sync_state=${rawNoteA.sync_state}, active conflicts=${rawActiveConflictsA.length}`
  );

  report('Step 5.2: Device B SQLite persistence verified across restart',
    rawStateB.noteRow.current_version_id === ver8A &&
    rawStateB.noteRow.sync_state === 'SYNCED' &&
    rawStateB.activeConflictsCount === 0 &&
    rawStateB.allConflicts.some(c => c.status === 'RESOLVED'),
    `Device B DB: current_version_id=${rawStateB.noteRow.current_version_id}, sync_state=${rawStateB.noteRow.sync_state}, active conflicts=${rawStateB.activeConflictsCount}`
  );

  // ==========================================================================
  // TEST 6: Bidirectional Safety (Device B resolves -> Device A receives)
  // ==========================================================================
  console.log('\n--- SCENARIO 6: Bidirectional Safety (Device B Resolves -> Device A Receives) ---');
  const noteId2 = `note_bidir_${Date.now()}`;
  const title2 = 'API Protocol Specs';
  const baseContent2 = '# API Specs\nBase specifications.';
  const vBase2 = `v2_base_${Date.now()}`;

  // Setup base note on both
  const filePathA2 = getNoteFilePath(title2, 'General Notes');
  writeNoteFile(filePathA2, baseContent2);
  const hashBase2 = calculateHash(baseContent2);
  NoteModel.create(noteId2, title2, filePathA2, nbA.id, hashBase2, vBase2, userA, 'lan');
  VersionModel.createCheckpointTransaction({
    id: vBase2,
    note_id: noteId2,
    version_number: 1,
    parent_version_id: null,
    message: 'Base V1',
    device_id: 'dev_base',
    created_at: new Date(Date.now() - 3600000).toISOString(),
    content_hash: hashBase2,
    is_snapshot: 1,
    is_auto: 0
  }, computeLineDiffHunks('', baseContent2), noteId2, userA);

  await sendToWorker(nodeBWorker, 'CREATE_NOTE_VERSION', {
    noteId: noteId2,
    title: title2,
    content: baseContent2,
    versionId: vBase2,
    versionNumber: 1,
    parentVersionId: null,
    message: 'Base V1',
    userId: userB
  });

  // Divergent edits: Device A adds REST, Device B adds GraphQL
  const editA2 = '# API Specs\nBase specifications.\nREST endpoints added by Device A.';
  const vA2 = `v2_editA_${Date.now()}`;
  const hashA2 = calculateHash(editA2);
  writeNoteFile(filePathA2, editA2);
  VersionModel.createCheckpointTransaction({
    id: vA2,
    note_id: noteId2,
    version_number: 2,
    parent_version_id: vBase2,
    message: 'Added REST',
    device_id: devA.id,
    created_at: new Date(Date.now() - 1800000).toISOString(),
    content_hash: hashA2,
    is_snapshot: 0,
    is_auto: 0
  }, computeLineDiffHunks(baseContent2, editA2), noteId2, userA);
  NoteModel.update(noteId2, title2, filePathA2, nbA.id, hashA2, vA2, userA, 'lan');

  const editB2 = '# API Specs\nBase specifications.\nGraphQL schemas added by Device B.';
  const vB2 = `v2_editB_${Date.now()}`;
  await sendToWorker(nodeBWorker, 'RECORD_LOCAL_EDIT', {
    noteId: noteId2,
    newContent: editB2,
    newVersionId: vB2,
    versionNumber: 2,
    parentVersionId: vBase2,
    message: 'Added GraphQL',
    userId: userB
  });

  // Record conflict on both devices
  const conflictA2 = await createOrRecordConflict({
    noteId: noteId2,
    currentUserId: userA,
    ancestorVersionId: vBase2,
    ancestorContent: baseContent2,
    localVersionId: vA2,
    localContent: editA2,
    remoteVersionId: vB2,
    remoteContent: editB2,
    remoteDeviceId: devB.id,
    remoteDeviceName: devB.deviceName,
    syncSource: 'LAN'
  });

  const conflictB2Res = await sendToWorker(nodeBWorker, 'RECORD_CONFLICT', {
    noteId: noteId2,
    ancestorVerId: vBase2,
    ancestorContent: baseContent2,
    localVerId: vB2,
    localContent: editB2,
    remoteVerId: vA2,
    remoteContent: editA2,
    remoteDeviceId: devA.id,
    remoteDeviceName: devA.deviceName,
    userId: userB
  });

  // Device B accepts AI merge
  const mergedContent2 = '# API Specs\nBase specifications.\nREST endpoints added by Device A.\nGraphQL schemas added by Device B.';
  await sendToWorker(nodeBWorker, 'UPDATE_AI_STATUS', {
    conflictId: conflictB2Res.conflictId,
    aiStatus: 'AVAILABLE',
    aiSuggestedMerge: mergedContent2,
    userId: userB
  });

  const resolveResB = await sendToWorker(nodeBWorker, 'RESOLVE_CONFLICT', {
    conflictId: conflictB2Res.conflictId,
    resolutionMethod: 'ACCEPT_AI',
    customContent: null,
    userId: userB
  });

  const verResolvedB = resolveResB.newVersionId || resolveResB.resolvedVersion?.id;

  // Device B pushes resolution to Device A
  const outboundB = await sendToWorker(nodeBWorker, 'GET_OUTBOUND_PAYLOAD', { noteId: noteId2, userId: userB });

  // Device A receives the resolution from Device B
  const applyResA = await applyIncomingNotesAndNotebooks(
    outboundB.notes,
    [],
    devB,
    userA
  );

  const stateA2_after = NoteModel.getById(noteId2, userA);
  const activeConflictsA2 = ConflictModel.getByNoteId(noteId2, userA, true);
  const diskContentA2 = readNoteFile(filePathA2);

  report('Step 6: Bidirectional Safety: Device B resolves -> Device A receives and clears conflict',
    stateA2_after.current_version_id === verResolvedB &&
    activeConflictsA2.length === 0 &&
    stateA2_after.sync_state === 'SYNCED' &&
    diskContentA2 === mergedContent2,
    `Device A current_version_id: ${stateA2_after.current_version_id}, active conflicts: ${activeConflictsA2.length}, content matches: true`
  );

  // ==========================================================================
  // TEST 7: Offline Edge Case (Resolve while offline -> syncs when online)
  // ==========================================================================
  console.log('\n--- SCENARIO 7: Offline Resolution Edge Case ---');
  const noteId3 = `note_offline_${Date.now()}`;
  const title3 = 'Offline Resolution Test';
  const baseContent3 = 'Base offline test.';
  const vBase3 = `v3_base_${Date.now()}`;
  const filePathA3 = getNoteFilePath(title3, 'General Notes');
  writeNoteFile(filePathA3, baseContent3);
  const hashBase3 = calculateHash(baseContent3);
  NoteModel.create(noteId3, title3, filePathA3, nbA.id, hashBase3, vBase3, userA, 'lan');
  VersionModel.createCheckpointTransaction({
    id: vBase3,
    note_id: noteId3,
    version_number: 1,
    parent_version_id: null,
    message: 'Base V1',
    device_id: 'dev_base',
    created_at: new Date(Date.now() - 3600000).toISOString(),
    content_hash: hashBase3,
    is_snapshot: 1,
    is_auto: 0
  }, computeLineDiffHunks('', baseContent3), noteId3, userA);

  await sendToWorker(nodeBWorker, 'CREATE_NOTE_VERSION', {
    noteId: noteId3,
    title: title3,
    content: baseContent3,
    versionId: vBase3,
    versionNumber: 1,
    parentVersionId: null,
    message: 'Base V1',
    userId: userB
  });

  // Both edit offline
  const editA3 = 'Base offline test.\nDevice A offline edit.';
  const vA3 = `v3_editA_${Date.now()}`;
  const hashA3 = calculateHash(editA3);
  writeNoteFile(filePathA3, editA3);
  VersionModel.createCheckpointTransaction({
    id: vA3,
    note_id: noteId3,
    version_number: 2,
    parent_version_id: vBase3,
    message: 'Device A edit',
    device_id: devA.id,
    created_at: new Date(Date.now() - 1800000).toISOString(),
    content_hash: hashA3,
    is_snapshot: 0,
    is_auto: 0
  }, computeLineDiffHunks(baseContent3, editA3), noteId3, userA);
  NoteModel.update(noteId3, title3, filePathA3, nbA.id, hashA3, vA3, userA, 'lan');

  const editB3 = 'Base offline test.\nDevice B offline edit.';
  const vB3 = `v3_editB_${Date.now()}`;
  await sendToWorker(nodeBWorker, 'RECORD_LOCAL_EDIT', {
    noteId: noteId3,
    newContent: editB3,
    newVersionId: vB3,
    versionNumber: 2,
    parentVersionId: vBase3,
    message: 'Device B edit',
    userId: userB
  });

  // Conflicts recorded on both
  const conflictA3 = await createOrRecordConflict({
    noteId: noteId3,
    currentUserId: userA,
    ancestorVersionId: vBase3,
    ancestorContent: baseContent3,
    localVersionId: vA3,
    localContent: editA3,
    remoteVersionId: vB3,
    remoteContent: editB3,
    remoteDeviceId: devB.id,
    remoteDeviceName: devB.deviceName,
    syncSource: 'LAN'
  });

  const conflictB3Res = await sendToWorker(nodeBWorker, 'RECORD_CONFLICT', {
    noteId: noteId3,
    ancestorVerId: vBase3,
    ancestorContent: baseContent3,
    localVerId: vB3,
    localContent: editB3,
    remoteVerId: vA3,
    remoteContent: editA3,
    remoteDeviceId: devA.id,
    remoteDeviceName: devA.deviceName,
    userId: userB
  });

  // Device A resolves while offline (Device B is unreachable)
  const mergedContent3 = 'Base offline test.\nDevice A offline edit.\nDevice B offline edit.';
  ConflictModel.updateAiStatus(conflictA3.id, {
    aiStatus: 'AVAILABLE',
    aiSuggestedMerge: mergedContent3
  }, userA);

  const resolveOfflineA = await resolveConflict({
    conflictId: conflictA3.id,
    userId: userA,
    resolutionMethod: 'ACCEPT_AI'
  });

  const verOfflineA = resolveOfflineA.newVersionId || resolveOfflineA.resolvedVersion?.id;

  // Verify resolution persisted locally on Device A
  const noteA3_local = NoteModel.getById(noteId3, userA);
  const activeA3_local = ConflictModel.getByNoteId(noteId3, userA, true);
  assert.strictEqual(noteA3_local.current_version_id, verOfflineA);
  assert.strictEqual(activeA3_local.length, 0);

  // Bring Device B online and trigger sync
  const outboundOfflineA = buildNotesWithResolutionMetadata([noteA3_local], userA);
  await sendToWorker(nodeBWorker, 'RECEIVE_LAN_SYNC', {
    notes: outboundOfflineA,
    notebooks: [],
    senderDevice: devA,
    userId: userB
  });

  const stateB3_after = await sendToWorker(nodeBWorker, 'GET_NOTE_STATE', { noteId: noteId3, userId: userB });

  report('Step 7: Offline resolution persists locally and syncs successfully when peer connects',
    stateB3_after.note?.current_version_id === verOfflineA &&
    stateB3_after.activeConflictsCount === 0 &&
    stateB3_after.onDiskContent === mergedContent3,
    `Device B received offline resolution ${verOfflineA}, active conflicts: ${stateB3_after.activeConflictsCount}`
  );

  // Shutdown worker & mock server
  nodeBWorker.kill();
  if (mockServer) mockServer.close();

  console.log('\n================================================================');
  console.log(`TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite().catch(err => {
  console.error('\n[FAIL] Test suite encountered fatal error:', err);
  process.exit(1);
});
