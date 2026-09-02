import React, { useState, useEffect } from 'react';
import { Folder, X, BookOpen } from 'lucide-react';
import CustomSelect from './CustomSelect';

export default function MoveNotebookModal({ isOpen, note, notebooks = [], onMove, onCancel }) {
  const [selectedNotebookId, setSelectedNotebookId] = useState('none');

  useEffect(() => {
    if (isOpen) {
      if (note) {
        setSelectedNotebookId(note.notebook_id || 'none');
      }
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
  }, [note, isOpen, onCancel]);

  if (!isOpen || !note) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    const finalNotebookId = selectedNotebookId === 'none' ? null : selectedNotebookId;
    onMove(note.id, finalNotebookId);
  };

  const notebookOptions = [
    { value: 'none', label: 'Unassigned', icon: <BookOpen size={13} /> },
    ...notebooks.map((nb) => ({
      value: nb.id,
      label: nb.name,
      icon: <Folder size={13} style={{ color: 'var(--accent-primary)' }} />
    }))
  ];

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Folder size={16} style={{ color: 'var(--accent-primary)' }} />
            <h3 className="modal-title">Move Note to Notebook</h3>
          </div>
          <button className="icon-btn-ghost" onClick={onCancel} title="Close (Esc)" type="button">
            <X size={15} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="modal-body">
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: 0 }}>
            Moving <strong style={{ color: 'var(--text-primary)' }}>"{note.title || 'Untitled Note'}"</strong> will relocate its physical <code className="md-inline-code">.md</code> file on disk.
          </p>

          <div className="form-group">
            <label className="form-label">Notebook / Folder</label>
            <CustomSelect
              value={selectedNotebookId}
              options={notebookOptions}
              onChange={setSelectedNotebookId}
            />
          </div>

          <div className="modal-footer">
            <button type="button" className="secondary-action-btn" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="primary-action-btn">
              Move File
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
