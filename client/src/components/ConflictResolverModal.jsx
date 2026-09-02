import React, { useState } from 'react';
import { AlertTriangle, Check, X, ShieldAlert } from 'lucide-react';
import { apiClient } from '../api/apiClient';

export default function ConflictResolverModal({ note, isOpen, onClose, onResolved }) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen || !note) return null;

  const handleResolve = async (choice) => {
    setIsSubmitting(true);
    try {
      await apiClient.post('/api/sync/gdrive/resolve-conflict', {
        noteId: note.id,
        choice // 'keep_local' | 'keep_cloud'
      });
      if (onResolved) onResolved(note.id, choice);
      onClose();
    } catch (err) {
      console.error('Resolve Conflict Error:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)', zIndex: 9999 }}>
      <div className="modal-content" style={{ maxWidth: '520px', width: '92%', padding: '24px', borderRadius: 'var(--radius-md)', background: 'var(--bg-modal)', border: '1px solid rgba(239, 68, 68, 0.4)', boxShadow: '0 20px 40px rgba(0,0,0,0.4)' }}>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
          <div style={{ width: '42px', height: '42px', borderRadius: '50%', background: 'rgba(239, 68, 68, 0.15)', color: '#ef4444', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <ShieldAlert size={24} />
          </div>
          <div>
            <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
              Sync Conflict Detected
            </h3>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: '2px 0 0 0' }}>
              Note: <strong style={{ color: 'var(--text-primary)' }}>{note.title || 'Untitled'}</strong>
            </p>
          </div>
        </div>

        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: '20px' }}>
          This note was edited locally while another copy was saved to Google Drive. Choose which version you would like to keep as the primary document:
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '20px' }}>
          <button
            type="button"
            onClick={() => handleResolve('keep_local')}
            disabled={isSubmitting}
            style={{
              display: 'flex',
              alignItems: 'center',
              justify: 'space-between',
              padding: '12px 14px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-subtle)',
              background: 'var(--bg-input)',
              color: 'var(--text-primary)',
              textAlign: 'left',
              cursor: 'pointer',
              fontSize: '0.8rem'
            }}
          >
            <div>
              <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Keep Local Version</div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Overwrites Google Drive with current device edits</div>
            </div>
            <Check size={16} style={{ color: 'var(--accent-primary)' }} />
          </button>

          <button
            type="button"
            onClick={() => handleResolve('keep_cloud')}
            disabled={isSubmitting}
            style={{
              display: 'flex',
              alignItems: 'center',
              justify: 'space-between',
              padding: '12px 14px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-subtle)',
              background: 'var(--bg-input)',
              color: 'var(--text-primary)',
              textAlign: 'left',
              cursor: 'pointer',
              fontSize: '0.8rem'
            }}
          >
            <div>
              <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Keep Cloud Version</div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Marks remote version as authoritative</div>
            </div>
            <Check size={16} style={{ color: 'var(--accent-emerald)' }} />
          </button>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            type="button"
            className="btn-secondary"
            onClick={onClose}
            style={{ padding: '6px 14px', fontSize: '0.78rem' }}
          >
            Cancel
          </button>
        </div>

      </div>
    </div>
  );
}
