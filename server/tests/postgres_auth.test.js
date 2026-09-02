const assert = require('assert');
const { PgUserModel, PgDeviceModel, isPostgresConnected } = require('../src/db/postgres');
const { UserModel, NoteModel } = require('../src/db/database');
const { hashPassword, comparePassword } = require('../src/utils/auth');

async function runPostgresAuthTests() {
  console.log('\n==================================================');
  console.log(' POSTGRESQL & OFFLINE AUTHENTICATION TEST SUITE');
  console.log('==================================================\n');

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`  ✓ PASSED: ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ FAILED: ${name}`);
      console.error(`    --> ${err.message}`);
      failed++;
    }
  }

  // Test 1: Password hashing and comparison
  await test('Password Hashing Integrity', async () => {
    const raw = 'SecurePass_2026!';
    const hashed = await hashPassword(raw);
    assert.notStrictEqual(raw, hashed, 'Password should be hashed');
    const valid = await comparePassword(raw, hashed);
    assert.strictEqual(valid, true, 'Valid password matches hash');
    const invalid = await comparePassword('WrongPassword', hashed);
    assert.strictEqual(invalid, false, 'Invalid password fails');
  });

  // Test 2: PgUserModel creation and lookup
  await test('User Creation & Retrieval (PgUserModel)', async () => {
    const email = `pg_user_${Date.now()}@syncnote.io`;
    const username = `pg_user_${Date.now()}`;
    const hash = await hashPassword('Password123');

    const created = await PgUserModel.create({ username, email, passwordHash: hash });
    assert.ok(created.id, 'Created user has an ID');
    assert.strictEqual(created.email, email, 'Email matches');

    const foundByEmail = await PgUserModel.findByEmail(email);
    assert.ok(foundByEmail, 'Found user by email');
    assert.strictEqual(foundByEmail.id, created.id, 'User ID matches');

    const foundByUsername = await PgUserModel.findByUsername(username);
    assert.ok(foundByUsername, 'Found user by username');
    assert.strictEqual(foundByUsername.id, created.id, 'User ID matches');
  });

  // Test 3: PgDeviceModel upsert
  await test('Device Upsert (PgDeviceModel)', async () => {
    const email = `dev_user_${Date.now()}@syncnote.io`;
    const hash = await hashPassword('Password123');
    const user = await PgUserModel.create({ username: `dev_user_${Date.now()}`, email, passwordHash: hash });

    const deviceId = `device_${Date.now()}`;
    const device = await PgDeviceModel.upsert({
      id: deviceId,
      userId: user.id,
      deviceName: 'Test Windows Machine',
      deviceType: 'desktop'
    });

    assert.strictEqual(device.id, deviceId, 'Device ID matches');

    const devices = await PgDeviceModel.getByUserId(user.id);
    assert.ok(devices.length >= 1, 'Device list retrieved');
  });

  // Test 4: Password Update
  await test('Password Change (PgUserModel)', async () => {
    const email = `pwd_user_${Date.now()}@syncnote.io`;
    const user = await PgUserModel.create({ username: `pwd_user_${Date.now()}`, email, passwordHash: 'oldhash' });

    const newHash = await hashPassword('NewSecurePassword!2026');
    await PgUserModel.updatePassword(user.id, newHash);

    const updatedUser = await PgUserModel.findByEmail(email);
    const isValid = await comparePassword('NewSecurePassword!2026', updatedUser.password_hash);
    assert.strictEqual(isValid, true, 'Updated password hash matches new password');
  });

  console.log('\n--------------------------------------------------');
  console.log(` RESULTS: ${passed} Passed, ${failed} Failed`);
  console.log('--------------------------------------------------\n');

  if (failed > 0) process.exit(1);
}

runPostgresAuthTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
