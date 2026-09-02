const { Pool } = require('pg');
const crypto = require('crypto');
require('dotenv').config();

let pool = null;
let isPostgresConnected = false;

// Create PostgreSQL Pool if environment configuration is present
const connectionString = process.env.DATABASE_URL;
const pgHost = process.env.POSTGRES_HOST || process.env.PGHOST || 'localhost';
const pgPort = parseInt(process.env.POSTGRES_PORT || process.env.PGPORT || '5432', 10);
const pgDatabase = process.env.POSTGRES_DB || process.env.PGDATABASE || 'syncnote';
const pgUser = process.env.POSTGRES_USER || process.env.PGUSER || 'syncnote';
const pgPassword = process.env.POSTGRES_PASSWORD || process.env.PGPASSWORD || 'syncnote';

try {
  pool = new Pool({
    connectionString: connectionString || undefined,
    host: pgHost,
    port: pgPort,
    database: pgDatabase,
    user: pgUser,
    password: pgPassword,
    connectionTimeoutMillis: 3000,
    idleTimeoutMillis: 10000,
    max: 10
  });

  pool.on('error', (err) => {
    console.warn('[PostgreSQL Pool Error]:', err.message);
  });
} catch (err) {
  console.warn('[PostgreSQL Init Exception]:', err.message);
}

/**
 * Initialize PostgreSQL Schema for Central User Accounts and Devices
 */
