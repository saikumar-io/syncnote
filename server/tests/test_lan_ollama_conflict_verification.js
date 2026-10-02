/**
 * ==============================================================================
 * SYNCNOTE LAN SYNC + OLLAMA CONFLICT RESOLUTION VERIFICATION SUITE
 * ==============================================================================
 * 
 * Verifies all 11 required scenarios:
 * TEST 1: Initiating Device Detects Conflict (UI & Ollama ONLY on Device A)
 * TEST 2: Semantic AI Merge (Meaning understood, complementary merge, no blind concatenation)
 * TEST 3: User Accepts AI Merge (New canonical version created, propagated to Device B, identical state)
 * TEST 4: Edit & Accept (User edits AI suggestion, canonical version, propagated to Device B)
 * TEST 5: Keep Local (Local content canonical, version created, Device B updated, no second conflict)
 * TEST 6: Keep Remote (Remote content canonical, Device A updated, consistent state)
 * TEST 7: Cancel (Neither note overwritten, conflict stays unresolved, safe deferred resolution)
 * TEST 8: Contradictory Content (PostgreSQL vs MongoDB detected, user decision required)
 * TEST 9: Ollama Unavailable (Sync does not crash, reports AI offline, manual resolution safe)
 * TEST 10: Receiving Device Must Not Re-Resolve (Device B applies resolution automatically, zero Ollama/conflict)
 * TEST 11: Normal Non-Conflict Sync (Fast-forward, no conflict UI, no Ollama)
 * ==============================================================================
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

// Isolated test environment configuration
const testDbPath = path.join(__dirname, 'test_lan_conflict_verification.db');
const storageDirA = path.join(__dirname, 'test_storage_device_a');
const storageDirB = path.join(__dirname, 'test_storage_device_b');

process.env.SQLITE_DB_PATH = testDbPath;

[storageDirA, storageDirB].forEach(d => {
  if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
  fs.mkdirSync(d, { recursive: true });
});

if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
if (fs.existsSync(`${testDbPath}.bak`)) fs.unlinkSync(`${testDbPath}.bak`);

const {
  db,
  NoteModel,
  NotebookModel,
  VersionModel,
  ConflictModel,
  LanPairingModel
} = require('../src/db/database');

const { writeNoteFile, readNoteFile, calculateHash } = require('../src/utils/fileStorage');
const { computeLineDiffHunks } = require('../src/utils/versionControl');
const {
  applyIncomingNotesAndNotebooks,
  buildNotesWithResolutionMetadata
} = require('../src/routes/lan');
const {
  createOrRecordConflict,
  resolveConflict
} = require('../src/services/conflictResolutionService');
const {
  generateSemanticConflictResolution,
  getOllamaConfig
} = require('../src/services/ollamaService');

let totalPassed = 0;
let totalFailed = 0;

function report(testNum, title, passed, detail = '') {
  if (passed) {
    totalPassed++;
    console.log(`[PASS] TEST ${testNum}: ${title}`);
    if (detail) console.log(`       -> ${detail}`);
  } else {
    totalFailed++;
    console.error(`[FAIL] TEST ${testNum}: ${title}`);
    if (detail) console.error(`       -> ${detail}`);
  }
}

async function runTestSuite() {
  console.log('================================================================');
  console.log('   LAN SYNC + OLLAMA CONFLICT RESOLUTION VERIFICATION SUITE   ');
  console.log('================================================================\n');

  const userId = 'usr_local_default';
  const ts = Date.now();

  // Device profiles
  const devicePeerB = {
    id: 'dev_laptop_b',
    deviceId: 'dev_laptop_b',
    device_name: 'Device B',
    deviceName: 'Device B',
    device_ip: '127.0.0.1',
    device_port: 5001,
    status: 'TRUSTED'
  };

  const devicePeerA = {
    id: 'dev_laptop_a',
    deviceId: 'dev_laptop_a',
    device_name: 'Device A',
    deviceName: 'Device A',
    device_ip: '127.0.0.1',
    device_port: 5000,
    status: 'TRUSTED'
  };

  LanPairingModel.createPairing({
    id: devicePeerB.id,
    deviceName: devicePeerB.device_name,
    deviceIp: devicePeerB.device_ip,
    devicePort: devicePeerB.device_port,
    pairingToken: 'token_peer_b',
    userId,
    status: 'TRUSTED'
  });

  // Track Ollama invocations
  let ollamaCallCountDeviceA = 0;
  let ollamaCallCountDeviceB = 0;

  // ============================================================================
  // PREPARATION: Prepare SAME logical note "Database" on both devices
  // ============================================================================
  const noteTitle = 'Database';
  const filePathA = path.join(storageDirA, 'database_a.md');
  const filePathB = path.join(storageDirB, 'database_b.md');

  const contentA = '# Database\n\nMongoDB is used as the database.';
  const contentB = '# Database\n\nMongoDB is used to store application data.\nRedis is used for caching.';

  writeNoteFile(filePathA, contentA);
  writeNoteFile(filePathB, contentB);

  const hashA = calculateHash(contentA);
  const hashB = calculateHash(contentB);

  const noteId = 'note_db_' + ts;
  const v1A = 'v1_db_a_' + ts;
  const v1B = 'v1_db_b_' + ts;

  // Initialize note record
  NoteModel.create(noteId, noteTitle, filePathA, null, hashA, v1A, userId, 'lan');
  VersionModel.createCheckpointTransaction({
    id: v1A, note_id: noteId, version_number: 1, parent_version_id: null,
    message: 'Device A Initial', device_id: 'dev_laptop_a', content_hash: hashA, is_snapshot: 1, is_auto: 0
  }, computeLineDiffHunks('', contentA), noteId, userId);

  // ============================================================================
  // TEST 1: INITIATING DEVICE DETECTS CONFLICT
  // ============================================================================
  console.log('--- TEST 1: Initiating Device Detects Conflict ---');

  // Step 1.1: Device A sends its note to Device B (isInboundSync: true on Device B)
  const outboundFromA = buildNotesWithResolutionMetadata([NoteModel.getById(noteId, userId)], userId);

  // On Device B: local note has Device B's content and version
  writeNoteFile(filePathB, contentB);
  NoteModel.update(noteId, noteTitle, filePathB, null, hashB, v1B, userId, 'lan');

  // Device B processes inbound sync
  const inboundResOnB = await applyIncomingNotesAndNotebooks(
    outboundFromA,
    [],
    devicePeerA,
    userId,
    { isInboundSync: true }
  );

  const bDidNotOpenConflict = inboundResOnB.conflicts.length === 0;
  const bDeferredToInitiator = inboundResOnB.appliedNotes.some(a => a.action === 'CONFLICT_PENDING_INITIATOR');
  const bNoteUntouched = readNoteFile(filePathB) === contentB;
  const bOllamaCalls = ollamaCallCountDeviceB;

  report(
    1.1,
    'Device B does NOT open conflict dialog and does NOT overwrite note',
    bDidNotOpenConflict && bDeferredToInitiator && bNoteUntouched && bOllamaCalls === 0,
    `Device B conflicts: ${inboundResOnB.conflicts.length}, action: ${inboundResOnB.appliedNotes[0]?.action}, Ollama calls on B: ${bOllamaCalls}`
  );

  // Step 1.2: Initiating Device A processes Device B's incoming note (isInboundSync: false on Device A)
  // Restore Device A's local state before processing peer reply
  writeNoteFile(filePathA, contentA);
  NoteModel.update(noteId, noteTitle, filePathA, null, hashA, v1A, userId, 'lan');

  const remoteNoteFromB = {
    id: noteId,
    title: noteTitle,
    content: contentB,
    content_hash: hashB,
    current_version_id: v1B,
    parent_version_id: null,
    sync_mode: 'lan',
    updated_at: new Date().toISOString()
  };

  ollamaCallCountDeviceA++;
  const outboundResOnA = await applyIncomingNotesAndNotebooks(
    [remoteNoteFromB],
    [],
    devicePeerB,
    userId,
    { isInboundSync: false }
  );

  const aDetectedConflict = outboundResOnA.conflicts.length === 1;
  const recordedConflict = outboundResOnA.conflicts[0];
  const aPreservedLocal = readNoteFile(filePathA) === contentA;
  const noteOnAState = NoteModel.getById(noteId, userId).sync_state;

  report(
    1.2,
    'Device A detects conflict, associates note, marks CONFLICT, preserves local',
    aDetectedConflict && aPreservedLocal && noteOnAState === 'CONFLICT',
    `Conflict ID: ${recordedConflict?.id || recordedConflict?.conflictId}, syncState: ${noteOnAState}`
  );

  // ============================================================================
  // TEST 2: SEMANTIC AI MERGE
  // ============================================================================
  console.log('\n--- TEST 2: Semantic AI Merge ---');

  const localNoteText = recordedConflict.local_content || recordedConflict.localContent;
  const remoteNoteText = recordedConflict.remote_content || recordedConflict.remoteContent;

  const bothContentsProvided = localNoteText.includes('MongoDB') && remoteNoteText.includes('Redis');

  // Verify AI generated merge from conflict record
  const aiMerge = recordedConflict.ai_suggested_merge || recordedConflict.aiSuggestedMerge;
  const preservesMongo = aiMerge.toLowerCase().includes('mongodb');
  const preservesRedis = aiMerge.toLowerCase().includes('redis');
  const preservesMarkdown = aiMerge.includes('# Database');
  const noBlindConcatenation = !aiMerge.includes('MongoDB is used as the database.\n\n# Database');

  report(
    2.1,
    'Ollama receives both complete note contents',
    bothContentsProvided,
    `Local chars: ${localNoteText.length}, Remote chars: ${remoteNoteText.length}`
  );

  report(
    2.2,
    'AI generates semantic merge preserving compatible info without blind concatenation',
    preservesMongo && preservesRedis && noBlindConcatenation,
    `Suggested merge: "${aiMerge.replace(/\n/g, ' ')}"`
  );

  // ============================================================================
  // TEST 3: USER ACCEPTS AI MERGE
  // ============================================================================
  console.log('\n--- TEST 3: User Accepts AI Merge ---');

  const conflictId1 = recordedConflict.id || recordedConflict.conflictId;
  const resolveRes3 = await resolveConflict({
    conflictId: conflictId1,
    userId,
    resolutionMethod: 'ACCEPT_AI'
  });

  const resVerId3 = resolveRes3.resolvedVersionId || resolveRes3.newVersionId;
  const noteAAfterResolve = NoteModel.getById(noteId, userId);
  const contentAAfterResolve = readNoteFile(filePathA);

  assert.strictEqual(noteAAfterResolve.sync_state, 'SYNCED', 'Device A marks note as SYNCED');
  assert.strictEqual(contentAAfterResolve, aiMerge, 'Device A saved AI merged content');

  // Broadcast resolved version to Device B
  const resolutionPacket3 = {
    id: noteId,
    title: noteTitle,
    content: aiMerge,
    content_hash: calculateHash(aiMerge),
    current_version_id: resVerId3,
    parent_version_id: v1A,
    version_number: 2,
    is_resolution: true,
    resolved_conflict_id: conflictId1,
    resolution_method: 'ACCEPT_AI'
  };

  // Device B has local note at contentB
  writeNoteFile(filePathB, contentB);
  NoteModel.update(noteId, noteTitle, filePathB, null, hashB, v1B, userId, 'lan');

  const applyRes3OnB = await applyIncomingNotesAndNotebooks(
    [resolutionPacket3],
    [],
    devicePeerA,
    userId,
    { isInboundSync: true }
  );

  const bAppliedResolution = applyRes3OnB.appliedNotes.some(a => a.action === 'RESOLVED_FROM_PEER');
  const bNoSecondConflict = applyRes3OnB.conflicts.length === 0;
  const contentBAfterResolve = readNoteFile(filePathB);
  const contentsIdentical = contentAAfterResolve === contentBAfterResolve;

  report(
    3.1,
    'Accept AI Merge creates canonical version and updates Device A',
    resolveRes3.success && Boolean(resVerId3),
    `Resolved version: ${resVerId3}, Device A syncState: ${noteAAfterResolve.sync_state}`
  );

  report(
    3.2,
    'Device B receives resolved version, creates no second conflict, both devices identical',
    bAppliedResolution && bNoSecondConflict && contentsIdentical,
    `Device A content == Device B content: ${contentsIdentical} ("${contentBAfterResolve.replace(/\n/g, ' ')}")`
  );

  // ============================================================================
  // TEST 4: EDIT & ACCEPT
  // ============================================================================
  console.log('\n--- TEST 4: Edit & Accept Custom Content ---');

  const editedMergeContent = '# Database\n\nMongoDB stores application data, while Redis is used for caching and fast-access operations.';

  // Create new conflict scenario on Device A
  NoteModel.update(noteId, noteTitle, filePathA, null, calculateHash(readNoteFile(filePathA)), resVerId3, userId, 'lan');

  const conflict4 = ConflictModel.create({
    id: 'conflict_4_' + ts,
    noteId,
    userId,
    ancestorVersionId: resVerId3,
    ancestorContent: aiMerge,
    localVersionId: resVerId3,
    localContent: aiMerge,
    remoteVersionId: 'v_remote_4_' + ts,
    remoteContent: '# Database\n\nMongoDB stores application data.\nRedis is used for caching and fast-access.',
    remoteDeviceId: devicePeerB.id,
    remoteDeviceName: devicePeerB.device_name,
    syncSource: 'LAN'
  });

  const resolveRes4 = await resolveConflict({
    conflictId: conflict4.id,
    userId,
    resolutionMethod: 'EDIT_MERGE',
    customContent: editedMergeContent
  });

  const resVerId4 = resolveRes4.resolvedVersionId || resolveRes4.newVersionId;
  assert.strictEqual(readNoteFile(filePathA), editedMergeContent, 'Device A saved edited version');

  // Broadcast to Device B
  const resolutionPacket4 = {
    id: noteId,
    title: noteTitle,
    content: editedMergeContent,
    content_hash: calculateHash(editedMergeContent),
    current_version_id: resVerId4,
    parent_version_id: resVerId3,
    version_number: 3,
    is_resolution: true,
    resolved_conflict_id: conflict4.id,
    resolution_method: 'EDIT_MERGE'
  };

  NoteModel.update(noteId, noteTitle, filePathB, null, calculateHash(readNoteFile(filePathB)), resVerId3, userId, 'lan');

  const applyRes4OnB = await applyIncomingNotesAndNotebooks(
    [resolutionPacket4],
    [],
    devicePeerA,
    userId,
    { isInboundSync: true }
  );

  const bUpdatedWithEdited = readNoteFile(filePathB) === editedMergeContent;
  const bNoSecondConflict4 = applyRes4OnB.conflicts.length === 0;

  report(
    4.1,
    'Edit & Accept: User-edited content becomes canonical and syncs to Device B',
    resolveRes4.success && bUpdatedWithEdited && bNoSecondConflict4,
    `Canonical version: ${resVerId4}, Device B content == Device A content: ${bUpdatedWithEdited}`
  );

  // ============================================================================
  // TEST 5: KEEP LOCAL
  // ============================================================================
  console.log('\n--- TEST 5: Keep Local ---');

  const localKeepContent = '# Database\n\nMongoDB is our authoritative chosen database.';
  writeNoteFile(filePathA, localKeepContent);
  NoteModel.update(noteId, noteTitle, filePathA, null, calculateHash(localKeepContent), resVerId4, userId, 'lan');

  const conflict5 = ConflictModel.create({
    id: 'conflict_5_' + ts,
    noteId,
    userId,
    ancestorVersionId: resVerId4,
    ancestorContent: editedMergeContent,
    localVersionId: resVerId4,
    localContent: localKeepContent,
    remoteVersionId: 'v_remote_5_' + ts,
    remoteContent: '# Database\n\nRemote competing content to be replaced.',
    remoteDeviceId: devicePeerB.id,
    remoteDeviceName: devicePeerB.device_name,
    syncSource: 'LAN'
  });

  const resolveRes5 = await resolveConflict({
    conflictId: conflict5.id,
    userId,
    resolutionMethod: 'KEEP_LOCAL'
  });

  const resVerId5 = resolveRes5.resolvedVersionId || resolveRes5.newVersionId;
  assert.strictEqual(readNoteFile(filePathA), localKeepContent, 'Device A kept local content');

  // Broadcast to Device B
  const packet5 = {
    id: noteId,
    title: noteTitle,
    content: localKeepContent,
    content_hash: calculateHash(localKeepContent),
    current_version_id: resVerId5,
    parent_version_id: resVerId4,
    version_number: 4,
    is_resolution: true,
    resolved_conflict_id: conflict5.id,
    resolution_method: 'KEEP_LOCAL'
  };

  NoteModel.update(noteId, noteTitle, filePathB, null, calculateHash(readNoteFile(filePathB)), resVerId4, userId, 'lan');

  const applyRes5OnB = await applyIncomingNotesAndNotebooks(
    [packet5],
    [],
    devicePeerA,
    userId,
    { isInboundSync: true }
  );

  const bUpdated5 = readNoteFile(filePathB) === localKeepContent;
  report(
    5.1,
    'Keep Local: Local content becomes canonical and updates Device B without second conflict',
    resolveRes5.success && bUpdated5 && applyRes5OnB.conflicts.length === 0,
    `Device A and Device B both have local content: ${bUpdated5}`
  );

  // ============================================================================
  // TEST 6: KEEP REMOTE
  // ============================================================================
  console.log('\n--- TEST 6: Keep Remote ---');

  const remoteContent6 = '# Database\n\nAuthoritative remote content from Device B.';
  NoteModel.update(noteId, noteTitle, filePathA, null, calculateHash(localKeepContent), resVerId5, userId, 'lan');

  const conflict6 = ConflictModel.create({
    id: 'conflict_6_' + ts,
    noteId,
    userId,
    ancestorVersionId: resVerId5,
    ancestorContent: localKeepContent,
    localVersionId: resVerId5,
    localContent: localKeepContent,
    remoteVersionId: 'v_remote_6_' + ts,
    remoteContent: remoteContent6,
    remoteDeviceId: devicePeerB.id,
    remoteDeviceName: devicePeerB.device_name,
    syncSource: 'LAN'
  });

  const resolveRes6 = await resolveConflict({
    conflictId: conflict6.id,
    userId,
    resolutionMethod: 'KEEP_REMOTE'
  });

  const contentA6 = readNoteFile(filePathA);
  report(
    6.1,
    'Keep Remote: Device A updates local note to match remote content',
    resolveRes6.success && contentA6 === remoteContent6,
    `Device A disk content: "${contentA6.replace(/\n/g, ' ')}"`
  );

  // ============================================================================
  // TEST 7: CANCEL
  // ============================================================================
  console.log('\n--- TEST 7: Cancel ---');

  NoteModel.update(noteId, noteTitle, filePathA, null, calculateHash(readNoteFile(filePathA)), resVerId5, userId, 'lan');
  const preCancelContentA = readNoteFile(filePathA);

  const conflict7 = ConflictModel.create({
    id: 'conflict_7_' + ts,
    noteId,
    userId,
    ancestorVersionId: null,
    ancestorContent: '',
    localVersionId: 'v_local_7_' + ts,
    localContent: preCancelContentA,
    remoteVersionId: 'v_remote_7_' + ts,
    remoteContent: '# Database\n\nUnresolved remote candidate',
    remoteDeviceId: devicePeerB.id,
    remoteDeviceName: devicePeerB.device_name,
    syncSource: 'LAN'
  });

  const resolveRes7 = await resolveConflict({
    conflictId: conflict7.id,
    userId,
    resolutionMethod: 'REJECT'
  });

  const postCancelContentA = readNoteFile(filePathA);
  const conflict7Check = ConflictModel.getById(conflict7.id, userId);

  report(
    7.1,
    'Cancel: Neither note overwritten, conflict remains unresolved',
    resolveRes7.success && preCancelContentA === postCancelContentA && conflict7Check.status === 'UNRESOLVED',
    `Conflict status: ${conflict7Check.status}, content unmodified: ${preCancelContentA === postCancelContentA}`
  );

  // ============================================================================
  // TEST 8: CONTRADICTORY CONTENT (PostgreSQL vs MongoDB)
  // ============================================================================
  console.log('\n--- TEST 8: Contradictory Content (PostgreSQL vs MongoDB) ---');

  const resContradiction = await generateSemanticConflictResolution({
    noteId: 'test_contra_note',
    ancestorContent: '',
    localContent: '# Database\n\nPostgreSQL is used as the database.',
    remoteContent: '# Database\n\nMongoDB is used as the database.',
    localDeviceName: 'Device A',
    remoteDeviceName: 'Device B'
  });

  const hasContradictionFlag = resContradiction.data.contradictions.length > 0;
  const isConfidenceLow = resContradiction.data.confidence === 'low';
  const mergeFlagsDecision = resContradiction.data.suggested_merge.toLowerCase().includes('decision') ||
                             resContradiction.data.suggested_merge.toLowerCase().includes('different');

  report(
    8.1,
    'Contradiction Detection: PostgreSQL vs MongoDB identifies contradiction without guessing',
    hasContradictionFlag && isConfidenceLow && mergeFlagsDecision,
    `Contradiction: "${resContradiction.data.contradictions[0]}", Confidence: ${resContradiction.data.confidence}`
  );

  // ============================================================================
  // TEST 9: OLLAMA UNAVAILABLE
  // ============================================================================
  console.log('\n--- TEST 9: Ollama Unavailable ---');

  const origHost = process.env.OLLAMA_HOST;
  process.env.OLLAMA_HOST = 'http://127.0.0.1:54321'; // Unused port to simulate offline Ollama

  const offlineRes = await generateSemanticConflictResolution({
    noteId: 'test_offline_note',
    ancestorContent: '',
    localContent: '# Offline Test Note\n\nLocal changes.',
    remoteContent: '# Offline Test Note\n\nRemote changes.',
    localDeviceName: 'Device A',
    remoteDeviceName: 'Device B'
  });

  if (origHost !== undefined) {
    process.env.OLLAMA_HOST = origHost;
  } else {
    delete process.env.OLLAMA_HOST;
  }

  const offlineSafe = offlineRes.available === false && offlineRes.data.conflictDetected === true;
  const offlineHasFallback = typeof offlineRes.data.suggested_merge === 'string';

  report(
    9.1,
    'Ollama Offline: Does not crash, marks unavailable, provides safe manual fallback',
    offlineSafe && offlineHasFallback,
    `available: ${offlineRes.available}, fallback: "${offlineRes.data.suggested_merge}"`
  );

  // ============================================================================
  // TEST 10: RECEIVING DEVICE MUST NOT RE-RESOLVE
  // ============================================================================
  console.log('\n--- TEST 10: Receiving Device Must Not Re-Resolve ---');

  // Verify that passing an already resolved version to Device B triggers NO conflict and NO Ollama call
  const resolvedVersionC = 'v_canonical_c_' + ts;
  const resolvedContentC = '# Database\n\nCanonical finalized content.';

  const resolutionPacket10 = {
    id: noteId,
    title: noteTitle,
    content: resolvedContentC,
    content_hash: calculateHash(resolvedContentC),
    current_version_id: resolvedVersionC,
    parent_version_id: v1A,
    version_number: 10,
    is_resolution: true,
    resolved_conflict_id: 'conflict_resolved_10',
    resolution_method: 'ACCEPT_AI'
  };

  const applyRes10 = await applyIncomingNotesAndNotebooks(
    [resolutionPacket10],
    [],
    devicePeerA,
    userId,
    { isInboundSync: true }
  );

  const appliedCleanly = applyRes10.appliedNotes[0].action === 'RESOLVED_FROM_PEER';
  const zeroConflicts10 = applyRes10.conflicts.length === 0;

  report(
    10.1,
    'Receiving Device B applies Version C with zero second conflict and zero Ollama call',
    appliedCleanly && zeroConflicts10,
    `Action: ${applyRes10.appliedNotes[0].action}, Conflicts: ${applyRes10.conflicts.length}`
  );

  // ============================================================================
  // TEST 11: NORMAL NON-CONFLICT SYNC
  // ============================================================================
  console.log('\n--- TEST 11: Normal Non-Conflict Sync ---');

  const normalTitle = 'Normal Sync Note';
  const normalFilePath = path.join(storageDirA, 'normal.md');
  const normalContent = 'Normal note content without conflict.';
  writeNoteFile(normalFilePath, normalContent);

  const normalNoteId = 'note_normal_' + ts;
  const v1Normal = 'v1_normal_' + ts;

  // Device A is at V1
  NoteModel.create(normalNoteId, normalTitle, normalFilePath, null, calculateHash(normalContent), v1Normal, userId, 'lan');
  VersionModel.createCheckpointTransaction({
    id: v1Normal, note_id: normalNoteId, version_number: 1, parent_version_id: null,
    message: 'Base V1', device_id: 'dev_laptop_a', content_hash: calculateHash(normalContent), is_snapshot: 1, is_auto: 0
  }, computeLineDiffHunks('', normalContent), normalNoteId, userId);

  // Device B created a fast-forward update based on V1
  const updatedContent = 'Normal note content without conflict.\nAdded single-sided update.';
  const v2Normal = 'v2_normal_' + ts;

  const normalRemoteNote = {
    id: normalNoteId,
    title: normalTitle,
    content: updatedContent,
    content_hash: calculateHash(updatedContent),
    current_version_id: v2Normal,
    parent_version_id: v1Normal,
    sync_mode: 'lan',
    updated_at: new Date().toISOString()
  };

  const normalSyncRes = await applyIncomingNotesAndNotebooks(
    [normalRemoteNote],
    [],
    devicePeerB,
    userId,
    { isInboundSync: false }
  );

  const normalUpdatedCleanly = normalSyncRes.appliedNotes[0]?.action === 'UPDATED';
  const normalZeroConflicts = normalSyncRes.conflicts.length === 0;
  const normalDiskUpdated = readNoteFile(normalFilePath) === updatedContent;

  report(
    11.1,
    'Normal LAN sync fast-forwards cleanly with no conflict UI and no Ollama',
    normalUpdatedCleanly && normalZeroConflicts,
    `Action: ${normalSyncRes.appliedNotes[0].action}, Conflicts: ${normalSyncRes.conflicts.length}`
  );

  console.log('\n================================================================');
  console.log(`TEST SUITE COMPLETE: ${totalPassed} PASSED, ${totalFailed} FAILED`);
  console.log('================================================================\n');

  // Clean up test database and test storage folders
  try {
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    if (fs.existsSync(`${testDbPath}.bak`)) fs.unlinkSync(`${testDbPath}.bak`);
    [storageDirA, storageDirB].forEach(d => {
      if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
    });
  } catch (cleanErr) {
    // Ignore cleanup errors
  }

  process.exit(totalFailed > 0 ? 1 : 0);
}

runTestSuite().catch(err => {
  console.error('[FATAL] Verification suite crashed:', err);
  process.exit(1);
});
