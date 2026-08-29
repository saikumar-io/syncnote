const express = require('express');
const router = express.Router();
const { NoteModel, NotebookModel } = require('../db/database');
const { 
  getNoteFilePath, 
  writeNoteFile, 
  readNoteFile, 
  moveNoteFile, 
  deleteNoteFile, 
  calculateHash, 
  generateVersionId 
} = require('../utils/fileStorage');

/**
 * Helper to get notebook name from ID
 */
const getNotebookName = (notebookId) => {
  if (!notebookId) return 'General Notes';
  const nb = NotebookModel.getById(notebookId);
  return nb ? nb.name : 'General Notes';
};

/**
 * @route   GET /api/notes
 * @desc    Fetch all notes metadata from SQLite and attach content from .md files
 */
router.get('/', (req, res) => {
  try {
    const { notebook_id } = req.query;
    const metadataList = NoteModel.getAll(notebook_id || null);

    const notesWithContent = metadataList.map((meta) => {
      const fileContent = readNoteFile(meta.file_path);
      return {
        ...meta,
        content: fileContent
      };
    });

    res.json({ status: 'success', count: notesWithContent.length, data: notesWithContent });
  } catch (error) {
    console.error('Error fetching notes:', error);
    res.status(500).json({ status: 'error', message: 'Failed to fetch notes' });
  }
});

/**
 * @route   GET /api/notes/:id
 * @desc    Fetch single note metadata and read content from .md file
 */
router.get('/:id', (req, res) => {
  try {
    const meta = NoteModel.getById(req.params.id);
    if (!meta) {
      return res.status(404).json({ status: 'error', message: 'Note not found' });
    }

    const content = readNoteFile(meta.file_path);
    res.json({ status: 'success', data: { ...meta, content } });
  } catch (error) {
    console.error('Error fetching note by ID:', error);
    res.status(500).json({ status: 'error', message: 'Failed to fetch note' });
  }
});

/**
 * @route   POST /api/notes
 * @desc    Create a new Markdown file and record SQLite metadata
 */
router.post('/', (req, res) => {
  try {
    const { title, content, notebook_id } = req.body;
    const finalTitle = title || 'Untitled Note';
    const finalContent = content || '';
    const nbName = getNotebookName(notebook_id);

    // 1. Resolve .md file path and write physical file
    const filePath = getNoteFilePath(finalTitle, nbName);
    writeNoteFile(filePath, finalContent);

    // 2. Compute SHA-256 hash & version ID
    const contentHash = calculateHash(finalContent);
    const versionId = generateVersionId();

    // 3. Create metadata record in SQLite
    const id = `note_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const newMeta = NoteModel.create(id, finalTitle, filePath, notebook_id || null, contentHash, versionId);

    res.status(201).json({ 
      status: 'success', 
      message: 'Note created successfully', 
      data: { ...newMeta, content: finalContent } 
    });
  } catch (error) {
    console.error('Error creating note:', error);
    res.status(500).json({ status: 'error', message: 'Failed to create note' });
  }
});

/**
 * @route   PUT /api/notes/:id
 * @desc    Update Markdown file content, move file if renamed, update SQLite metadata
 */
router.put('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { title, content, notebook_id } = req.body;

    const existing = NoteModel.getById(id);
    if (!existing) {
      return res.status(404).json({ status: 'error', message: 'Note not found' });
    }

    const finalTitle = title !== undefined ? title : existing.title;
    const finalContent = content !== undefined ? content : readNoteFile(existing.file_path);
    const finalNotebookId = notebook_id !== undefined ? notebook_id : existing.notebook_id;

    // Check if file needs to be relocated (if title or notebook changed)
    const nbName = getNotebookName(finalNotebookId);
    let targetFilePath = existing.file_path;
    const expectedFilePath = getNoteFilePath(finalTitle, nbName);

    if (existing.file_path !== expectedFilePath) {
      moveNoteFile(existing.file_path, expectedFilePath);
      targetFilePath = expectedFilePath;
    }

    // Write updated content to .md file
    writeNoteFile(targetFilePath, finalContent);

    // Calculate content hash and update version ID if content changed
    const newHash = calculateHash(finalContent);
    let newVersionId = existing.current_version_id;
    if (newHash !== existing.content_hash) {
      newVersionId = generateVersionId();
    }

    // Update SQLite metadata
    const updatedMeta = NoteModel.update(id, finalTitle, targetFilePath, finalNotebookId, newHash, newVersionId);

    res.json({ 
      status: 'success', 
      message: 'Note updated successfully', 
      data: { ...updatedMeta, content: finalContent } 
    });
  } catch (error) {
    console.error('Error updating note:', error);
    res.status(500).json({ status: 'error', message: 'Failed to update note' });
  }
});

/**
 * @route   DELETE /api/notes/:id
 * @desc    Delete physical .md file and SQLite metadata record
 */
router.delete('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const existing = NoteModel.getById(id);

    if (!existing) {
      return res.status(404).json({ status: 'error', message: 'Note not found' });
    }

    // Unlink physical Markdown file from disk
    deleteNoteFile(existing.file_path);

    // Delete SQLite metadata record
    NoteModel.delete(id);

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

module.exports = router;
