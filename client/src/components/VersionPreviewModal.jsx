import React, { useState, useEffect } from 'react';
import { Eye, X, RotateCcw, Edit3, AlertTriangle, Loader2 } from 'lucide-react';
import MarkdownRenderer from './MarkdownRenderer';
import { formatRelativeTime, formatDateSafe } from '../utils/timeUtils';

export default function VersionPreviewModal({ 
  isOpen, 
  onClose, 
  versionData, 
  versionContentData,
  isLoading = false,
  error = null,
  onRestore 
}) {
  const [mode, setMode] = useState('preview'); // 'preview' | 'raw'

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Accept both versionData or versionContentData, nested or flat
  const payload = versionData || versionContentData || {};
  const versionObj = payload.version || payload;
  const versionNumber = versionObj.version_number ?? payload.version_number ?? '';
  const message = versionObj.message ?? payload.message ?? 'Checkpoint';
  const createdAt = versionObj.created_at ?? payload.created_at;
  const contentHash = versionObj.content_hash ?? payload.content_hash ?? '';
  const content = payload.content !== undefined ? payload.content : (versionObj.content !== undefined ? versionObj.content : null);

  const formattedTime = formatRelativeTime(createdAt, 'Unknown date');
  const fullDate = formatDateSafe(createdAt, '');

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card version-preview-card" onClick={(e) => e.stopPropagation()} style={{ width: 'min(92vw, 700px)' }}>
        {/* Header */}
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Eye size={18} style={{ color: 'var(--accent-primary)' }} />
            <div>
              <h3 className="modal-title">
                Historical Version {versionNumber !== '' ? `V${versionNumber}` : ''} (Read-Only)
              </h3>
              <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                {message} • {formattedTime}{fullDate ? ` (${fullDate})` : ''}
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div className="editor-tabs" style={{ background: 'var(--bg-input)' }}>
              <button 
                className={`editor-tab-btn ${mode === 'preview' ? 'active' : ''}`}
                onClick={() => setMode('preview')}
                type="button"
              >
                <Eye size={12} />
                <span>Preview</span>
              </button>
              <button 
                className={`editor-tab-btn ${mode === 'raw' ? 'active' : ''}`}
                onClick={() => setMode('raw')}
                type="button"
              >
                <Edit3 size={12} />
                <span>Raw</span>
              </button>
            </div>
            <button className="icon-btn-ghost" onClick={onClose} title="Close (Esc)" type="button">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Content View */}
        <div className="modal-body" style={{ padding: '16px' }}>
          <div className="version-preview-body" style={{ minHeight: '180px', maxHeight: '60vh', overflowY: 'auto' }}>
            {isLoading ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '180px', gap: '8px', color: 'var(--text-muted)' }}>
                <Loader2 size={18} className="spin-animation" />
                <span>Loading version...</span>
              </div>
            ) : error ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '180px', gap: '8px', color: 'var(--accent-danger)' }}>
                <AlertTriangle size={24} />
                <span style={{ fontWeight: 600 }}>Unable to load this version</span>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{error}</span>
              </div>
            ) : content === '' ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '180px', color: 'var(--text-muted)', fontSize: '0.88rem' }}>
                <em>Empty note</em>
              </div>
            ) : mode === 'preview' ? (
              <MarkdownRenderer content={content || ''} />
            ) : (
              <textarea
                className="editor-content-textarea"
                value={content || ''}
                readOnly
                style={{ height: '300px', resize: 'none', width: '100%', fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}
              />
            )}
          </div>

          <div className="modal-footer" style={{ borderTop: '1px solid var(--border-subtle)', justifyContent: 'space-between', marginTop: '12px', paddingTop: '12px' }}>
            <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              {contentHash ? `Hash: ${contentHash.substring(0, 16)}...` : ''}
            </span>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button className="secondary-action-btn" onClick={onClose} type="button">
                Close
              </button>
              <button 
                className="primary-action-btn" 
                onClick={() => {
                  onClose();
                  if (onRestore) onRestore(versionObj);
                }}
                disabled={isLoading || !!error}
                title="Restore this historical version as a new checkpoint"
                style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                type="button"
              >
                <RotateCcw size={13} />
                <span>Restore as Current</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
