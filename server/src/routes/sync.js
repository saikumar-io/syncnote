const express = require('express');
const router = express.Router();
const { requireAuth, optionalAuth } = require('../middleware/authMiddleware');
const { 
  SyncQueueModel, 
  NoteModel, 
  NotebookModel,
  LanPairingModel
} = require('../db/database');
const { writeNoteFile, deleteNoteFile, readNoteFile } = require('../utils/fileStorage');

const { 
  uploadNoteToGoogleDrive,
  getGoogleAccountStatus,
  getGoogleDriveStatus,
  syncUserNotesWithGoogleDrive,
  syncSingleNoteWithGoogleDrive,
  getPendingGoogleSyncItems,
  checkGoogleDriveReachability
} = require('../utils/googleSyncService');

// GET /api/sync/gdrive/status - Authoritative Google Drive status endpoint
router.get('/gdrive/status', optionalAuth, async (req, res) => {
  try {
    const userId = req.user ? req.user.id : 'usr_local_default';
    const drive = getGoogleDriveStatus(userId);
    const pendingItems = getPendingGoogleSyncItems(userId);
    return res.json({
      connected: drive.connected,
      email: drive.email,
      folderName: drive.folderName || 'SyncNote',
      folderId: drive.folderId || null,
      pendingCount: pendingItems ? pendingItems.length : 0,
      authorizedAt: drive.authorizedAt
    });
  } catch (err) {
    return res.status(200).json({ connected: false, error: 'Failed to retrieve Google Drive status', details: err.message });
  }
});

// POST /api/sync/gdrive/sync or /api/sync/gdrive/sync-now - Trigger Google Drive sync pass
router.post(['/gdrive/sync', '/gdrive/sync-now'], optionalAuth, async (req, res) => {
  try {
    const userId = req.user ? req.user.id : 'usr_local_default';
    const { noteId } = req.body || {};

    if (noteId) {
      const result = await syncSingleNoteWithGoogleDrive(userId, noteId);
      return res.json({
        success: true,
        message: 'Single note synced to Google Drive.',
        result
      });
    }

    const result = await syncUserNotesWithGoogleDrive(userId);
    return res.json({
      success: true,
      message: 'Google Drive sync pass completed.',
      result
    });
  } catch (err) {
    console.error('Google Drive Sync Error:', err);
    return res.status(500).json({ error: 'Google Drive sync failed', details: err.message });
  }
});

// POST /api/sync/gdrive/notes/:noteId/sync - Note-specific Google Drive sync
router.post('/gdrive/notes/:noteId/sync', optionalAuth, async (req, res) => {
  try {
    const userId = req.user ? req.user.id : 'usr_local_default';
    const { noteId } = req.params;
    const result = await syncSingleNoteWithGoogleDrive(userId, noteId);
    return res.json({
      success: true,
      message: 'Note synchronized with Google Drive.',
      result
    });
  } catch (err) {
    console.error(`Google Drive Sync Error for note ${req.params.noteId}:`, err);
    return res.status(500).json({ error: 'Google Drive note sync failed', details: err.message });
  }
});

