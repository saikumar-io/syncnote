import React, { useState, useEffect } from 'react';
import { BookOpen, X } from 'lucide-react';

export default function NotebookModal({ isOpen, initialName = '', isEditing = false, onSave, onCancel }) {
  const [name, setName] = useState('');

  useEffect(() => {
    setName(initialName);
  }, [initialName, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (name.trim()) {
      onSave(name.trim());
      setName('');
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-container">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-primary)', fontSize: '0.9rem', fontWeight: 600 }}>
            <BookOpen size={16} />
            <span>{isEditing ? 'Rename Notebook' : 'Create Notebook'}</span>
          </div>
          <button style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }} onClick={onCancel}>
            <X size={14} />
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <input
            type="text"
            className="search-input"
            style={{ borderRadius: 'var(--radius-sm)', padding: '8px 12px' }}
            placeholder="Notebook Name (e.g. Research, Project, Ideas)..."
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />

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
              {isEditing ? 'Save' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
