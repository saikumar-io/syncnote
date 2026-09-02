const express = require('express');
const router = express.Router();
const { NoteModel, NotebookModel, VersionModel, SessionModel, SyncQueueModel } = require('../db/database');
const { 
  getNoteFilePath, 
  writeNoteFile, 
  readNoteFile, 
  moveNoteFile, 
  deleteNoteFile, 
  calculateHash 
} = require('../utils/fileStorage');
const {
  computeLineDiffHunks,
  reconstructVersionContent,
  getDiffViewData
} = require('../utils/versionControl');
const { requireAuth } = require('../middleware/authMiddleware');

// Require authentication for all Note & Version endpoints
router.use(requireAuth);

/**
 * Helper to get notebook name from ID for a specific user
 */
const getNotebookName = (notebookId, userId) => {
  if (!notebookId) return 'General Notes';
  const nb = NotebookModel.getById(notebookId, userId);
  return nb ? nb.name : 'General Notes';
};

/**
 * Helper to compute lightweight session recovery info
 */
const getNoteSessionInfo = (note, fileContent, userId) => {
  const latestVersion = VersionModel.getLatestForNote(note.id, userId);
  const currentHash = calculateHash(fileContent);
  const session = SessionModel.getByNoteId(note.id, userId);

  const isInterrupted = session && session.session_status === 'interrupted';
  const hasDiff = latestVersion ? (currentHash !== latestVersion.content_hash) : (fileContent.trim().length > 0);
  const isAcknowledged = session && session.session_status === 'acknowledged';

  const showRecovery = Boolean(isInterrupted && hasDiff && !isAcknowledged);

  return {
    has_uncheckpointed_changes: showRecovery,
    last_checkpoint_id: latestVersion ? latestVersion.id : null,
    last_checkpoint_number: latestVersion ? latestVersion.version_number : null,
    current_content_hash: currentHash,
    session_status: showRecovery ? 'interrupted' : (isAcknowledged ? 'acknowledged' : 'clean')
  };
};

/**
 * @route   GET /api/notes
 * @desc    Fetch all notes metadata from SQLite for authenticated user and attach content from .md files
 */
router.get('/', (req, res) => {
  try {
    const { notebook_id } = req.query;
    const metadataList = NoteModel.getAll(req.user.id, notebook_id || null);

    const notesWithContent = metadataList.map((meta) => {
      const fileContent = readNoteFile(meta.file_path);
      const sessionInfo = getNoteSessionInfo(meta, fileContent, req.user.id);
      return {
        ...meta,
        content: fileContent,
        session_info: sessionInfo
      };
    });

    res.json({ status: 'success', count: notesWithContent.length, data: notesWithContent });
  } catch (error) {
    console.error('Error fetching notes:', error);
    res.status(500).json({ status: 'error', message: 'Failed to fetch notes' });
  }
});

/**
 * @route   GET /api/notes/activity
 * @desc    Fetch aggregated global version activity for authenticated user
 */
router.get('/activity', (req, res) => {
  try {
    const activity = VersionModel.getGlobalActivity(req.user.id);
    res.json({ status: 'success', data: activity });
  } catch (error) {
    console.error('Error fetching global activity:', error);
    res.status(500).json({ status: 'error', message: 'Failed to fetch global activity' });
  }
});

/**
 * @route   GET /api/notes/global-history
 * @desc    Fetch global version history for authenticated user
 */
router.get('/global-history', (req, res) => {
  try {
    const history = VersionModel.getAllHistory(req.user.id);
    res.json({ status: 'success', data: history });
  } catch (error) {
    console.error('Error fetching global version history:', error);
    res.status(500).json({ status: 'error', message: 'Failed to fetch global version history' });
  }
});

/**
 * @route   GET /api/notes/:id
 * @desc    Fetch single note metadata for authenticated user
 */
