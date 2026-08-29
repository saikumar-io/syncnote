const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Configurable root directory for physical Markdown note storage
const NOTES_ROOT = path.join(__dirname, '../../../notes');

// Ensure root notes directory exists
if (!fs.existsSync(NOTES_ROOT)) {
  fs.mkdirSync(NOTES_ROOT, { recursive: true });
}

/**
 * Convert title to safe filename (e.g. "My Note!" -> "my-note.md")
 */
const sanitizeFilename = (title) => {
  const clean = (title || 'untitled')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
  return `${clean || 'untitled'}.md`;
};

/**
 * Sanitize folder name for notebooks
 */
const sanitizeFolderName = (notebookName) => {
  if (!notebookName || notebookName.trim() === '') return 'Unassigned';
  return notebookName
    .trim()
    .replace(/[^a-zA-Z0-9\s_-]/g, '')
    .replace(/\s+/g, ' ');
};

/**
 * Calculate SHA-256 content hash
 */
const calculateHash = (content = '') => {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
};

/**
 * Generate initial version ID
 */
const generateVersionId = () => {
  return `v1_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
};

/**
 * Resolve full path for a note file given notebook name and title
 */
const getNoteFilePath = (title, notebookName = 'Unassigned') => {
  const folderName = sanitizeFolderName(notebookName);
  const folderPath = path.join(NOTES_ROOT, folderName);
  if (!fs.existsSync(folderPath)) {
    fs.mkdirSync(folderPath, { recursive: true });
  }

  const fileName = sanitizeFilename(title);
  return path.join(folderPath, fileName);
};

/**
 * Write Markdown content to disk
 */
const writeNoteFile = (filePath, content = '') => {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, content, 'utf8');
};

/**
 * Read Markdown content from disk
 */
const readNoteFile = (filePath) => {
  try {
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf8');
    }
  } catch (err) {
    console.error(`[FileStorage] Error reading file ${filePath}:`, err);
  }
  return '';
};

/**
 * Move or rename Markdown note file
 */
const moveNoteFile = (oldPath, newPath) => {
  if (!oldPath || oldPath === newPath) return;
  try {
    if (fs.existsSync(oldPath)) {
      const newDir = path.dirname(newPath);
      if (!fs.existsSync(newDir)) {
        fs.mkdirSync(newDir, { recursive: true });
      }
      fs.renameSync(oldPath, newPath);
    }
  } catch (err) {
    console.error(`[FileStorage] Error moving file from ${oldPath} to ${newPath}:`, err);
  }
};

/**
 * Delete Markdown note file from disk
 */
const deleteNoteFile = (filePath) => {
  try {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (err) {
    console.error(`[FileStorage] Error deleting file ${filePath}:`, err);
  }
};

module.exports = {
  NOTES_ROOT,
  sanitizeFilename,
  sanitizeFolderName,
  calculateHash,
  generateVersionId,
  getNoteFilePath,
  writeNoteFile,
  readNoteFile,
  moveNoteFile,
  deleteNoteFile
};
