import React, { useEffect } from 'react';
import { AlertTriangle, X } from 'lucide-react';

export default function DeleteNotebookModal({ 
  isOpen, 
  onClose, 
  notebook, 
  noteCount = 0, 
  onConfirmDelete 
}) {
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

  if (!isOpen || !notebook) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertTriangle size={16} style={{ color: 'var(--accent-danger)' }} />
            <h3 className="modal-title" style={{ color: 'var(--accent-danger)' }}>Delete "{notebook.name}"?</h3>
          </div>
          <button className="icon-btn-ghost" onClick={onClose} title="Close (Esc)" type="button">
            <X size={15} />
          </button>
        </div>

        <div className="modal-body">
          {noteCount > 0 ? (
            <p style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}>
              This notebook contains <strong>{noteCount} {noteCount === 1 ? 'note' : 'notes'}</strong>. All contained notes will be moved to <strong>"Unassigned"</strong>. No notes will be deleted.
            </p>
          ) : (
            <p style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}>
              Delete the notebook <strong>"{notebook.name}"</strong>? This action cannot be undone.
            </p>
          )}

          <div className="modal-footer">
            <button type="button" className="secondary-action-btn" onClick={onClose}>
              Cancel
            </button>
            <button 
              type="button" 
              className="primary-action-btn"
              style={{ background: 'var(--accent-danger)', borderColor: 'var(--accent-danger)', color: '#ffffff', fontWeight: 600 }}
              onClick={() => {
                onConfirmDelete(notebook.id);
                onClose();
              }}
            >
              Delete
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
