import React, { useState, useEffect } from 'react';
import { Eye, X, RotateCcw, Edit3, AlertTriangle, Loader2, Hash, Clock } from 'lucide-react';
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

  const payload = versionData || versionContentData || {};
  const versionObj = payload.version || payload;
  const versionNumber = versionObj.version_number ?? payload.version_number ?? '';
  const message = versionObj.message ?? payload.message ?? 'Checkpoint Snapshot';
  const createdAt = versionObj.created_at ?? payload.created_at;
  const contentHash = versionObj.content_hash ?? payload.content_hash ?? '';
  const content = payload.content !== undefined ? payload.content : (versionObj.content !== undefined ? versionObj.content : null);

  const formattedTime = formatRelativeTime(createdAt, 'Unknown date');
  const fullDate = formatDateSafe(createdAt, '');

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card version-preview-card" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div className="preview-icon-badge">
              <Eye size={16} />
            </div>
            <div>
              <h3 className="modal-title">
                Version V{versionNumber !== '' ? versionNumber : 'Snapshot'} (Read-Only)
              </h3>
              <p className="diff-subtitle">
                {message} · {formattedTime} {fullDate ? `(${fullDate})` : ''}
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div className="segmented-tab-control">
              <button 
                className={`segmented-tab-btn ${mode === 'preview' ? 'active' : ''}`}
                onClick={() => setMode('preview')}
                type="button"
              >
                <Eye size={12} />
                <span>Preview</span>
              </button>
              <button 
                className={`segmented-tab-btn ${mode === 'raw' ? 'active' : ''}`}
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
          <div className="version-preview-scroll-viewport">
            {isLoading ? (
              <div className="preview-loading-state">
                <Loader2 size={20} className="spin text-muted" />
                <span>Loading historical version...</span>
              </div>
            ) : error ? (
              <div className="preview-error-state">
                <AlertTriangle size={24} className="text-danger" />
                <span className="error-title">Unable to load this version</span>
                <span className="error-sub">{error}</span>
              </div>
            ) : content === '' ? (
              <div className="preview-empty-state">
                <em>Empty note content in this version</em>
              </div>
            ) : mode === 'preview' ? (
              <MarkdownRenderer content={content || ''} />
            ) : (
              <textarea
                className="raw-markdown-preview-textarea"
                value={content || ''}
                readOnly
              />
            )}
          </div>

          <div className="modal-footer" style={{ borderTop: '1px solid var(--border-subtle)', justifyContent: 'space-between', marginTop: '14px', paddingTop: '12px' }}>
            <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              {contentHash ? `SHA256: ${contentHash.substring(0, 16)}...` : ''}
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
                title="Restore this version as current"
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
