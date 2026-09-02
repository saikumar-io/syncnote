const path = require('path');
const fs = require('fs');

// Set cwd context to server root if needed
const serverDir = path.join(__dirname, 'server');
process.chdir(serverDir);

const { db, NoteModel, VersionModel, SessionModel } = require('./src/db/database');
const { computeLineDiffHunks, applyLineDiffHunks, reconstructVersionContent, getDiffViewData, versionCache } = require('./src/utils/versionControl');
const { writeNoteFile, readNoteFile, getNoteFilePath } = require('./src/utils/fileStorage');
const { calculateHash } = require('./src/utils/fileStorage');

console.log('====================================================');
console.log('   SyncNote Session Recovery & VC Verification      ');
console.log('====================================================\n');

try {
  // Step 1: Database Schema & Sessions Table Check
  console.log('[Step 1] Verifying SQLite database schema & sessions table...');
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name);
  console.log('   Tables found:', tables.join(', '));
  if (!tables.includes('versions') || !tables.includes('version_diffs') || !tables.includes('sessions')) {
    throw new Error('Required tables (versions, version_diffs, sessions) missing in SQLite database!');
  }
  console.log('   ✓ Step 1 Passed: Database schema and sessions table verified.\n');

  // Step 2: Create Test Note
  console.log('[Step 2] Creating test note metadata & physical .md file...');
  const testNoteId = `test_note_${Date.now()}`;
  const testTitle = `Test Note ${Date.now()}`;
  const testFilePath = getNoteFilePath(testTitle, 'General Notes');
  const initialText = 'Line 1: Initial content';
  writeNoteFile(testFilePath, initialText);
  const initialHash = calculateHash(initialText);
  const note = NoteModel.create(testNoteId, testTitle, testFilePath, null, initialHash, null);
  SessionModel.upsert(testNoteId, null, initialHash, 'uncheckpointed');
  console.log(`   Created Note: ID=${note.id}, Title=${note.title}`);
  console.log('   ✓ Step 2 Passed: Note created.\n');

  // Step 3: Create Manual Checkpoint V1
  console.log('[Step 3] Creating Manual Checkpoint V1...');
  const diffHunksV1 = computeLineDiffHunks('', initialText);
  const v1Data = {
    id: `v1_${Date.now()}`,
    note_id: testNoteId,
    version_number: 1,
    parent_version_id: null,
    message: 'Manual Checkpoint V1',
    device_id: 'local_device',
    created_at: new Date().toISOString(),
    content_hash: initialHash,
    is_snapshot: 0,
    is_auto: 0
  };
  const v1 = VersionModel.createCheckpointTransaction(v1Data, diffHunksV1, testNoteId);
  SessionModel.upsert(testNoteId, v1.id, initialHash, 'clean');
  console.log(`   Created Version V1: ID=${v1.id}, Parent=${v1.parent_version_id}`);
  console.log('   ✓ Step 3 Passed: V1 Checkpoint created.\n');

  // Step 4: Normal Reopen Check (Identical content)
  console.log('[Step 4] Testing Normal Reopen (Working content matches latest checkpoint)...');
  const fileContentStep4 = readNoteFile(testFilePath);
  const hashStep4 = calculateHash(fileContentStep4);
  const latestVerStep4 = VersionModel.getLatestForNote(testNoteId);
  const hasUncheckpointedStep4 = (hashStep4 !== latestVerStep4.content_hash);
  if (hasUncheckpointedStep4) {
    throw new Error('Normal reopen failed: falsely detected uncheckpointed changes!');
  }
  console.log('   ✓ Step 4 Passed: Normal reopen cleanly loaded without recovery prompt.\n');

  // Step 5: Autosave Edits (Uncheckpointed changes detection)
  console.log('[Step 5] Simulating Autosave edits after session break (No automatic version created)...');
  const editedText = 'Line 1: Initial content\nLine 2: Uncheckpointed edit from previous session';
  writeNoteFile(testFilePath, editedText); // Continuous autosave
  const editedHash = calculateHash(editedText);
  NoteModel.update(testNoteId, undefined, undefined, undefined, editedHash, v1.id);
  SessionModel.upsert(testNoteId, v1.id, editedHash, 'uncheckpointed');

  // Verify no new version record was created merely by autosave or reopening
  const versionsCountAfterAutosave = VersionModel.getHistory(testNoteId).length;
  if (versionsCountAfterAutosave !== 1) {
    throw new Error('Autosave or session break illegally generated an automatic version!');
  }

  // Detect uncheckpointed changes
  const latestVerStep5 = VersionModel.getLatestForNote(testNoteId);
  const hasUncheckpointedStep5 = (editedHash !== latestVerStep5.content_hash);
  if (!hasUncheckpointedStep5) {
    throw new Error('Failed to detect uncheckpointed changes from previous session!');
  }
  console.log('   ✓ Step 5 Passed: Uncheckpointed changes correctly detected; zero automatic versions created.\n');

  // Step 6: Test "Keep Changes"
  console.log('[Step 6] Testing "Keep Changes" action...');
  SessionModel.updateStatus(testNoteId, 'acknowledged');
  const sessionKeep = SessionModel.getByNoteId(testNoteId);
  if (sessionKeep.session_status !== 'acknowledged') {
    throw new Error('"Keep Changes" status update failed!');
  }
  const currentWorkingContentKeep = readNoteFile(testFilePath);
  if (currentWorkingContentKeep !== editedText) {
    throw new Error('"Keep Changes" corrupted working .md content!');
  }
  console.log('   ✓ Step 6 Passed: "Keep Changes" preserved working .md content and updated session status.\n');

  // Step 7: Test "Discard Changes"
  console.log('[Step 7] Testing "Discard Changes" action...');
  const latestForDiscard = VersionModel.getLatestForNote(testNoteId);
  const restoredContentFromV1 = reconstructVersionContent(latestForDiscard.id, VersionModel);
  writeNoteFile(testFilePath, restoredContentFromV1);
  const restoredHashFromV1 = calculateHash(restoredContentFromV1);
  NoteModel.update(testNoteId, undefined, undefined, undefined, restoredHashFromV1, latestForDiscard.id);
  SessionModel.upsert(testNoteId, latestForDiscard.id, restoredHashFromV1, 'clean');

  const fileContentAfterDiscard = readNoteFile(testFilePath);
  const versionsCountAfterDiscard = VersionModel.getHistory(testNoteId).length;

  if (fileContentAfterDiscard !== initialText) {
    throw new Error('Discard changes failed to restore latest checkpoint content!');
  }
  if (versionsCountAfterDiscard !== 1) {
    throw new Error('Discard changes illegally modified or deleted version history!');
  }
  console.log('   ✓ Step 7 Passed: "Discard Changes" accurately restored working .md content without modifying version history.\n');

  // Step 8: Cold Cache / Server Restart Check
  console.log('[Step 8] Simulating Server Restart (Clearing in-memory cache)...');
  versionCache.clear();
  const sessionAfterRestart = SessionModel.getByNoteId(testNoteId);
  const workingAfterRestart = readNoteFile(testFilePath);
  const reconV1Restart = reconstructVersionContent(v1.id, VersionModel);
  if (workingAfterRestart !== initialText || reconV1Restart !== initialText || !sessionAfterRestart) {
    throw new Error('Server restart simulation failed!');
  }
  console.log('   ✓ Step 8 Passed: Working file and version history fully recoverable after server restart.\n');

  // Step 9: Manual Checkpoint After Recovery
  console.log('[Step 9] Creating Manual Checkpoint V2 after recovery...');
  const textV2 = 'Line 1: Initial content\nLine 2: New Manual Checkpoint V2';
  writeNoteFile(testFilePath, textV2);
  const hashV2 = calculateHash(textV2);
  const diffHunksV2 = computeLineDiffHunks(initialText, textV2);

  const v2Data = {
    id: `v2_${Date.now()}`,
    note_id: testNoteId,
    version_number: 2,
    parent_version_id: v1.id,
    message: 'Manual Checkpoint V2',
    device_id: 'local_device',
    created_at: new Date().toISOString(),
    content_hash: hashV2,
    is_snapshot: 0,
    is_auto: 0
  };
  const v2 = VersionModel.createCheckpointTransaction(v2Data, diffHunksV2, testNoteId);
  SessionModel.upsert(testNoteId, v2.id, hashV2, 'clean');

  const finalHistory = VersionModel.getHistory(testNoteId);
  console.log(`   Created Version V2: ID=${v2.id}, Parent=${v2.parent_version_id}`);
  console.log('   Full Version History:', finalHistory.map(h => `V${h.version_number}: ${h.message}`).join(' -> '));

  if (finalHistory.length !== 2) {
    throw new Error('Manual checkpoint creation after recovery failed!');
  }
  console.log('   ✓ Step 9 Passed: Manual checkpoint V2 created as primary version mechanism.\n');

  // Cleanup Test Data
  console.log('[Cleanup] Deleting test note, sessions, and versions...');
  NoteModel.delete(testNoteId);
  SessionModel.delete(testNoteId);
  if (fs.existsSync(testFilePath)) fs.unlinkSync(testFilePath);
  console.log('   ✓ Cleanup Complete.\n');

  console.log('====================================================');
  console.log('   🎉 ALL SESSION RECOVERY TESTS PASSED SUCCESSFULLY! ');
  console.log('====================================================');
} catch (err) {
  console.error('\n❌ VERIFICATION TEST FAILED:', err);
  process.exit(1);
}