async function initPostgresSchema() {
  if (!pool) {
    console.warn('⚠️ [PostgreSQL] Pool not initialized. Checking fallback...');
    return false;
  }

  try {
    const client = await pool.connect();
    try {
      // Ensure uuid generation extension if supported
      await client.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`).catch(() => {});

      // Create users table in PostgreSQL
      await client.query(`
        CREATE TABLE IF NOT EXISTS users (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          username VARCHAR(100) UNIQUE NOT NULL,
          email VARCHAR(255) UNIQUE NOT NULL,
          password_hash TEXT,
          auth_provider VARCHAR(50) DEFAULT 'local',
          provider_user_id VARCHAR(255),
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);

      await client.query(`ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;`).catch(() => {});
      await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider VARCHAR(50) DEFAULT 'local';`).catch(() => {});
      await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS provider_user_id VARCHAR(255);`).catch(() => {});
      await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;`).catch(() => {});
      await client.query(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);`);
      await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_provider ON users(auth_provider, provider_user_id) WHERE provider_user_id IS NOT NULL;`).catch(() => {});

      // Create devices table in PostgreSQL
      await client.query(`
        CREATE TABLE IF NOT EXISTS devices (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID REFERENCES users(id) ON DELETE CASCADE,
          device_name TEXT NOT NULL,
          device_type TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          last_seen TIMESTAMPTZ DEFAULT NOW()
        );
      `);

      await client.query(`CREATE INDEX IF NOT EXISTS idx_devices_user_id ON devices(user_id);`);

      isPostgresConnected = true;
      console.log('✅ [PostgreSQL] Central user authentication schema initialized successfully.');
      return true;
    } finally {
      client.release();
    }
  } catch (err) {
    console.warn(`⚠️ [PostgreSQL Connection Warning]: ${err.message}`);
    console.warn('   Note: Server will fall back to local SQLite user storage if PostgreSQL is offline.');
    isPostgresConnected = false;
    return false;
  }
}

// Auto-run initialization on module load
initPostgresSchema().catch(() => {});

/**
 * Helper query wrapper
 */
async function query(text, params) {
  if (!pool || !isPostgresConnected) {
    throw new Error('PostgreSQL database unavailable');
  }
  return pool.query(text, params);
}

function generateUUID() {
  return crypto.randomUUID();
}

/**
 * Central User Model (PostgreSQL with SQLite fallback)
 */
const PgUserModel = {
  async findByEmail(email) {
    const cleanEmail = (email || '').trim().toLowerCase();
    if (isPostgresConnected && pool) {
      try {
        const res = await query('SELECT * FROM users WHERE email = $1', [cleanEmail]);
        if (res.rows.length > 0) {
          const u = res.rows[0];
          return { id: u.id, email: u.email, username: u.username, password_hash: u.password_hash, created_at: u.created_at };
        }
        return null;
      } catch (err) {
        console.warn('[PgUserModel.findByEmail error]:', err.message);
      }
    }
    // Fallback to SQLite UserModel
    const { UserModel } = require('./database');
    return UserModel.findByEmail(cleanEmail);
  },

  async findByUsername(username) {
    const cleanUsername = (username || '').trim().toLowerCase();
    if (isPostgresConnected && pool) {
      try {
        const res = await query('SELECT * FROM users WHERE LOWER(username) = $1', [cleanUsername]);
        if (res.rows.length > 0) {
          const u = res.rows[0];
          return { id: u.id, email: u.email, username: u.username, password_hash: u.password_hash, created_at: u.created_at };
        }
        return null;
      } catch (err) {
        console.warn('[PgUserModel.findByUsername error]:', err.message);
      }
    }
    const { UserModel } = require('./database');
    return UserModel.findByUsername(cleanUsername);
  },

  async findById(id) {
    if (isPostgresConnected && pool) {
      try {
        const res = await query('SELECT id, username, email, avatar_url, created_at, updated_at FROM users WHERE id = $1', [id]);
        if (res.rows.length > 0) {
          return res.rows[0];
        }
        return null;
      } catch (err) {
        console.warn('[PgUserModel.findById error]:', err.message);
      }
    }
    const { UserModel } = require('./database');
    return UserModel.findById(id);
  },

  async updateAvatar(id, avatarUrl) {
    if (isPostgresConnected && pool) {
      try {
        const res = await query(
          'UPDATE users SET avatar_url = $1, updated_at = NOW() WHERE id = $2 RETURNING id, username, email, avatar_url',
          [avatarUrl, id]
        );
        if (res.rows.length > 0) return res.rows[0];
      } catch (err) {
        console.warn('[PgUserModel.updateAvatar error]:', err.message);
      }
    }
    const { UserModel } = require('./database');
    return UserModel.updateAvatar(id, avatarUrl);
  },

  async create({ username, email, passwordHash, avatarUrl }) {
    const cleanEmail = (email || '').trim().toLowerCase();
    const cleanUsername = (username || '').trim();
    const uuid = generateUUID();

    if (isPostgresConnected && pool) {
      try {
        const res = await query(
          `INSERT INTO users (id, username, email, password_hash, avatar_url)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, username, email, avatar_url, created_at`,
          [uuid, cleanUsername, cleanEmail, passwordHash, avatarUrl || null]
        );
        const u = res.rows[0];
        const { UserModel } = require('./database');
        try {
          UserModel.create({ id: u.id, username: u.username, email: u.email, passwordHash, avatarUrl });
        } catch (e) {}
        return u;
      } catch (err) {
        console.error('[PgUserModel.create error]:', err.message);
        throw err;
      }
    }

    const { UserModel } = require('./database');
    return UserModel.create({ id: uuid, username: cleanUsername, email: cleanEmail, passwordHash, avatarUrl });
  },

  async updatePassword(id, newPasswordHash) {
    if (isPostgresConnected && pool) {
      try {
        await query(
          `UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`,
          [newPasswordHash, id]
        );
      } catch (err) {
        console.warn('[PgUserModel.updatePassword error]:', err.message);
      }
    }
    const { UserModel } = require('./database');
    return UserModel.updatePassword(id, newPasswordHash);
  },

  async updateProfile(id, { username }) {
    if (isPostgresConnected && pool) {
      try {
        const res = await query(
          `UPDATE users SET username = $1, updated_at = NOW() WHERE id = $2 RETURNING id, username, email, avatar_url`,
          [username, id]
        );
        if (res.rows.length > 0) return res.rows[0];
      } catch (err) {
        console.warn('[PgUserModel.updateProfile error]:', err.message);
      }
    }
    const { UserModel } = require('./database');
    return UserModel.updateProfile(id, { username });
  },

  async findOrCreateGoogleUser({ googleId, email, name, avatarUrl, id }) {
    const cleanEmail = (email || '').trim().toLowerCase();

    if (isPostgresConnected && pool) {
      try {
        // 1. Check by auth_provider = 'google' AND provider_user_id = googleId
        const resByProvider = await query(
          'SELECT id, username, email, avatar_url, created_at, auth_provider FROM users WHERE auth_provider = $1 AND provider_user_id = $2',
          ['google', String(googleId)]
        );
        if (resByProvider.rows.length > 0) {
          const u = resByProvider.rows[0];
          if (avatarUrl && avatarUrl !== u.avatar_url) {
            await query('UPDATE users SET avatar_url = $1, updated_at = NOW() WHERE id = $2', [avatarUrl, u.id]);
            u.avatar_url = avatarUrl;
          }
          const { UserModel } = require('./database');
          try { UserModel.findOrCreateGoogleUser({ googleId, email: u.email, name: u.username, avatarUrl: u.avatar_url, id: u.id }); } catch (e) {}
          return u;
        }

        // 2. Check by email
        const resByEmail = await query('SELECT id, username, email, avatar_url, created_at FROM users WHERE email = $1', [cleanEmail]);
        if (resByEmail.rows.length > 0) {
          const u = resByEmail.rows[0];
          await query(
            'UPDATE users SET auth_provider = $1, provider_user_id = $2, avatar_url = COALESCE($3, avatar_url), updated_at = NOW() WHERE id = $4',
            ['google', String(googleId), avatarUrl || null, u.id]
          );
          const updatedAvatar = avatarUrl || u.avatar_url;
          const { UserModel } = require('./database');
          try { UserModel.findOrCreateGoogleUser({ googleId, email: u.email, name: u.username, avatarUrl: updatedAvatar, id: u.id }); } catch (e) {}
          return { id: u.id, email: u.email, username: u.username, avatar_url: updatedAvatar, created_at: u.created_at, auth_provider: 'google' };
        }

        // 3. Create new OAuth user
        const uuid = id || generateUUID();
        let baseUsername = (name || cleanEmail.split('@')[0] || 'google_user').replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
        if (!baseUsername) baseUsername = 'google_user';
        let username = baseUsername;
        let counter = 1;

        while (true) {
          const checkU = await query('SELECT id FROM users WHERE LOWER(username) = $1', [username]);
          if (checkU.rows.length === 0) break;
          username = `${baseUsername}_${counter++}`;
        }

        const inserted = await query(
          `INSERT INTO users (id, username, email, password_hash, auth_provider, provider_user_id, avatar_url)
           VALUES ($1, $2, $3, NULL, $4, $5, $6)
           RETURNING id, username, email, avatar_url, created_at, auth_provider`,
          [uuid, username, cleanEmail, 'google', String(googleId), avatarUrl || null]
        );
        const u = inserted.rows[0];
        const { UserModel } = require('./database');
        try { UserModel.findOrCreateGoogleUser({ googleId, email: u.email, name: u.username, avatarUrl: u.avatar_url, id: u.id }); } catch (e) {}
        return u;
      } catch (err) {
        console.warn('[PgUserModel.findOrCreateGoogleUser error]:', err.message);
      }
    }

    const { UserModel } = require('./database');
    return UserModel.findOrCreateGoogleUser({ googleId, email: cleanEmail, name, avatarUrl, id });
  }
};

/**
 * Device Model (PostgreSQL with SQLite fallback)
 */
const PgDeviceModel = {
  async upsert({ id, userId, deviceName, deviceType }) {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const deviceId = (id && uuidRegex.test(id)) ? id : crypto.randomUUID();

    if (isPostgresConnected && pool) {
      try {
        const res = await query(
          `INSERT INTO devices (id, user_id, device_name, device_type, last_seen)
           VALUES ($1, $2, $3, $4, NOW())
           ON CONFLICT (id) DO UPDATE
           SET device_name = EXCLUDED.device_name,
               device_type = EXCLUDED.device_type,
               last_seen = NOW()
           RETURNING *`,
          [deviceId, userId, deviceName || 'Unknown Device', deviceType || 'desktop']
        );
        return res.rows[0];
      } catch (err) {
        console.warn('[PgDeviceModel.upsert error]:', err.message);
      }
    }

    const { DeviceModel } = require('./database');
    return DeviceModel.upsert({ id: deviceId, userId, deviceName, deviceType });
  },

  async getByUserId(userId) {
    if (isPostgresConnected && pool) {
      try {
        const res = await query(
          `SELECT * FROM devices WHERE user_id = $1 ORDER BY last_seen DESC`,
          [userId]
        );
        return res.rows;
      } catch (err) {
        console.warn('[PgDeviceModel.getByUserId error]:', err.message);
      }
    }

    const { DeviceModel } = require('./database');
    return DeviceModel.getByUserId(userId);
  }
};

module.exports = {
  pool,
  query,
  initPostgresSchema,
  isPostgresConnected: () => isPostgresConnected,
  PgUserModel,
  PgDeviceModel
};
