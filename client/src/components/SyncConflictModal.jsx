import React from 'react';
import { AlertTriangle, X, Check } from 'lucide-react';

export default function SyncConflictModal({
  isOpen,
  conflict,
  onClose,
  onResolveKeepLocal,
  onResolveKeepRemote,
  onResolveMerge
}) {
  if (!isOpen || !conflict) return null;

  const { title, localContent, remoteContent, deviceName } = conflict;

  return (
    <div className="modal-overlay" style={{ zIndex: 300 }}>
      <div className="modal-container" style={{ maxWidth: '650px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--accent-warning)', fontWeight: 600 }}>
            <AlertTriangle size={18} />
            <span>LAN Sync Divergent Edit Conflict</span>
          </div>
          <button style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }} onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: '14px' }}>
          Divergent modifications were detected for note <strong>"{title}"</strong> from remote device <strong>{deviceName || 'LAN Peer'}</strong>. Select how to resolve this conflict:
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
          {/* Local Content Card */}
          <div style={{ background: 'var(--bg-app)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', padding: '10px' }}>
            <div style={{ fontSize: '0.76rem', fontWeight: 600, color: 'var(--accent-primary)', marginBottom: '6px' }}>
              This Device (Local Version)
            </div>
            <pre style={{ fontSize: '0.72rem', fontFamily: 'var(--font-mono)', height: '140px', overflowY: 'auto', background: 'var(--bg-input)', padding: '8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
              {localContent || '(Empty)'}
            </pre>
            <button
              onClick={onResolveKeepLocal}
              className="btn-secondary"
              style={{ width: '100%', marginTop: '8px', fontSize: '0.74rem' }}
            >
              Keep This Device's Version
            </button>
          </div>

          {/* Remote Content Card */}
          <div style={{ background: 'var(--bg-app)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', padding: '10px' }}>
            <div style={{ fontSize: '0.76rem', fontWeight: 600, color: 'var(--accent-emerald)', marginBottom: '6px' }}>
              Remote Device ({deviceName || 'Peer'})
            </div>
            <pre style={{ fontSize: '0.72rem', fontFamily: 'var(--font-mono)', height: '140px', overflowY: 'auto', background: 'var(--bg-input)', padding: '8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
              {remoteContent || '(Empty)'}
            </pre>
            <button
              onClick={onResolveKeepRemote}
              className="btn-secondary"
              style={{ width: '100%', marginTop: '8px', fontSize: '0.74rem' }}
            >
              Keep Remote Version
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button
            onClick={onResolveMerge}
            className="btn-primary"
            style={{ fontSize: '0.76rem', padding: '6px 14px', display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <Check size={14} />
            <span>Keep Both (Merge as Conflict Copy)</span>
          </button>
        </div>
      </div>
    </div>
  );
}
