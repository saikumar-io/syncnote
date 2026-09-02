const assert = require('assert');
const fs = require('fs');
const path = require('path');

async function runGDriveSyncTests() {
  console.log('==================================================');
  console.log(' SYNCNOTE GOOGLE DRIVE SYNC PERMISSION FIX TESTS');
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

  // 1. Verify Scope in auth.js
  test('Google Drive OAuth route uses https://www.googleapis.com/auth/drive scope', () => {
    const authJsContent = fs.readFileSync(path.join(__dirname, '../src/routes/auth.js'), 'utf8');
    assert.ok(authJsContent.includes("const scope = 'https://www.googleapis.com/auth/drive';"), 'Drive OAuth scope must be https://www.googleapis.com/auth/drive');
    assert.ok(!authJsContent.includes("const scope = 'https://www.googleapis.com/auth/drive.file';"), 'drive.file scope must not be used');
    assert.ok(!authJsContent.includes("const scope = 'https://www.googleapis.com/auth/drive.appdata';"), 'drive.appdata scope must not be used');
    
    // Check Google Login scopes remain openid email profile
    assert.ok(authJsContent.includes("const scope = 'openid email profile';"), 'Google Login scopes must remain openid email profile');
  });

  // 2. Verify Privacy Guard rejects LAN & Local notes
  const { rejectGoogleUpload } = require('../src/utils/googleSyncService');

  test('Privacy Guard rejects non-cloud notes from Google Drive upload', () => {
    assert.throws(() => {
      rejectGoogleUpload({ id: 'note_1', title: 'Local Note', sync_mode: 'local' });
    }, /CRITICAL PRIVACY VIOLATION REJECTED/);

    assert.throws(() => {
      rejectGoogleUpload({ id: 'note_2', title: 'LAN Note', sync_mode: 'lan' });
    }, /CRITICAL PRIVACY VIOLATION REJECTED/);

    assert.doesNotThrow(() => {
      rejectGoogleUpload({ id: 'note_3', title: 'Cloud Note', sync_mode: 'cloud' });
    });

    assert.doesNotThrow(() => {
      rejectGoogleUpload({ id: 'note_4', title: 'Google Note', sync_mode: 'google' });
    });
  });

  // 3. Verify error message for insufficient permissions & insufficientScopes
  const { NoteModel } = require('../src/db/database');
  const { syncSingleNoteWithGoogleDrive } = require('../src/utils/googleSyncService');

  await asyncTest('syncSingleNoteWithGoogleDrive records SYNC_FAILED on Drive permission error', async () => {
    const testUserId = 'usr_test_permission_fail';
    const testNoteId = `note_test_${Date.now()}`;
    const testFilePath = path.join(__dirname, `../data/test_file_${Date.now()}.md`);
    fs.mkdirSync(path.join(__dirname, '../data'), { recursive: true });
    fs.writeFileSync(testFilePath, '# Test Cloud Content');

    try {
      NoteModel.create(testNoteId, 'Test Cloud Note', testFilePath, null, 'hash123', null, testUserId, 'cloud');
      
      try {
        await syncSingleNoteWithGoogleDrive(testUserId, testNoteId);
        assert.fail('Expected sync to throw error since no real access token is configured in test');
      } catch (err) {
        assert.ok(err.message, 'Error should be thrown');
      }

      const updated = NoteModel.getById(testNoteId, testUserId);
      assert.strictEqual(updated.sync_state, 'SYNC_FAILED', 'sync_state must be updated to SYNC_FAILED');
      assert.ok(updated.sync_error, 'sync_error must record failure details');

    } finally {
      try {
        if (fs.existsSync(testFilePath)) fs.unlinkSync(testFilePath);
        NoteModel.delete(testNoteId, testUserId);
      } catch (e) {}
    }
  });

  console.log('\n==================================================');
  console.log(` SUMMARY: ${passed} PASSED / ${failed} FAILED`);
  console.log('==================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runGDriveSyncTests().catch((err) => {
  console.error('Test execution error:', err);
  process.exit(1);
});
