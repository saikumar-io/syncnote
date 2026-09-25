const { ConflictModel, NoteModel, VersionModel, SessionModel } = require('../db/database');
const { writeNoteFile, readNoteFile, calculateHash } = require('../utils/fileStorage');
const { computeLineDiffHunks, reconstructVersionContent } = require('../utils/versionControl');
const { generateSemanticConflictResolution } = require('./ollamaService');

/**
 * Service managing semantic note conflict lifecycles, local AI generation,
 * user review decisions, and version-control tree commits.
 */

// Track in-flight AI resolution promises to prevent multiple simultaneous Ollama requests for the same conflict
const inFlightAiRequests = new Map();

/**
 * Record a detected concurrent conflict and trigger local AI analysis
 */
async function createOrRecordConflict({
  noteId,
  userId = 'usr_local_default',
  ancestorVersionId = null,
  ancestorContent = '',
  localVersionId = null,
  localContent = '',
  remoteVersionId = null,
  remoteContent = '',
  remoteDeviceId = null,
  remoteDeviceName = 'Peer Device',
  syncSource = 'LAN'
}) {
  const currentUserId = userId || 'usr_local_default';

  // 1. Check if an active unresolved conflict already exists for this note
  const existingConflicts = ConflictModel.getByNoteId(noteId, currentUserId, true);
  if (existingConflicts.length > 0) {
    const active = existingConflicts[0];
    // If the active conflict already has AI suggestions and matching content, return it without duplicate AI execution
    if (active.ai_status === 'AVAILABLE' && active.remote_content === remoteContent && active.local_content === localContent) {
      console.log(`[ConflictService] Existing unresolved conflict '${active.id}' already analyzed for note ${noteId}. Reusing.`);
      return active;
    }
    // If an AI resolution is already in-flight for this conflict, reuse the existing promise
    if (inFlightAiRequests.has(active.id)) {
      console.log(`[ConflictService] AI resolution already in-flight for conflict '${active.id}'. Awaiting existing request.`);
      return inFlightAiRequests.get(active.id);
    }
  }

  // 2. Reconstruct ancestor content from version history if version ID provided but content empty
  let resolvedAncestorContent = ancestorContent || '';
  if (!resolvedAncestorContent && ancestorVersionId) {
    try {
      resolvedAncestorContent = reconstructVersionContent(ancestorVersionId, VersionModel, currentUserId);
    } catch (e) {
      console.warn(`[ConflictService] Failed reconstructing ancestor version ${ancestorVersionId}:`, e.message);
      resolvedAncestorContent = '';
    }
  }

  // 3. Create persistent conflict record in SQLite
  const conflictRecord = ConflictModel.create({
    noteId,
    userId: currentUserId,
    ancestorVersionId,
    ancestorContent: resolvedAncestorContent,
    localVersionId,
    localContent,
    remoteVersionId,
    remoteContent,
    remoteDeviceId,
    remoteDeviceName,
    syncSource
  });

  // Mark note's sync_state as CONFLICT in SQLite metadata
  NoteModel.updateSyncMetadata(noteId, currentUserId, {
    syncState: 'CONFLICT',
    syncError: `Concurrent conflict detected from ${remoteDeviceName} via ${syncSource}`
  });

  console.log(`[ConflictService] Recorded concurrent conflict ${conflictRecord.id} for note ${noteId}. Invoking local AI assistant...`);

  // 4. Invoke local modular Ollama service (guarded against concurrent duplicate requests)
  const aiPromise = (async () => {
    try {
      const aiResult = await generateSemanticConflictResolution({
        noteId,
        ancestorContent: resolvedAncestorContent,
        localContent,
        remoteContent,
        localDeviceName: 'Device A (Local)',
        remoteDeviceName: `${remoteDeviceName} (${syncSource})`
      });

      // 5. Update conflict record with AI response
      const updatedConflict = ConflictModel.updateAiStatus(conflictRecord.id, {
        aiStatus: aiResult.available ? 'AVAILABLE' : 'UNAVAILABLE',
        aiSummary: aiResult.data.summary,
        aiChanges: aiResult.data.changesFromAncestor,
        aiSuggestedMerge: aiResult.data.suggestedMerge,
        aiReasoning: aiResult.data.reasoning,
        aiError: aiResult.error || null,
        aiLatencyMs: aiResult.latencyMs
      }, currentUserId);

      return updatedConflict;
    } finally {
      inFlightAiRequests.delete(conflictRecord.id);
    }
  })();

  inFlightAiRequests.set(conflictRecord.id, aiPromise);
  return await aiPromise;
}

/**
 * Re-trigger AI analysis on an existing conflict (e.g., if user started Ollama after conflict detection)
 */
