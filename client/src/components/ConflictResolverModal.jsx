import React, { useState, useEffect } from 'react';
import { 
  AlertTriangle, 
  Check, 
  X, 
  Sparkles, 
  Edit3, 
  RefreshCw, 
  ServerOff,
  Layers, 
  ArrowRight,
  GitMerge,
  Copy,
  CheckCircle2,
  FileText,
  ShieldAlert,
  Terminal,
  Cpu
} from 'lucide-react';
import { apiClient } from '../api/apiClient';

export default function ConflictResolverModal({ 
  conflict: propConflict, 
  note: propNote, 
  isOpen, 
  onClose, 
  onResolved 
}) {
  const [conflict, setConflict] = useState(propConflict || null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editedContent, setEditedContent] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [copiedSection, setCopiedSection] = useState(null);

  useEffect(() => {
    let isMounted = true;
    async function loadConflictData() {
      if (!isOpen) return;

      setErrorMessage('');
      setIsEditing(false);

      if (propConflict && propConflict.id) {
        setConflict(propConflict);
        setEditedContent(propConflict.ai_suggested_merge || propConflict.aiSuggestedMerge || propConflict.local_content || '');
        return;
      }

      const noteId = propNote ? propNote.id : (propConflict ? propConflict.note_id : null);
      if (noteId) {
        setIsLoading(true);
        try {
          const res = await apiClient.get(`/api/conflicts?note_id=${noteId}`);
          if (isMounted && res && res.conflicts && res.conflicts.length > 0) {
            const found = res.conflicts[0];
            setConflict(found);
            setEditedContent(found.ai_suggested_merge || found.aiSuggestedMerge || found.local_content || '');
          } else {
            setConflict({
              id: `virtual_${Date.now()}`,
              note_id: noteId,
              note_title: propNote?.title || 'Untitled Note',
              local_content: propNote?.content || '',
              remote_content: '',
              ancestor_content: '',
              remote_device_name: 'Remote Device',
              sync_source: propNote?.sync_mode === 'cloud' ? 'CLOUD' : 'LAN',
              ai_status: 'UNAVAILABLE',
              ai_summary: 'Sync conflict detected between local and remote versions.',
              ai_semantic_analysis: 'Sync conflict detected between local and remote versions.',
              ai_common_info: [],
              ai_contradictions: [],
              ai_suggested_merge: propNote?.content || '',
              ai_reasoning: 'Review both versions and select which content to preserve.'
            });
            setEditedContent(propNote?.content || '');
          }
        } catch (err) {
          console.error('Failed to load conflict:', err);
        } finally {
          if (isMounted) setIsLoading(false);
        }
      }
    }

    loadConflictData();
    return () => { isMounted = false; };
  }, [isOpen, propConflict, propNote]);

  if (!isOpen) return null;

  const noteTitle = conflict?.note_title || conflict?.title || propNote?.title || 'Untitled Note';
  const remoteDeviceName = conflict?.remote_device_name || conflict?.deviceName || conflict?.remoteDeviceName || 'Remote Peer';
  const aiReady = conflict?.ai_status === 'AVAILABLE' && Boolean(conflict?.ai_suggested_merge || conflict?.aiSuggestedMerge);
  const aiGenerating = isLoading || conflict?.ai_status === 'GENERATING';

  // Extract structured semantic reconciliation data
  const localContent = conflict?.local_content ?? conflict?.localContent ?? '';
  const remoteContent = conflict?.remote_content ?? conflict?.remoteContent ?? '';
  const semanticAnalysis = conflict?.ai_semantic_analysis || conflict?.aiSemanticAnalysis || conflict?.ai_reasoning || conflict?.ai_summary || '';
  const commonPoints = Array.isArray(conflict?.ai_common_info) 
    ? conflict.ai_common_info 
    : (Array.isArray(conflict?.aiCommonInfo) ? conflict.aiCommonInfo : []);
  const localUnique = Array.isArray(conflict?.ai_local_unique)
    ? conflict.ai_local_unique
    : (Array.isArray(conflict?.aiLocalUnique) ? conflict.aiLocalUnique : []);
  const remoteUnique = Array.isArray(conflict?.ai_remote_unique)
    ? conflict.ai_remote_unique
    : (Array.isArray(conflict?.aiRemoteUnique) ? conflict.aiRemoteUnique : []);
  const contradictions = Array.isArray(conflict?.ai_contradictions)
    ? conflict.ai_contradictions
    : (Array.isArray(conflict?.aiContradictions) ? conflict.aiContradictions : []);
  const hasContradictions = contradictions.length > 0;
  const suggestedMerge = conflict?.ai_suggested_merge || conflict?.aiSuggestedMerge || '';

  const copyToClipboard = (text, sectionKey) => {
    navigator.clipboard.writeText(text);
    setCopiedSection(sectionKey);
    setTimeout(() => setCopiedSection(null), 2000);
  };

  const handleAction = async (resolutionMethod, customText = null) => {
    if (!conflict) return;
    setIsSubmitting(true);
    setErrorMessage('');

    try {
      const conflictId = conflict.id || conflict.conflictId;
      const noteIdentifier = conflict.note_id || conflict.noteId;

      if (conflictId && !String(conflictId).startsWith('virtual_')) {
        const res = await apiClient.post(`/api/conflicts/${conflictId}/resolve`, {
          resolutionMethod,
          customContent: customText !== null ? customText : (resolutionMethod === 'EDIT_MERGE' ? editedContent : null)
        });

        if (onResolved) onResolved(noteIdentifier, resolutionMethod, res);
      } else {
        const choice = resolutionMethod === 'KEEP_REMOTE' ? 'keep_cloud' : 'keep_local';
        await apiClient.post('/api/sync/gdrive/resolve-conflict', {
          noteId: noteIdentifier,
          choice
        });
        if (onResolved) onResolved(noteIdentifier, resolutionMethod);
      }

      onClose();
    } catch (err) {
      console.error('Failed resolving conflict:', err);
      setErrorMessage(err.message || 'Failed to resolve conflict. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleKeepRemote = () => {
    const confirmed = window.confirm(
      `Replace your local note version with the remote version from ${remoteDeviceName}? This will overwrite your local changes.`
    );
    if (confirmed) {
      handleAction('KEEP_REMOTE');
    }
  };

  const handleCancel = () => {
    if (conflict?.id && !String(conflict.id).startsWith('virtual_')) {
      handleAction('REJECT').catch(() => {});
    }
    onClose();
  };

  const handleRetryAi = async () => {
    if (!conflict || !conflict.id || conflict.id.startsWith('virtual_')) return;
    setIsLoading(true);
    setErrorMessage('');
    try {
      const res = await apiClient.post(`/api/conflicts/${conflict.id}/retry-ai`);
      if (res && res.conflict) {
        setConflict(res.conflict);
        setEditedContent(res.conflict.ai_suggested_merge || res.conflict.aiSuggestedMerge || res.conflict.local_content || '');
      }
    } catch (err) {
      setErrorMessage(err.message || 'AI assistant is still unavailable. Verify Ollama is running.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="modal-backdrop conflict-studio-backdrop" onClick={handleCancel}>
      <div 
        className="conflict-studio-card"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Studio Top Header */}
        <div className="conflict-studio-header">
          <div className="studio-header-left">
            <div className="studio-alert-badge">
              <GitMerge size={18} />
            </div>
            <div>
              <div className="studio-title-row">
                <h2 className="studio-main-title">CONFLICT DETECTED</h2>
                {hasContradictions ? (
                  <span className="studio-status-pill warning">
                    <AlertTriangle size={11} />
                    <span>Contradictions Detected · User Choice Required</span>
                  </span>
                ) : aiReady ? (
                  <span className="studio-status-pill success">
                    <Sparkles size={11} />
                    <span>AI Suggested Merge Ready</span>
                  </span>
                ) : aiGenerating ? (
                  <span className="studio-status-pill analyzing">
                    <RefreshCw size={11} className="spin" />
                    <span>Analyzing Semantic Differences...</span>
                  </span>
                ) : (
                  <span className="studio-status-pill neutral">
                    <ServerOff size={11} />
                    <span>Local AI Offline · Manual Mode</span>
                  </span>
                )}
              </div>
              <p className="studio-subtitle-text">
                Target Note: <strong>{noteTitle}</strong> · Conflicting Peer: <strong>{remoteDeviceName}</strong>
              </p>
            </div>
          </div>

          <div className="studio-header-right">
            {!aiReady && !aiGenerating && (
              <button
                type="button"
                className="studio-retry-btn"
                onClick={handleRetryAi}
                disabled={isLoading}
              >
                <RefreshCw size={12} className={isLoading ? 'spin' : ''} />
                <span>Retry AI Analysis</span>
              </button>
            )}
            <button
              type="button"
              className="icon-btn-ghost studio-close-btn"
              onClick={handleCancel}
              title="Close without resolving"
            >
              <X size={17} />
            </button>
          </div>
        </div>

        {/* Error Notification */}
        {errorMessage && (
          <div className="studio-error-banner">
            <AlertTriangle size={14} />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Studio Scrollable Workspace */}
        <div className="conflict-studio-workspace">
          
          {/* SECTION 1: SIDE-BY-SIDE LOCAL vs REMOTE VERSIONS */}
          <div className="versions-split-grid">
            
            {/* LOCAL VERSION */}
            <div className="version-diff-pane local-pane">
              <div className="version-pane-header">
                <div className="pane-title-wrap">
                  <span className="source-indicator local">LOCAL VERSION</span>
                  <span className="device-source-tag">This Device</span>
                </div>
                <button 
                  className="icon-btn-ghost copy-btn"
                  onClick={() => copyToClipboard(localContent, 'local')}
                  title="Copy local content"
                >
                  {copiedSection === 'local' ? <Check size={12} className="text-success" /> : <Copy size={12} />}
                </button>
              </div>
              <pre className="code-source-canvas">
                {localContent || '(Empty Note)'}
              </pre>
            </div>

            {/* REMOTE VERSION */}
            <div className="version-diff-pane remote-pane">
              <div className="version-pane-header">
                <div className="pane-title-wrap">
                  <span className="source-indicator remote">REMOTE VERSION</span>
                  <span className="device-source-tag">{remoteDeviceName}</span>
                </div>
                <button 
                  className="icon-btn-ghost copy-btn"
                  onClick={() => copyToClipboard(remoteContent, 'remote')}
                  title="Copy remote content"
                >
                  {copiedSection === 'remote' ? <Check size={12} className="text-success" /> : <Copy size={12} />}
                </button>
              </div>
              <pre className="code-source-canvas">
                {remoteContent || '(Empty Note)'}
              </pre>
            </div>
          </div>

          {/* SECTION 2: AI SEMANTIC ANALYSIS */}
          <div className={`ai-semantic-analysis-card ${hasContradictions ? 'has-contradictions' : ''}`}>
            <div className="card-header-bar">
              <div className="card-title-left">
                <Sparkles size={14} className="sparkle-icon" />
                <span>AI SEMANTIC ANALYSIS</span>
              </div>
              <span className="model-chip">Local Inference Engine</span>
            </div>

            <p className="analysis-summary-text">
              {semanticAnalysis || 'Both devices created independent modifications. Semantic analysis evaluated intent and structure.'}
            </p>

            {/* Contradictions Alert Callout */}
            {hasContradictions && (
              <div className="contradictions-warning-box">
                <div className="warning-title-row">
                  <AlertTriangle size={14} className="warning-icon" />
                  <span className="warning-label">Direct Semantic Contradiction</span>
                </div>
                <ul className="contradictions-list">
                  {contradictions.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
                <p className="contradiction-recommendation">
                  The statements contain mutually exclusive choices. The AI will not silently override your intent. Choose "Keep Local", "Keep Remote", or "Edit & Accept".
                </p>
              </div>
            )}
          </div>

          {/* SECTION 3: COMMON INFORMATION & UNIQUE BREAKDOWNS */}
          <div className="common-info-card">
            <div className="card-header-bar">
              <div className="card-title-left">
                <Layers size={13} />
                <span>COMMON INFORMATION</span>
              </div>
            </div>

            {commonPoints.length > 0 ? (
              <ul className="common-points-list">
                {commonPoints.map((pt, idx) => (
                  <li key={idx}>{pt}</li>
                ))}
              </ul>
            ) : (
              <p className="empty-points-text">Both versions share base context or modified the same section differently.</p>
            )}

            {(localUnique.length > 0 || remoteUnique.length > 0) && (
              <div className="unique-breakdown-grid">
                {localUnique.length > 0 && (
                  <div className="unique-column local">
                    <span className="unique-heading">Local-Only Information:</span>
                    <ul className="unique-items-list">
                      {localUnique.map((u, i) => <li key={i}>{u}</li>)}
                    </ul>
                  </div>
                )}
                {remoteUnique.length > 0 && (
                  <div className="unique-column remote">
                    <span className="unique-heading">Remote-Only Information:</span>
                    <ul className="unique-items-list">
                      {remoteUnique.map((u, i) => <li key={i}>{u}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* SECTION 4: AI SUGGESTED MERGE */}
          <div className="suggested-merge-card">
            <div className="merge-header-row">
              <div className="merge-title-wrap">
                <span className="merge-title-text">AI SUGGESTED MERGE</span>
                {isEditing && (
                  <span className="editing-mode-pill">Editing Mode Active</span>
                )}
              </div>

              {!isEditing ? (
                <button
                  type="button"
                  className="studio-text-action-btn"
                  onClick={() => setIsEditing(true)}
                >
                  <Edit3 size={12} />
                  <span>Customize in Editor</span>
                </button>
              ) : (
                <button
                  type="button"
                  className="studio-text-action-btn reset"
                  onClick={() => {
                    setIsEditing(false);
                    setEditedContent(suggestedMerge || localContent);
                  }}
                >
                  Reset to AI Suggestion
                </button>
              )}
            </div>

            {isEditing ? (
              <textarea
                className="merge-interactive-textarea"
                value={editedContent}
                onChange={(e) => setEditedContent(e.target.value)}
                placeholder="Edit final merged note content..."
              />
            ) : (
              <pre className="merge-preview-canvas">
                {suggestedMerge || localContent || '(Empty Merge Result)'}
              </pre>
            )}
          </div>

        </div>

        {/* Studio Action Buttons Footer */}
        <div className="conflict-studio-footer">
          {/* Secondary manual fallback options */}
          <div className="footer-left-actions">
            <button
              type="button"
              className="btn-studio-secondary"
              onClick={() => handleAction('KEEP_LOCAL')}
              disabled={isSubmitting}
              title="Keep Local: Preserve this device's version and broadcast it"
            >
              Keep Local
            </button>

            <button
              type="button"
              className="btn-studio-secondary"
              onClick={handleKeepRemote}
              disabled={isSubmitting}
              title="Keep Remote: Replace with remote peer version"
            >
              Keep Remote
            </button>

            <button
              type="button"
              className="btn-studio-ghost"
              onClick={handleCancel}
              disabled={isSubmitting}
              title="Cancel without resolving"
            >
              Cancel
            </button>
          </div>

          {/* Primary Resolution Actions */}
          <div className="footer-right-actions">
            {isEditing ? (
              <>
                <button
                  type="button"
                  className="btn-studio-ghost"
                  onClick={() => setIsEditing(false)}
                  disabled={isSubmitting}
                >
                  Cancel Edit
                </button>
                <button
                  type="button"
                  className="btn-studio-primary"
                  onClick={() => handleAction('EDIT_MERGE', editedContent)}
                  disabled={isSubmitting || !editedContent.trim()}
                >
                  <Check size={14} />
                  <span>Accept Edited Version</span>
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="btn-studio-secondary"
                  onClick={() => setIsEditing(true)}
                  disabled={isSubmitting}
                >
                  <Edit3 size={13} />
                  <span>Edit & Accept</span>
                </button>

                <button
                  type="button"
                  className="btn-studio-primary"
                  onClick={() => handleAction('ACCEPT_AI')}
                  disabled={isSubmitting || !aiReady || hasContradictions}
                  title={
                    hasContradictions 
                      ? 'Contradiction detected: Please choose Keep Local, Keep Remote, or Edit & Accept' 
                      : (aiReady ? 'Accept AI-suggested merge' : 'AI merge unavailable')
                  }
                >
                  <Sparkles size={14} />
                  <span>Accept AI Merge</span>
                </button>
              </>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