router.get('/:id', (req, res) => {
  try {
    const meta = NoteModel.getById(req.params.id, req.user.id);
    if (!meta) {
      return res.status(404).json({ status: 'error', message: 'Note not found or access denied' });
    }

    const content = readNoteFile(meta.file_path);
    const sessionInfo = getNoteSessionInfo(meta, content, req.user.id);
    res.json({ status: 'success', data: { ...meta, content, session_info: sessionInfo } });
  } catch (error) {
    console.error('Error fetching note by ID:', error);
    res.status(500).json({ status: 'error', message: 'Failed to fetch note' });
  }
});

const { uploadNoteToGoogleDrive } = require('../utils/googleSyncService');

/**
 * @route   POST /api/notes
 * @desc    Create a new Markdown file and record SQLite metadata for authenticated user
 */
router.post('/', async (req, res) => {
  try {
    let { title, content, notebook_id, sync_mode } = req.body || {};
    if (typeof title === 'object' && title !== null) {
      notebook_id = title.notebook_id || notebook_id;
      content = title.content || content;
      sync_mode = title.sync_mode || sync_mode;
      title = title.title;
    }
    const finalTitle = (typeof title === 'string' && title.trim().length > 0) ? title.trim() : 'Untitled Note';
    const finalContent = typeof content === 'string' ? content : '';
    const finalNotebookId = notebook_id || null;
    const finalSyncMode = ['local', 'google', 'cloud', 'lan'].includes(sync_mode) ? (sync_mode === 'google' ? 'cloud' : sync_mode) : 'local';

    const nbName = getNotebookName(finalNotebookId, req.user.id);
    const filePath = getNoteFilePath(finalTitle, nbName);
    writeNoteFile(filePath, finalContent);

    const contentHash = calculateHash(finalContent);

    const id = `note_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const newMeta = NoteModel.create(id, finalTitle, filePath, finalNotebookId, contentHash, null, req.user.id, finalSyncMode);

    SessionModel.upsert(id, null, contentHash, finalContent.trim().length > 0 ? 'uncheckpointed' : 'clean', req.user.id);
    const sessionInfo = getNoteSessionInfo(newMeta, finalContent, req.user.id);

    // If sync_mode === 'google', attempt Google Drive sync upload
    if (finalSyncMode === 'google') {
      try {
        await uploadNoteToGoogleDrive(req.user.id, newMeta, finalContent);
      } catch (gErr) {
        console.warn(`[Note POST] Google Drive sync note notice: ${gErr.message}`);
      }
    }

    // Enqueue for Sync Engine
    SyncQueueModel.enqueue({
      entityType: 'NOTE',
      entityId: id,
      operation: 'CREATE_NOTE',
      payload: { id, title: finalTitle, content: finalContent, notebook_id: finalNotebookId, sync_mode: finalSyncMode }
    });

    res.status(201).json({ 
      status: 'success', 
      message: 'Note created successfully', 
      data: { ...newMeta, content: finalContent, session_info: sessionInfo } 
    });
  } catch (error) {
    console.error('Error creating note:', error);
    res.status(500).json({ status: 'error', message: 'Failed to create note' });
  }
});

/**
 * @route   PUT /api/notes/:id
 * @desc    Autosave: Update Markdown file content, move file if renamed, update metadata for user
 */
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    let { title, content, notebook_id, sync_mode } = req.body || {};

    if (typeof title === 'object' && title !== null) {
      notebook_id = title.notebook_id !== undefined ? title.notebook_id : notebook_id;
      content = title.content !== undefined ? title.content : content;
      sync_mode = title.sync_mode !== undefined ? title.sync_mode : sync_mode;
      title = title.title;
    }

    const existing = NoteModel.getById(id, req.user.id);
    if (!existing) {
      return res.status(404).json({ status: 'error', message: 'Note not found or access denied' });
    }

    const finalTitle = (typeof title === 'string') ? title : existing.title;
    const finalContent = (typeof content === 'string') ? content : readNoteFile(existing.file_path);
    const finalNotebookId = notebook_id !== undefined ? notebook_id : existing.notebook_id;
    const finalSyncMode = sync_mode !== undefined ? (['local', 'google', 'cloud', 'lan'].includes(sync_mode) ? (sync_mode === 'google' ? 'cloud' : sync_mode) : existing.sync_mode) : existing.sync_mode;

    const nbName = getNotebookName(finalNotebookId, req.user.id);
    let targetFilePath = existing.file_path;
    const expectedFilePath = getNoteFilePath(finalTitle, nbName);

    if (existing.file_path !== expectedFilePath) {
      moveNoteFile(existing.file_path, expectedFilePath);
      targetFilePath = expectedFilePath;
    }

    writeNoteFile(targetFilePath, finalContent);

    const newHash = calculateHash(finalContent);

    const updatedMeta = NoteModel.update(id, finalTitle, targetFilePath, finalNotebookId, newHash, existing.current_version_id, req.user.id, finalSyncMode);

    const latestVersion = VersionModel.getLatestForNote(id, req.user.id);
    const isClean = latestVersion ? (newHash === latestVersion.content_hash) : (finalContent.trim().length === 0);
    SessionModel.upsert(id, latestVersion ? latestVersion.id : null, newHash, 'clean', req.user.id);
    const sessionInfo = getNoteSessionInfo(updatedMeta, finalContent, req.user.id);

    // If note is or became cloud mode, sync upload to Google Drive
    if (finalSyncMode === 'cloud' || finalSyncMode === 'google') {
      try {
        await uploadNoteToGoogleDrive(req.user.id, updatedMeta, finalContent);
      } catch (gErr) {
        console.warn(`[Note PUT] Google Drive sync note notice: ${gErr.message}`);
      }
    }

    // Enqueue for Sync Engine (Coalesced update operation)
    SyncQueueModel.enqueue({
      entityType: 'NOTE',
      entityId: id,
      operation: 'UPDATE_NOTE',
      payload: { id, title: finalTitle, content: finalContent, notebook_id: finalNotebookId, sync_mode: finalSyncMode }
    });

    res.json({ 
      status: 'success', 
      message: 'Note updated successfully', 
      data: { ...updatedMeta, content: finalContent, session_info: sessionInfo } 
    });
  } catch (error) {
    console.error('Error updating note:', error);
    res.status(500).json({ status: 'error', message: 'Failed to update note' });
  }
});

/**
 * @route   DELETE /api/notes/:id
 * @desc    Delete physical .md file and SQLite metadata record for user
 */
router.delete('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const existing = NoteModel.getById(id, req.user.id);

    if (!existing) {
      return res.status(404).json({ status: 'error', message: 'Note not found or access denied' });
    }

    deleteNoteFile(existing.file_path);
    NoteModel.delete(id, req.user.id);

    // Enqueue for Sync Engine
    SyncQueueModel.enqueue({
      entityType: 'NOTE',
      entityId: id,
      operation: 'DELETE_NOTE',
      payload: { id }
    });

    res.json({ 
      status: 'success', 
      message: 'Note deleted successfully', 
      id 
    });
  } catch (error) {
    console.error('Error deleting note:', error);
    res.status(500).json({ status: 'error', message: 'Failed to delete note' });
  }
});

/* ==========================================================================
   SESSION RECOVERY ENDPOINTS
   ========================================================================== */

router.post('/:id/keep-recovery', (req, res) => {
  try {
    const { id } = req.params;
    const note = NoteModel.getById(id, req.user.id);
    if (!note) {
      return res.status(404).json({ status: 'error', message: 'Note not found or access denied' });
    }

    const fileContent = readNoteFile(note.file_path);
    const currentHash = calculateHash(fileContent);
    const latestVersion = VersionModel.getLatestForNote(id, req.user.id);

    SessionModel.upsert(id, latestVersion ? latestVersion.id : null, currentHash, 'acknowledged', req.user.id);
    const sessionInfo = getNoteSessionInfo(note, fileContent, req.user.id);

    res.json({
      status: 'success',
      message: 'Uncheckpointed changes kept for editing',
      data: {
        session_info: sessionInfo
      }
    });
  } catch (error) {
    console.error('Error keeping recovery:', error);
    res.status(500).json({ status: 'error', message: 'Failed to keep uncheckpointed changes' });
  }
});

router.post('/:id/discard-recovery', (req, res) => {
  try {
    const { id } = req.params;
    const note = NoteModel.getById(id, req.user.id);
    if (!note) {
      return res.status(404).json({ status: 'error', message: 'Note not found or access denied' });
    }

    const latestVersion = VersionModel.getLatestForNote(id, req.user.id);
    let restoredContent = '';
    if (latestVersion) {
      restoredContent = reconstructVersionContent(latestVersion.id, VersionModel);
    }

    writeNoteFile(note.file_path, restoredContent);
    const restoredHash = calculateHash(restoredContent);

    const updatedNote = NoteModel.update(id, undefined, undefined, undefined, restoredHash, latestVersion ? latestVersion.id : null, req.user.id);
    SessionModel.upsert(id, latestVersion ? latestVersion.id : null, restoredHash, 'clean', req.user.id);

    res.json({
      status: 'success',
      message: 'Discarded changes and restored note to latest checkpoint',
      data: {
        ...updatedNote,
        content: restoredContent,
        session_info: getNoteSessionInfo(updatedNote, restoredContent, req.user.id)
      }
    });
  } catch (error) {
    console.error('Error discarding recovery:', error);
    res.status(500).json({ status: 'error', message: 'Failed to discard uncheckpointed changes' });
  }
});

/* ==========================================================================
   VERSION CONTROL ENDPOINTS
   ========================================================================== */

router.get('/:id/history', (req, res) => {
  try {
    const { id } = req.params;
    const note = NoteModel.getById(id, req.user.id);
    if (!note) {
      return res.status(404).json({ status: 'error', message: 'Note not found or access denied' });
    }

    const history = VersionModel.getHistory(id, req.user.id);
    res.json({ status: 'success', data: history });
  } catch (error) {
    console.error('Error fetching version history:', error);
    res.status(500).json({ status: 'error', message: 'Failed to fetch version history' });
  }
});

router.get('/:id/versions/:versionId', (req, res) => {
  try {
    const { id, versionId } = req.params;
    console.log(`[VersionPreview] noteId: ${id}, versionId: ${versionId}`);

    const note = NoteModel.getById(id, req.user.id);
    if (!note) {
      return res.status(404).json({ status: 'error', message: 'Note not found or access denied' });
    }

    const version = VersionModel.getById(versionId, req.user.id);
    if (!version) {
      return res.status(404).json({ status: 'error', message: 'Version not found or access denied' });
    }

    const diffRecord = VersionModel.getDiffByVersionId(versionId, req.user.id);
    console.log(`[VersionPreview] versionNumber: ${version.version_number}, diff found: ${!!diffRecord}`);

    const content = reconstructVersionContent(versionId, VersionModel, req.user.id);
    console.log(`[VersionPreview] reconstructed content length: ${content ? content.length : 0}`);

    const responseData = {
      ...version,
      version_number: version.version_number,
      created_at: version.created_at,
      content_hash: version.content_hash,
      message: version.message,
      content: content,
      version: version
    };

    res.json({ status: 'success', data: responseData });
  } catch (error) {
    console.error('[VersionPreview Error]: Failed to reconstruct version:', error);
    res.status(500).json({ status: 'error', message: error.message || 'Failed to reconstruct version' });
  }
});

router.get('/:id/versions/:versionId/diff', (req, res) => {
  try {
    const { id, versionId } = req.params;
    const note = NoteModel.getById(id, req.user.id);
    if (!note) {
      return res.status(404).json({ status: 'error', message: 'Note not found or access denied' });
    }

    const version = VersionModel.getById(versionId, req.user.id);
    if (!version) {
      return res.status(404).json({ status: 'error', message: 'Version not found or access denied' });
    }

    const diffData = getDiffViewData(versionId, VersionModel, req.user.id);
    res.json({ status: 'success', data: diffData });
  } catch (error) {
    console.error('Error fetching version diff:', error);
    res.status(500).json({ status: 'error', message: 'Failed to fetch version diff' });
  }
});

router.post('/:id/checkpoints', (req, res) => {
  try {
    const { id } = req.params;
    const { message, content } = req.body || {};

    const note = NoteModel.getById(id, req.user.id);
    if (!note) {
      return res.status(404).json({ status: 'error', message: 'Note not found or access denied' });
    }

    let currentContent = content;
    if (currentContent === undefined) {
      currentContent = readNoteFile(note.file_path);
    } else {
      writeNoteFile(note.file_path, currentContent);
    }

    const currentHash = calculateHash(currentContent);
    const latestVersion = VersionModel.getLatestForNote(id, req.user.id);

    if (latestVersion && latestVersion.content_hash === currentHash) {
      return res.json({ 
        status: 'no_change', 
        message: 'No changes since the last checkpoint.' 
      });
    }

    let previousContent = '';
    if (latestVersion) {
      previousContent = reconstructVersionContent(latestVersion.id, VersionModel);
    }

    const diffHunks = computeLineDiffHunks(previousContent, currentContent);

    const nextVersionNum = (latestVersion ? latestVersion.version_number : 0) + 1;
    const parentVersionId = latestVersion ? latestVersion.id : null;
    const versionId = `v${nextVersionNum}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const checkpointMsg = message && message.trim() ? message.trim() : `Checkpoint V${nextVersionNum}`;

    const versionData = {
      id: versionId,
      note_id: id,
      version_number: nextVersionNum,
      parent_version_id: parentVersionId,
      message: checkpointMsg,
      device_id: 'local_device',
      created_at: new Date().toISOString(),
      content_hash: currentHash,
      is_snapshot: 0,
      is_auto: 0
    };

    const createdVersion = VersionModel.createCheckpointTransaction(versionData, diffHunks, id, req.user.id);
    SessionModel.upsert(id, createdVersion.id, currentHash, 'clean', req.user.id);

    res.status(201).json({
      status: 'success',
      message: 'Checkpoint created',
      data: createdVersion
    });
  } catch (error) {
    console.error('[Checkpoint API Error]:', error);
    res.status(500).json({ 
      status: 'error', 
      message: error.message || 'Failed to create checkpoint' 
    });
  }
});

