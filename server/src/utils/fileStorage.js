const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Configurable root directory for physical Markdown note storage
const serverDataNotes = path.resolve(__dirname, '../../data/notes');
const NOTES_ROOT = process.env.NOTES_DIR
  ? (path.isAbsolute(process.env.NOTES_DIR) ? process.env.NOTES_DIR : path.resolve(__dirname, '../../', process.env.NOTES_DIR))
  : serverDataNotes;

// Ensure root notes directory exists
if (!fs.existsSync(NOTES_ROOT)) {
  fs.mkdirSync(NOTES_ROOT, { recursive: true });
}

/**
 * Resolve note file path reliably regardless of cwd
 */
const resolveFilePath = (filePath) => {
  if (!filePath) return '';
  if (path.isAbsolute(filePath)) return filePath;
  // If it exists directly relative to cwd, use it
  if (fs.existsSync(filePath)) return path.resolve(filePath);
  // Check relative to server folder
  const serverPath = path.resolve(__dirname, '../../', filePath);
  if (fs.existsSync(serverPath)) return serverPath;
  // Check relative to project root
  const rootPath = path.resolve(__dirname, '../../../', filePath);
  if (fs.existsSync(rootPath)) return rootPath;
  // Default to server-relative path
  return path.resolve(__dirname, '../../', filePath);
};

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
  let strContent = content;
  if (typeof strContent !== 'string') {
    if (strContent && typeof strContent === 'object' && strContent.content !== undefined) {
      strContent = String(strContent.content);
    } else if (strContent && typeof strContent === 'object' && strContent.text !== undefined) {
      strContent = String(strContent.text);
    } else {
      strContent = String(strContent || '');
    }
  }
  return crypto.createHash('sha256').update(strContent, 'utf8').digest('hex');
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
  let strContent = content;
  if (typeof strContent !== 'string') {
    if (strContent && typeof strContent === 'object' && strContent.content !== undefined) {
      strContent = String(strContent.content);
    } else if (strContent && typeof strContent === 'object' && strContent.text !== undefined) {
      strContent = String(strContent.text);
    } else {
      strContent = String(strContent || '');
    }
  }
  const resolved = resolveFilePath(filePath);
  const dir = path.dirname(resolved);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(resolved, strContent, 'utf8');
};

/**
 * Read Markdown content from disk
 */
const readNoteFile = (filePath) => {
  try {
    const resolved = resolveFilePath(filePath);
    if (resolved && fs.existsSync(resolved)) {
      return fs.readFileSync(resolved, 'utf8');
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
    const resolvedOld = resolveFilePath(oldPath);
    const resolvedNew = resolveFilePath(newPath);
    if (fs.existsSync(resolvedOld)) {
      const newDir = path.dirname(resolvedNew);
      if (!fs.existsSync(newDir)) {
        fs.mkdirSync(newDir, { recursive: true });
      }
      fs.renameSync(resolvedOld, resolvedNew);
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
    const resolved = resolveFilePath(filePath);
    if (resolved && fs.existsSync(resolved)) {
      fs.unlinkSync(resolved);
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
