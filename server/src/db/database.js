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
  // 0. Create users & devices tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT,
      auth_provider TEXT DEFAULT 'local',
      provider_user_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      device_name TEXT NOT NULL,
      device_type TEXT,
      last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
    CREATE INDEX IF NOT EXISTS idx_devices_user_id ON devices(user_id);

    CREATE TABLE IF NOT EXISTS google_drive_auths (
      user_id TEXT PRIMARY KEY,
      email TEXT,
      access_token TEXT,
      refresh_token TEXT,
      folder_id TEXT DEFAULT 'syncnote_gdrive_root_folder_id',
      folder_name TEXT DEFAULT 'SyncNote',
      is_connected INTEGER DEFAULT 1,
      authorized_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  try { db.exec("ALTER TABLE users ADD COLUMN auth_provider TEXT DEFAULT 'local';"); } catch (e) {}
  try { db.exec("ALTER TABLE users ADD COLUMN provider_user_id TEXT;"); } catch (e) {}

  // 1. Create notebooks table
  db.exec(`
    CREATE TABLE IF NOT EXISTS notebooks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      user_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Add user_id to notebooks if missing from older schema
  try {
    db.exec('ALTER TABLE notebooks ADD COLUMN user_id TEXT;');
  } catch (e) {
    // Column already exists
  }

  // 2. Check if legacy notes table exists with inline 'content' column
  const tableInfo = db.prepare("PRAGMA table_info(notes)").all();
  const hasContentCol = tableInfo.some((col) => col.name === 'content');

  if (hasContentCol) {
    console.log('[SQLite DB Migration] Migrating legacy SQLite notes to File-First Markdown storage...');
    const oldNotes = db.prepare("SELECT * FROM notes").all();
    const notebooksList = db.prepare("SELECT * FROM notebooks").all();
    const nbMap = {};
    notebooksList.forEach((nb) => { nbMap[nb.id] = nb.name; });

    const migratedData = oldNotes.map((note) => {
      const nbName = nbMap[note.notebook_id] || 'General Notes';
      const filePath = note.file_path || getNoteFilePath(note.title, nbName);
      const noteContent = note.content || '';
      
      writeNoteFile(filePath, noteContent);
      const contentHash = calculateHash(noteContent);
      const versionId = generateVersionId();

      return {
        id: note.id,
        title: note.title || 'Untitled Note',
        file_path: filePath,
        notebook_id: note.notebook_id || null,
        user_id: note.user_id || 'usr_local_default',
        created_at: note.created_at || new Date().toISOString(),
        updated_at: note.updated_at || new Date().toISOString(),
        current_version_id: versionId,
        content_hash: contentHash
      };
    });

    db.exec("DROP TABLE notes;");
    db.exec(`
      CREATE TABLE notes (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        file_path TEXT NOT NULL,
        notebook_id TEXT,
        user_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        current_version_id TEXT,
        content_hash TEXT
      );
    `);

    const insertStmt = db.prepare(`
      INSERT INTO notes (id, title, file_path, notebook_id, user_id, created_at, updated_at, current_version_id, content_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    migratedData.forEach((n) => {
      insertStmt.run(n.id, n.title, n.file_path, n.notebook_id, n.user_id, n.created_at, n.updated_at, n.current_version_id, n.content_hash);
    });

    console.log(`[SQLite DB Migration] Successfully exported ${migratedData.length} notes to .md files & updated metadata schema.`);
  } else {
    db.exec(`
      CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        file_path TEXT NOT NULL,
        notebook_id TEXT,
        user_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        current_version_id TEXT,
        content_hash TEXT
      );
    `);
  }

  // Add user_id column to notes if missing
  try {
    db.exec('ALTER TABLE notes ADD COLUMN user_id TEXT;');
  } catch (e) {
    // Column already exists
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_notes_user_id ON notes(user_id);
    CREATE INDEX IF NOT EXISTS idx_notebooks_user_id ON notebooks(user_id);
  `);

  // 3. Create version control tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS versions (
      id TEXT PRIMARY KEY,
      note_id TEXT NOT NULL,
      version_number INTEGER NOT NULL,
      parent_version_id TEXT,
      message TEXT,
      device_id TEXT DEFAULT 'local_device',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      content_hash TEXT NOT NULL,
      is_snapshot INTEGER DEFAULT 0,
      is_auto INTEGER DEFAULT 0,
      FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_version_id) REFERENCES versions(id)
    );

    CREATE TABLE IF NOT EXISTS version_diffs (
      id TEXT PRIMARY KEY,
      version_id TEXT NOT NULL,
      diff_data TEXT NOT NULL,
      FOREIGN KEY (version_id) REFERENCES versions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS sessions (
      note_id TEXT PRIMARY KEY,
      last_checkpoint_id TEXT,
      current_content_hash TEXT NOT NULL,
      last_saved_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      session_status TEXT DEFAULT 'clean',
      FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS sync_queue (
      id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      operation TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      status TEXT DEFAULT 'PENDING',
      retry_count INTEGER DEFAULT 0,
      last_error TEXT,
      synced_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS lan_paired_devices (
      id TEXT PRIMARY KEY,
      device_name TEXT NOT NULL,
      device_ip TEXT,
      pairing_token TEXT NOT NULL,
      user_id TEXT NOT NULL,
      status TEXT DEFAULT 'TRUSTED',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS device_selected_notes (
      device_id TEXT NOT NULL,
      note_id TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (device_id, note_id)
    );

    CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(status);
    CREATE INDEX IF NOT EXISTS idx_sync_queue_entity ON sync_queue(entity_type, entity_id);
    CREATE INDEX IF NOT EXISTS idx_lan_paired_user_id ON lan_paired_devices(user_id);
  `);

  try {
    db.exec('ALTER TABLE versions ADD COLUMN is_auto INTEGER DEFAULT 0;');
  } catch (err) {}

  // Sync Metadata & Mode Columns on notes and notebooks
  try {
    db.exec("ALTER TABLE notes ADD COLUMN sync_mode TEXT NOT NULL DEFAULT 'local';");
  } catch (e) {
    // Column already exists
  }

  try {
    db.exec("ALTER TABLE users ADD COLUMN avatar_url TEXT;");
  } catch (e) {}

  const syncCols = [
    'sync_status TEXT DEFAULT \'SYNCED\'',
    'remote_id TEXT',
    'remote_revision INTEGER DEFAULT 1',
    'local_updated_at DATETIME',
    'remote_updated_at DATETIME',
    'last_synced_at DATETIME',
    'gdrive_file_id TEXT',
    'last_synced_hash TEXT',
    'sync_state TEXT DEFAULT \'NOT_SYNCED\'',
    'sync_error TEXT'
  ];

  syncCols.forEach(col => {
    try { db.exec(`ALTER TABLE notes ADD COLUMN ${col};`); } catch (e) {}
    try { db.exec(`ALTER TABLE notebooks ADD COLUMN ${col};`); } catch (e) {}
  });

  // Ensure public_key and device_type exist on lan_paired_devices table
  try { db.exec("ALTER TABLE lan_paired_devices ADD COLUMN public_key TEXT;"); } catch (e) {}
  try { db.exec("ALTER TABLE lan_paired_devices ADD COLUMN device_type TEXT DEFAULT 'desktop';"); } catch (e) {}

  // Ensure default notebook exists
  const nbCount = db.prepare("SELECT COUNT(*) as count FROM notebooks").get();
  if (nbCount && (nbCount.count === 0 || nbCount.count === '0')) {
    db.prepare("INSERT INTO notebooks (id, name, user_id) VALUES (?, ?, ?)").run('nb_default', 'General Notes', 'usr_local_default');
  }

  // Safe Migration: Assign existing null user_id records to 'usr_local_default'
  db.prepare("UPDATE notebooks SET user_id = 'usr_local_default' WHERE user_id IS NULL").run();
  db.prepare("UPDATE notes SET user_id = 'usr_local_default' WHERE user_id IS NULL").run();

  console.log('[SQLite DB] File-first database schema ready with Auth, Version Control, Sync Queue & LAN Pairing tables.');
};

initDatabase();

// User Operations Helper Methods
const UserModel = {
  create: ({ id, email, username, passwordHash, avatarUrl }) => {
    const now = new Date().toISOString();
    const stmt = db.prepare(`
      INSERT INTO users (id, email, username, password_hash, avatar_url, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(id, email.toLowerCase().trim(), username.trim(), passwordHash, avatarUrl || null, now, now);
    return UserModel.findById(id);
  },

  findById: (id) => {
    const stmt = db.prepare('SELECT id, email, username, avatar_url, created_at, updated_at FROM users WHERE id = ?');
    return stmt.get(id);
  },

  findByEmail: (email) => {
    const stmt = db.prepare('SELECT * FROM users WHERE email = ?');
    return stmt.get(email.toLowerCase().trim());
  },

  findByUsername: (username) => {
    const stmt = db.prepare('SELECT * FROM users WHERE username = ?');
    return stmt.get(username.trim());
  },

  updateAvatar: (id, avatarUrl) => {
    const now = new Date().toISOString();
    const stmt = db.prepare('UPDATE users SET avatar_url = ?, updated_at = ? WHERE id = ?');
    stmt.run(avatarUrl, now, id);
    return UserModel.findById(id);
  },

  updatePassword: (id, passwordHash) => {
    const now = new Date().toISOString();
    const stmt = db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?');
    stmt.run(passwordHash, now, id);
    return UserModel.findById(id);
  },

  updateProfile: (id, { username }) => {
    const now = new Date().toISOString();
    const stmt = db.prepare('UPDATE users SET username = ?, updated_at = ? WHERE id = ?');
    stmt.run(username.trim(), now, id);
    return UserModel.findById(id);
  },

  assignUnownedDataToUser: (userId) => {
    if (!userId) return;
    db.prepare("UPDATE notebooks SET user_id = ? WHERE user_id = 'usr_local_default' OR user_id IS NULL").run(userId);
    db.prepare("UPDATE notes SET user_id = ? WHERE user_id = 'usr_local_default' OR user_id IS NULL").run(userId);
  },

  findOrCreateGoogleUser: ({ googleId, email, name, avatarUrl, id }) => {
    const cleanEmail = (email || '').trim().toLowerCase();
    
    // Check by googleId
    const byProvider = db.prepare('SELECT * FROM users WHERE auth_provider = ? AND provider_user_id = ?').get('google', String(googleId));
    if (byProvider) {
      if (avatarUrl && avatarUrl !== byProvider.avatar_url) {
        db.prepare('UPDATE users SET avatar_url = ?, updated_at = ? WHERE id = ?').run(avatarUrl, new Date().toISOString(), byProvider.id);
      }
      return UserModel.findById(byProvider.id);
    }

    // Check by email
    const byEmail = db.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail);
    if (byEmail) {
      db.prepare('UPDATE users SET auth_provider = ?, provider_user_id = ?, avatar_url = COALESCE(?, avatar_url), updated_at = ? WHERE id = ?')
        .run('google', String(googleId), avatarUrl || null, new Date().toISOString(), byEmail.id);
      return UserModel.findById(byEmail.id);
    }

    // Create new
    const userId = id || `usr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    let baseUsername = (name || cleanEmail.split('@')[0] || 'google_user').replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
    if (!baseUsername) baseUsername = 'google_user';
    let username = baseUsername;
    let counter = 1;

    while (db.prepare('SELECT id FROM users WHERE LOWER(username) = ?').get(username)) {
      username = `${baseUsername}_${counter++}`;
    }

    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO users (id, email, username, password_hash, auth_provider, provider_user_id, avatar_url, created_at, updated_at)
      VALUES (?, ?, ?, NULL, 'google', ?, ?, ?, ?)
    `).run(userId, cleanEmail, username, String(googleId), avatarUrl || null, now, now);

    return UserModel.findById(userId);
  }
};

// Device Operations Helper Methods
const DeviceModel = {
  upsert: ({ id, userId, deviceName, deviceType }) => {
    const now = new Date().toISOString();
    const stmt = db.prepare(`
      INSERT INTO devices (id, user_id, device_name, device_type, last_seen, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        user_id = excluded.user_id,
        device_name = excluded.device_name,
        device_type = excluded.device_type,
        last_seen = excluded.last_seen
    `);
    stmt.run(id, userId, deviceName || 'Desktop Computer', deviceType || 'desktop', now, now);
    return DeviceModel.getById(id);
  },

  getById: (id) => {
    const stmt = db.prepare('SELECT * FROM devices WHERE id = ?');
    return stmt.get(id);
  },

  getByUserId: (userId) => {
    const stmt = db.prepare('SELECT * FROM devices WHERE user_id = ? ORDER BY last_seen DESC');
    return stmt.all(userId);
  },

  updateLastSeen: (id) => {
    const now = new Date().toISOString();
    const stmt = db.prepare('UPDATE devices SET last_seen = ? WHERE id = ?');
    stmt.run(now, id);
  }
};

// Notebook Operations Helper Methods
const NotebookModel = {
  getAll: (userId) => {
    const stmt = db.prepare(`
      SELECT n.*, 
        (SELECT COUNT(*) FROM notes WHERE notebook_id = n.id AND (user_id = ? OR user_id = 'usr_local_default')) as note_count 
      FROM notebooks n 
      WHERE n.user_id = ? OR n.user_id = 'usr_local_default'
      ORDER BY created_at ASC
    `);
    return stmt.all(userId, userId);
  },

  getById: (id, userId) => {
    const stmt = db.prepare('SELECT * FROM notebooks WHERE id = ? AND (user_id = ? OR user_id = \'usr_local_default\')');
    return stmt.get(id, userId);
  },

  create: (id, name, userId) => {
    const stmt = db.prepare('INSERT INTO notebooks (id, name, user_id) VALUES (?, ?, ?)');
    stmt.run(id, name || 'New Notebook', userId || 'usr_local_default');
    return NotebookModel.getById(id, userId);
  },

  rename: (id, name, userId) => {
    const stmt = db.prepare('UPDATE notebooks SET name = ? WHERE id = ? AND (user_id = ? OR user_id = \'usr_local_default\')');
    stmt.run(name, id, userId);
    return NotebookModel.getById(id, userId);
  },

  delete: (id, userId) => {
    db.prepare('UPDATE notes SET notebook_id = NULL WHERE notebook_id = ? AND (user_id = ? OR user_id = \'usr_local_default\')').run(id, userId);
    const stmt = db.prepare('DELETE FROM notebooks WHERE id = ? AND (user_id = ? OR user_id = \'usr_local_default\')');
    const result = stmt.run(id, userId);
    return result.changes > 0;
  }
};

// Note Operations Helper Methods (Metadata indexing layer)
const NoteModel = {
  getAll: (userId, notebookId = null) => {
    const safeUserId = userId || 'usr_local_default';
    if (notebookId) {
      const stmt = db.prepare('SELECT * FROM notes WHERE notebook_id = ? AND (user_id = ? OR user_id = \'usr_local_default\') ORDER BY updated_at DESC');
      return stmt.all(notebookId, safeUserId);
    }
    const stmt = db.prepare('SELECT * FROM notes WHERE (user_id = ? OR user_id = \'usr_local_default\') ORDER BY updated_at DESC');
    return stmt.all(safeUserId);
  },

  getById: (id, userId) => {
    const safeUserId = userId || 'usr_local_default';
    const stmt = db.prepare('SELECT * FROM notes WHERE id = ? AND (user_id = ? OR user_id = \'usr_local_default\')');
    return stmt.get(id, safeUserId);
  },

  create: (id, title, filePath, notebookId, contentHash, currentVersionId, userId, syncMode = 'local') => {
    const safeUserId = userId || 'usr_local_default';
    const normalizeMode = (m) => (m === 'cloud' || m === 'google') ? 'cloud' : (m === 'lan' ? 'lan' : 'local');
    const finalSyncMode = normalizeMode(syncMode);
    const now = new Date().toISOString();
    const stmt = db.prepare(`
      INSERT INTO notes (id, title, file_path, notebook_id, user_id, created_at, updated_at, current_version_id, content_hash, sync_mode)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(id, title || 'Untitled Note', filePath, notebookId || null, safeUserId, now, now, currentVersionId, contentHash, finalSyncMode);
    return NoteModel.getById(id, safeUserId);
  },

  update: (id, title, filePath, notebookId, contentHash, currentVersionId, userId, syncMode) => {
    const safeUserId = userId || 'usr_local_default';
    const now = new Date().toISOString();
    const existing = NoteModel.getById(id, safeUserId);
    if (!existing) return null;

    const normalizeMode = (m) => (m === 'cloud' || m === 'google') ? 'cloud' : (m === 'lan' ? 'lan' : 'local');
    const finalTitle = title !== undefined ? title : existing.title;
    const finalFilePath = filePath !== undefined ? filePath : existing.file_path;
    const finalNotebookId = notebookId !== undefined ? notebookId : existing.notebook_id;
    const finalHash = contentHash !== undefined ? contentHash : existing.content_hash;
    const finalVersion = currentVersionId !== undefined ? currentVersionId : existing.current_version_id;
    const finalSyncMode = syncMode !== undefined ? normalizeMode(syncMode) : existing.sync_mode;

    const stmt = db.prepare(`
      UPDATE notes 
      SET title = ?, file_path = ?, notebook_id = ?, content_hash = ?, current_version_id = ?, sync_mode = ?, updated_at = ?
      WHERE id = ? AND (user_id = ? OR user_id = 'usr_local_default')
    `);
    stmt.run(finalTitle, finalFilePath, finalNotebookId, finalHash, finalVersion, finalSyncMode, now, id, safeUserId);
    return NoteModel.getById(id, safeUserId);
  },

  updateSyncMetadata: (id, userId, { gdriveFileId, lastSyncedHash, lastSyncedAt, syncState, syncError }) => {
    const safeUserId = userId || 'usr_local_default';
    const existing = NoteModel.getById(id, safeUserId);
    if (!existing) return null;

    const finalFileId = gdriveFileId !== undefined ? gdriveFileId : existing.gdrive_file_id;
    const finalSyncedHash = lastSyncedHash !== undefined ? lastSyncedHash : existing.last_synced_hash;
    const finalSyncedAt = lastSyncedAt !== undefined ? lastSyncedAt : existing.last_synced_at;
    const finalState = syncState !== undefined ? syncState : existing.sync_state;
    const finalError = syncError !== undefined ? syncError : existing.sync_error;

    const stmt = db.prepare(`
      UPDATE notes
      SET gdrive_file_id = ?, last_synced_hash = ?, last_synced_at = ?, sync_state = ?, sync_error = ?
      WHERE id = ? AND (user_id = ? OR user_id = 'usr_local_default')
    `);
    stmt.run(finalFileId, finalSyncedHash, finalSyncedAt, finalState, finalError, id, safeUserId);
    return NoteModel.getById(id, safeUserId);
  },

  delete: (id, userId) => {
    const safeUserId = userId || 'usr_local_default';
    const stmt = db.prepare('DELETE FROM notes WHERE id = ? AND (user_id = ? OR user_id = \'usr_local_default\')');
    const result = stmt.run(id, safeUserId);
    return result.changes > 0;
  }
};

// Version Operations Helper Methods
const VersionModel = {
  getHistory: (noteId, userId) => {
    // Ownership check via JOIN
    const stmt = db.prepare(`
      SELECT v.* FROM versions v
      INNER JOIN notes n ON v.note_id = n.id
      WHERE v.note_id = ? AND (n.user_id = ? OR n.user_id = 'usr_local_default')
      ORDER BY v.version_number ASC
    `);
    return stmt.all(noteId, userId);
  },

  getAllHistory: (userId) => {
    const stmt = db.prepare(`
      SELECT 
        v.*,
        n.title as note_title,
        n.file_path as note_file_path,
        vd.diff_data
      FROM versions v
      INNER JOIN notes n ON v.note_id = n.id
      LEFT JOIN version_diffs vd ON v.id = vd.version_id
      WHERE (n.user_id = ? OR n.user_id = 'usr_local_default')
      ORDER BY v.created_at DESC
    `);
    const rows = stmt.all(userId);
    return rows.map(row => {
      let additions = 0;
      let deletions = 0;
      if (row.diff_data) {
        try {
          const hunks = JSON.parse(row.diff_data);
          if (Array.isArray(hunks)) {
            for (const hunk of hunks) {
              if (hunk.added) additions += hunk.added.length;
              if (hunk.removed) deletions += hunk.removed.length;
            }
          }
        } catch (e) {}
      }
      const { diff_data, ...ver } = row;
      return { ...ver, additions, deletions };
    });
  },

  getGlobalActivity: (userId) => {
    const stmt = db.prepare(`
      SELECT 
        v.id, v.note_id, v.version_number, v.message, v.created_at, v.is_auto,
        n.title as note_title, n.file_path as note_file_path,
        vd.diff_data
      FROM versions v
      INNER JOIN notes n ON v.note_id = n.id
      LEFT JOIN version_diffs vd ON v.id = vd.version_id
      WHERE (n.user_id = ? OR n.user_id = 'usr_local_default')
      ORDER BY v.created_at ASC
    `);
    const rows = stmt.all(userId);

    const dateMap = {};
    rows.forEach(row => {
      if (!row.created_at) return;
      const dateStr = new Date(row.created_at).toISOString().split('T')[0];
      if (!dateMap[dateStr]) {
        dateMap[dateStr] = {
          date: dateStr,
          checkpointCount: 0,
          linesAdded: 0,
          linesRemoved: 0,
          notesChangedSet: new Set()
        };
      }
      dateMap[dateStr].checkpointCount += 1;
      if (row.note_id) dateMap[dateStr].notesChangedSet.add(row.note_id);

      if (row.diff_data) {
        try {
          const hunks = JSON.parse(row.diff_data);
          if (Array.isArray(hunks)) {
            for (const hunk of hunks) {
              if (hunk.added) dateMap[dateStr].linesAdded += hunk.added.length;
              if (hunk.removed) dateMap[dateStr].linesRemoved += hunk.removed.length;
            }
          }
        } catch (e) {}
      }
    });

    return Object.values(dateMap).map(item => ({
      date: item.date,
      checkpointCount: item.checkpointCount,
      linesAdded: item.linesAdded,
      linesRemoved: item.linesRemoved,
      notesChanged: item.notesChangedSet.size
    }));
  },

  getById: (id, userId) => {
    if (userId) {
      const stmt = db.prepare(`
        SELECT v.* FROM versions v
        INNER JOIN notes n ON v.note_id = n.id
        WHERE v.id = ? AND (n.user_id = ? OR n.user_id = 'usr_local_default')
      `);
      const res = stmt.get(id, userId);
      if (res) return res;
    }
    const fallbackStmt = db.prepare(`SELECT * FROM versions WHERE id = ?`);
    return fallbackStmt.get(id);
  },

  getLatestForNote: (noteId, userId) => {
    if (userId) {
      const stmt = db.prepare(`
        SELECT v.* FROM versions v
        INNER JOIN notes n ON v.note_id = n.id
        WHERE v.note_id = ? AND (n.user_id = ? OR n.user_id = 'usr_local_default')
        ORDER BY v.version_number DESC 
        LIMIT 1
      `);
      const res = stmt.get(noteId, userId);
      if (res) return res;
    }
    const fallbackStmt = db.prepare(`
      SELECT * FROM versions 
      WHERE note_id = ? 
      ORDER BY version_number DESC 
      LIMIT 1
    `);
    return fallbackStmt.get(noteId);
  },

  getDiffByVersionId: (versionId, userId) => {
    if (userId) {
      const stmt = db.prepare(`
        SELECT vd.* FROM version_diffs vd
        INNER JOIN versions v ON vd.version_id = v.id
        INNER JOIN notes n ON v.note_id = n.id
        WHERE vd.version_id = ? AND (n.user_id = ? OR n.user_id = 'usr_local_default')
      `);
      const res = stmt.get(versionId, userId);
      if (res) return res;
    }
    const fallbackStmt = db.prepare(`SELECT * FROM version_diffs WHERE version_id = ?`);
    return fallbackStmt.get(versionId);
  },

  createCheckpointTransaction: (versionData, diffData, noteId, userId) => {
    const runInTransaction = () => {
      const stmtVer = db.prepare(`
        INSERT INTO versions (id, note_id, version_number, parent_version_id, message, device_id, created_at, content_hash, is_snapshot, is_auto)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmtVer.run(
        versionData.id,
        versionData.note_id,
        versionData.version_number,
        versionData.parent_version_id || null,
        versionData.message || (versionData.is_auto ? 'Auto checkpoint' : 'Manual checkpoint'),
        versionData.device_id || 'local_device',
        versionData.created_at || new Date().toISOString(),
        versionData.content_hash,
        versionData.is_snapshot || 0,
        versionData.is_auto || 0
      );

      const stmtDiff = db.prepare(`
        INSERT INTO version_diffs (id, version_id, diff_data)
        VALUES (?, ?, ?)
      `);
      stmtDiff.run(
        `diff_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        versionData.id,
        JSON.stringify(diffData)
      );

      const stmtNote = db.prepare(`
        UPDATE notes 
        SET current_version_id = ?, content_hash = ?, updated_at = ?
        WHERE id = ? AND (user_id = ? OR user_id = 'usr_local_default')
      `);
      stmtNote.run(versionData.id, versionData.content_hash, new Date().toISOString(), noteId, userId);
    };

    if (typeof db.transaction === 'function') {
      const tx = db.transaction(runInTransaction);
      tx();
    } else {
      db.exec('BEGIN TRANSACTION;');
      try {
        runInTransaction();
        db.exec('COMMIT;');
      } catch (err) {
        db.exec('ROLLBACK;');
        throw err;
      }
    }

    return VersionModel.getById(versionData.id, userId);
  }
};

// Session Operations Helper Methods (Lightweight Session Recovery)
const SessionModel = {
  getByNoteId: (noteId, userId) => {
    const stmt = db.prepare(`
      SELECT s.* FROM sessions s
      INNER JOIN notes n ON s.note_id = n.id
      WHERE s.note_id = ? AND (n.user_id = ? OR n.user_id = 'usr_local_default')
    `);
    return stmt.get(noteId, userId);
  },

  upsert: (noteId, lastCheckpointId, currentContentHash, sessionStatus = 'uncheckpointed', userId) => {
    const now = new Date().toISOString();
    const stmt = db.prepare(`
      INSERT INTO sessions (note_id, last_checkpoint_id, current_content_hash, last_saved_at, session_status)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(note_id) DO UPDATE SET
        last_checkpoint_id = excluded.last_checkpoint_id,
        current_content_hash = excluded.current_content_hash,
        last_saved_at = excluded.last_saved_at,
        session_status = excluded.session_status
    `);
    stmt.run(noteId, lastCheckpointId || null, currentContentHash, now, sessionStatus);
    return SessionModel.getByNoteId(noteId, userId);
  },

  updateStatus: (noteId, sessionStatus, userId) => {
    const stmt = db.prepare(`
      UPDATE sessions SET session_status = ? 
      WHERE note_id IN (SELECT id FROM notes WHERE id = ? AND (user_id = ? OR user_id = 'usr_local_default'))
    `);
    stmt.run(sessionStatus, noteId, userId);
    return SessionModel.getByNoteId(noteId, userId);
  },

  delete: (noteId, userId) => {
    const stmt = db.prepare(`
      DELETE FROM sessions 
      WHERE note_id IN (SELECT id FROM notes WHERE id = ? AND (user_id = ? OR user_id = 'usr_local_default'))
    `);
    const result = stmt.run(noteId, userId);
    return result.changes > 0;
  }
};

// Sync Queue Helper Methods (Local-first offline queue with coalescing)
const SyncQueueModel = {
  enqueue: ({ id, entityType, entityId, operation, payload }) => {
    const now = new Date().toISOString();
    const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const queueId = id || `sq_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    // Coalescing: If an existing pending update item exists for the exact entity & operation, update its payload!
    if (operation === 'UPDATE_NOTE' || operation === 'UPDATE_FOLDER') {
      const existing = db.prepare(`
        SELECT * FROM sync_queue 
        WHERE entity_type = ? AND entity_id = ? AND operation = ? AND status IN ('PENDING', 'FAILED')
        LIMIT 1
      `).get(entityType, entityId, operation);

      if (existing) {
        db.prepare(`
          UPDATE sync_queue 
          SET payload = ?, created_at = ?, retry_count = 0, last_error = NULL, status = 'PENDING'
          WHERE id = ?
        `).run(payloadStr, now, existing.id);
        return db.prepare('SELECT * FROM sync_queue WHERE id = ?').get(existing.id);
      }
    }

    const stmt = db.prepare(`
      INSERT INTO sync_queue (id, entity_type, entity_id, operation, payload, created_at, status)
      VALUES (?, ?, ?, ?, ?, ?, 'PENDING')
    `);
    stmt.run(queueId, entityType, entityId, operation, payloadStr, now);
    return db.prepare('SELECT * FROM sync_queue WHERE id = ?').get(queueId);
  },

  getPending: () => {
    const stmt = db.prepare(`
      SELECT * FROM sync_queue 
      WHERE status IN ('PENDING', 'FAILED') AND retry_count < 10
      ORDER BY created_at ASC
    `);
    return stmt.all();
  },

  markSyncing: (id) => {
    db.prepare("UPDATE sync_queue SET status = 'SYNCING' WHERE id = ?").run(id);
  },

  markSynced: (id) => {
    const now = new Date().toISOString();
    db.prepare("UPDATE sync_queue SET status = 'SYNCED', synced_at = ? WHERE id = ?").run(now, id);
  },

  markFailed: (id, errorMsg) => {
    db.prepare(`
      UPDATE sync_queue 
      SET status = 'FAILED', retry_count = retry_count + 1, last_error = ?
      WHERE id = ?
    `).run(errorMsg || 'Sync failed', id);
  },

  clearSynced: () => {
    db.prepare("DELETE FROM sync_queue WHERE status = 'SYNCED'").run();
  },

  getStats: () => {
    const pending = db.prepare("SELECT COUNT(*) as count FROM sync_queue WHERE status IN ('PENDING', 'FAILED')").get();
    const synced = db.prepare("SELECT COUNT(*) as count FROM sync_queue WHERE status = 'SYNCED'").get();
    const lastSynced = db.prepare("SELECT MAX(synced_at) as last_synced FROM sync_queue WHERE status = 'SYNCED'").get();

    return {
      pendingCount: pending ? pending.count : 0,
      syncedCount: synced ? synced.count : 0,
      lastSyncedAt: lastSynced ? lastSynced.last_synced : null
    };
  }
};

// LAN Device Pairing Helper Methods
const LanPairingModel = {
  getPairedDevices: (userId) => {
    const stmt = db.prepare('SELECT * FROM lan_paired_devices WHERE (user_id = ? OR user_id = \'usr_local_default\') AND status = \'TRUSTED\' ORDER BY last_seen DESC');
    return stmt.all(userId || 'usr_local_default');
  },

  getAllDevices: (userId) => {
    const stmt = db.prepare('SELECT * FROM lan_paired_devices WHERE (user_id = ? OR user_id = \'usr_local_default\') ORDER BY last_seen DESC');
    return stmt.all(userId || 'usr_local_default');
  },

  getById: (id) => {
    return db.prepare('SELECT * FROM lan_paired_devices WHERE id = ?').get(id);
  },

  getByToken: (pairingToken) => {
    return db.prepare('SELECT * FROM lan_paired_devices WHERE pairing_token = ? AND status = \'TRUSTED\'').get(pairingToken);
  },

  getByPublicKey: (publicKey) => {
    return db.prepare('SELECT * FROM lan_paired_devices WHERE public_key = ? AND status = \'TRUSTED\'').get(publicKey);
  },

  createPairing: ({ id, deviceName, deviceIp, pairingToken, publicKey, deviceType = 'desktop', userId, status = 'TRUSTED' }) => {
    const now = new Date().toISOString();
    const stmt = db.prepare(`
      INSERT INTO lan_paired_devices (id, device_name, device_ip, pairing_token, public_key, device_type, user_id, status, created_at, last_seen)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        device_name = excluded.device_name,
        device_ip = excluded.device_ip,
        pairing_token = excluded.pairing_token,
        public_key = COALESCE(excluded.public_key, lan_paired_devices.public_key),
        device_type = excluded.device_type,
        status = excluded.status,
        last_seen = excluded.last_seen
    `);
    stmt.run(id, deviceName, deviceIp || null, pairingToken, publicKey || null, deviceType, userId || 'usr_local_default', status, now, now);
    return LanPairingModel.getById(id);
  },

  updateLastSeen: (id, deviceIp) => {
    const now = new Date().toISOString();
    db.prepare('UPDATE lan_paired_devices SET last_seen = ?, device_ip = ? WHERE id = ?').run(now, deviceIp || null, id);
  },

  revokePairing: (id, userId) => {
    const stmt = db.prepare('UPDATE lan_paired_devices SET status = \'REVOKED\' WHERE id = ? AND (user_id = ? OR user_id = \'usr_local_default\')');
    const res = stmt.run(id, userId || 'usr_local_default');
    return res.changes > 0;
  },

  deletePairing: (id, userId) => {
    const stmt = db.prepare('DELETE FROM lan_paired_devices WHERE id = ? AND (user_id = ? OR user_id = \'usr_local_default\')');
    const res = stmt.run(id, userId || 'usr_local_default');
    db.prepare('DELETE FROM device_selected_notes WHERE device_id = ?').run(id);
    return res.changes > 0;
  },

  renameDevice: (id, newName) => {
    const stmt = db.prepare('UPDATE lan_paired_devices SET device_name = ? WHERE id = ?');
    stmt.run(newName.trim(), id);
    return LanPairingModel.getById(id);
  },

  getDeviceSelectedNotes: (deviceId) => {
    const rows = db.prepare('SELECT note_id FROM device_selected_notes WHERE device_id = ?').all(deviceId);
    return rows.map(r => r.note_id);
  },

  setDeviceSelectedNotes: (deviceId, noteIds = []) => {
    db.prepare('DELETE FROM device_selected_notes WHERE device_id = ?').run(deviceId);
    const insert = db.prepare('INSERT OR IGNORE INTO device_selected_notes (device_id, note_id) VALUES (?, ?)');
    const transaction = db.transaction((ids) => {
      for (const id of ids) {
        insert.run(deviceId, id);
      }
    });
    transaction(noteIds);
    return LanPairingModel.getDeviceSelectedNotes(deviceId);
  }
};

const GoogleDriveAuthModel = {
  get: (userId) => {
    if (!userId) return null;
    try {
      const row = db.prepare('SELECT * FROM google_drive_auths WHERE user_id = ? AND is_connected = 1').get(String(userId));
      if (!row) return null;
      return {
        userId: row.user_id,
        email: row.email,
        accessToken: row.access_token,
        refreshToken: row.refresh_token,
        folderId: row.folder_id,
        folderName: row.folder_name,
        isConnected: Boolean(row.is_connected),
        authorizedAt: row.authorized_at,
        updatedAt: row.updated_at
      };
    } catch (err) {
      console.warn('[GoogleDriveAuthModel.get error]:', err.message);
      return null;
    }
  },

  upsert: ({ userId, email, accessToken, refreshToken, folderId, folderName }) => {
    if (!userId) return null;
    const now = new Date().toISOString();
    const strUserId = String(userId);
    try {
      const existing = db.prepare('SELECT user_id FROM google_drive_auths WHERE user_id = ?').get(strUserId);
      if (existing) {
        db.prepare(`
          UPDATE google_drive_auths 
          SET email = COALESCE(?, email),
              access_token = COALESCE(?, access_token),
              refresh_token = COALESCE(?, refresh_token),
              folder_id = COALESCE(?, folder_id),
              folder_name = COALESCE(?, folder_name),
              is_connected = 1,
              updated_at = ?
          WHERE user_id = ?
        `).run(email || null, accessToken || null, refreshToken || null, folderId || null, folderName || null, now, strUserId);
      } else {
        db.prepare(`
          INSERT INTO google_drive_auths (user_id, email, access_token, refresh_token, folder_id, folder_name, is_connected, authorized_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
        `).run(strUserId, email || null, accessToken || null, refreshToken || null, folderId || 'syncnote_gdrive_root_folder_id', folderName || 'SyncNote', now, now);
      }

      if (strUserId !== 'usr_local_default') {
        try { db.prepare(`DELETE FROM google_drive_auths WHERE user_id = 'usr_local_default'`).run(); } catch (e) {}
      }

      return GoogleDriveAuthModel.get(strUserId);
    } catch (err) {
      console.error('[GoogleDriveAuthModel.upsert error]:', err.message);
      return null;
    }
  },

  disconnect: (userId) => {
    if (!userId) return false;
    try {
      db.prepare(`UPDATE google_drive_auths SET is_connected = 0 WHERE user_id = ?`).run(String(userId));
      return true;
    } catch (err) {
      return false;
    }
  },

  migrateDefaultUserTo: (targetUserId) => {
    if (!targetUserId || targetUserId === 'usr_local_default') return false;
    try {
      const defaultRow = db.prepare(`SELECT * FROM google_drive_auths WHERE user_id = 'usr_local_default' AND is_connected = 1`).get();
      if (defaultRow) {
        GoogleDriveAuthModel.upsert({
          userId: targetUserId,
          email: defaultRow.email,
          accessToken: defaultRow.access_token,
          refreshToken: defaultRow.refresh_token,
          folderId: defaultRow.folder_id,
          folderName: defaultRow.folder_name
        });
        db.prepare(`DELETE FROM google_drive_auths WHERE user_id = 'usr_local_default'`).run();
        console.log(`[Google Drive Auth Migration] Migrated Drive connection from usr_local_default to user '${targetUserId}'.`);
        return true;
      }
    } catch (err) {
      console.warn('[GoogleDriveAuthModel.migrateDefaultUserTo error]:', err.message);
    }
    return false;
  }
};

module.exports = { 
  db, 
  UserModel, 
  DeviceModel, 
  NoteModel, 
  NotebookModel, 
  VersionModel, 
  SessionModel,
  SyncQueueModel,
  LanPairingModel,
  GoogleDriveAuthModel
};
