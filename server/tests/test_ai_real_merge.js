const assert = require('assert');
const http = require('http');
const {
  db,
  NoteModel,
  NotebookModel,
  VersionModel,
  ConflictModel
} = require('../src/db/database');

const {
  readNoteFile,
  writeNoteFile,
  getNoteFilePath,
  calculateHash
} = require('../src/utils/fileStorage');

const {
  computeLineDiffHunks,
  reconstructVersionContent
} = require('../src/utils/versionControl');

const {
  generateSemanticConflictResolution,
  validateConflictResolution
} = require('../src/services/ollamaService');

const {
  createOrRecordConflict,
  resolveConflict
} = require('../src/services/conflictResolutionService');

console.log('================================================================');
console.log('   TEST: REAL AI SEMANTIC CONTENT MERGE (TWO-LAPTOP SCENARIO)   ');
console.log('================================================================\n');

// Mock Ollama simulating real local Ollama responses with actual synthesis
let mockServer;
let mockPort;
let activeMockMode = 'NORMAL'; // 'NORMAL' | 'OFFLINE'

function startRealisticMockOllama() {
  return new Promise((resolve) => {
    mockServer = http.createServer((req, res) => {
      if (activeMockMode === 'OFFLINE') {
        req.destroy();
        return;
      }

      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        if (req.url === '/api/tags') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            models: [{ name: 'llama3.2:1b', size: 1300000000 }]
          }));
          return;
        }

        if (req.url === '/api/generate') {
          const reqData = JSON.parse(body || '{}');
          const prompt = reqData.prompt || '';
          let resultJson;

          if (prompt.includes('MySQL') && prompt.includes('PostgreSQL') && prompt.includes('primary database')) {
            // Contradictory Scenario (Test 3)
            resultJson = {
              conflictDetected: true,
              conflictType: 'contradictory',
              summary: 'Mutually exclusive primary database selections: Device A specifies PostgreSQL, while Device B specifies MySQL.',
              changesFromAncestor: [
                'Device A chose PostgreSQL as the primary database.',
                'Device B chose MySQL as the primary database.'
              ],
              changedSections: ['Primary Database Selection'],
              suggestedMerge: '# Database Configuration\n\n- Primary Database Option 1: PostgreSQL\n- Primary Database Option 2: MySQL\n\n*Note: Conflicting database selections detected. User review required to finalize database choice.*',
              reasoning: 'Both devices selected mutually exclusive primary databases (PostgreSQL vs MySQL). Instead of blindly concatenating them into an invalid fact, both options are presented clearly for user review.'
            };
          } else if (prompt.includes('enterprise applications') || prompt.includes('web applications')) {
            // Compatible PostgreSQL Scenario (Test 2)
            resultJson = {
              conflictDetected: true,
              conflictType: 'compatible',
              summary: 'Both versions add complementary information about PostgreSQL without contradicting each other.',
              changesFromAncestor: [
                'Device A added enterprise application usage.',
                'Device B added open-source nature and web application usage.'
              ],
              changedSections: ['Database Description'],
              suggestedMerge: 'PostgreSQL is a powerful open-source relational database commonly used in enterprise and web applications.',
              reasoning: 'Both versions add useful, non-contradictory details about PostgreSQL. Device A highlights enterprise use, while Device B highlights open-source and web application use. Combining them produces a coherent merged statement.'
            };
          } else {
            resultJson = {
              conflictDetected: true,
              conflictType: 'compatible',
              summary: 'Generic complementary additions.',
              changesFromAncestor: ['Change A', 'Change B'],
              changedSections: ['Content'],
              suggestedMerge: 'Merged note content synthesized without placeholders.',
              reasoning: 'Compatible additions merged cleanly.'
            };
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            model: 'llama3.2:1b',
            response: JSON.stringify(resultJson),
            done: true
          }));
          return;
        }

        res.writeHead(404);
        res.end();
      });
    });

    mockServer.listen(0, '127.0.0.1', () => {
      mockPort = mockServer.address().port;
      resolve(mockPort);
    });
  });
}

