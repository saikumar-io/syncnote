import React, { useState, useEffect } from 'react';
import { Folder, X } from 'lucide-react';

export default function MoveNotebookModal({ isOpen, note, notebooks = [], onMove, onCancel }) {
  const [selectedNotebookId, setSelectedNotebookId] = useState('');

  useEffect(() => {
    if (note) {
      setSelectedNotebookId(note.notebook_id || '');
    }
  }, [note, isOpen]);

  if (!isOpen || !note) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    onMove(note.id, selectedNotebookId || null);
  };

  return (
    <div className="modal-overlay">
      <div className="modal-container">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-primary)', fontSize: '0.9rem', fontWeight: 600 }}>
            <Folder size={16} />
            <span>Move Note to Notebook</span>
          </div>
          <button style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }} onClick={onCancel}>
            <X size={14} />
          </button>
        </div>

        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          Moving <strong style={{ color: 'var(--text-primary)' }}>"{note.title || 'Untitled Note'}"</strong> will relocate its physical <code className="md-inline-code">.md</code> file on disk.
        </p>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <select
            className="search-input"
            style={{ padding: '8px 12px', borderRadius: 'var(--radius-sm)', outline: 'none' }}
            value={selectedNotebookId}
            onChange={(e) => setSelectedNotebookId(e.target.value)}
          >
            <option value="">Unassigned (General Notes)</option>
            {notebooks.map((nb) => (
              <option key={nb.id} value={nb.id}>
                {nb.name} ({nb.note_count || 0} notes)
              </option>
            ))}
          </select>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px' }}>
            <button 
              type="button" 
              onClick={onCancel}
              style={{
                background: 'transparent',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-primary)',
                padding: '5px 12px',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.78rem',
                cursor: 'pointer'
              }}
            >
              Cancel
            </button>
            <button 
              type="submit" 
              style={{
                background: 'var(--text-primary)',
                border: 'none',
                color: 'var(--bg-app)',
                padding: '5px 12px',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.78rem',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              Move File
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
