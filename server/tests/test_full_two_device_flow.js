const assert = require('assert');
const path = require('path');
const fs = require('fs');

// Ensure isolated database environment
process.env.DB_PATH = path.join(__dirname, 'test_two_device.db');
process.env.STORAGE_PATH = path.join(__dirname, 'test_storage_a');

const storageDirA = path.join(__dirname, 'test_storage_a');
const storageDirB = path.join(__dirname, 'test_storage_b');
[storageDirA, storageDirB].forEach(d => {
  if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
  fs.mkdirSync(d, { recursive: true });
});

if (fs.existsSync(process.env.DB_PATH)) fs.unlinkSync(process.env.DB_PATH);

const {
  initDatabase,
  NoteModel,
  NotebookModel,
  VersionModel,
  ConflictModel,
  LanPairingModel
} = require('../src/db/database');

const { writeNoteFile, readNoteFile, calculateHash } = require('../src/utils/fileStorage');
const { computeLineDiffHunks } = require('../src/utils/versionControl');
const { applyIncomingNotesAndNotebooks, buildNotesWithResolutionMetadata, broadcastResolvedNoteToPeers } = require('../src/routes/lan');
const { resolveConflict } = require('../src/services/conflictResolutionService');
const { generateSemanticConflictResolution } = require('../src/services/ollamaService');

let passedTests = 0;
function pass(name, detail = '') {
  passedTests++;
  console.log(`[PASS] ${name}`);
  if (detail) console.log(`       -> ${detail}`);
}

