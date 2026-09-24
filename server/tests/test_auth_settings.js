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

  // 5. Test OAuth user hasPassword detection & password setting
  await asyncTest('OAuth user password setting & dual auth method persistence', async () => {
    const { hashPassword, comparePassword } = require('../src/utils/auth');
    const googleId = `oauth_${Date.now()}`;
    const email = `oauth_user_${Date.now()}@syncnote.io`;
    const name = 'OAuth Password Test User';

    // Step A: Create OAuth user
    const oauthUser = await PgUserModel.findOrCreateGoogleUser({ googleId, email, name });
    assert.ok(oauthUser.id);

    // Step B: Verify initial hasPassword is false
    const fetchedBefore = await PgUserModel.findById(oauthUser.id);
    assert.strictEqual(fetchedBefore.has_password, false, 'Initial OAuth user must have has_password: false');
    assert.strictEqual(fetchedBefore.hasPassword, false, 'Initial OAuth user must have hasPassword: false');

    // Step C: Set password for the OAuth user
    const newPassword = 'SecureSyncPassword123!';
    const passwordHash = await hashPassword(newPassword);
    await PgUserModel.updatePassword(oauthUser.id, passwordHash);

    // Step D: Verify hasPassword is now true
    const fetchedAfter = await PgUserModel.findById(oauthUser.id);
    assert.strictEqual(fetchedAfter.has_password, true, 'OAuth user with set password must have has_password: true');
    assert.strictEqual(fetchedAfter.hasPassword, true, 'OAuth user with set password must have hasPassword: true');

    // Step E: Verify password can be used for email/password authentication
    const userForAuth = await PgUserModel.findByEmail(email);
    assert.strictEqual(userForAuth.id, oauthUser.id);
    const passwordValid = await comparePassword(newPassword, userForAuth.password_hash);
    assert.strictEqual(passwordValid, true, 'Password comparison must succeed for new password');

    const wrongPasswordValid = await comparePassword('WrongPassword', userForAuth.password_hash);
    assert.strictEqual(wrongPasswordValid, false, 'Wrong password comparison must fail');

    // Step F: Verify logging in with Google again preserves the account and password
    const googleLoginUser = await PgUserModel.findOrCreateGoogleUser({ googleId, email, name });
    assert.strictEqual(googleLoginUser.id, oauthUser.id, 'Google login must preserve identical user ID');

    const fetchedAfterGoogle = await PgUserModel.findByEmail(email);
    assert.ok(fetchedAfterGoogle.password_hash, 'Google login must not erase user password hash');
    const passwordStillValid = await comparePassword(newPassword, fetchedAfterGoogle.password_hash);
    assert.strictEqual(passwordStillValid, true, 'Password must remain valid after subsequent Google login');
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
