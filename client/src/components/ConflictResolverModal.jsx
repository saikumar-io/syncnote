import React, { useState, useEffect } from 'react';
import { 
  AlertTriangle, 
  Check, 
  X, 
  Sparkles, 
  Edit3, 
  RefreshCw, 
  Layers, 
  CheckCircle2, 
  Info,
  ServerOff,
  Laptop
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
  const [activeTab, setActiveTab] = useState('merged'); // 'merged' | 'three-way' | 'ancestor'
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
        setEditedContent(propConflict.ai_suggested_merge || propConflict.local_content || '');
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
            setEditedContent(found.ai_suggested_merge || found.local_content || '');
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
              ai_changes: [],
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

  const noteTitle = conflict?.note_title || propNote?.title || 'Untitled Note';
  const noteId = conflict?.note_id || propNote?.id || 'note_unknown';
  const remoteDeviceName = conflict?.remote_device_name || 'Remote Peer';
  const aiReady = conflict?.ai_status === 'AVAILABLE' && Boolean(conflict?.ai_suggested_merge);
  const aiGenerating = isLoading || conflict?.ai_status === 'GENERATING';

  // Action Handlers
  const handleAction = async (resolutionMethod, customText = null) => {
    if (!conflict) return;
    setIsSubmitting(true);
    setErrorMessage('');

    try {
      const conflictId = conflict.id || conflict.conflictId;
      const noteIdentifier = conflict.note_id || conflict.noteId;

      // If it's a recorded persistent conflict in SQLite
      if (conflictId && !String(conflictId).startsWith('virtual_')) {
        const res = await apiClient.post(`/api/conflicts/${conflictId}/resolve`, {
          resolutionMethod,
          customContent: customText !== null ? customText : (resolutionMethod === 'EDIT_MERGE' ? editedContent : null)
        });

        if (onResolved) onResolved(noteIdentifier, resolutionMethod, res);
      } else {
        // Fallback for legacy cloud resolve endpoint if virtual
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

  const handleRetryAi = async () => {
    if (!conflict || !conflict.id || conflict.id.startsWith('virtual_')) return;
    setIsLoading(true);
    setErrorMessage('');
    try {
      const res = await apiClient.post(`/api/conflicts/${conflict.id}/retry-ai`);
      if (res && res.conflict) {
        setConflict(res.conflict);
        setEditedContent(res.conflict.ai_suggested_merge || res.conflict.local_content || '');
      }
    } catch (err) {
      setErrorMessage(err.message || 'AI assistant is still unavailable. Verify Ollama is running.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="modal-overlay" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)', zIndex: 9999 }}>
      <div 
        className="modal-content" 
        style={{ 
          maxWidth: '880px', 
          width: '95%', 
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
          padding: '0', 
          borderRadius: 'var(--radius-lg, 12px)', 
          background: 'var(--bg-modal, #18181b)', 
          border: '1px solid rgba(239, 68, 68, 0.35)', 
          boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)',
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
          background: 'linear-gradient(to right, rgba(239,68,68,0.1), rgba(24,24,27,0.8))'
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
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <h3 style={{ fontSize: '0.96rem', fontWeight: 700, letterSpacing: '0.02em', color: 'var(--text-primary)', margin: 0 }}>
                  SYNC CONFLICT DETECTED
                </h3>
                {aiReady ? (
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
                <code style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>id: {noteId}</code>
              </p>
            </div>
          </div>

          <button 
            type="button" 
            onClick={onClose}
            style={{ 
              background: 'transparent', 
              border: 'none', 
              color: 'var(--text-muted)', 
              cursor: 'pointer',
              padding: '6px',
              borderRadius: '6px'
            }}
          >
            <X size={18} />
          </button>
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

        {/* View Toggle Bar */}
        <div style={{ 
          padding: '8px 20px', 
          borderBottom: '1px solid var(--border-subtle, #27272a)',
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'space-between',
          background: 'var(--bg-app, #121214)'
        }}>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button
              type="button"
              onClick={() => { setActiveTab('merged'); setIsEditing(false); }}
              style={{
                fontSize: '0.72rem',
                fontWeight: 600,
                padding: '5px 12px',
                borderRadius: '6px',
                border: activeTab === 'merged' ? '1px solid var(--accent-primary, #3b82f6)' : '1px solid transparent',
                background: activeTab === 'merged' ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
                color: activeTab === 'merged' ? 'var(--accent-primary, #3b82f6)' : 'var(--text-secondary)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '5px'
              }}
            >
              <Sparkles size={13} /> AI Suggested Resolution
            </button>

            <button
              type="button"
              onClick={() => { setActiveTab('three-way'); setIsEditing(false); }}
              style={{
                fontSize: '0.72rem',
                fontWeight: 600,
                padding: '5px 12px',
                borderRadius: '6px',
                border: activeTab === 'three-way' ? '1px solid var(--accent-primary, #3b82f6)' : '1px solid transparent',
                background: activeTab === 'three-way' ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
                color: activeTab === 'three-way' ? 'var(--accent-primary, #3b82f6)' : 'var(--text-secondary)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '5px'
              }}
            >
              <Layers size={13} /> Compare Versions (Local vs Remote)
            </button>

            <button
              type="button"
              onClick={() => { setActiveTab('ancestor'); setIsEditing(false); }}
              style={{
                fontSize: '0.72rem',
                fontWeight: 600,
                padding: '5px 12px',
                borderRadius: '6px',
                border: activeTab === 'ancestor' ? '1px solid var(--accent-primary, #3b82f6)' : '1px solid transparent',
                background: activeTab === 'ancestor' ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
                color: activeTab === 'ancestor' ? 'var(--accent-primary, #3b82f6)' : 'var(--text-secondary)',
                cursor: 'pointer'
              }}
            >
              Common Ancestor
            </button>
          </div>

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
              <RefreshCw size={11} className={isLoading ? 'spin-icon' : ''} /> Retry Local AI
            </button>
          )}
        </div>

        {/* Modal Scrollable Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 20px', minHeight: '280px' }}>
          
          {/* TAB 1: AI Suggested Resolution (Default) */}
          {activeTab === 'merged' && (
            <div>
              {/* AI Semantic Summary & Explanation Card */}
              <div style={{ 
                background: 'rgba(59, 130, 246, 0.08)', 
                border: '1px solid rgba(59, 130, 246, 0.25)', 
                borderRadius: '8px', 
                padding: '12px 14px', 
                marginBottom: '14px' 
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--accent-primary, #3b82f6)', fontWeight: 600, fontSize: '0.78rem', marginBottom: '6px' }}>
                  <Sparkles size={14} />
                  <span>AI Semantic Conflict Analysis & Merge Explanation</span>
                </div>
                <div style={{ fontSize: '0.76rem', color: 'var(--text-primary)', lineHeight: 1.5, marginBottom: '6px' }}>
                  {conflict?.ai_summary || conflict?.aiSummary || 'Both devices created independent changes from the common ancestor.'}
                </div>
                {(conflict?.ai_reasoning || conflict?.aiReasoning) && (
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', fontStyle: 'italic', borderTop: '1px solid rgba(59,130,246,0.15)', paddingTop: '6px', marginTop: '6px' }}>
                    Reasoning: {conflict.ai_reasoning || conflict.aiReasoning}
                  </div>
                )}
                {((conflict?.ai_changes && conflict.ai_changes.length > 0) || (conflict?.aiChanges && conflict.aiChanges.length > 0)) && (
                  <ul style={{ margin: '6px 0 0 16px', padding: 0, fontSize: '0.71rem', color: 'var(--text-secondary)' }}>
                    {(conflict?.ai_changes || conflict?.aiChanges || []).map((change, idx) => (
                      <li key={idx}>{change}</li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Version Comparison Section: LOCAL VERSION vs REMOTE VERSION */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '14px' }}>
                {/* LOCAL VERSION */}
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                    <span style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--accent-primary, #3b82f6)', letterSpacing: '0.04em' }}>
                      LOCAL VERSION
                    </span>
                    <span style={{ fontSize: '0.66rem', color: 'var(--text-muted)' }}>This Device</span>
                  </div>
                  <pre style={{
                    margin: 0,
                    height: '140px',
                    overflowY: 'auto',
                    background: 'var(--bg-input, #09090b)',
                    color: 'var(--text-primary)',
                    border: '1px solid rgba(59, 130, 246, 0.3)',
                    borderRadius: '6px',
                    padding: '8px 10px',
                    fontFamily: 'var(--font-mono, monospace)',
                    fontSize: '0.72rem',
                    lineHeight: 1.45,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    boxSizing: 'border-box'
                  }}>
                    {conflict?.local_content || conflict?.localContent || '(Empty)'}
                  </pre>
                </div>

                {/* REMOTE VERSION */}
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                    <span style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--accent-emerald, #10b981)', letterSpacing: '0.04em' }}>
                      REMOTE VERSION
                    </span>
                    <span style={{ fontSize: '0.66rem', color: 'var(--text-muted)' }}>{remoteDeviceName}</span>
                  </div>
                  <pre style={{
                    margin: 0,
                    height: '140px',
                    overflowY: 'auto',
                    background: 'var(--bg-input, #09090b)',
                    color: 'var(--text-primary)',
                    border: '1px solid rgba(16, 185, 129, 0.3)',
                    borderRadius: '6px',
                    padding: '8px 10px',
                    fontFamily: 'var(--font-mono, monospace)',
                    fontSize: '0.72rem',
                    lineHeight: 1.45,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    boxSizing: 'border-box'
                  }}>
                    {conflict?.remote_content || conflict?.remoteContent || '(Empty)'}
                  </pre>
                </div>
              </div>

              {/* AI SUGGESTED MERGE Section */}
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
                      <Edit3 size={12} /> Edit & Accept
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => { setIsEditing(false); setEditedContent(conflict?.ai_suggested_merge || conflict?.aiSuggestedMerge || ''); }}
                      style={{ fontSize: '0.70rem', color: 'var(--text-muted)', background: 'transparent', border: 'none', cursor: 'pointer' }}
                    >
                      Reset to AI Suggestion
                    </button>
                  )}
                </div>

                {isEditing ? (
                  <textarea
                    value={editedContent}
                    onChange={(e) => setEditedContent(e.target.value)}
                    style={{
                      width: '100%',
                      height: '160px',
                      background: 'var(--bg-input, #09090b)',
                      color: 'var(--text-primary)',
                      border: '1px solid var(--accent-primary, #3b82f6)',
                      borderRadius: '6px',
                      padding: '10px',
                      fontFamily: 'var(--font-mono, monospace)',
                      fontSize: '0.76rem',
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
                    height: '160px',
                    overflowY: 'auto',
                    background: 'var(--bg-input, #09090b)',
                    color: 'var(--text-primary)',
                    border: '1px solid rgba(59, 130, 246, 0.35)',
                    borderRadius: '6px',
                    padding: '10px',
                    fontFamily: 'var(--font-mono, monospace)',
                    fontSize: '0.76rem',
                    lineHeight: 1.5,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    boxSizing: 'border-box'
                  }}>
                    {conflict?.ai_suggested_merge || conflict?.aiSuggestedMerge || conflict?.local_content || conflict?.localContent || '(Empty)'}
                  </pre>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: Compare Versions (Local vs Remote) */}
          {activeTab === 'three-way' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              {/* Local Device Version */}
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <span style={{ fontSize: '0.76rem', fontWeight: 600, color: 'var(--accent-primary, #3b82f6)' }}>
                    Device A (Local Version)
                  </span>
                  <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Current Note</span>
                </div>
                <pre style={{
                  margin: 0,
                  flex: 1,
                  height: '240px',
                  overflowY: 'auto',
                  background: 'var(--bg-input, #09090b)',
                  color: 'var(--text-primary)',
                  border: '1px solid rgba(59, 130, 246, 0.3)',
                  borderRadius: '6px',
                  padding: '10px',
                  fontFamily: 'var(--font-mono, monospace)',
                  fontSize: '0.74rem',
                  lineHeight: 1.5,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  boxSizing: 'border-box'
                }}>
                  {conflict?.local_content || '(Empty)'}
                </pre>
              </div>

              {/* Remote Device Version */}
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <span style={{ fontSize: '0.76rem', fontWeight: 600, color: 'var(--accent-emerald, #10b981)' }}>
                    Device B ({remoteDeviceName})
                  </span>
                  <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Incoming Peer</span>
                </div>
                <pre style={{
                  margin: 0,
                  flex: 1,
                  height: '240px',
                  overflowY: 'auto',
                  background: 'var(--bg-input, #09090b)',
                  color: 'var(--text-primary)',
                  border: '1px solid rgba(16, 185, 129, 0.3)',
                  borderRadius: '6px',
                  padding: '10px',
                  fontFamily: 'var(--font-mono, monospace)',
                  fontSize: '0.74rem',
                  lineHeight: 1.5,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  boxSizing: 'border-box'
                }}>
                  {conflict?.remote_content || '(Empty)'}
                </pre>
              </div>
            </div>
          )}

          {/* TAB 3: Common Ancestor */}
          {activeTab === 'ancestor' && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                <span style={{ fontSize: '0.76rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                  Common Ancestor Version (Origin of divergence)
                </span>
                <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                  {conflict?.ancestor_version_id ? `ID: ${conflict.ancestor_version_id}` : 'Base state'}
                </span>
              </div>
              <pre style={{
                margin: 0,
                height: '240px',
                overflowY: 'auto',
                background: 'var(--bg-input, #09090b)',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border-subtle, #27272a)',
                borderRadius: '6px',
                padding: '10px',
                fontFamily: 'var(--font-mono, monospace)',
                fontSize: '0.74rem',
                lineHeight: 1.5,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                boxSizing: 'border-box'
              }}>
                {conflict?.ancestor_content || '(Note was empty or created simultaneously)'}
              </pre>
            </div>
          )}

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
              title="Keep Local: preserve local version and create a resolution checkpoint"
            >
              Keep Local
            </button>

            <button
              type="button"
              className="btn-secondary"
              onClick={handleKeepRemote}
              disabled={isSubmitting}
              style={{ fontSize: '0.74rem', padding: '6px 12px' }}
              title="Keep Remote: replace local version with remote version only after confirmation"
            >
              Keep Remote
            </button>

            <button
              type="button"
              onClick={() => handleAction('REJECT')}
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
              title="Reject / Cancel: keep both versions unresolved and do not overwrite anything"
            >
              Reject / Cancel
            </button>
          </div>

          {/* Primary Action Buttons */}
          <div style={{ display: 'flex', gap: '8px' }}>
            {isEditing ? (
              <button
                type="button"
                className="btn-primary"
                onClick={() => handleAction('EDIT_MERGE', editedContent)}
                disabled={isSubmitting}
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
                  disabled={isSubmitting || !aiReady}
                  style={{ 
                    fontSize: '0.76rem', 
                    padding: '7px 16px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    background: aiReady ? 'var(--accent-primary, #3b82f6)' : 'var(--bg-input)',
                    opacity: aiReady ? 1 : 0.6
                  }}
                  title={aiReady ? 'Accept AI-suggested merge and create new version' : 'AI merge unavailable'}
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
