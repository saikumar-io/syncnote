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
      // If it's a recorded persistent conflict in SQLite
      if (conflict.id && !conflict.id.startsWith('virtual_')) {
        const res = await apiClient.post(`/api/conflicts/${conflict.id}/resolve`, {
          resolutionMethod,
          customContent: customText !== null ? customText : (resolutionMethod === 'EDIT_MERGE' ? editedContent : null)
        });

        if (onResolved) onResolved(conflict.note_id, resolutionMethod, res);
      } else {
        // Fallback for legacy cloud resolve endpoint if virtual
        const choice = resolutionMethod === 'KEEP_REMOTE' ? 'keep_cloud' : 'keep_local';
        await apiClient.post('/api/sync/gdrive/resolve-conflict', {
          noteId: conflict.note_id,
          choice
        });
        if (onResolved) onResolved(conflict.note_id, resolutionMethod);
      }

      onClose();
    } catch (err) {
      console.error('Failed resolving conflict:', err);
      setErrorMessage(err.message || 'Failed to resolve conflict. Please try again.');
    } finally {
      setIsSubmitting(false);
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
                  <Info size={14} />
                  <span>AI Semantic Explanation</span>
                </div>
                <div style={{ fontSize: '0.76rem', color: 'var(--text-primary)', lineHeight: 1.5, marginBottom: '6px' }}>
                  {conflict?.ai_summary || 'Both devices created independent changes from the common ancestor.'}
                </div>
                {conflict?.ai_reasoning && (
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', fontStyle: 'italic', borderTop: '1px solid rgba(59,130,246,0.15)', paddingTop: '6px', marginTop: '6px' }}>
                    Reasoning: {conflict.ai_reasoning}
                  </div>
                )}
                {conflict?.ai_changes && conflict.ai_changes.length > 0 && (
                  <ul style={{ margin: '6px 0 0 16px', padding: 0, fontSize: '0.71rem', color: 'var(--text-secondary)' }}>
                    {conflict.ai_changes.map((change, idx) => (
                      <li key={idx}>{change}</li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Merged Content Box */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <span style={{ fontSize: '0.76rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                    {isEditing ? 'Editing Merged Note Content' : 'AI Suggested Merged Content'}
                  </span>
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
                      <Edit3 size={12} /> Tweak / Edit Merge
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => { setIsEditing(false); setEditedContent(conflict?.ai_suggested_merge || ''); }}
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
                      height: '200px',
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
                    height: '200px',
                    overflowY: 'auto',
                    background: 'var(--bg-input, #09090b)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border-subtle, #27272a)',
                    borderRadius: '6px',
                    padding: '10px',
                    fontFamily: 'var(--font-mono, monospace)',
                    fontSize: '0.76rem',
                    lineHeight: 1.5,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    boxSizing: 'border-box'
                  }}>
                    {conflict?.ai_suggested_merge || conflict?.local_content || '(Empty)'}
                  </pre>
                )}
              </div>

              {/* Three-Way Source Context (Common Ancestor, Device A, Device B) */}
              <div style={{ marginTop: '16px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
                <div>
                  <div style={{ fontSize: '0.70rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '4px', textTransform: 'uppercase' }}>
                    COMMON ANCESTOR
                  </div>
                  <pre style={{ margin: 0, height: '110px', overflowY: 'auto', background: 'var(--bg-input, #09090b)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)', borderRadius: '6px', padding: '8px', fontSize: '0.70rem', lineHeight: 1.4, whiteSpace: 'pre-wrap', wordBreak: 'break-word', boxSizing: 'border-box' }}>
                    {conflict?.ancestor_content || '(Base state empty)'}
                  </pre>
                </div>
                <div>
                  <div style={{ fontSize: '0.70rem', fontWeight: 700, color: 'var(--accent-primary, #3b82f6)', marginBottom: '4px', textTransform: 'uppercase' }}>
                    DEVICE A (Local)
                  </div>
                  <pre style={{ margin: 0, height: '110px', overflowY: 'auto', background: 'var(--bg-input, #09090b)', color: 'var(--text-primary)', border: '1px solid rgba(59, 130, 246, 0.3)', borderRadius: '6px', padding: '8px', fontSize: '0.70rem', lineHeight: 1.4, whiteSpace: 'pre-wrap', wordBreak: 'break-word', boxSizing: 'border-box' }}>
                    {conflict?.local_content || '(Empty)'}
                  </pre>
                </div>
                <div>
                  <div style={{ fontSize: '0.70rem', fontWeight: 700, color: 'var(--accent-emerald, #10b981)', marginBottom: '4px', textTransform: 'uppercase' }}>
                    DEVICE B ({remoteDeviceName})
                  </div>
                  <pre style={{ margin: 0, height: '110px', overflowY: 'auto', background: 'var(--bg-input, #09090b)', color: 'var(--text-primary)', border: '1px solid rgba(16, 185, 129, 0.3)', borderRadius: '6px', padding: '8px', fontSize: '0.70rem', lineHeight: 1.4, whiteSpace: 'pre-wrap', wordBreak: 'break-word', boxSizing: 'border-box' }}>
                    {conflict?.remote_content || '(Empty)'}
                  </pre>
                </div>
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
              title="Preserve local version and create a resolution checkpoint"
            >
              Keep A
            </button>

            <button
              type="button"
              className="btn-secondary"
              onClick={() => handleAction('KEEP_REMOTE')}
              disabled={isSubmitting}
              style={{ fontSize: '0.74rem', padding: '6px 12px' }}
              title="Accept remote peer version as the new checkpoint"
            >
              Keep B
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
              title="Defer decision: keep both versions for later resolution"
            >
              Resolve Later
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
              >
                <Check size={14} /> Save & Commit Merged Version
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
                >
                  <Edit3 size={13} /> Edit Merge
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
