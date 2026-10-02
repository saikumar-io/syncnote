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
  const [errorMessage, setErrorMessage] = useState('');
  const [suggestedTitle, setSuggestedTitle] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setTitle('');
      setErrorMessage('');
      setSuggestedTitle('');
      setIsSubmitting(false);
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

  const handleSubmit = async (e) => {
    e.preventDefault();
    const trimmedTitle = title.trim() || 'Untitled Note';
    const finalNotebookId = selectedNotebookId === 'none' ? null : selectedNotebookId;
    setErrorMessage('');
    setSuggestedTitle('');
    setIsSubmitting(true);

    try {
      if (onCreate) {
        await onCreate({ title: trimmedTitle, notebook_id: finalNotebookId });
      }
      setTitle('');
      setSelectedNotebookId('none');
      onClose();
    } catch (err) {
      const errData = err.data || {};
      if (err.status === 409 || errData.code === 'DUPLICATE_NOTE_NAME') {
        setErrorMessage(errData.message || `A note named '${trimmedTitle}' already exists in this folder.`);
        if (errData.suggestedTitle) {
          setSuggestedTitle(errData.suggestedTitle);
        }
      } else {
        setErrorMessage(err.message || 'Failed to create note');
      }
    } finally {
      setIsSubmitting(false);
    }
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
          {errorMessage && (
            <div 
              className="duplicate-note-error-callout"
              style={{
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                borderRadius: '6px',
                padding: '10px 12px',
                color: '#ef4444',
                fontSize: '0.84rem',
                marginBottom: '14px',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px'
              }}
            >
              <div>{errorMessage}</div>
              {suggestedTitle && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '2px' }}>
                  <span style={{ color: 'var(--text-secondary, #94a3b8)', fontSize: '0.8rem' }}>Suggested name:</span>
                  <button
                    type="button"
                    onClick={() => {
                      setTitle(suggestedTitle);
                      setErrorMessage('');
                      setSuggestedTitle('');
                    }}
                    style={{
                      background: 'rgba(59, 130, 246, 0.15)',
                      border: '1px solid rgba(59, 130, 246, 0.35)',
                      borderRadius: '4px',
                      padding: '2px 8px',
                      color: '#3b82f6',
                      fontSize: '0.8rem',
                      cursor: 'pointer',
                      fontWeight: 500
                    }}
                  >
                    Use "{suggestedTitle}"
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="form-group">
            <label className="form-label">Note Name</label>
            <input
              type="text"
              className="modal-input"
              placeholder="e.g. Database Management Systems"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                if (errorMessage) {
                  setErrorMessage('');
                  setSuggestedTitle('');
                }
              }}
              autoFocus
            />
          </div>

          <div className="form-group">
            <label className="form-label">Notebook / Folder</label>
            <CustomSelect
              value={selectedNotebookId}
              options={notebookOptions}
              onChange={(val) => {
                setSelectedNotebookId(val);
                if (errorMessage) {
                  setErrorMessage('');
                  setSuggestedTitle('');
                }
              }}
            />
          </div>

          <div className="modal-footer">
            <button type="button" className="secondary-action-btn" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </button>
            <button type="submit" className="primary-action-btn" disabled={isSubmitting}>
              {isSubmitting ? 'Creating...' : 'Create Note'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
