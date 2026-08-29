const express = require('express');
const router = express.Router();
const { NOTES_ROOT } = require('../utils/fileStorage');

/**
 * @route   GET /api/health
 * @desc    Health check endpoint with dynamic storage location metadata
 * @access  Public
 */
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'SyncNote API Server',
    version: '1.0.0',
    notes_dir: NOTES_ROOT
  });
});

module.exports = router;
