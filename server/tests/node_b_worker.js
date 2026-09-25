/**
 * Node B Worker: Simulates a second physical laptop/node on the LAN
 * Runs with its own isolated SQLite database and isolated notes directory.
 */

const {
  db,
  NoteModel,
  NotebookModel,
  VersionModel,
  ConflictModel,
  LanPairingModel,
  SessionModel
} = require('../src/db/database');

const {
  writeNoteFile,
  readNoteFile,
  getNoteFilePath,
  calculateHash,
  generateVersionId
} = require('../src/utils/fileStorage');

const { computeLineDiffHunks } = require('../src/utils/versionControl');
const { createOrRecordConflict, resolveConflict } = require('../src/services/conflictResolutionService');
const lanRouter = require('../src/routes/lan');
const { applyIncomingNotesAndNotebooks, buildNotesWithResolutionMetadata } = lanRouter;

process.on('message', async ({ id, action, payload }) => {
  try {
    let result = null;

    if (action === 'SETUP_PEER') {
      const { peerId, peerName, userId } = payload;
      LanPairingModel.createPairing({
        id: peerId,
        deviceName: peerName,
        deviceIp: '127.0.0.1',
        devicePort: 5000,
        pairingToken: 'tok_devA',
        publicKey: 'pub_key_a',
        deviceType: 'laptop',
        userId,
        status: 'TRUSTED'
      });
      result = { paired: true };
    }

    else if (action === 'CREATE_NOTE_VERSION') {
      const { noteId, title, content, versionId, versionNumber, parentVersionId, message, userId } = payload;
      let notebook = NotebookModel.getAll(userId).find(n => n.name === 'General Notes');
      if (!notebook) {
        notebook = NotebookModel.create(`nb_b_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`, 'General Notes', userId);
      }
      const filePath = getNoteFilePath(title, 'General Notes');
      writeNoteFile(filePath, content);
      const hash = calculateHash(content);

      NoteModel.create(noteId, title, filePath, notebook.id, hash, versionId, userId, 'lan');

      const diffHunks = computeLineDiffHunks('', content);
      VersionModel.createCheckpointTransaction({
        id: versionId,
        note_id: noteId,
        version_number: versionNumber,
        parent_version_id: parentVersionId || null,
        message: message || `Version ${versionNumber}`,
        device_id: 'dev_b_laptop',
        created_at: new Date().toISOString(),
        content_hash: hash,
        is_snapshot: versionNumber === 1 || !parentVersionId ? 1 : 0,
        is_auto: 0
      }, diffHunks, noteId, userId);

      NoteModel.updateSyncMetadata(noteId, userId, {
        lastSyncedHash: hash,
        lastSyncedAt: new Date().toISOString(),
        syncState: 'SYNCED',
        syncError: null
      });

      result = { noteId, versionId, hash };
    }

    else if (action === 'RECORD_LOCAL_EDIT') {
      const { noteId, newContent, newVersionId, versionNumber, parentVersionId, message, userId } = payload;
      const note = NoteModel.getById(noteId, userId);
      const oldContent = readNoteFile(note.file_path);
      writeNoteFile(note.file_path, newContent);
      const newHash = calculateHash(newContent);

      const diffHunks = computeLineDiffHunks(oldContent, newContent);
      VersionModel.createCheckpointTransaction({
        id: newVersionId,
        note_id: noteId,
        version_number: versionNumber,
        parent_version_id: parentVersionId,
        message: message || `Edit V${versionNumber}`,
        device_id: 'dev_b_laptop',
        created_at: new Date().toISOString(),
        content_hash: newHash,
        is_snapshot: 0,
        is_auto: 0
      }, diffHunks, noteId, userId);

      NoteModel.update(noteId, note.title, note.file_path, note.notebook_id, newHash, newVersionId, userId, note.sync_mode);

      result = { noteId, newVersionId, newHash };
    }

    else if (action === 'RECORD_CONFLICT') {
      const { noteId, ancestorVerId, ancestorContent, localVerId, localContent, remoteVerId, remoteContent, remoteDeviceId, remoteDeviceName, userId } = payload;
      const conflict = await createOrRecordConflict({
        noteId,
        currentUserId: userId,
        ancestorVersionId: ancestorVerId,
        ancestorContent,
        localVersionId: localVerId,
        localContent,
        remoteVersionId: remoteVerId,
        remoteContent,
        remoteDeviceId,
        remoteDeviceName,
        syncSource: 'LAN'
      });
      result = { conflictId: conflict?.id, aiStatus: conflict?.ai_status };
    }

    else if (action === 'RECEIVE_LAN_SYNC') {
      const { notes, notebooks, senderDevice, userId } = payload;
      const syncResult = await applyIncomingNotesAndNotebooks(notes, notebooks, senderDevice, userId);
      result = syncResult;
    }

    else if (action === 'GET_OUTBOUND_PAYLOAD') {
      const { noteId, userId } = payload;
      const notes = NoteModel.getAll(userId).filter(n => n.id === noteId);
      const payloadNotes = buildNotesWithResolutionMetadata(notes, userId);
      result = { notes: payloadNotes };
    }

    else if (action === 'UPDATE_AI_STATUS') {
      const { conflictId, aiStatus, aiSuggestedMerge, userId } = payload;
      ConflictModel.updateAiStatus(conflictId, {
        aiStatus: aiStatus || 'AVAILABLE',
        aiSuggestedMerge
      }, userId);
      result = { updated: true };
    }

    else if (action === 'RESOLVE_CONFLICT') {
      const { conflictId, resolutionMethod, customContent, message, userId } = payload;
      const res = await resolveConflict({
        conflictId,
        userId,
        resolutionMethod,
        customContent,
        message
      });
      result = res;
    }

    else if (action === 'GET_NOTE_STATE') {
      const { noteId, userId } = payload;
      const note = NoteModel.getById(noteId, userId);
      const onDiskContent = note ? readNoteFile(note.file_path) : null;
      const latestVer = note ? VersionModel.getLatestForNote(noteId, userId) : null;
      const allVersions = note ? VersionModel.getHistory(noteId, userId) : [];
      const activeConflicts = ConflictModel.getByNoteId(noteId, userId, true);
      const allConflicts = ConflictModel.getByNoteId(noteId, userId, false);

      result = {
        note,
        onDiskContent,
        latestVer,
        allVersions,
        activeConflictsCount: activeConflicts.length,
        activeConflicts,
        allConflicts
      };
    }

    else if (action === 'VERIFY_RAW_DB') {
      const { noteId } = payload;
      const noteRow = db.prepare('SELECT * FROM notes WHERE id = ?').get(noteId);
      const activeConflicts = db.prepare("SELECT * FROM conflicts WHERE note_id = ? AND status = 'UNRESOLVED'").all(noteId);
      const allConflicts = db.prepare('SELECT * FROM conflicts WHERE note_id = ?').all(noteId);
      const versions = db.prepare('SELECT * FROM versions WHERE note_id = ? ORDER BY version_number ASC').all(noteId);

      result = {
        noteRow,
        activeConflictsCount: activeConflicts.length,
        allConflictsCount: allConflicts.length,
        allConflicts,
        versions
      };
    }

    else {
      throw new Error(`Unknown action: ${action}`);
    }

    process.send({ id, success: true, result });
  } catch (err) {
    process.send({ id, success: false, error: err.message, stack: err.stack });
  }
});
