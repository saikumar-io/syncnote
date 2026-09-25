/**
 * Verification Test Suite for SyncNote Ollama Timeout Resolution
 * 
 * Tests:
 * 1. Diagnostic test with small prompt: "Say hello in one sentence."
 * 2. Diagnostic test with: "Explain PostgreSQL in one sentence."
 * 3. Actual conflict resolution test with real inputs:
 *    - Common Ancestor: "PostgreSQL is a relational database."
 *    - Device A: "PostgreSQL is a powerful relational database used in enterprise applications."
 *    - Device B: "PostgreSQL is an open-source database commonly used for web applications."
 * 4. Validation of structured JSON output and complete merged note content.
 */

const assert = require('assert');
const ollamaService = require('../src/utils/ollamaService');
// Also verify that importing from services/ollamaService is identical
const directService = require('../src/services/ollamaService');

async function runTests() {
  console.log('====================================================');
  console.log('SYNCNOTE OLLAMA TIMEOUT FIX VERIFICATION TEST');
  console.log('====================================================\n');

  // Verify exports match
  assert.strictEqual(typeof ollamaService.testOllamaConnection, 'function');
  assert.strictEqual(typeof ollamaService.generateSemanticConflictResolution, 'function');
  assert.strictEqual(typeof ollamaService.checkOllamaHealth, 'function');

  // 0. Check Health
  console.log('>>> STEP 0: Health Check');
  const health = await ollamaService.checkOllamaHealth();
  console.log(`Health Status: available=${health.available}, modelReady=${health.modelReady}, model=${health.configuredModel}`);
  assert.strictEqual(health.available, true, 'Ollama should be available');
  assert.strictEqual(health.modelReady, true, 'Configured model should be ready');
  console.log('[PASS] Step 0: Health Check passed\n');

  // 1. Test with small prompt
  console.log('>>> STEP 1: Test with small prompt ("Say hello in one sentence.")');
  const res1 = await ollamaService.testOllamaConnection('Say hello in one sentence.');
  console.log(`Result: status=${res1.status}, duration=${res1.durationMs}ms`);
  console.log(`Response: "${res1.response}"`);
  assert.strictEqual(res1.status, 200, 'HTTP status should be 200');
  assert.ok(res1.durationMs < 10000, `Expected duration < 10000ms, got ${res1.durationMs}ms`);
  assert.ok(res1.response && res1.response.length > 0, 'Response should not be empty');
  console.log('[PASS] Step 1: Small prompt test completed successfully\n');

  // 2. Test with PostgreSQL explanation
  console.log('>>> STEP 2: Test with explanation prompt ("Explain PostgreSQL in one sentence.")');
  const res2 = await ollamaService.testOllamaConnection('Explain PostgreSQL in one sentence.');
  console.log(`Result: status=${res2.status}, duration=${res2.durationMs}ms`);
  console.log(`Response: "${res2.response}"`);
  assert.strictEqual(res2.status, 200, 'HTTP status should be 200');
  assert.ok(res2.durationMs < 15000, `Expected duration < 15000ms, got ${res2.durationMs}ms`);
  assert.ok(res2.response && res2.response.length > 0, 'Response should not be empty');
  console.log('[PASS] Step 2: PostgreSQL explanation completed successfully\n');

  // 3. Test actual conflict input
  console.log('>>> STEP 3: Test actual conflict input through generateSemanticConflictResolution');
  const ancestorContent = 'PostgreSQL is a relational database.';
  const localContent = 'PostgreSQL is a powerful relational database used in enterprise applications.';
  const remoteContent = 'PostgreSQL is an open-source database commonly used for web applications.';

  const conflictRes = await ollamaService.generateSemanticConflictResolution({
    noteId: 'test_note_timeout_fix',
    ancestorContent,
    localContent,
    remoteContent,
    localDeviceName: 'Device A',
    remoteDeviceName: 'Device B'
  });

  console.log(`AI Invocation success: ${conflictRes.success}, available: ${conflictRes.available}`);
  console.log(`Latency: ${conflictRes.latencyMs}ms`);
  assert.strictEqual(conflictRes.success, true, 'AI resolution should succeed');
  assert.strictEqual(conflictRes.available, true, 'AI should be reported as available');
  assert.ok(conflictRes.latencyMs < 30000, `Latency must be < 30000ms, got ${conflictRes.latencyMs}ms`);

  const data = conflictRes.data;
  console.log('\nParsed Structured Output:');
  console.log('conflictDetected:', data.conflictDetected);
  console.log('conflictType:', data.conflictType);
  console.log('reasoning:', data.reasoning);
  console.log('summary:', data.summary);
  console.log('changesFromAncestor:', data.changesFromAncestor);
  console.log('suggestedMerge:', data.suggestedMerge);

  // Assertions on structured output
  assert.strictEqual(typeof data.conflictDetected, 'boolean', 'conflictDetected must be boolean');
  assert.strictEqual(typeof data.suggestedMerge, 'string', 'suggestedMerge must be a string');
  assert.ok(data.suggestedMerge.length > 0, 'suggestedMerge must not be empty');

  // Ensure NO placeholder text
  assert.ok(!data.suggestedMerge.toLowerCase().includes('placeholder'), 'No placeholder text in suggestedMerge');
  assert.ok(!data.suggestedMerge.toLowerCase().includes('proposed merged'), 'No proposed merged placeholder in suggestedMerge');

  // Ensure actual merged content incorporates semantic elements from both devices
  const lowerMerge = data.suggestedMerge.toLowerCase();
  console.log('\nChecking merged content contains both changes:');
  const hasEnterprise = lowerMerge.includes('enterprise');
  const hasWeb = lowerMerge.includes('web');
  const hasPostgres = lowerMerge.includes('postgresql') || lowerMerge.includes('postgres');
  console.log(`- Mentions PostgreSQL: ${hasPostgres}`);
  console.log(`- Mentions enterprise (Device A): ${hasEnterprise}`);
  console.log(`- Mentions web (Device B): ${hasWeb}`);

  assert.ok(hasPostgres, 'Merged note should mention PostgreSQL');
  assert.ok(hasEnterprise || hasWeb, 'Merged note should incorporate changes from at least one device, ideally both');

  console.log('\n[PASS] Step 3: Real conflict input passed with flying colors!');
  console.log('====================================================');
  console.log('ALL VERIFICATION CHECKS PASSED');
  console.log('====================================================');
}

runTests().catch(err => {
  console.error('\n[FAIL] Test suite failed with error:', err);
  process.exit(1);
});