// GET /api/sync/gdrive/pending - List Google notes modified offline or conflicting
router.get('/gdrive/pending', optionalAuth, async (req, res) => {
  try {
    const userId = req.user ? req.user.id : 'usr_local_default';
    const pending = getPendingGoogleSyncItems(userId);
    return res.json({
      success: true,
      pendingCount: pending.length,
      items: pending
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch pending sync items', details: err.message });
  }
});

// GET /api/sync/gdrive/reachability - Check Google Drive reachability
router.get('/gdrive/reachability', optionalAuth, async (req, res) => {
  try {
    const userId = req.user ? req.user.id : 'usr_local_default';
    const status = await checkGoogleDriveReachability(userId);
    return res.json(status);
  } catch (err) {
    return res.status(200).json({ reachable: false, connected: false, error: err.message });
  }
});

// GET /api/sync/status - Returns sync status and pending stats
router.get('/status', optionalAuth, async (req, res) => {
  try {
    const userId = req.user ? req.user.id : 'usr_local_default';
    const stats = SyncQueueModel.getStats();
    const allNotes = NoteModel.getAll(userId);
    const googleAccount = getGoogleAccountStatus(userId);
    const googleDrive = getGoogleDriveStatus(userId);
    const pairedDevices = LanPairingModel.getPairedDevices(userId);
    const pendingGoogleItems = getPendingGoogleSyncItems(userId);

    const breakdown = {
      local: allNotes.filter(n => n.sync_mode === 'local').length,
      google: allNotes.filter(n => n.sync_mode === 'google' || n.sync_mode === 'cloud').length,
      lan: allNotes.filter(n => n.sync_mode === 'lan').length
    };

    return res.json({
      status: 'ok',
      userId: req.user ? req.user.id : 'usr_local_default',
      authenticated: Boolean(req.user),
      googleAccount,
      googleDrive,
      onlineSyncConnected: Boolean(googleDrive.connected),
      gdriveFolderName: 'SyncNote',
      lanSync: {
        available: true,
        pairedDevicesCount: pairedDevices.length
      },
      pendingCount: stats.pendingCount + pendingGoogleItems.length,
      pendingGoogleCount: pendingGoogleItems.length,
      syncedCount: stats.syncedCount,
      lastSyncedAt: stats.lastSyncedAt,
      breakdown
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch sync status', details: err.message });
  }
});

// POST /api/sync/gdrive/resolve-conflict - Resolve a sync conflict
router.post('/gdrive/resolve-conflict', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { noteId, choice } = req.body; // 'keep_local' | 'keep_cloud'

    if (!noteId || !choice) {
      return res.status(400).json({ error: 'Missing noteId or choice parameter.' });
    }

    const note = NoteModel.getById(noteId, userId);
    if (!note) {
      return res.status(404).json({ error: 'Note not found.' });
    }

    if (choice === 'keep_local') {
      const currentContent = readNoteFile(note.file_path);
      const { calculateHash } = require('../utils/fileStorage');
      const hash = calculateHash(currentContent);

      NoteModel.updateSyncMetadata(note.id, userId, {
        lastSyncedHash: hash,
        lastSyncedAt: new Date().toISOString(),
        syncState: 'SYNCED',
        syncError: null
      });

      // Force push to Drive
      await uploadNoteToGoogleDrive(userId, note, currentContent);
    } else if (choice === 'keep_cloud') {
      // Mark as synced with current remote version
      const currentContent = readNoteFile(note.file_path);
      const { calculateHash } = require('../utils/fileStorage');
      const hash = calculateHash(currentContent);

      NoteModel.updateSyncMetadata(note.id, userId, {
        lastSyncedHash: hash,
        lastSyncedAt: new Date().toISOString(),
        syncState: 'SYNCED',
        syncError: null
      });
    }

    return res.json({ success: true, message: `Conflict resolved using ${choice}.` });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to resolve conflict', details: err.message });
  }
});

// POST /api/sync/push - Push local pending changes to backend/cloud
router.post('/push', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const items = SyncQueueModel.getPending();

    const syncedIds = [];
    const failedIds = [];

    for (const item of items) {
      SyncQueueModel.markSyncing(item.id);
      try {
        let payload = item.payload;
        if (typeof payload === 'string') {
          payload = JSON.parse(payload);
        }

        switch (item.operation) {
          case 'CREATE_NOTE':
          case 'UPDATE_NOTE': {
            if (payload.id && payload.content !== undefined) {
              const note = NoteModel.getById(payload.id, userId);
              if (note) {
                writeNoteFile(note.file_path, payload.content);

                // If note has sync_mode === 'google', push to Google Drive dedicated app folder
                if (note.sync_mode === 'google') {
                  try {
                    await uploadNoteToGoogleDrive(userId, note, payload.content);
                  } catch (gErr) {
                    console.warn(`[Sync Queue Push] Google Drive sync note notice: ${gErr.message}`);
                  }
                }
              }
            }
            break;
          }
          case 'DELETE_NOTE': {
            if (payload.id) {
              const note = NoteModel.getById(payload.id, userId);
              if (note) {
                deleteNoteFile(note.file_path);
                NoteModel.delete(payload.id, userId);
              }
            }
            break;
          }
          case 'CREATE_FOLDER':
          case 'UPDATE_FOLDER': {
            if (payload.id && payload.name) {
              const existing = NotebookModel.getById(payload.id, userId);
              if (!existing) {
                NotebookModel.create(payload.id, payload.name, userId);
              } else {
                NotebookModel.rename(payload.id, payload.name, userId);
              }
            }
            break;
          }
          case 'DELETE_FOLDER': {
            if (payload.id) {
              NotebookModel.delete(payload.id, userId);
            }
            break;
          }
          default:
            break;
        }

        SyncQueueModel.markSynced(item.id);
        syncedIds.push(item.id);
      } catch (itemErr) {
        SyncQueueModel.markFailed(item.id, itemErr.message);
        failedIds.push({ id: item.id, error: itemErr.message });
      }
    }

    const updatedStats = SyncQueueModel.getStats();

    return res.json({
      success: true,
      syncedCount: syncedIds.length,
      syncedIds,
      failedIds,
      pendingCount: updatedStats.pendingCount,
      lastSyncedAt: updatedStats.lastSyncedAt
    });
  } catch (err) {
    return res.status(500).json({ error: 'Sync push failed', details: err.message });
  }
});

// GET /api/sync/pull - Pull incremental remote changes
router.get('/pull', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const cursor = req.query.cursor ? new Date(req.query.cursor).toISOString() : new Date(0).toISOString();

    const notes = NoteModel.getAll(userId).filter((n) => new Date(n.updated_at).toISOString() > cursor);
    const notebooks = NotebookModel.getAll(userId).filter((nb) => new Date(nb.created_at || 0).toISOString() > cursor);

    const notesWithContent = notes.map((note) => ({
      ...note,
      content: readNoteFile(note.file_path)
    }));

    return res.json({
      success: true,
      cursor: new Date().toISOString(),
      notes: notesWithContent,
      notebooks
    });
  } catch (err) {
    return res.status(500).json({ error: 'Sync pull failed', details: err.message });
  }
});

module.exports = router;
