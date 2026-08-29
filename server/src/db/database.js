const path = require('path');
const fs = require('fs');
const { 
  getNoteFilePath, 
  writeNoteFile, 
  calculateHash, 
  generateVersionId 
} = require('../utils/fileStorage');

// Ensure data directory exists
const dataDir = path.join(__dirname, '../../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'syncnote.db');
const backupDbPath = path.join(dataDir, 'syncnote.db.bak');

// Safe Automatic Database Backup before schema initialization
if (fs.existsSync(dbPath)) {
  try {
    fs.copyFileSync(dbPath, backupDbPath);
    console.log('[SQLite DB] Database backup created at syncnote.db.bak');
  } catch (err) {
    console.warn('[SQLite DB] Failed to create database backup:', err);
  }
}

let db;

// Dual driver initializer (better-sqlite3 or Node.js built-in node:sqlite)
try {
  const BetterSqlite3 = require('better-sqlite3');
  db = new BetterSqlite3(dbPath);
  db.pragma('journal_mode = WAL');
  console.log('[SQLite DB] Loaded via better-sqlite3');
} catch (err1) {
  try {
    const { DatabaseSync } = require('node:sqlite');
    db = new DatabaseSync(dbPath);
    db.exec('PRAGMA journal_mode = WAL;');
    console.log('[SQLite DB] Loaded via Node.js built-in node:sqlite module');
  } catch (err2) {
    console.error('CRITICAL: Neither better-sqlite3 nor node:sqlite could be loaded.', err1, err2);
    throw new Error('SQLite driver not available');
  }
}

// Initialize database schema and perform file-first migration
const initDatabase = () => {
  // 1. Create notebooks table
  db.exec(`
    CREATE TABLE IF NOT EXISTS notebooks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Ensure default notebook exists
  const nbCount = db.prepare("SELECT COUNT(*) as count FROM notebooks").get();
  if (nbCount && (nbCount.count === 0 || nbCount.count === '0')) {
    db.prepare("INSERT INTO notebooks (id, name) VALUES (?, ?)").run('nb_default', 'General Notes');
  }

  // 2. Check if legacy notes table exists with inline 'content' column
  const tableInfo = db.prepare("PRAGMA table_info(notes)").all();
  const hasContentCol = tableInfo.some((col) => col.name === 'content');

  if (hasContentCol) {
    console.log('[SQLite DB Migration] Migrating legacy SQLite notes to File-First Markdown storage...');
    // Fetch all existing notes with inline content
    const oldNotes = db.prepare("SELECT * FROM notes").all();
    const notebooksList = db.prepare("SELECT * FROM notebooks").all();
    const nbMap = {};
    notebooksList.forEach((nb) => { nbMap[nb.id] = nb.name; });

    const migratedData = oldNotes.map((note) => {
      const nbName = nbMap[note.notebook_id] || 'General Notes';
      const filePath = note.file_path || getNoteFilePath(note.title, nbName);
      const noteContent = note.content || '';
      
      // Write content into physical .md file
      writeNoteFile(filePath, noteContent);
      const contentHash = calculateHash(noteContent);
      const versionId = generateVersionId();

      return {
        id: note.id,
        title: note.title || 'Untitled Note',
        file_path: filePath,
        notebook_id: note.notebook_id || null,
        created_at: note.created_at || new Date().toISOString(),
        updated_at: note.updated_at || new Date().toISOString(),
        current_version_id: versionId,
        content_hash: contentHash
      };
    });

    // Recreate notes table without inline content column
    db.exec("DROP TABLE notes;");
    db.exec(`
      CREATE TABLE notes (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        file_path TEXT NOT NULL,
        notebook_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        current_version_id TEXT,
        content_hash TEXT
      );
    `);

    // Insert migrated note records
    const insertStmt = db.prepare(`
      INSERT INTO notes (id, title, file_path, notebook_id, created_at, updated_at, current_version_id, content_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    migratedData.forEach((n) => {
      insertStmt.run(n.id, n.title, n.file_path, n.notebook_id, n.created_at, n.updated_at, n.current_version_id, n.content_hash);
    });

    console.log(`[SQLite DB Migration] Successfully exported ${migratedData.length} notes to .md files & updated metadata schema.`);
  } else {
    // Standard schema creation if table doesn't exist
    db.exec(`
      CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        file_path TEXT NOT NULL,
        notebook_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        current_version_id TEXT,
        content_hash TEXT
      );
    `);
  }

  console.log('[SQLite DB] File-first database schema ready.');
};

initDatabase();

// Notebook Operations Helper Methods
const NotebookModel = {
  getAll: () => {
    const stmt = db.prepare(`
      SELECT n.*, 
        (SELECT COUNT(*) FROM notes WHERE notebook_id = n.id) as note_count 
      FROM notebooks n 
      ORDER BY created_at ASC
    `);
    return stmt.all();
  },

  getById: (id) => {
    const stmt = db.prepare('SELECT * FROM notebooks WHERE id = ?');
    return stmt.get(id);
  },

  create: (id, name) => {
    const stmt = db.prepare('INSERT INTO notebooks (id, name) VALUES (?, ?)');
    stmt.run(id, name || 'New Notebook');
    return NotebookModel.getById(id);
  },

  rename: (id, name) => {
    const stmt = db.prepare('UPDATE notebooks SET name = ? WHERE id = ?');
    stmt.run(name, id);
    return NotebookModel.getById(id);
  },

  delete: (id) => {
    db.prepare('UPDATE notes SET notebook_id = NULL WHERE notebook_id = ?').run(id);
    const stmt = db.prepare('DELETE FROM notebooks WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }
};

// Note Operations Helper Methods (Metadata indexing layer)
const NoteModel = {
  getAll: (notebookId = null) => {
    if (notebookId) {
      const stmt = db.prepare('SELECT * FROM notes WHERE notebook_id = ? ORDER BY updated_at DESC');
      return stmt.all(notebookId);
    }
    const stmt = db.prepare('SELECT * FROM notes ORDER BY updated_at DESC');
    return stmt.all();
  },

  getById: (id) => {
    const stmt = db.prepare('SELECT * FROM notes WHERE id = ?');
    return stmt.get(id);
  },

  create: (id, title, filePath, notebookId, contentHash, currentVersionId) => {
    const now = new Date().toISOString();
    const stmt = db.prepare(`
      INSERT INTO notes (id, title, file_path, notebook_id, created_at, updated_at, current_version_id, content_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(id, title || 'Untitled Note', filePath, notebookId || null, now, now, currentVersionId, contentHash);
    return NoteModel.getById(id);
  },

  update: (id, title, filePath, notebookId, contentHash, currentVersionId) => {
    const now = new Date().toISOString();
    const existing = NoteModel.getById(id);
    if (!existing) return null;

    const finalTitle = title !== undefined ? title : existing.title;
    const finalFilePath = filePath !== undefined ? filePath : existing.file_path;
    const finalNotebookId = notebookId !== undefined ? notebookId : existing.notebook_id;
    const finalHash = contentHash !== undefined ? contentHash : existing.content_hash;
    const finalVersion = currentVersionId !== undefined ? currentVersionId : existing.current_version_id;

    const stmt = db.prepare(`
      UPDATE notes 
      SET title = ?, file_path = ?, notebook_id = ?, content_hash = ?, current_version_id = ?, updated_at = ?
      WHERE id = ?
    `);
    stmt.run(finalTitle, finalFilePath, finalNotebookId, finalHash, finalVersion, now, id);
    return NoteModel.getById(id);
  },

  delete: (id) => {
    const stmt = db.prepare('DELETE FROM notes WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }
};

module.exports = { db, NoteModel, NotebookModel };
