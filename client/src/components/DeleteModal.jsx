import React, { useEffect } from 'react';
import { Trash2, AlertTriangle, X } from 'lucide-react';

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
      <div className="modal-card delete-dialog-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div className="danger-icon-badge">
              <Trash2 size={16} />
            </div>
            <div>
              <h3 className="modal-title" style={{ color: 'var(--accent-danger)' }}>Delete {itemType}</h3>
              <p className="diff-subtitle">Permanent removal from disk and database</p>
            </div>
          </div>
          <button className="icon-btn-ghost" onClick={onCancel} title="Close (Esc)" type="button">
            <X size={15} />
          </button>
        </div>

        <div className="modal-body" style={{ padding: '16px 20px' }}>
          <p style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}>
            Are you sure you want to delete <strong style={{ color: 'var(--text-primary)' }}>"{title}"</strong>?
          </p>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '8px' }}>
            This action cannot be undone. The corresponding Markdown file will be removed from your local disk and its SQLite version history pruned.
          </p>

          <div className="modal-footer" style={{ marginTop: '20px', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <button type="button" className="secondary-action-btn" onClick={onCancel}>
              Cancel
            </button>
            <button 
              type="button" 
              className="danger-action-btn" 
              onClick={onConfirm}
            >
              <Trash2 size={13} />
              <span>Delete Permanently</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
