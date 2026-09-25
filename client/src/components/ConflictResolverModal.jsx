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
  ArrowRight
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

  // Load conflict details if only note or propConflict was passed
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
            // Fallback: If no conflict in conflicts table, construct virtual conflict from note
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

  // Action Handlers
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
      `Are you sure you want to replace your local note version with the remote version from ${remoteDeviceName}? This will overwrite your local changes.`
    );
    if (confirmed) {
      handleAction('KEEP_REMOTE');
    }
  };

  const handleCancel = () => {
    // Cancel without resolving: preserves both devices without modification
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
    <div className="modal-overlay" style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)', zIndex: 9999 }}>
      <div 
        className="modal-content" 
        style={{ 
          maxWidth: '920px', 
          width: '95%', 
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
          padding: '0', 
          borderRadius: 'var(--radius-lg, 12px)', 
          background: 'var(--bg-modal, #18181b)', 
          border: '1px solid rgba(239, 68, 68, 0.4)', 
          boxShadow: '0 25px 50px -12px rgba(0,0,0,0.6)',
          overflow: 'hidden'
        }}
      >
        
        {/* Modal Header */}
        <div style={{ 
          padding: '16px 20px', 
          borderBottom: '1px solid var(--border-subtle, #27272a)',
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'space-between',
          background: 'linear-gradient(to right, rgba(239,68,68,0.12), rgba(24,24,27,0.85))'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ 
              width: '38px', 
              height: '38px', 
              borderRadius: '8px', 
              background: 'rgba(239, 68, 68, 0.15)', 
              color: '#ef4444', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center' 
            }}>
              <AlertTriangle size={22} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <h3 style={{ fontSize: '0.98rem', fontWeight: 700, letterSpacing: '0.04em', color: 'var(--text-primary)', margin: 0 }}>
                  CONFLICT DETECTED
                </h3>
                {hasContradictions ? (
                  <span style={{ 
                    fontSize: '0.68rem', 
                    padding: '2px 8px', 
                    borderRadius: '12px', 
                    background: 'rgba(245, 158, 11, 0.15)', 
                    color: '#f59e0b', 
                    border: '1px solid rgba(245, 158, 11, 0.3)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}>
                    <AlertTriangle size={11} /> Contradiction Detected (User Decision Required)
                  </span>
                ) : aiReady ? (
                  <span style={{ 
                    fontSize: '0.68rem', 
                    padding: '2px 8px', 
                    borderRadius: '12px', 
                    background: 'rgba(16, 185, 129, 0.15)', 
                    color: '#10b981', 
                    border: '1px solid rgba(16, 185, 129, 0.3)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}>
                    <Sparkles size={11} /> AI Suggested Merge Ready
                  </span>
                ) : aiGenerating ? (
                  <span style={{ 
                    fontSize: '0.68rem', 
                    padding: '2px 8px', 
                    borderRadius: '12px', 
                    background: 'rgba(59, 130, 246, 0.15)', 
                    color: '#3b82f6', 
                    border: '1px solid rgba(59, 130, 246, 0.3)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}>
                    <RefreshCw size={11} className="spin-icon" /> AI Analyzing...
                  </span>
                ) : (
                  <span style={{ 
                    fontSize: '0.68rem', 
                    padding: '2px 8px', 
                    borderRadius: '12px', 
                    background: 'rgba(245, 158, 11, 0.15)', 
                    color: '#f59e0b', 
                    border: '1px solid rgba(245, 158, 11, 0.3)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}>
                    <ServerOff size={11} /> Local AI Unavailable (Manual Mode)
                  </span>
                )}
              </div>
              <p style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', margin: '3px 0 0 0' }}>
                Note: <strong style={{ color: 'var(--text-primary)' }}>{noteTitle}</strong> 
                <span style={{ margin: '0 6px', color: 'var(--border-subtle)' }}>•</span>
                Peer: <strong style={{ color: 'var(--text-primary)' }}>{remoteDeviceName}</strong>
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {!aiReady && !aiGenerating && (
              <button
                type="button"
                onClick={handleRetryAi}
                disabled={isLoading}
                style={{
                  fontSize: '0.70rem',
                  padding: '4px 10px',
                  borderRadius: '4px',
                  border: '1px solid var(--border-subtle)',
                  background: 'var(--bg-input)',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}
              >
                <RefreshCw size={11} className={isLoading ? 'spin-icon' : ''} /> Retry AI Analysis
              </button>
            )}

            <button 
              type="button" 
              onClick={handleCancel}
              style={{ 
                background: 'transparent', 
                border: 'none', 
                color: 'var(--text-muted)', 
                cursor: 'pointer',
                padding: '6px',
                borderRadius: '6px'
              }}
              title="Close without resolving"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Error / Alert banner */}
        {errorMessage && (
          <div style={{ 
            padding: '8px 16px', 
            background: 'rgba(239, 68, 68, 0.15)', 
            color: '#ef4444', 
            fontSize: '0.74rem', 
            borderBottom: '1px solid rgba(239, 68, 68, 0.25)' 
          }}>
            {errorMessage}
          </div>
        )}

        {/* Modal Scrollable Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          
          {/* SECTION 1: LOCAL VERSION vs REMOTE VERSION */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            {/* LOCAL VERSION */}
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                <span style={{ fontSize: '0.76rem', fontWeight: 700, color: 'var(--accent-primary, #3b82f6)', letterSpacing: '0.04em' }}>
                  LOCAL VERSION
                </span>
                <span style={{ fontSize: '0.66rem', color: 'var(--text-muted)' }}>This Device</span>
              </div>
              <pre style={{
                margin: 0,
                height: '130px',
                overflowY: 'auto',
                background: 'var(--bg-input, #09090b)',
                color: 'var(--text-primary)',
                border: '1px solid rgba(59, 130, 246, 0.3)',
                borderRadius: '6px',
                padding: '8px 10px',
                fontFamily: 'var(--font-mono, monospace)',
                fontSize: '0.73rem',
                lineHeight: 1.45,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                boxSizing: 'border-box'
              }}>
                {localContent || '(Empty)'}
              </pre>
            </div>

            {/* REMOTE VERSION */}
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                <span style={{ fontSize: '0.76rem', fontWeight: 700, color: 'var(--accent-emerald, #10b981)', letterSpacing: '0.04em' }}>
                  REMOTE VERSION
                </span>
                <span style={{ fontSize: '0.66rem', color: 'var(--text-muted)' }}>{remoteDeviceName}</span>
              </div>
              <pre style={{
                margin: 0,
                height: '130px',
                overflowY: 'auto',
                background: 'var(--bg-input, #09090b)',
                color: 'var(--text-primary)',
                border: '1px solid rgba(16, 185, 129, 0.3)',
                borderRadius: '6px',
                padding: '8px 10px',
                fontFamily: 'var(--font-mono, monospace)',
                fontSize: '0.73rem',
                lineHeight: 1.45,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                boxSizing: 'border-box'
              }}>
                {remoteContent || '(Empty)'}
              </pre>
            </div>
          </div>

          {/* SECTION 2: AI SEMANTIC ANALYSIS */}
          <div style={{ 
            background: hasContradictions ? 'rgba(245, 158, 11, 0.08)' : 'rgba(59, 130, 246, 0.08)', 
            border: hasContradictions ? '1px solid rgba(245, 158, 11, 0.3)' : '1px solid rgba(59, 130, 246, 0.25)', 
            borderRadius: '8px', 
            padding: '12px 14px'
          }}>
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '6px', 
              color: hasContradictions ? '#f59e0b' : 'var(--accent-primary, #3b82f6)', 
              fontWeight: 700, 
              fontSize: '0.78rem', 
              letterSpacing: '0.04em',
              marginBottom: '6px' 
            }}>
              <Sparkles size={14} />
              <span>AI SEMANTIC ANALYSIS</span>
            </div>
            
            <div style={{ fontSize: '0.76rem', color: 'var(--text-primary)', lineHeight: 1.5 }}>
              {semanticAnalysis || 'Both devices created independent changes from the common ancestor.'}
            </div>

            {/* Direct Contradictions Warning */}
            {hasContradictions && (
              <div style={{ 
                marginTop: '10px', 
                padding: '8px 12px', 
                borderRadius: '6px', 
                background: 'rgba(239, 68, 68, 0.12)', 
                border: '1px solid rgba(239, 68, 68, 0.3)' 
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#ef4444', fontWeight: 600, fontSize: '0.74rem', marginBottom: '4px' }}>
                  <AlertTriangle size={13} />
                  <span>Contradiction Detected:</span>
                </div>
                <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '0.72rem', color: 'var(--text-primary)' }}>
                  {contradictions.map((item, idx) => (
                    <li key={idx} style={{ marginBottom: '2px' }}>{item}</li>
                  ))}
                </ul>
                <div style={{ fontSize: '0.71rem', color: '#f59e0b', marginTop: '4px', fontStyle: 'italic' }}>
                  Suggestion: Statements contain conflicting choices. Please choose "Keep Local", "Keep Remote", or "Edit & Accept" to select the final result.
                </div>
              </div>
            )}
          </div>

          {/* SECTION 3: COMMON INFORMATION */}
          <div style={{ 
            background: 'var(--bg-input, #09090b)', 
            border: '1px solid var(--border-subtle, #27272a)', 
            borderRadius: '8px', 
            padding: '12px 14px' 
          }}>
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '6px', 
              color: 'var(--text-secondary)', 
              fontWeight: 700, 
              fontSize: '0.76rem', 
              letterSpacing: '0.04em',
              marginBottom: '6px' 
            }}>
              <Layers size={13} />
              <span>COMMON INFORMATION</span>
            </div>

            {commonPoints.length > 0 ? (
              <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '0.73rem', color: 'var(--text-primary)', lineHeight: 1.5 }}>
                {commonPoints.map((point, idx) => (
                  <li key={idx} style={{ marginBottom: '3px' }}>{point}</li>
                ))}
              </ul>
            ) : (
              <p style={{ margin: 0, fontSize: '0.73rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                Both versions share base context or modified the same section differently.
              </p>
            )}

            {/* Unique Information details */}
            {(localUnique.length > 0 || remoteUnique.length > 0) && (
              <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid var(--border-subtle, #27272a)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                {localUnique.length > 0 && (
                  <div>
                    <span style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--accent-primary, #3b82f6)' }}>Local Unique:</span>
                    <ul style={{ margin: '2px 0 0 0', paddingLeft: '14px', fontSize: '0.70rem', color: 'var(--text-secondary)' }}>
                      {localUnique.map((u, i) => <li key={i}>{u}</li>)}
                    </ul>
                  </div>
                )}
                {remoteUnique.length > 0 && (
                  <div>
                    <span style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--accent-emerald, #10b981)' }}>Remote Unique:</span>
                    <ul style={{ margin: '2px 0 0 0', paddingLeft: '14px', fontSize: '0.70rem', color: 'var(--text-secondary)' }}>
                      {remoteUnique.map((u, i) => <li key={i}>{u}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* SECTION 4: AI SUGGESTED MERGE */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '0.76rem', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '0.04em' }}>
                  AI SUGGESTED MERGE
                </span>
                {isEditing && (
                  <span style={{ fontSize: '0.68rem', padding: '1px 6px', borderRadius: '4px', background: 'rgba(59, 130, 246, 0.2)', color: 'var(--accent-primary)' }}>
                    Editing Mode
                  </span>
                )}
              </div>
              {!isEditing ? (
                <button
                  type="button"
                  onClick={() => setIsEditing(true)}
                  style={{
                    fontSize: '0.70rem',
                    color: 'var(--accent-primary)',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                >
                  <Edit3 size={12} /> Edit before accepting
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => { setIsEditing(false); setEditedContent(suggestedMerge || localContent); }}
                  style={{ fontSize: '0.70rem', color: 'var(--text-muted)', background: 'transparent', border: 'none', cursor: 'pointer' }}
                >
                  Reset to AI suggestion
                </button>
              )}
            </div>

            {isEditing ? (
              <textarea
                value={editedContent}
                onChange={(e) => setEditedContent(e.target.value)}
                style={{
                  width: '100%',
                  height: '140px',
                  background: 'var(--bg-input, #09090b)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--accent-primary, #3b82f6)',
                  borderRadius: '6px',
                  padding: '10px',
                  fontFamily: 'var(--font-mono, monospace)',
                  fontSize: '0.75rem',
                  lineHeight: 1.5,
                  resize: 'vertical',
                  boxSizing: 'border-box'
                }}
                placeholder="Enter customized merged note content..."
              />
            ) : (
              <pre style={{
                margin: 0,
                width: '100%',
                height: '140px',
                overflowY: 'auto',
                background: 'var(--bg-input, #09090b)',
                color: 'var(--text-primary)',
                border: '1px solid rgba(59, 130, 246, 0.35)',
                borderRadius: '6px',
                padding: '10px',
                fontFamily: 'var(--font-mono, monospace)',
                fontSize: '0.75rem',
                lineHeight: 1.5,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                boxSizing: 'border-box'
              }}>
                {suggestedMerge || localContent || '(Empty)'}
              </pre>
            )}
          </div>

        </div>

        {/* Modal Action Buttons Footer */}
        <div style={{ 
          padding: '14px 20px', 
          borderTop: '1px solid var(--border-subtle, #27272a)',
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'space-between',
          background: 'var(--bg-app, #121214)',
          flexWrap: 'wrap',
          gap: '10px'
        }}>
          {/* Secondary manual buttons */}
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => handleAction('KEEP_LOCAL')}
              disabled={isSubmitting}
              style={{ fontSize: '0.74rem', padding: '6px 12px' }}
              title="Keep Local: preserve local version and synchronize it to peer"
            >
              Keep Local
            </button>

            <button
              type="button"
              className="btn-secondary"
              onClick={handleKeepRemote}
              disabled={isSubmitting}
              style={{ fontSize: '0.74rem', padding: '6px 12px' }}
              title="Keep Remote: replace local version with peer version"
            >
              Keep Remote
            </button>

            <button
              type="button"
              onClick={handleCancel}
              disabled={isSubmitting}
              style={{ 
                fontSize: '0.74rem', 
                padding: '6px 12px',
                background: 'transparent',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-muted)',
                borderRadius: '6px',
                cursor: 'pointer'
              }}
              title="Cancel: close without resolving, keep both versions unchanged"
            >
              Cancel
            </button>
          </div>

          {/* Primary Action Buttons */}
          <div style={{ display: 'flex', gap: '8px' }}>
            {isEditing ? (
              <>
                <button
                  type="button"
                  onClick={() => setIsEditing(false)}
                  disabled={isSubmitting}
                  style={{
                    fontSize: '0.74rem',
                    padding: '6px 12px',
                    background: 'transparent',
                    border: '1px solid var(--border-subtle)',
                    color: 'var(--text-secondary)',
                    borderRadius: '6px',
                    cursor: 'pointer'
                  }}
                >
                  Cancel Edit
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => handleAction('EDIT_MERGE', editedContent)}
                  disabled={isSubmitting || !editedContent.trim()}
                  style={{ 
                    fontSize: '0.76rem', 
                    padding: '7px 16px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                  title="Save and commit your edited version"
                >
                  <Check size={14} /> Accept Edited Version
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setIsEditing(true)}
                  disabled={isSubmitting}
                  style={{ 
                    fontSize: '0.74rem', 
                    padding: '6px 12px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px'
                  }}
                  title="Edit and customize the merged version before accepting"
                >
                  <Edit3 size={13} /> Edit & Accept
                </button>

                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => handleAction('ACCEPT_AI')}
                  disabled={isSubmitting || !aiReady || hasContradictions}
                  style={{ 
                    fontSize: '0.76rem', 
                    padding: '7px 16px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    background: (aiReady && !hasContradictions) ? 'var(--accent-primary, #3b82f6)' : 'var(--bg-input)',
                    opacity: (aiReady && !hasContradictions) ? 1 : 0.6,
                    cursor: (aiReady && !hasContradictions) ? 'pointer' : 'not-allowed'
                  }}
                  title={
                    hasContradictions 
                      ? 'Contradiction detected: Please choose Keep Local, Keep Remote, or Edit & Accept' 
                      : (aiReady ? 'Accept AI-suggested merge and create canonical version' : 'AI merge unavailable')
                  }
                >
                  <Sparkles size={14} /> Accept AI Merge
                </button>
              </>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
