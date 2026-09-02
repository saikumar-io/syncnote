import React, { useEffect } from 'react';
import { AlertTriangle, X } from 'lucide-react';

export default function DeleteModal({ isOpen, title, itemType = 'Note', onConfirm, onCancel }) {
  useEffect(() => {
    if (isOpen) {
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

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertTriangle size={16} style={{ color: 'var(--accent-danger)' }} />
            <h3 className="modal-title" style={{ color: 'var(--accent-danger)' }}>Delete {itemType}</h3>
          </div>
          <button className="icon-btn-ghost" onClick={onCancel} title="Close (Esc)" type="button">
            <X size={15} />
          </button>
        </div>

        <div className="modal-body">
          <p style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}>
            Are you sure you want to delete <strong style={{ color: 'var(--text-primary)' }}>"{title}"</strong>? This will permanently remove the Markdown file from disk and SQLite history.
          </p>

          <div className="modal-footer">
            <button type="button" className="secondary-action-btn" onClick={onCancel}>
              Cancel
            </button>
            <button 
              type="button" 
              className="primary-action-btn" 
              onClick={onConfirm}
              style={{ background: 'var(--accent-danger)', borderColor: 'var(--accent-danger)', color: '#ffffff' }}
            >
              Delete
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
