const express = require('express');
const router = express.Router();
const { NotebookModel, NoteModel } = require('../db/database');
const { getNoteFilePath, moveNoteFile } = require('../utils/fileStorage');

/**
 * @route   GET /api/notebooks
 * @desc    Fetch all notebooks with note counts
 */
router.get('/', (req, res) => {
  try {
    const notebooks = NotebookModel.getAll();
    res.json({ status: 'success', count: notebooks.length, data: notebooks });
  } catch (error) {
    console.error('Error fetching notebooks:', error);
    res.status(500).json({ status: 'error', message: 'Failed to fetch notebooks' });
  }
});

/**
 * @route   POST /api/notebooks
 * @desc    Create a new notebook
 */
router.post('/', (req, res) => {
  try {
    const { name } = req.body;
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ status: 'error', message: 'Notebook name is required' });
    }

    const id = `nb_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const newNotebook = NotebookModel.create(id, name.trim());

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
 * @desc    Rename an existing notebook & move physical note files on disk
 */
router.put('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;

    if (!name || typeof name !== 'string') {
      return res.status(400).json({ status: 'error', message: 'Notebook name is required' });
    }

    const oldNb = NotebookModel.getById(id);
    if (!oldNb) {
      return res.status(404).json({ status: 'error', message: 'Notebook not found' });
    }

    const newName = name.trim();
    const updatedNotebook = NotebookModel.rename(id, newName);

    // Relocate physical files belonging to this notebook
    const notesInNb = NoteModel.getAll(id);
    notesInNb.forEach((note) => {
      const newPath = getNoteFilePath(note.title, newName);
      if (note.file_path !== newPath) {
        moveNoteFile(note.file_path, newPath);
        NoteModel.update(note.id, note.title, newPath, note.notebook_id, note.content_hash, note.current_version_id);
      }
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
 * @desc    Delete a notebook & move physical files to Unassigned folder
 */
router.delete('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const oldNb = NotebookModel.getById(id);

    if (!oldNb) {
      return res.status(404).json({ status: 'error', message: 'Notebook not found' });
    }

    // Move associated physical files to Unassigned folder
    const notesInNb = NoteModel.getAll(id);
    notesInNb.forEach((note) => {
      const unassignedPath = getNoteFilePath(note.title, 'Unassigned');
      if (note.file_path !== unassignedPath) {
        moveNoteFile(note.file_path, unassignedPath);
        NoteModel.update(note.id, note.title, unassignedPath, null, note.content_hash, note.current_version_id);
      }
    });

    // Delete notebook metadata row
    NotebookModel.delete(id);

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
