import React from 'react';
import { AlertTriangle, X } from 'lucide-react';

export default function DeleteModal({ isOpen, title, itemType, onConfirm, onCancel }) {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-container">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--accent-danger)', fontSize: '0.9rem', fontWeight: 600 }}>
            <AlertTriangle size={16} />
            <span>Delete {itemType}</span>
          </div>
          <button style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }} onClick={onCancel}>
            <X size={14} />
          </button>
        </div>
        
        <p style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          Are you sure you want to delete <strong style={{ color: 'var(--text-primary)' }}>"{title}"</strong>? This will permanently remove the Markdown file.
        </p>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
          <button 
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
            onClick={onConfirm}
            style={{
              background: 'var(--accent-danger)',
              border: 'none',
              color: '#ffffff',
              padding: '5px 12px',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.78rem',
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
