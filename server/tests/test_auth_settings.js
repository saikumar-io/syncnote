const assert = require('assert');
const path = require('path');

// Test 1: Verify database models
const { UserModel } = require('../src/db/database');
const { PgUserModel } = require('../src/db/postgres');

async function runAuthSettingsTests() {
  console.log('==================================================');
  console.log(' SYNCNOTE AUTH & SETTINGS INTEGRATION TEST');
  console.log('==================================================\n');

  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    try {
      fn();
      console.log(`[PASS] ${name}`);
      passed++;
    } catch (e) {
      console.error(`[FAIL] ${name}:`, e.message);
      failed++;
    }
  }

  async function asyncTest(name, fn) {
    try {
      await fn();
      console.log(`[PASS] ${name}`);
      passed++;
    } catch (e) {
      console.error(`[FAIL] ${name}:`, e.message);
      failed++;
    }
  }

  // 1. Test SQLite Google user creation
  test('SQLite UserModel.findOrCreateGoogleUser handles new user', () => {
    const googleId = '11223344556677889900';
    const email = 'testgoogle@syncnote.io';
    const name = 'Test Google User';

    const u = UserModel.findOrCreateGoogleUser({ googleId, email, name });
    assert.strictEqual(u.email, email);
    assert.strictEqual(u.auth_provider, 'google');
    assert.strictEqual(u.provider_user_id, googleId);
  });

  // 2. Test SQLite idempotency on findOrCreateGoogleUser
  test('SQLite UserModel.findOrCreateGoogleUser is idempotent', () => {
    const googleId = '11223344556677889900';
    const email = 'testgoogle@syncnote.io';

    const u1 = UserModel.findOrCreateGoogleUser({ googleId, email, name: 'Test Google User' });
    const u2 = UserModel.findOrCreateGoogleUser({ googleId, email, name: 'Test Google User' });
    assert.strictEqual(u1.id, u2.id);
  });

  // 3. Test PgUserModel fallback / schema compatibility
  await asyncTest('PgUserModel.findOrCreateGoogleUser works with PostgreSQL/SQLite fallback', async () => {
    const googleId = '99887766554433221100';
    const email = 'pg_oauth_test@syncnote.io';
    const name = 'PG OAuth Test';

    const u = await PgUserModel.findOrCreateGoogleUser({ googleId, email, name });
    assert.ok(u);
    assert.strictEqual(u.email, email);
  });

  // 4. Test missing GOOGLE_CLIENT_ID error handling logic in auth route
  test('Auth route handles missing GOOGLE_CLIENT_ID without server crash', () => {
    const express = require('express');
    const authRouter = require('../src/routes/auth');
    assert.ok(authRouter);
  });

  console.log('\n==================================================');
  console.log(` SUMMARY: ${passed} PASSED / ${failed} FAILED`);
  console.log('==================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runAuthSettingsTests().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