router.post('/:id/restore', (req, res) => {
  try {
    const { id } = req.params;
    const { version_id } = req.body;

    const note = NoteModel.getById(id, req.user.id);
    if (!note) {
      return res.status(404).json({ status: 'error', message: 'Note not found or access denied' });
    }

    const targetVersion = VersionModel.getById(version_id, req.user.id);
    if (!targetVersion) {
      return res.status(404).json({ status: 'error', message: 'Target version not found or access denied' });
    }

    const restoredContent = reconstructVersionContent(version_id, VersionModel);
    const restoredHash = calculateHash(restoredContent);

    writeNoteFile(note.file_path, restoredContent);

    const latestVersion = VersionModel.getLatestForNote(id, req.user.id);

    let currentContentBeforeRestore = '';
    if (latestVersion) {
      currentContentBeforeRestore = reconstructVersionContent(latestVersion.id, VersionModel);
    }

    const diffHunks = computeLineDiffHunks(currentContentBeforeRestore, restoredContent);

    const nextVersionNum = (latestVersion ? latestVersion.version_number : 0) + 1;
    const parentVersionId = latestVersion ? latestVersion.id : null;
    const newVersionId = `v${nextVersionNum}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const restoreMsg = `Restored from V${targetVersion.version_number}`;

    const versionData = {
      id: newVersionId,
      note_id: id,
      version_number: nextVersionNum,
      parent_version_id: parentVersionId,
      message: restoreMsg,
      device_id: 'local_device',
      created_at: new Date().toISOString(),
      content_hash: restoredHash,
      is_snapshot: 0
    };

    const newVersion = VersionModel.createCheckpointTransaction(versionData, diffHunks, id, req.user.id);

    res.json({
      status: 'success',
      message: `Restored version V${targetVersion.version_number} as V${newVersion.version_number}`,
      data: {
        version: newVersion,
        content: restoredContent
      }
    });
  } catch (error) {
    console.error('Error restoring version:', error);
    res.status(500).json({ status: 'error', message: 'Failed to restore version' });
  }
});

module.exports = router;
