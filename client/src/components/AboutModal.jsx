import React from 'react';
import { Info, X, Zap, Cpu, Code2, Database } from 'lucide-react';

export default function AboutModal({ isOpen, onClose }) {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-container" style={{ maxWidth: '500px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.9rem', fontWeight: 600 }}>
            <Zap size={16} style={{ color: 'var(--accent-primary)' }} />
            <span>About SyncNote</span>
          </div>
          <button style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }} onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '6px', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
          <div>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              SyncNote
            </h2>
            <p style={{ fontSize: '0.78rem', color: 'var(--accent-primary)', fontWeight: 500 }}>
              Offline-First Intelligent Knowledge Management Platform
            </p>
          </div>

          <p style={{ lineHeight: 1.5 }}>
            SyncNote is an offline-first note-taking application designed for developers and researchers. It uses physical <code className="md-inline-code">.md</code> files on disk as the single source of truth for note contents, backed by a high-performance SQLite metadata index layer for instant search, version tracking, and future semantic synchronization.
          </p>

          {/* Genuine Technical Specs */}
          <div className="settings-card" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
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
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '10px' }}>
          <button 
            onClick={onClose}
            style={{
              background: 'var(--text-primary)',
              color: 'var(--bg-app)',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              padding: '5px 14px',
              fontSize: '0.78rem',
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
