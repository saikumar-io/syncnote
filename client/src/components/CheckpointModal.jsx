import React, { useState, useEffect } from 'react';
import { GitCommit, X, AlertCircle } from 'lucide-react';

export default function CheckpointModal({ isOpen, onConfirm, onCancel, statusMessage, isSubmitting }) {
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (isOpen) {
      setMessage('');
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onCancel();
      }
    };

    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    onConfirm(message);
  };

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal-card checkpoint-dialog-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
            <div className="checkpoint-icon-badge">
              <GitCommit size={16} />
            </div>
            <div>
              <h3 className="modal-title">Create Checkpoint Snapshot</h3>
              <p className="diff-subtitle">Record a permanent version snapshot into SQLite history</p>
            </div>
          </div>
          <button className="icon-btn-ghost" onClick={onCancel} title="Close (Esc)" type="button">
            <X size={15} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="modal-body" style={{ padding: '16px 20px' }}>
          {statusMessage && (
            <div className="checkpoint-alert-banner">
              <AlertCircle size={14} style={{ flexShrink: 0 }} />
              <span>{statusMessage}</span>
            </div>
          )}

          <div className="form-group" style={{ marginBottom: '16px' }}>
            <label className="field-title" style={{ marginBottom: '6px', display: 'block', fontSize: '0.8rem' }}>
              Commit / Checkpoint Message (Optional)
            </label>
            <input
              type="text"
              className="settings-text-input"
              placeholder="e.g. Added section on distributed consensus protocols"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              autoFocus
              style={{ width: '100%' }}
            />
          </div>

          <div className="modal-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
              Press <kbd>Enter</kbd> to save
            </span>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button type="button" className="secondary-action-btn" onClick={onCancel} disabled={isSubmitting}>
                Cancel
              </button>
              <button type="submit" className="primary-action-btn" disabled={isSubmitting}>
                {isSubmitting ? 'Creating Snapshot...' : 'Save Checkpoint'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
