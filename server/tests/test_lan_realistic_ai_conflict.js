/**
 * Test: Realistic LAN Conflict AI Resolution Pipeline with Live Ollama
 * 
 * Verifies:
 * Common Ancestor
 *       ↓
 * Device A edit + Device B edit
 *       ↓
 * Concurrent conflict detected
 *       ↓
 * Ollama request (live llama3.2:1b)
 *       ↓
 * HTTP 200 & Safe Diagnostic Logging
 *       ↓
 * Parsed <MERGED_NOTE>
 *       ↓
 * AI Suggested Merged Content (actual Markdown, no summary/placeholder)
 *       ↓
 * Accept AI Merge
 *       ↓
 * New version created & all branches preserved
 */

const assert = require('assert');
const { ConflictModel, NoteModel, VersionModel, NotebookModel, db } = require('../src/db/database');
const { createOrRecordConflict, resolveConflict } = require('../src/services/conflictResolutionService');
const { readNoteFile, writeNoteFile, getNoteFilePath, calculateHash } = require('../src/utils/fileStorage');
const { computeLineDiffHunks } = require('../src/utils/versionControl');
const { checkOllamaHealth } = require('../src/services/ollamaService');

async function runRealisticLanConflictTest() {
  console.log('================================================================');
  console.log('  TEST: REALISTIC LAN CONFLICT PIPELINE WITH LIVE OLLAMA        ');
  console.log('================================================================\n');

  // Verify live Ollama is accessible
  process.env.OLLAMA_HOST = 'http://127.0.0.1:11434';
  process.env.OLLAMA_MODEL = 'llama3.2:1b';
  process.env.OLLAMA_TIMEOUT_MS = '45000';

  const health = await checkOllamaHealth();
  console.log(`[Ollama Health] Available: ${health.available}, Model Ready: ${health.modelReady}`);
  assert.strictEqual(health.available, true, 'Live Ollama must be reachable');
  assert.strictEqual(health.modelReady, true, 'Model llama3.2:1b must be installed');

  const userId = `usr_lan_test_${Date.now()}`;
  const noteId = `note_lan_conflict_${Date.now()}`;
  const notebook = NotebookModel.create(userId, 'Test Notebook');
  const notebookId = notebook.id;
  const notePath = getNoteFilePath(userId, noteId);

  // 1. Common Ancestor
  const ancestorContent = `hello this is for lan sync testing\nohh this is rightside`;
  const vAncestorId = `v_ancestor_${Date.now()}`;
  const vAncestorHash = calculateHash(ancestorContent);

  writeNoteFile(notePath, ancestorContent);
  NoteModel.create(noteId, 'LAN Sync Conflict Note', notePath, notebookId, vAncestorHash, vAncestorId, userId, 'lan');

  VersionModel.createCheckpointTransaction({
    id: vAncestorId,
    note_id: noteId,
    version_number: 1,
    parent_version_id: null,
    message: 'Common Ancestor version',
    device_id: 'dev_base',
    created_at: new Date(Date.now() - 3600000).toISOString(),
    content_hash: vAncestorHash,
    is_snapshot: 1,
    is_auto: 0
  }, computeLineDiffHunks('', ancestorContent), noteId, userId);

  // 2. Device A Edit (Local)
  const localContent = `hello this is for lan sync testing\nohh this is rightside and right way`;
  const vLocalId = `v_devA_${Date.now()}`;
  const vLocalHash = calculateHash(localContent);
  writeNoteFile(notePath, localContent);

  VersionModel.createCheckpointTransaction({
    id: vLocalId,
    note_id: noteId,
    version_number: 2,
    parent_version_id: vAncestorId,
    message: 'Added right way',
    device_id: 'dev_laptop_A',
    created_at: new Date(Date.now() - 1800000).toISOString(),
    content_hash: vLocalHash,
    is_snapshot: 0,
    is_auto: 0
  }, computeLineDiffHunks(ancestorContent, localContent), noteId, userId);

  // 3. Device B Edit (Remote)
  const remoteContent = `hello this is for lan sync testing\nohh its this WAY`;
  const vRemoteId = `v_devB_${Date.now()}`;
  const vRemoteHash = calculateHash(remoteContent);

  VersionModel.createCheckpointTransaction({
    id: vRemoteId,
    note_id: noteId,
    version_number: 2,
    parent_version_id: vAncestorId,
    message: 'Capitalized way and changed phrasing',
    device_id: 'dev_laptop_B',
    created_at: new Date(Date.now() - 900000).toISOString(),
    content_hash: vRemoteHash,
    is_snapshot: 0,
    is_auto: 0
  }, computeLineDiffHunks(ancestorContent, remoteContent), noteId, userId);

  console.log('[Setup] Created Common Ancestor, Device A (local) and Device B (remote) versions.');

  // 4. Concurrent conflict recorded & Ollama invoked
  console.log('\n--- INVOKING AI CONFLICT RESOLUTION ---');
  const conflict = await createOrRecordConflict({
    noteId,
    userId,
    ancestorVersionId: vAncestorId,
    ancestorContent,
    localVersionId: vLocalId,
    localContent,
    remoteVersionId: vRemoteId,
    remoteContent,
    remoteDeviceId: 'dev_laptop_B',
    remoteDeviceName: 'Laptop B',
    syncSource: 'LAN'
  });

  console.log(`\n[Conflict Recorded] ID: ${conflict.id}, Note: ${conflict.note_id}`);
  console.log(`[Conflict AI Status] ${conflict.ai_status} (latency: ${conflict.ai_latency_ms}ms)`);
  console.log(`[AI Suggested Merge Content]:\n"${conflict.ai_suggested_merge}"\n`);
  console.log(`[AI Explanation/Reasoning]:\n"${conflict.ai_reasoning}"\n`);

  // Assertions on AI output
  assert.strictEqual(conflict.ai_status, 'AVAILABLE', 'AI conflict status should be AVAILABLE');
  assert.ok(conflict.ai_suggested_merge && conflict.ai_suggested_merge.trim().length > 0, 'Suggested merge must not be empty');
  assert.ok(!conflict.ai_suggested_merge.toLowerCase().includes('placeholder'), 'Suggested merge must not contain placeholder text');
  assert.ok(!conflict.ai_suggested_merge.toLowerCase().includes('full proposed merged'), 'Suggested merge must not contain placeholder headers');
  
  // Suggested merge must contain actual text, not a summary description
  assert.ok(conflict.ai_suggested_merge.toLowerCase().includes('hello') || conflict.ai_suggested_merge.toLowerCase().includes('lan'), 'Merged note must contain actual note text');
  assert.ok(conflict.ai_suggested_merge.length < 500, 'Output should be bounded and not runaway generation');

  // 5. Test ACCEPT_AI resolution
  console.log('--- USER ACCEPTS AI MERGE ---');
  const resolveResult = await resolveConflict({
    conflictId: conflict.id,
    userId,
    resolutionMethod: 'ACCEPT_AI'
  });

  assert.strictEqual(resolveResult.success, true, 'resolveConflict should succeed');
  assert.strictEqual(resolveResult.conflict.status, 'RESOLVED', 'Conflict status should be RESOLVED');

  // 6. Verify version control tree integrity
  const allVersions = VersionModel.getHistory(noteId, userId);
  console.log(`[Version Tree] Total versions for note: ${allVersions.length}`);
  assert.strictEqual(allVersions.length, 4, 'Should have 4 versions: Ancestor, Device A, Device B, and Merged');

  const latestNote = NoteModel.getById(noteId, userId);
  const newMergedVersion = VersionModel.getById(latestNote.current_version_id, userId);
  console.log(`[New Version Created] ID: ${newMergedVersion.id}, Version: V${newMergedVersion.version_number}`);
  assert.strictEqual(newMergedVersion.version_number, 3, 'Merged version should be V3');

  // Verify on-disk file content matches the accepted merge
  const onDiskContent = readNoteFile(notePath);
  console.log(`[On-Disk Content Matches AI Merge]: "${onDiskContent}"`);
  assert.strictEqual(onDiskContent, conflict.ai_suggested_merge, 'On-disk content must match the AI suggested merge');

  console.log('\n================================================================');
  console.log('  SUCCESS: REALISTIC LAN AI CONFLICT PIPELINE PASSED!           ');
  console.log('================================================================');
}

runRealisticLanConflictTest().catch(err => {
  console.error('\n[FAIL] Test encountered error:', err);
  process.exit(1);
});
