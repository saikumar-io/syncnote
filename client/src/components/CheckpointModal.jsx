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
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <GitCommit size={16} style={{ color: 'var(--accent-primary)' }} />
            <h3 className="modal-title">Create Checkpoint</h3>
          </div>
          <button className="icon-btn-ghost" onClick={onCancel} title="Close (Esc)" type="button">
            <X size={15} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="modal-body">
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.4 }}>
            Save a permanent version snapshot in history. Your current note content will be versioned into SQLite.
          </p>

          {statusMessage && (
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '8px', 
              padding: '8px 12px', 
              borderRadius: 'var(--radius-sm)', 
              background: 'rgba(234, 179, 8, 0.12)', 
              border: '1px solid rgba(234, 179, 8, 0.3)', 
              color: 'var(--accent-warning)', 
              fontSize: '0.78rem'
            }}>
              <AlertCircle size={14} style={{ flexShrink: 0 }} />
              <span>{statusMessage}</span>
            </div>
          )}

          <div className="form-group">
            <label className="form-label">Message (optional)</label>
            <input
              type="text"
              className="modal-input"
              placeholder="Describe your changes..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              autoFocus
            />
          </div>

          <div className="modal-footer">
            <button type="button" className="secondary-action-btn" onClick={onCancel} disabled={isSubmitting}>
              Cancel
            </button>
            <button type="submit" className="primary-action-btn" disabled={isSubmitting}>
              {isSubmitting ? 'Creating...' : 'Create Checkpoint'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