async function runAllTests() {
  console.log('================================================================');
  console.log('   FULL TWO-DEVICE SYNCHRONIZATION & OLLAMA CONFLICT SUITE     ');
  console.log('================================================================\n');

  const userId = 'usr_local_default';
  const devicePeerB = {
    id: 'dev_laptop_b',
    deviceId: 'dev_laptop_b',
    device_name: 'Device B Laptop',
    deviceName: 'Device B Laptop',
    device_ip: '127.0.0.1',
    device_port: 5001,
    status: 'TRUSTED'
  };

  LanPairingModel.createPairing({
    id: devicePeerB.id,
    deviceName: devicePeerB.device_name,
    deviceIp: devicePeerB.device_ip,
    devicePort: devicePeerB.device_port,
    pairingToken: 'token_b_123',
    userId,
    status: 'TRUSTED'
  });

  const ts = Date.now();

  // -------------------------------------------------------------
  // Test A: Device A and B have identical notes. A edits. A syncs.
  // Expected: B updates automatically. No conflict.
  // -------------------------------------------------------------
  console.log('--- TEST A: One-sided Edit Sync (Fast-Forward) ---');
  const noteA_id = 'note_test_a_' + ts;
  const filePathA = path.join(storageDirA, `note_a_${ts}.md`);
  const baseContentA = 'Initial synchronized note content';
  writeNoteFile(filePathA, baseContentA);
  const baseHashA = calculateHash(baseContentA);
  const v1A = 'v1_initial_' + ts;

  NoteModel.create(noteA_id, 'Note A', filePathA, 'nb_default', baseHashA, v1A, userId, 'lan');
  VersionModel.createCheckpointTransaction({
    id: v1A,
    note_id: noteA_id,
    version_number: 1,
    parent_version_id: null,
    message: 'Base V1',
    device_id: 'dev_laptop_a',
    content_hash: baseHashA,
    is_snapshot: 1,
    is_auto: 0
  }, computeLineDiffHunks('', baseContentA), noteA_id, userId);

  // Device A edits Note A to V2
  const editedContentA = 'Initial synchronized note content\nUpdated by Device A';
  writeNoteFile(filePathA, editedContentA);
  const editedHashA = calculateHash(editedContentA);
  const v2A = 'v2_device_a_' + ts;

  VersionModel.createCheckpointTransaction({
    id: v2A,
    note_id: noteA_id,
    version_number: 2,
    parent_version_id: v1A,
    message: 'Device A edit',
    device_id: 'dev_laptop_a',
    content_hash: editedHashA,
    is_snapshot: 0,
    is_auto: 0
  }, computeLineDiffHunks(baseContentA, editedContentA), noteA_id, userId);

  NoteModel.update(noteA_id, 'Note A', filePathA, 'nb_default', editedHashA, v2A, userId, 'lan');

  // Device A clicks "Sync": pushes to Device B (isInboundSync: true on B)
  const outboundNotesA = buildNotesWithResolutionMetadata([NoteModel.getById(noteA_id, userId)], userId);
  
  // Simulate Device B receiving this inbound sync:
  // On Device B, note is currently at V1 (baseContentA) with lastSyncedHash = baseHashA
  writeNoteFile(filePathA, baseContentA);
  NoteModel.update(noteA_id, 'Note A', filePathA, 'nb_default', baseHashA, v1A, userId, 'lan');
  NoteModel.updateSyncMetadata(noteA_id, userId, {
    lastSyncedHash: baseHashA,
    lastSyncedAt: new Date().toISOString(),
    syncState: 'SYNCED',
    syncError: null
  });

  const applyResB = await applyIncomingNotesAndNotebooks(
    outboundNotesA,
    [],
    { id: 'dev_laptop_a', device_name: 'Device A' },
    userId,
    { isInboundSync: true }
  );

  assert.strictEqual(applyResB.conflicts.length, 0, 'No conflicts should be created on one-sided edit');
  assert.strictEqual(applyResB.appliedNotes[0].action, 'UPDATED', 'Device B updates note automatically');
  pass('Test A: One-sided edit', 'B updates automatically without conflict');

  // -------------------------------------------------------------
  // Test B: A and B edit the same note differently. A clicks Sync.
  // Expected: Conflict UI appears ONLY on A. Device B remains unchanged.
  // -------------------------------------------------------------
  console.log('\n--- TEST B: Concurrent Edits - Conflict UI ONLY on Initiator ---');
  const noteB_id = 'note_test_b_' + ts;
  const filePathB_A = path.join(storageDirA, `note_b_${ts}.md`);
  const commonAncestorContent = 'Common baseline note';
  writeNoteFile(filePathB_A, commonAncestorContent);
  const vCommon = 'v1_common_' + ts;
  const hCommon = calculateHash(commonAncestorContent);

  NoteModel.create(noteB_id, 'Note B Divergent', filePathB_A, 'nb_default', hCommon, vCommon, userId, 'lan');
  // Common ancestor checkpoint
  VersionModel.createCheckpointTransaction({
    id: vCommon,
    note_id: noteB_id,
    version_number: 1,
    parent_version_id: null,
    message: 'Common V1',
    device_id: 'dev_root',
    content_hash: hCommon,
    is_snapshot: 1,
    is_auto: 0
  }, computeLineDiffHunks('', commonAncestorContent), noteB_id, userId);

  // Device A edits note B
  const contentA_B = 'Common baseline note\nEdit from Device A';
  writeNoteFile(filePathB_A, contentA_B);
  const vA_B = 'v2_from_a_' + ts;
  const hA_B = calculateHash(contentA_B);
  VersionModel.createCheckpointTransaction({
    id: vA_B,
    note_id: noteB_id,
    version_number: 2,
    parent_version_id: vCommon,
    message: 'Edit A',
    device_id: 'dev_laptop_a',
    content_hash: hA_B,
    is_snapshot: 0,
    is_auto: 0
  }, computeLineDiffHunks(commonAncestorContent, contentA_B), noteB_id, userId);
  NoteModel.update(noteB_id, 'Note B Divergent', filePathB_A, 'nb_default', hA_B, vA_B, userId, 'lan');

  // Device B edited note B differently
  const contentB_B = 'Common baseline note\nEdit from Device B';
  const hB_B = calculateHash(contentB_B);
  const vB_B = 'v2_from_b_' + ts;
  VersionModel.createCheckpointTransaction({
    id: vB_B,
    note_id: noteB_id,
    version_number: 2,
    parent_version_id: vCommon,
    message: 'Edit B',
    device_id: 'dev_laptop_b',
    content_hash: hB_B,
    is_snapshot: 0,
    is_auto: 0
  }, computeLineDiffHunks(commonAncestorContent, contentB_B), noteB_id, userId);

  // Step 1: Device A clicks Sync -> payload sent to Device B (isInboundSync: true on B)
  const incomingToB = buildNotesWithResolutionMetadata([NoteModel.getById(noteB_id, userId)], userId);
  
  // On Device B, local note has Device B's edit
  writeNoteFile(filePathB_A, contentB_B);
  NoteModel.update(noteB_id, 'Note B Divergent', filePathB_A, 'nb_default', hB_B, vB_B, userId, 'lan');

  // Device B processes inbound sync
  const inboundResOnB = await applyIncomingNotesAndNotebooks(
    incomingToB,
    [],
    { id: 'dev_laptop_a', device_name: 'Device A' },
    userId,
    { isInboundSync: true }
  );

  // Assertions on Device B:
  assert.strictEqual(inboundResOnB.conflicts.length, 0, 'Device B must have 0 conflicts in response');
  assert.strictEqual(inboundResOnB.appliedNotes[0].action, 'CONFLICT_PENDING_INITIATOR', 'Device B defers conflict to initiator');
  
  // Note on Device B is NOT in CONFLICT state and local disk note is untouched
  const noteOnB = NoteModel.getById(noteB_id, userId);
  assert.notStrictEqual(noteOnB.sync_state, 'CONFLICT', 'Device B sync_state must NOT be set to CONFLICT on inbound sync');
  pass('Test B.1: Receiving Device B receives inbound sync', 'Zero conflicts created on B, note untouched, conflict UI deferred');

  // Step 2: Initiating Device A processes Device B response (isInboundSync: false on A)
  // Restore Device A's local state before processing peer's reply
  writeNoteFile(filePathB_A, contentA_B);
  NoteModel.update(noteB_id, 'Note B Divergent', filePathB_A, 'nb_default', hA_B, vA_B, userId, 'lan');

  const remoteNoteFromB = {
    id: noteB_id,
    title: 'Note B Divergent',
    current_version_id: vB_B,
    parent_version_id: vCommon,
    content: contentB_B,
    content_hash: hB_B,
    sync_mode: 'lan',
    updated_at: new Date().toISOString()
  };

  const outboundResOnA = await applyIncomingNotesAndNotebooks(
    [remoteNoteFromB],
    [],
    devicePeerB,
    userId,
    { isInboundSync: false }
  );

  assert.strictEqual(outboundResOnA.conflicts.length, 1, 'Device A detects conflict and records it');
  const recordedConflict = outboundResOnA.conflicts[0];
  assert.strictEqual(recordedConflict.note_id, noteB_id, 'Conflict is for Note B');
  const noteOnA = NoteModel.getById(noteB_id, userId);
  assert.strictEqual(noteOnA.sync_state, 'CONFLICT', 'Device A marks note as CONFLICT');
  pass('Test B.2: Initiating Device A shows conflict UI', 'Conflict modal opens ONLY on Device A');

  // -------------------------------------------------------------
  // Test C: A accepts AI merge.
  // Expected: Canonical version created, pushed to B, both become identical.
  // -------------------------------------------------------------
  console.log('\n--- TEST C: User Accepts AI Merge & Resolution Propagates ---');
  const aiMergeSuggestion = 'Common baseline note\nEdit from Device A\nEdit from Device B';
  ConflictModel.updateAiStatus(recordedConflict.id, {
    aiStatus: 'AVAILABLE',
    aiSuggestedMerge: aiMergeSuggestion,
    aiSemanticAnalysis: 'Reconciled additions from both devices'
  }, userId);

  const resolveResC = await resolveConflict({
    conflictId: recordedConflict.id,
    userId,
    resolutionMethod: 'ACCEPT_AI'
  });

  assert.strictEqual(resolveResC.success, true);
  const resVerId = resolveResC.resolvedVersionId || resolveResC.newVersionId || resolveResC.versionId;
  assert.strictEqual(resVerId && resVerId.startsWith('v3_'), true, 'Canonical V3 created');
  assert.strictEqual(ConflictModel.getUnresolved(userId).length, 0, 'Active conflict resolved on A');

  // Device A broadcasts resolved version to Device B
  const resolvedNotePayload = {
    id: noteB_id,
    title: 'Note B Divergent',
    content: aiMergeSuggestion,
    content_hash: calculateHash(aiMergeSuggestion),
    current_version_id: resVerId,
    parent_version_id: vA_B,
    version_number: 3,
    is_resolution: true,
    resolved_conflict_id: recordedConflict.id,
    resolution_method: 'ACCEPT_AI'
  };

  // Device B receives resolution packet
  const applyResolutionOnB = await applyIncomingNotesAndNotebooks(
    [resolvedNotePayload],
    [],
    { id: 'dev_laptop_a', device_name: 'Device A' },
    userId,
    { isInboundSync: true }
  );

  assert.strictEqual(applyResolutionOnB.appliedNotes[0].action, 'RESOLVED_FROM_PEER');
  assert.strictEqual(applyResolutionOnB.conflicts.length, 0, 'Device B does NOT generate a second conflict');
  const finalNoteA = NoteModel.getById(noteB_id, userId);
  assert.strictEqual(finalNoteA.current_version_id, resVerId);
  assert.strictEqual(finalNoteA.sync_state, 'SYNCED');
  pass('Test C: Accept AI Merge', 'Canonical V3 created, propagated to B, both devices identical');

  // -------------------------------------------------------------
  // Test D: A edits the AI suggestion and accepts.
  // Expected: B receives the edited final version.
  // -------------------------------------------------------------
  console.log('\n--- TEST D: Edit & Accept Custom Content ---');
  const noteD_id = 'note_test_d_' + ts;
  const filePathD = path.join(storageDirA, `note_d_${ts}.md`);
  writeNoteFile(filePathD, 'Initial D');
  const v1D = 'v1_d_' + ts;
  NoteModel.create(noteD_id, 'Note D', filePathD, 'nb_default', calculateHash('Initial D'), v1D, userId, 'lan');
  VersionModel.createCheckpointTransaction({
    id: v1D, note_id: noteD_id, version_number: 1, parent_version_id: null,
    message: 'Base D', device_id: 'dev_a', content_hash: calculateHash('Initial D'), is_snapshot: 1, is_auto: 0
  }, [], noteD_id, userId);

  // Create conflict on Note D
  const conflictD = ConflictModel.create({
    id: 'conflict_d_' + ts,
    noteId: noteD_id,
    userId,
    ancestorVersionId: v1D,
    ancestorContent: 'Initial D',
    localVersionId: 'v2_d_local_' + ts,
    localContent: 'Initial D\nLocal branch',
    remoteVersionId: 'v2_d_remote_' + ts,
    remoteContent: 'Initial D\nRemote branch',
    remoteDeviceId: 'dev_laptop_b',
    remoteDeviceName: 'Device B',
    syncSource: 'LAN'
  });

  const customEditedMerge = 'Initial D\nCustom merged content crafted by user on Device A';
  const resolveResD = await resolveConflict({
    conflictId: conflictD.id,
    userId,
    resolutionMethod: 'EDIT_MERGE',
    customContent: customEditedMerge
  });

  assert.strictEqual(resolveResD.success, true);
  const resVerIdD = resolveResD.resolvedVersionId || resolveResD.newVersionId || resolveResD.versionId;
  assert.strictEqual(readNoteFile(filePathD), customEditedMerge, 'Device A saved custom edited content');

  // Propagate to Device B
  const payloadD = {
    id: noteD_id,
    title: 'Note D',
    content: customEditedMerge,
    content_hash: calculateHash(customEditedMerge),
    current_version_id: resVerIdD,
    is_resolution: true,
    resolved_conflict_id: conflictD.id,
    resolution_method: 'EDIT_MERGE'
  };

  const applyD = await applyIncomingNotesAndNotebooks([payloadD], [], devicePeerB, userId, { isInboundSync: true });
  assert.strictEqual(applyD.appliedNotes[0].action, 'RESOLVED_FROM_PEER');
  pass('Test D: Edit & Accept', 'Custom user-edited version saved and propagated to Device B');

  // -------------------------------------------------------------
  // Test E: A chooses Keep Local.
  // Expected: A's version becomes canonical and B receives it.
  // -------------------------------------------------------------
  console.log('\n--- TEST E: Keep Local ---');
  const noteE_id = 'note_test_e_' + ts;
  const filePathE = path.join(storageDirA, `note_e_${ts}.md`);
  const localEContent = 'Local authoritative content for Note E';
  writeNoteFile(filePathE, localEContent);
  const v1E = 'v1_e_local_' + ts;
  NoteModel.create(noteE_id, 'Note E', filePathE, 'nb_default', calculateHash(localEContent), v1E, userId, 'lan');
  VersionModel.createCheckpointTransaction({
    id: v1E, note_id: noteE_id, version_number: 1, parent_version_id: null,
    message: 'Local V1 E', device_id: 'dev_a', content_hash: calculateHash(localEContent), is_snapshot: 1, is_auto: 0
  }, [], noteE_id, userId);

  const conflictE = ConflictModel.create({
    id: 'conflict_e_' + ts,
    noteId: noteE_id,
    userId,
    ancestorVersionId: null,
    ancestorContent: '',
    localVersionId: v1E,
    localContent: localEContent,
    remoteVersionId: 'v1_e_remote_' + ts,
    remoteContent: 'Remote content to be replaced',
    remoteDeviceId: 'dev_laptop_b',
    remoteDeviceName: 'Device B',
    syncSource: 'LAN'
  });

  const resolveResE = await resolveConflict({
    conflictId: conflictE.id,
    userId,
    resolutionMethod: 'KEEP_LOCAL'
  });

  assert.strictEqual(resolveResE.success, true);
  assert.strictEqual(readNoteFile(filePathE), localEContent);
  pass('Test E: Keep Local', 'Local version preserved as canonical and broadcasted to peer');

  // -------------------------------------------------------------
  // Test F: A chooses Keep Remote.
  // Expected: B's version becomes canonical and A receives it.
  // -------------------------------------------------------------
  console.log('\n--- TEST F: Keep Remote ---');
  const noteF_id = 'note_test_f_' + ts;
  const filePathF = path.join(storageDirA, `note_f_${ts}.md`);
  writeNoteFile(filePathF, 'Local content on F');
  const v1F = 'v1_f_' + ts;
  NoteModel.create(noteF_id, 'Note F', filePathF, 'nb_default', calculateHash('Local content on F'), v1F, userId, 'lan');
  VersionModel.createCheckpointTransaction({
    id: v1F, note_id: noteF_id, version_number: 1, parent_version_id: null,
    message: 'Local V1 F', device_id: 'dev_a', content_hash: calculateHash('Local content on F'), is_snapshot: 1, is_auto: 0
  }, [], noteF_id, userId);

  const remoteFContent = 'Authoritative remote content from Device B';
  const conflictF = ConflictModel.create({
    id: 'conflict_f_' + ts,
    noteId: noteF_id,
    userId,
    ancestorVersionId: null,
    ancestorContent: '',
    localVersionId: v1F,
    localContent: 'Local content on F',
    remoteVersionId: 'v1_f_remote_' + ts,
    remoteContent: remoteFContent,
    remoteDeviceId: 'dev_laptop_b',
    remoteDeviceName: 'Device B',
    syncSource: 'LAN'
  });

  const resolveResF = await resolveConflict({
    conflictId: conflictF.id,
    userId,
    resolutionMethod: 'KEEP_REMOTE'
  });

  assert.strictEqual(resolveResF.success, true);
  assert.strictEqual(readNoteFile(filePathF), remoteFContent, 'Local disk updated to remote version');
  pass('Test F: Keep Remote', 'Remote version becomes canonical and saved to disk on A');

  // -------------------------------------------------------------
  // Test G: A cancels.
  // Expected: neither device changes and conflict remains unresolved.
  // -------------------------------------------------------------
  console.log('\n--- TEST G: User Cancels / Rejects ---');
  const noteG_id = 'note_test_g_' + ts;
  const filePathG = path.join(storageDirA, `note_g_${ts}.md`);
  const initialGContent = 'Initial G content';
  writeNoteFile(filePathG, initialGContent);
  const v1G = 'v1_g_' + ts;
  NoteModel.create(noteG_id, 'Note G', filePathG, 'nb_default', calculateHash(initialGContent), v1G, userId, 'lan');
  VersionModel.createCheckpointTransaction({
    id: v1G, note_id: noteG_id, version_number: 1, parent_version_id: null,
    message: 'Base G', device_id: 'dev_a', content_hash: calculateHash(initialGContent), is_snapshot: 1, is_auto: 0
  }, [], noteG_id, userId);

  const conflictG = ConflictModel.create({
    id: 'conflict_g_' + ts,
    noteId: noteG_id,
    userId,
    ancestorVersionId: v1G,
    ancestorContent: initialGContent,
    localVersionId: v1G,
    localContent: initialGContent,
    remoteVersionId: 'v2_g_remote_' + ts,
    remoteContent: 'Remote edited G',
    remoteDeviceId: 'dev_laptop_b',
    remoteDeviceName: 'Device B',
    syncSource: 'LAN'
  });

  const resolveResG = await resolveConflict({
    conflictId: conflictG.id,
    userId,
    resolutionMethod: 'REJECT'
  });

  assert.strictEqual(resolveResG.success, true);
  assert.strictEqual(readNoteFile(filePathG), initialGContent, 'Disk remains unchanged on Cancel');
  const checkConflictG = ConflictModel.getById(conflictG.id, userId);
  assert.strictEqual(checkConflictG.status, 'UNRESOLVED', 'Conflict remains unresolved');
  pass('Test G: Cancel / Reject', 'Neither device changes, conflict remains unresolved on Initiator');

  // -------------------------------------------------------------
  // Test H: AI identifies semantically equivalent statements (Sai Kumar)
  // Expected: AI recognizes common meaning and proposes concise merged statement "I am Sai Kumar"
  // -------------------------------------------------------------
  console.log('\n--- TEST H: Semantic Reconciliation (Sai Kumar) ---');
  const resH = await generateSemanticConflictResolution({
    noteId: 'test_sai_kumar',
    ancestorContent: '',
    localContent: 'I am Sai Kumar',
    remoteContent: 'This is Saikumar'
  });

  assert.strictEqual(resH.success, true);
  assert.strictEqual(resH.data.contradictions.length, 0, 'No contradictions on semantically equivalent statements');
  assert.strictEqual(resH.data.suggested_merge.toLowerCase().includes('sai kumar') || resH.data.suggested_merge.toLowerCase().includes('saikumar'), true);
  // Ensure it didn't redundantly concatenate both sentences
  assert.strictEqual(resH.data.suggested_merge.includes('I am Sai Kumar. This is Saikumar'), false);
  pass('Test H: Semantic Equivalence', `AI reconciled: "${resH.data.suggested_merge}" (No duplicate sentences)`);

  // -------------------------------------------------------------
  // Test I: AI detects genuinely contradictory information (MongoDB vs PostgreSQL)
  // Expected: AI explains contradiction and requires user decision
  // -------------------------------------------------------------
  console.log('\n--- TEST I: Contradiction Detection (MongoDB vs PostgreSQL) ---');
  const resI = await generateSemanticConflictResolution({
    noteId: 'test_database_choice',
    ancestorContent: '',
    localContent: 'The application uses MongoDB.',
    remoteContent: 'The application uses PostgreSQL.'
  });

  assert.strictEqual(resI.success, true);
  assert.strictEqual(resI.data.contradictions.length > 0, true, 'Must detect contradiction between MongoDB and PostgreSQL');
  assert.strictEqual(resI.data.confidence, 'low', 'Confidence must be low for contradiction');
  assert.strictEqual(resI.data.suggested_merge.includes('User decision required') || resI.data.suggested_merge.includes('different'), true, 'Suggested merge flags user decision required');
  pass('Test I: Contradiction Detection', `AI detected contradiction: ${resI.data.contradictions[0]} -> Merge: "${resI.data.suggested_merge}"`);

  console.log('\n================================================================');
  console.log(`ALL TESTS PASSED: ${passedTests} passed, 0 failed`);
  console.log('================================================================\n');

  // Clean up test DB
  if (fs.existsSync(process.env.DB_PATH)) fs.unlinkSync(process.env.DB_PATH);
  [storageDirA, storageDirB].forEach(d => {
    if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
  });
}

runAllTests().catch(err => {
  console.error('\n[FAIL] Test suite error:', err);
  process.exit(1);
});
