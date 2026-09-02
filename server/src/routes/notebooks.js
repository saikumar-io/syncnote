const express = require('express');
const router = express.Router();
const { NotebookModel, NoteModel, SyncQueueModel } = require('../db/database');
const { getNoteFilePath, moveNoteFile } = require('../utils/fileStorage');
const { requireAuth } = require('../middleware/authMiddleware');

// Apply Auth Protection to all Notebook routes
router.use(requireAuth);

/**
 * @route   GET /api/notebooks
 * @desc    Fetch all notebooks belonging to authenticated user
 */
router.get('/', (req, res) => {
  try {
    const notebooks = NotebookModel.getAll(req.user.id);
    res.json({ status: 'success', count: notebooks.length, data: notebooks });
  } catch (error) {
    console.error('Error fetching notebooks:', error);
    res.status(500).json({ status: 'error', message: 'Failed to fetch notebooks' });
  }
});

/**
 * @route   POST /api/notebooks
 * @desc    Create a new notebook for authenticated user
 */
router.post('/', (req, res) => {
  try {
    const { name } = req.body;
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ status: 'error', message: 'Notebook name is required' });
    }

    const id = `nb_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const newNotebook = NotebookModel.create(id, name.trim(), req.user.id);

    SyncQueueModel.enqueue({
      entityType: 'FOLDER',
      entityId: id,
      operation: 'CREATE_FOLDER',
      payload: { id, name: name.trim() }
    });

    res.status(201).json({ 
      status: 'success', 
      message: 'Notebook created successfully', 
      data: newNotebook 
    });
  } catch (error) {
    console.error('Error creating notebook:', error);
    res.status(500).json({ status: 'error', message: 'Failed to create notebook' });
  }
});

/**
 * @route   PUT /api/notebooks/:id
 * @desc    Rename an existing notebook belonging to user & move physical files
 */
router.put('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;

    if (!name || typeof name !== 'string') {
      return res.status(400).json({ status: 'error', message: 'Notebook name is required' });
    }

    const oldNb = NotebookModel.getById(id, req.user.id);
    if (!oldNb) {
      return res.status(404).json({ status: 'error', message: 'Notebook not found or access denied' });
    }

    const newName = name.trim();
    const updatedNotebook = NotebookModel.rename(id, newName, req.user.id);

    // Relocate physical files belonging to this notebook
    const notesInNb = NoteModel.getAll(req.user.id, id);
    notesInNb.forEach((note) => {
      const newPath = getNoteFilePath(note.title, newName);
      if (note.file_path !== newPath) {
        moveNoteFile(note.file_path, newPath);
        NoteModel.update(note.id, note.title, newPath, note.notebook_id, note.content_hash, note.current_version_id, req.user.id);
      }
    });

    SyncQueueModel.enqueue({
      entityType: 'FOLDER',
      entityId: id,
      operation: 'UPDATE_FOLDER',
      payload: { id, name: newName }
    });

    res.json({ 
      status: 'success', 
      message: 'Notebook renamed successfully', 
      data: updatedNotebook 
    });
  } catch (error) {
    console.error('Error renaming notebook:', error);
    res.status(500).json({ status: 'error', message: 'Failed to rename notebook' });
  }
});

/**
 * @route   DELETE /api/notebooks/:id
 * @desc    Delete a notebook belonging to user & move physical files to Unassigned
 */
router.delete('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const oldNb = NotebookModel.getById(id, req.user.id);

    if (!oldNb) {
      return res.status(404).json({ status: 'error', message: 'Notebook not found or access denied' });
    }

    const notesInNb = NoteModel.getAll(req.user.id, id);
    notesInNb.forEach((note) => {
      const unassignedPath = getNoteFilePath(note.title, 'Unassigned');
      if (note.file_path !== unassignedPath) {
        moveNoteFile(note.file_path, unassignedPath);
        NoteModel.update(note.id, note.title, unassignedPath, null, note.content_hash, note.current_version_id, req.user.id);
      }
    });

    NotebookModel.delete(id, req.user.id);

    SyncQueueModel.enqueue({
      entityType: 'FOLDER',
      entityId: id,
      operation: 'DELETE_FOLDER',
      payload: { id }
    });

    res.json({ 
      status: 'success', 
      message: 'Notebook deleted successfully', 
      id 
    });
  } catch (error) {
    console.error('Error deleting notebook:', error);
    res.status(500).json({ status: 'error', message: 'Failed to delete notebook' });
  }
});

module.exports = router;
