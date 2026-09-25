const express = require('express');
const router = express.Router();
const { requireAuth, optionalAuth } = require('../middleware/authMiddleware');
const { ConflictModel } = require('../db/database');
const { checkOllamaHealth } = require('../services/ollamaService');
const { resolveConflict, retryAiAnalysis } = require('../services/conflictResolutionService');

// Require authentication for conflict operations
router.use(optionalAuth);

/**
 * GET /api/conflicts/status
 * Summary status of active conflicts and local Ollama daemon readiness
 */
router.get('/status', async (req, res) => {
  try {
    const userId = req.user ? req.user.id : 'usr_local_default';
    const unresolved = ConflictModel.getUnresolved(userId);
    const ollamaHealth = await checkOllamaHealth();

    return res.json({
      status: 'ok',
      unresolvedCount: unresolved.length,
      conflicts: unresolved.map(c => ({
        id: c.id,
        noteId: c.note_id,
        noteTitle: c.note_title,
        syncSource: c.sync_source,
        createdAt: c.created_at,
        aiStatus: c.ai_status
      })),
      ollama: ollamaHealth
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to retrieve conflict status', details: err.message });
  }
});

/**
 * GET /api/conflicts/metrics
 * Research evaluation metrics for AI-assisted semantic conflict resolution
 */
router.get('/metrics', (req, res) => {
  try {
    const metricsData = ConflictModel.getMetrics();
    return res.json({
      success: true,
      metrics: metricsData
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to retrieve conflict metrics', details: err.message });
  }
});

/**
 * GET /api/conflicts
 * List all active/unresolved conflicts for current user
 */
router.get('/', (req, res) => {
  try {
    const userId = req.user ? req.user.id : 'usr_local_default';
    const { note_id } = req.query;

    let conflicts;
    if (note_id) {
      conflicts = ConflictModel.getByNoteId(note_id, userId, true);
    } else {
      conflicts = ConflictModel.getUnresolved(userId);
    }

    return res.json({
      success: true,
      count: conflicts.length,
      conflicts
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch conflicts', details: err.message });
  }
});

/**
 * GET /api/conflicts/:id
 * Retrieve full details for a specific conflict
 */
router.get('/:id', (req, res) => {
  try {
    const userId = req.user ? req.user.id : 'usr_local_default';
    const conflict = ConflictModel.getById(req.params.id, userId);

    if (!conflict) {
      return res.status(404).json({ error: 'Conflict not found' });
    }

    return res.json({
      success: true,
      conflict
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch conflict details', details: err.message });
  }
});

/**
 * POST /api/conflicts/:id/resolve
 * Execute user resolution decision: ACCEPT_AI | EDIT_MERGE | KEEP_LOCAL | KEEP_REMOTE | REJECT
 */
router.post('/:id/resolve', async (req, res) => {
  try {
    const userId = req.user ? req.user.id : 'usr_local_default';
    const { id } = req.params;
    const { resolutionMethod, customContent, message } = req.body || {};

    if (!resolutionMethod) {
      return res.status(400).json({ error: 'Missing resolutionMethod parameter' });
    }

    const result = await resolveConflict({
      conflictId: id,
      userId,
      resolutionMethod,
      customContent,
      message
    });

    return res.json(result);
  } catch (err) {
    console.error('Error resolving conflict:', err);
    return res.status(500).json({ error: 'Failed to resolve conflict', details: err.message });
  }
});

/**
 * POST /api/conflicts/:id/retry-ai
 * Manually re-trigger local Ollama semantic resolution
 */
router.post('/:id/retry-ai', async (req, res) => {
  try {
    const userId = req.user ? req.user.id : 'usr_local_default';
    const { id } = req.params;

    const updatedConflict = await retryAiAnalysis(id, userId);
    return res.json({
      success: true,
      conflict: updatedConflict
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to re-trigger AI conflict analysis', details: err.message });
  }
});

module.exports = router;
