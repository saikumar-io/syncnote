const express = require('express');
const router = express.Router();
const { NOTES_ROOT } = require('../utils/fileStorage');
const { db } = require('../db/database');
const { isPostgresConnected, pool } = require('../db/postgres');

/**
 * @route   GET /api/health
 * @desc    Comprehensive structured health check endpoint (Backend + PostgreSQL + SQLite)
 * @access  Public
 */
router.get('/health', async (req, res) => {
  let sqliteAlive = false;
  let postgresAlive = false;

  // Check SQLite
  try {
    if (db) {
      const stmt = db.prepare('SELECT 1 as alive');
      const row = stmt.get();
      if (row && (row.alive === 1 || row.alive === '1')) {
        sqliteAlive = true;
      }
    }
  } catch (err) {
    sqliteAlive = false;
  }

  // Check PostgreSQL
  try {
    if (pool && isPostgresConnected()) {
      const pgRes = await pool.query('SELECT 1 as alive');
      if (pgRes && pgRes.rows && pgRes.rows.length > 0) {
        postgresAlive = true;
      }
    }
  } catch (err) {
    postgresAlive = false;
  }

  if (sqliteAlive && postgresAlive) {
    return res.status(200).json({
      status: 'ok',
      backend: true,
      postgres: true,
      sqlite: true,
      timestamp: new Date().toISOString(),
      service: 'SyncNote API Server',
      version: '1.0.0',
      notes_dir: NOTES_ROOT
    });
  } else if (sqliteAlive) {
    // Degraded mode: backend & sqlite functional, PostgreSQL offline
    return res.status(200).json({
      status: 'degraded',
      backend: true,
      postgres: false,
      sqlite: true,
      timestamp: new Date().toISOString(),
      service: 'SyncNote API Server',
      version: '1.0.0',
      notes_dir: NOTES_ROOT
    });
  } else {
    return res.status(503).json({
      status: 'unhealthy',
      backend: true,
      postgres: postgresAlive,
      sqlite: false,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;
