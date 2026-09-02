const assert = require('assert');
const path = require('path');
const fs = require('fs');

// Environment setup
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test_jwt_secret_key_12345';

const { 
  UserModel, 
  DeviceModel, 
  NoteModel, 
  NotebookModel, 
  VersionModel 
} = require('../src/db/database');

const { 
  hashPassword, 
  comparePassword, 
  generateToken, 
  verifyToken,
  validateRegistrationInput
} = require('../src/utils/auth');

async function runAuthTests() {
  console.log('\n==================================================');
  console.log(' SYNCNOTE AUTHENTICATION & OWNERSHIP TEST SUITE');
  console.log('==================================================\n');

  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    try {
      fn();
      console.log(`  ✓ PASSED: ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ FAILED: ${name}`);
      console.error(`    --> Error: ${err.message}`);
      failed++;
    }
  }

  async function asyncTest(name, fn) {
    try {
      await fn();
      console.log(`  ✓ PASSED: ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ FAILED: ${name}`);
      console.error(`    --> Error: ${err.message}`);
      failed++;
    }
  }

  // 1. Password Hashing & Verification
  await asyncTest('Password Hashing & Verification', async () => {
    const rawPass = 'SecretP@ss123';
    const hashed = await hashPassword(rawPass);
    assert.notStrictEqual(rawPass, hashed, 'Hashed password should not equal plaintext');
    
    const isValid = await comparePassword(rawPass, hashed);
    assert.strictEqual(isValid, true, 'Valid password comparison should return true');

    const isInvalid = await comparePassword('WrongPass', hashed);
    assert.strictEqual(isInvalid, false, 'Invalid password comparison should return false');
  });

  // 2. JWT Token Generation & Decoding
  test('JWT Token Generation & Verification', () => {
    const payload = { id: 'usr_test_1', email: 'test@syncnote.io', username: 'testuser' };
    const token = generateToken(payload);
    assert.strictEqual(typeof token, 'string', 'Token should be a string');

    const decoded = verifyToken(token);
    assert.strictEqual(decoded.id, payload.id, 'Decoded user ID match');
    assert.strictEqual(decoded.email, payload.email, 'Decoded user email match');
  });

  // 3. Registration Input Validation
  test('Registration Input Validation', () => {
    const invalidName = validateRegistrationInput({ username: 'ab', email: 'valid@test.com', password: '123' });
    assert.strictEqual(invalidName.isValid, false, 'Username < 3 chars should fail');

    const valid = validateRegistrationInput({ username: 'alex_dev', email: 'alex@syncnote.io', password: 'password123', confirmPassword: 'password123' });
    assert.strictEqual(valid.isValid, true, 'Valid payload should pass validation');
  });

  // 4. User Model Persistence
  test('User Model CRUD Operations', () => {
    const testEmail = `user_${Date.now()}@syncnote.io`;
    const testUsername = `user_${Date.now()}`;
    const testId = `usr_${Date.now()}`;

    const created = UserModel.create({
      id: testId,
      email: testEmail,
      username: testUsername,
      passwordHash: 'hash123'
    });

    assert.strictEqual(created.id, testId, 'Created user ID matches');
    assert.strictEqual(created.email, testEmail.toLowerCase(), 'Created user email matches');

    const foundByEmail = UserModel.findByEmail(testEmail);
    assert.strictEqual(foundByEmail.id, testId, 'Find by email matches');

    const foundByUsername = UserModel.findByUsername(testUsername);
    assert.strictEqual(foundByUsername.id, testId, 'Find by username matches');
  });

  // 5. Device Identity Model
  test('Device Model Upsert & Retrieval', () => {
    const userId = `usr_${Date.now()}`;
    const deviceId = `device_${Date.now()}`;

    const device = DeviceModel.upsert({
      id: deviceId,
      userId,
      deviceName: 'Work Station 1',
      deviceType: 'desktop'
    });

    assert.strictEqual(device.id, deviceId, 'Device ID matches');
    assert.strictEqual(device.device_name, 'Work Station 1', 'Device name matches');

    const userDevices = DeviceModel.getByUserId(userId);
    assert.strictEqual(userDevices.length, 1, 'User has 1 device');
  });

  // 6. User Data Isolation (User A vs User B Ownership Boundary)
  test('User Ownership Isolation (Notes & Notebooks)', () => {
    const userA = `usr_A_${Date.now()}`;
    const userB = `usr_B_${Date.now()}`;

    // Create Notebook for User A
    const nbA = NotebookModel.create(`nb_A_${Date.now()}`, 'User A Notebook', userA);

    // Create Notebook for User B
    const nbB = NotebookModel.create(`nb_B_${Date.now()}`, 'User B Notebook', userB);

    // User A should only see their notebooks
    const userANotebooks = NotebookModel.getAll(userA);
    const hasNbA = userANotebooks.some(n => n.id === nbA.id);
    const hasNbB = userANotebooks.some(n => n.id === nbB.id);

    assert.strictEqual(hasNbA, true, 'User A sees their notebook');
    assert.strictEqual(hasNbB, false, 'User A DOES NOT see User B notebook');

    // Create Note for User A
    const noteA = NoteModel.create(`note_A_${Date.now()}`, 'User A Note', 'notes/a.md', nbA.id, 'hashA', null, userA);

    // Create Note for User B
    const noteB = NoteModel.create(`note_B_${Date.now()}`, 'User B Note', 'notes/b.md', nbB.id, 'hashB', null, userB);

    // User B attempting to fetch User A's note should be null
    const unauthorizedAccess = NoteModel.getById(noteA.id, userB);
    assert.strictEqual(unauthorizedAccess, undefined, 'User B accessing User A note returns undefined/null');

    // User A fetching their note
    const authorizedAccess = NoteModel.getById(noteA.id, userA);
    assert.strictEqual(authorizedAccess.id, noteA.id, 'User A successfully retrieves their note');
  });

  // 7. Migration of Legacy Unowned Notes
  test('Unowned Data Migration on First User Registration', () => {
    const unownedId = `note_unowned_${Date.now()}`;
    NoteModel.create(unownedId, 'Unowned Note', 'notes/unowned.md', null, 'hashU', null, 'usr_local_default');

    const newUser = `usr_new_${Date.now()}`;
    UserModel.assignUnownedDataToUser(newUser);

    const migratedNote = NoteModel.getById(unownedId, newUser);
    assert.strictEqual(migratedNote.user_id, newUser, 'Unowned note successfully re-assigned to new user');
  });

  console.log('\n--------------------------------------------------');
  console.log(` RESULTS: ${passed} Passed, ${failed} Failed`);
  console.log('--------------------------------------------------\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runAuthTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
