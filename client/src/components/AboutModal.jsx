import React, { useEffect } from 'react';
import { X, Zap, Code2 } from 'lucide-react';

export default function AboutModal({ isOpen, onClose }) {
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

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Zap size={16} style={{ color: 'var(--accent-primary)' }} />
            <h3 className="modal-title">About SyncNote</h3>
          </div>
          <button className="icon-btn-ghost" onClick={onClose} title="Close (Esc)" type="button">
            <X size={15} />
          </button>
        </div>

        <div className="modal-body">
          <div>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
              SyncNote
            </h2>
            <p style={{ fontSize: '0.78rem', color: 'var(--accent-primary)', fontWeight: 500, margin: '2px 0 0 0' }}>
              Offline-First Intelligent Knowledge Management Platform
            </p>
          </div>

          <p style={{ lineHeight: 1.5, fontSize: '0.82rem', color: 'var(--text-secondary)', margin: 0 }}>
            SyncNote is an offline-first note-taking application designed for developers and researchers. It uses physical <code className="md-inline-code">.md</code> files on disk as the single source of truth for note contents, backed by a high-performance SQLite metadata index layer for instant search, version tracking, and future semantic synchronization.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', background: 'var(--bg-input)', padding: '12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
            <div style={{ fontSize: '0.76rem', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Code2 size={13} />
              <span>Technology Architecture</span>
            </div>
            <div style={{ fontSize: '0.74rem', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: '3px' }}>
              <span>• Frontend: React 18, Vite, Vanilla CSS</span>
              <span>• Backend: Node.js Express REST API</span>
              <span>• Storage Engine: Physical File System (.md)</span>
              <span>• Metadata Index: SQLite (better-sqlite3)</span>
              <span>• Cryptography: SHA-256 Content Hashing</span>
              <span>• Application Version: 1.0.0</span>
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="primary-action-btn" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
