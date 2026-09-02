import React, { useState, useEffect } from 'react';
import { BookOpen, X } from 'lucide-react';

export default function NotebookModal({ isOpen, initialName = '', isEditing = false, onSave, onCancel }) {
  const [name, setName] = useState('');

  useEffect(() => {
    if (isOpen) {
      setName(initialName);
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
  }, [isOpen, initialName, onCancel]);

  if (!isOpen) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (name.trim()) {
      onSave(name.trim());
      setName('');
    }
  };

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <BookOpen size={16} style={{ color: 'var(--accent-primary)' }} />
            <h3 className="modal-title">{isEditing ? 'Rename Notebook' : 'Create Notebook'}</h3>
          </div>
          <button className="icon-btn-ghost" onClick={onCancel} title="Close (Esc)" type="button">
            <X size={15} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="modal-body">
          <div className="form-group">
            <label className="form-label">Notebook Name</label>
            <input
              type="text"
              className="modal-input"
              placeholder="e.g. Research, Projects, BTech Proj..."
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>

          <div className="modal-footer">
            <button type="button" className="secondary-action-btn" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="primary-action-btn">
              {isEditing ? 'Save Changes' : 'Create Notebook'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
