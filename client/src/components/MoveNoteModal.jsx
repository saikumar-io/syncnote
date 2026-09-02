import React, { useState, useEffect } from 'react';
import { X, FolderInput, BookOpen, Folder } from 'lucide-react';
import CustomSelect from './CustomSelect';

export default function MoveNoteModal({ 
  isOpen, 
  onClose, 
  note, 
  notebooks = [], 
  onMoveNote 
}) {
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
  }, [isOpen, note, onClose]);

  if (!isOpen || !note) return null;

  const handleMove = () => {
    const finalNotebookId = selectedNotebookId === 'none' ? null : selectedNotebookId;
    onMoveNote(note.id, finalNotebookId);
    onClose();
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
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FolderInput size={16} style={{ color: 'var(--accent-primary)' }} />
            <h3 className="modal-title">Move "{note.title || 'Untitled'}"</h3>
          </div>
          <button className="icon-btn-ghost" onClick={onClose} title="Close (Esc)" type="button">
            <X size={15} />
          </button>
        </div>

        <div className="modal-body">
          <div className="form-group">
            <label className="form-label">Select Target Notebook / Folder</label>
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
            <button type="button" className="primary-action-btn" onClick={handleMove}>
              Move Note
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
