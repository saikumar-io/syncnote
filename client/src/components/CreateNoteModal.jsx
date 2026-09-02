import React, { useState, useEffect } from 'react';
import { X, FileText, BookOpen, Folder } from 'lucide-react';
import CustomSelect from './CustomSelect';

export default function CreateNoteModal({ 
  isOpen, 
  onClose, 
  onCreate, 
  notebooks = [],
  defaultNotebookId = null
}) {
  const [title, setTitle] = useState('');
  const [selectedNotebookId, setSelectedNotebookId] = useState('none');

  useEffect(() => {
    if (isOpen) {
      setTitle('');
      setSelectedNotebookId(defaultNotebookId || 'none');
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
  }, [isOpen, defaultNotebookId, onClose]);

  if (!isOpen) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    const finalNotebookId = selectedNotebookId === 'none' ? null : selectedNotebookId;
    onCreate({ title: title.trim() || 'Untitled Note', notebook_id: finalNotebookId });
    setTitle('');
    setSelectedNotebookId('none');
    onClose();
  };

  // Dynamically map notebooks array from application state/API
  const notebookOptions = [
    { value: 'none', label: 'Unassigned', icon: <BookOpen size={13} /> },
    ...notebooks.map((nb) => ({
      value: nb.id,
      label: nb.name,
      icon: <Folder size={13} style={{ color: 'var(--accent-primary)' }} />
    }))
  ];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FileText size={16} style={{ color: 'var(--accent-primary)' }} />
            <h3 className="modal-title">Create Note</h3>
          </div>
          <button 
            className="icon-btn-ghost" 
            onClick={onClose}
            title="Close (Esc)"
            type="button"
          >
            <X size={15} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="modal-body">
          <div className="form-group">
            <label className="form-label">Note Name</label>
            <input
              type="text"
              className="modal-input"
              placeholder="e.g. Database Management Systems"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
            />
          </div>

          <div className="form-group">
            <label className="form-label">Notebook / Folder</label>
            <CustomSelect
              value={selectedNotebookId}
              options={notebookOptions}
              onChange={setSelectedNotebookId}
            />
          </div>

          <div className="modal-footer">
            <button type="button" className="secondary-action-btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primary-action-btn">
              Create Note
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