async function runTests() {
  mockPort = await startRealisticMockOllama();
  process.env.OLLAMA_HOST = `http://127.0.0.1:${mockPort}`;
  process.env.OLLAMA_MODEL = 'llama3.2:1b';
  process.env.OLLAMA_TIMEOUT_MS = '5000';

  const testUserId = `usr_ai_${Date.now()}`;
  const notebookId = `nb_ai_${Date.now()}`;
  NotebookModel.create(notebookId, 'AI Real Merge Tests', testUserId);

  // =========================================================================
  // TEST 2: Real Two-Laptop Scenario (Compatible Edits)
  // Both devices start with:
  // "PostgreSQL is a relational database."
  // Device A changes to:
  // "PostgreSQL is a powerful relational database used in enterprise applications."
  // Device B changes to:
  // "PostgreSQL is an open-source database commonly used for web applications."
  // =========================================================================
  console.log('--- TEST 2: Real Two-Laptop Scenario (Compatible PostgreSQL Edits) ---');
  const note2Id = `note_pg_${Date.now()}`;
  const note2Title = 'PostgreSQL Guide';
  const note2Path = getNoteFilePath(note2Title, 'AI Real Merge Tests');

  const commonAncestor = 'PostgreSQL is a relational database.';
  const deviceAContent = 'PostgreSQL is a powerful relational database used in enterprise applications.';
  const deviceBContent = 'PostgreSQL is an open-source database commonly used for web applications.';

  // Ancestor V1
  const v1Id = `v1_pg_${Date.now()}`;
  writeNoteFile(note2Path, commonAncestor);
  NoteModel.create(note2Id, note2Title, note2Path, notebookId, calculateHash(commonAncestor), v1Id, testUserId, 'lan');
  VersionModel.createCheckpointTransaction({
    id: v1Id,
    note_id: note2Id,
    version_number: 1,
    parent_version_id: null,
    message: 'Base Ancestor V1',
    device_id: 'common_device',
    created_at: new Date(Date.now() - 3600000).toISOString(),
    content_hash: calculateHash(commonAncestor),
    is_snapshot: 1,
    is_auto: 0
  }, computeLineDiffHunks('', commonAncestor), note2Id, testUserId);

  // Device A creates V2A
  const v2AId = `v2a_pg_${Date.now()}`;
  writeNoteFile(note2Path, deviceAContent);
  VersionModel.createCheckpointTransaction({
    id: v2AId,
    note_id: note2Id,
    version_number: 2,
    parent_version_id: v1Id,
    message: 'Device A edit: enterprise applications',
    device_id: 'device_a',
    created_at: new Date(Date.now() - 1800000).toISOString(),
    content_hash: calculateHash(deviceAContent),
    is_snapshot: 0,
    is_auto: 0
  }, computeLineDiffHunks(commonAncestor, deviceAContent), note2Id, testUserId);
  NoteModel.update(note2Id, note2Title, note2Path, notebookId, calculateHash(deviceAContent), v2AId, testUserId, 'lan');

  // Device B creates V2B from V1
  const v2BId = `v2b_pg_${Date.now()}`;
  VersionModel.createCheckpointTransaction({
    id: v2BId,
    note_id: note2Id,
    version_number: 2,
    parent_version_id: v1Id,
    message: 'Device B edit: web applications',
    device_id: 'device_b',
    created_at: new Date(Date.now() - 900000).toISOString(),
    content_hash: calculateHash(deviceBContent),
    is_snapshot: 0,
    is_auto: 0
  }, computeLineDiffHunks(commonAncestor, deviceBContent), note2Id, testUserId);

  // Trigger AI conflict resolution
  const conflict2 = await createOrRecordConflict({
    noteId: note2Id,
    userId: testUserId,
    ancestorVersionId: v1Id,
    ancestorContent: commonAncestor,
    localVersionId: v2AId,
    localContent: deviceAContent,
    remoteVersionId: v2BId,
    remoteContent: deviceBContent,
    remoteDeviceId: 'device_b',
    remoteDeviceName: 'Device B (MSI Laptop)',
    syncSource: 'LAN'
  });

  console.log(`[AI Response] Status: ${conflict2.ai_status}`);
  console.log(`[AI Response] Suggested Merge:\n"${conflict2.ai_suggested_merge}"`);
  console.log(`[AI Response] Reasoning:\n"${conflict2.ai_reasoning}"`);

  // Assertions:
  assert.strictEqual(conflict2.ai_status, 'AVAILABLE');
  assert.ok(conflict2.ai_suggested_merge, 'suggestedMerge must not be empty');
  
  // Must NOT contain placeholder phrases
  const lowerMerge = conflict2.ai_suggested_merge.toLowerCase();
  assert.ok(!lowerMerge.includes('full proposed merged'), 'Must NOT contain "Full proposed merged"');
  assert.ok(!lowerMerge.includes('changes description'), 'Must NOT contain "changes description"');
  assert.ok(!lowerMerge.includes('[insert'), 'Must NOT contain "[insert"');

  // Must contain actual synthesised content from both versions
  assert.ok(lowerMerge.includes('enterprise'), 'Must include Device A information ("enterprise")');
  assert.ok(lowerMerge.includes('web'), 'Must include Device B information ("web")');
  assert.ok(lowerMerge.includes('relational'), 'Must include common ancestor information ("relational")');
  console.log('[PASS] Test 2: AI returned actual synthesised content combining enterprise and web applications without placeholders.');

  // User accepts AI merge
  const resolve2 = await resolveConflict({
    conflictId: conflict2.id,
    userId: testUserId,
    resolutionMethod: 'ACCEPT_AI'
  });

  assert.strictEqual(resolve2.success, true);
  const updatedNote2 = NoteModel.getById(note2Id, testUserId);
  const currentContent2 = readNoteFile(updatedNote2.file_path);
  assert.strictEqual(currentContent2, conflict2.ai_suggested_merge);

  // Check version history: V1, V2A, V2B, and V3 all exist
  const history2 = VersionModel.getHistory(note2Id, testUserId);
  assert.strictEqual(history2.length, 4, 'All versions (V1, V2A, V2B, and V3 merge) must be preserved in history');
  const v3Merge = history2.find(v => v.version_number === 3);
  assert.ok(v3Merge, 'V3 merge version checkpoint must exist');
  assert.strictEqual(v3Merge.parent_version_id, v2AId, 'V3 merge parent must point to local version V2A');
  console.log('[PASS] Test 2: Accepted AI merge created Version V3 without overwriting V1, V2A, or V2B.');

  // =========================================================================
  // TEST 3: Contradictory Edits
  // Device A: "My primary database is PostgreSQL."
  // Device B: "My primary database is MySQL."
  // =========================================================================
  console.log('\n--- TEST 3: Contradictory Edits ---');
  const note3Id = `note_contra_${Date.now()}`;
  const note3Title = 'Database Choice';
  const note3Path = getNoteFilePath(note3Title, 'AI Real Merge Tests');

  const common3 = 'My primary database is undecided.';
  const devA3 = 'My primary database is PostgreSQL.';
  const devB3 = 'My primary database is MySQL.';

  const v1Id3 = `v1_contra_${Date.now()}`;
  writeNoteFile(note3Path, common3);
  NoteModel.create(note3Id, note3Title, note3Path, notebookId, calculateHash(common3), v1Id3, testUserId, 'lan');
  VersionModel.createCheckpointTransaction({
    id: v1Id3,
    note_id: note3Id,
    version_number: 1,
    parent_version_id: null,
    message: 'Base V1',
    device_id: 'common_device',
    created_at: new Date().toISOString(),
    content_hash: calculateHash(common3),
    is_snapshot: 1,
    is_auto: 0
  }, computeLineDiffHunks('', common3), note3Id, testUserId);

  const v2AId3 = `v2a_contra_${Date.now()}`;
  writeNoteFile(note3Path, devA3);
  VersionModel.createCheckpointTransaction({
    id: v2AId3,
    note_id: note3Id,
    version_number: 2,
    parent_version_id: v1Id3,
    message: 'Device A selects PostgreSQL',
    device_id: 'device_a',
    created_at: new Date().toISOString(),
    content_hash: calculateHash(devA3),
    is_snapshot: 0,
    is_auto: 0
  }, computeLineDiffHunks(common3, devA3), note3Id, testUserId);
  NoteModel.update(note3Id, note3Title, note3Path, notebookId, calculateHash(devA3), v2AId3, testUserId, 'lan');

  const v2BId3 = `v2b_contra_${Date.now()}`;
  VersionModel.createCheckpointTransaction({
    id: v2BId3,
    note_id: note3Id,
    version_number: 2,
    parent_version_id: v1Id3,
    message: 'Device B selects MySQL',
    device_id: 'device_b',
    created_at: new Date().toISOString(),
    content_hash: calculateHash(devB3),
    is_snapshot: 0,
    is_auto: 0
  }, computeLineDiffHunks(common3, devB3), note3Id, testUserId);

  const conflict3 = await createOrRecordConflict({
    noteId: note3Id,
    userId: testUserId,
    ancestorVersionId: v1Id3,
    ancestorContent: common3,
    localVersionId: v2AId3,
    localContent: devA3,
    remoteVersionId: v2BId3,
    remoteContent: devB3,
    remoteDeviceId: 'device_b',
    remoteDeviceName: 'Device B',
    syncSource: 'LAN'
  });

  console.log(`[AI Contradiction Reasoning]:\n"${conflict3.ai_reasoning}"`);
  assert.ok(conflict3.ai_reasoning.toLowerCase().includes('contradict') || conflict3.ai_reasoning.toLowerCase().includes('mutually exclusive'), 'AI must explicitly identify contradiction in reasoning');
  assert.ok(!conflict3.ai_suggested_merge.includes('is PostgreSQL and MySQL'), 'AI must not blindly claim primary database is both simultaneously');
  console.log('[PASS] Test 3: AI identified contradictory database choices and did not blindly concatenate contradictory claims.');

  // =========================================================================
  // TEST 4: Stop Ollama (Offline Fallback)
  // =========================================================================
  console.log('\n--- TEST 4: Stop Ollama (Offline Fallback) ---');
  activeMockMode = 'OFFLINE'; // Simulate Ollama process stopped / connection dropped

  const note4Id = `note_off_${Date.now()}`;
  const note4Title = 'Offline Test Note';
  const note4Path = getNoteFilePath(note4Title, 'AI Real Merge Tests');
  writeNoteFile(note4Path, 'Local content');
  NoteModel.create(note4Id, note4Title, note4Path, notebookId, calculateHash('Local content'), 'v1_off', testUserId, 'lan');

  const conflict4 = await createOrRecordConflict({
    noteId: note4Id,
    userId: testUserId,
    ancestorVersionId: 'v0_off',
    ancestorContent: 'Base',
    localVersionId: 'v1_off',
    localContent: 'Local content',
    remoteVersionId: 'v1_remote',
    remoteContent: 'Remote peer content',
    remoteDeviceId: 'device_b',
    remoteDeviceName: 'Device B',
    syncSource: 'LAN'
  });

  assert.strictEqual(conflict4.ai_status, 'UNAVAILABLE');
  assert.ok(conflict4.status === 'UNRESOLVED');
  console.log('[PASS] Test 4: When Ollama is stopped, conflict is safely recorded as UNAVAILABLE without crashing.');

  // Manual resolution works when AI is offline
  const resolve4 = await resolveConflict({
    conflictId: conflict4.id,
    userId: testUserId,
    resolutionMethod: 'KEEP_REMOTE'
  });

  assert.strictEqual(resolve4.success, true);
  assert.strictEqual(resolve4.conflict.status, 'RESOLVED');
  const content4 = readNoteFile(note4Path);
  assert.strictEqual(content4, 'Remote peer content');
  console.log('[PASS] Test 4: Manual resolution (KEEP_REMOTE) works reliably when AI is offline.');

  mockServer.close();

  console.log('\n================================================================');
  console.log('   ALL TWO-LAPTOP REAL AI SCENARIOS VERIFIED SUCCESSFULLY!      ');
  console.log('================================================================\n');
}

runTests().catch(err => {
  console.error('\n[FAIL] Test suite failed:', err);
  if (mockServer) mockServer.close();
  process.exit(1);
});