async function retryAiAnalysis(conflictId, userId) {
  const conflict = ConflictModel.getById(conflictId, userId);
  if (!conflict) {
    throw new Error(`Conflict '${conflictId}' not found.`);
  }

  if (inFlightAiRequests.has(conflictId)) {
    console.log(`[ConflictService] AI resolution already in-flight for conflict '${conflictId}'. Awaiting existing request.`);
    return inFlightAiRequests.get(conflictId);
  }

  ConflictModel.updateAiStatus(conflictId, { aiStatus: 'GENERATING' }, userId);

  const aiPromise = (async () => {
    try {
      const aiResult = await generateSemanticConflictResolution({
        noteId: conflict.note_id,
        ancestorContent: conflict.ancestor_content,
        localContent: conflict.local_content,
        remoteContent: conflict.remote_content,
        localDeviceName: 'Device A (Local)',
        remoteDeviceName: `${conflict.remote_device_name || 'Device B'} (${conflict.sync_source})`
      });

      return ConflictModel.updateAiStatus(conflictId, {
        aiStatus: aiResult.available ? 'AVAILABLE' : 'UNAVAILABLE',
        aiSummary: aiResult.data.summary,
        aiChanges: aiResult.data.changesFromAncestor,
        aiSuggestedMerge: aiResult.data.suggestedMerge,
        aiReasoning: aiResult.data.reasoning,
        aiError: aiResult.error || null,
        aiLatencyMs: aiResult.latencyMs
      }, userId);
    } finally {
      inFlightAiRequests.delete(conflictId);
    }
  })();

  inFlightAiRequests.set(conflictId, aiPromise);
  return await aiPromise;
}

/**
 * Apply user's conflict resolution decision through the existing version control engine.
 * Options: 'ACCEPT_AI' | 'EDIT_MERGE' | 'KEEP_LOCAL' | 'KEEP_REMOTE' | 'REJECT'
 */
async function resolveConflict({
  conflictId,
  userId = 'usr_local_default',
  resolutionMethod,
  customContent = null,
  message = null
}) {
  const currentUserId = userId || 'usr_local_default';
  const conflict = ConflictModel.getById(conflictId, currentUserId);

  if (!conflict) {
    throw new Error(`Conflict '${conflictId}' not found.`);
  }

  if (conflict.status === 'RESOLVED') {
    return { success: true, message: 'Conflict already resolved.', conflict };
  }

  const note = NoteModel.getById(conflict.note_id, currentUserId);
  if (!note) {
    throw new Error(`Note '${conflict.note_id}' not found.`);
  }

  const now = new Date().toISOString();
  const detectedAt = conflict.created_at;
  const resolutionDurationMs = Math.max(0, Date.now() - new Date(detectedAt).getTime());

  // Handle REJECT / RESOLVE LATER: leave both versions intact, keep conflict state
  if (resolutionMethod === 'REJECT') {
    ConflictModel.recordMetric({
      conflictId: conflict.id,
      noteId: note.id,
      syncSource: conflict.sync_source,
      detectedAt,
      resolvedAt: now,
      resolutionDurationMs,
      aiAvailable: conflict.ai_status === 'AVAILABLE' ? 1 : 0,
      aiModel: conflict.ai_model || 'llama3.2:1b',
      aiLatencyMs: conflict.ai_latency_ms,
      resolutionMethod: 'REJECT',
      aiSuggestionRejected: 1,
      ancestorLength: (conflict.ancestor_content || '').length,
      localLength: (conflict.local_content || '').length,
      remoteLength: (conflict.remote_content || '').length,
      mergedLength: 0
    });

    return {
      success: true,
      message: 'Conflict resolution deferred. Both versions preserved in history.',
      conflict
    };
  }

  // Determine final merged content and commit message based on user decision
  let finalContent = '';
  let versionMessage = '';
  let isAiAccepted = 0;
  let isAiEdited = 0;
  let manualChoice = 'NONE';

  switch (resolutionMethod) {
    case 'ACCEPT_AI':
      finalContent = conflict.ai_suggested_merge;
      if (!finalContent && finalContent !== '') {
        throw new Error('No AI suggestion available to accept.');
      }
      versionMessage = message && message.trim() ? message.trim() : `AI Semantic Merge: resolved conflict between local and ${conflict.remote_device_name || 'remote'}`;
      isAiAccepted = 1;
      break;

    case 'EDIT_MERGE':
      finalContent = typeof customContent === 'string' ? customContent : (conflict.ai_suggested_merge || conflict.local_content);
      versionMessage = message && message.trim() ? message.trim() : `Manual Edit Merge: resolved conflict between local and ${conflict.remote_device_name || 'remote'}`;
      isAiEdited = 1;
      break;

    case 'KEEP_LOCAL':
      finalContent = conflict.local_content;
      versionMessage = message && message.trim() ? message.trim() : `Resolved conflict: kept local version (from ${note.title})`;
      manualChoice = 'LOCAL';
      break;

    case 'KEEP_REMOTE':
      finalContent = conflict.remote_content;
      versionMessage = message && message.trim() ? message.trim() : `Resolved conflict: kept remote version from ${conflict.remote_device_name || 'remote peer'}`;
      manualChoice = 'REMOTE';
      break;

    default:
      throw new Error(`Invalid resolution method '${resolutionMethod}'. Expected ACCEPT_AI, EDIT_MERGE, KEEP_LOCAL, KEEP_REMOTE, or REJECT.`);
  }

  // Reconstruct latest version to compute line-level diff hunks for the new version
  let latestLocalVersion = null;
  if (conflict.local_version_id) {
    latestLocalVersion = VersionModel.getById(conflict.local_version_id, currentUserId);
  }
  if (!latestLocalVersion && note.current_version_id) {
    latestLocalVersion = VersionModel.getById(note.current_version_id, currentUserId);
  }
  if (!latestLocalVersion) {
    latestLocalVersion = VersionModel.getLatestForNote(note.id, currentUserId);
  }
  let previousWorkingContent = '';
  if (latestLocalVersion) {
    try {
      previousWorkingContent = reconstructVersionContent(latestLocalVersion.id, VersionModel, currentUserId);
    } catch (e) {
      previousWorkingContent = readNoteFile(note.file_path);
    }
  } else {
    previousWorkingContent = readNoteFile(note.file_path);
  }

  // Create NEW version in version control tree (ensures zero history destroyed)
  const diffHunks = computeLineDiffHunks(previousWorkingContent, finalContent);
  const nextVerNum = (latestLocalVersion ? latestLocalVersion.version_number : 0) + 1;
  const newVerId = `v${nextVerNum}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const newHash = calculateHash(finalContent);

  const versionData = {
    id: newVerId,
    note_id: note.id,
    version_number: nextVerNum,
    parent_version_id: latestLocalVersion ? latestLocalVersion.id : null,
    message: versionMessage,
    device_id: 'local_device',
    created_at: now,
    content_hash: newHash,
    is_snapshot: 0,
    is_auto: 0
  };

  // Commit version transaction
  const createdVersion = VersionModel.createCheckpointTransaction(versionData, diffHunks, note.id, currentUserId);

  // Write merged Markdown file to disk
  writeNoteFile(note.file_path, finalContent);

  // Update note metadata and reset sync state to SYNCED
  NoteModel.update(
    note.id,
    note.title,
    note.file_path,
    note.notebook_id,
    newHash,
    newVerId,
    currentUserId,
    note.sync_mode
  );

  NoteModel.updateSyncMetadata(note.id, currentUserId, {
    lastSyncedHash: newHash,
    lastSyncedAt: now,
    syncState: 'SYNCED',
    syncError: null
  });

  // Update session clean state
  SessionModel.upsert(note.id, newVerId, newHash, 'clean', currentUserId);

  // Mark conflict as RESOLVED in database
  const resolvedConflict = ConflictModel.resolve(conflict.id, {
    resolutionMethod,
    resolvedVersionId: newVerId,
    userId: currentUserId
  });

  // Record research evaluation metric
  ConflictModel.recordMetric({
    conflictId: conflict.id,
    noteId: note.id,
    syncSource: conflict.sync_source,
    detectedAt,
    resolvedAt: now,
    resolutionDurationMs,
    aiAvailable: conflict.ai_status === 'AVAILABLE' ? 1 : 0,
    aiModel: conflict.ai_model || 'llama3.2:1b',
    aiLatencyMs: conflict.ai_latency_ms,
    resolutionMethod,
    aiSuggestionAccepted: isAiAccepted,
    aiSuggestionEdited: isAiEdited,
    aiSuggestionRejected: 0,
    manualChoice,
    ancestorLength: (conflict.ancestor_content || '').length,
    localLength: (conflict.local_content || '').length,
    remoteLength: (conflict.remote_content || '').length,
    mergedLength: (finalContent || '').length
  });

  console.log(`[ConflictService] Successfully resolved conflict ${conflict.id} using '${resolutionMethod}'. Created Version V${nextVerNum} (${newVerId}).`);

  return {
    success: true,
    message: `Conflict resolved successfully as Version V${nextVerNum}`,
    resolvedVersion: createdVersion,
    conflict: resolvedConflict,
    note: NoteModel.getById(note.id, currentUserId)
  };
}

module.exports = {
  createOrRecordConflict,
  retryAiAnalysis,
  resolveConflict
};
