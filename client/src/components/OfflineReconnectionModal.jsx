import React, { useState } from 'react';
import { Wifi, Zap, AlertTriangle, RefreshCw, X } from 'lucide-react';
import { apiClient } from '../api/apiClient';

export default function OfflineReconnectionModal({ pendingItems = [], isOpen, onClose, onSyncCompleted }) {
  const [isSyncing, setIsSyncing] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  if (!isOpen || pendingItems.length === 0) return null;

  const handleSyncAll = async () => {
    setIsSyncing(true);
    try {
      await apiClient.post('/api/sync/gdrive/sync-now');
      if (onSyncCompleted) onSyncCompleted();
      onClose();
    } catch (err) {
      console.error('Reconnection Sync Error:', err);
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="modal-overlay" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', zIndex: 9999 }}>
      <div className="modal-content" style={{ maxWidth: '480px', width: '90%', padding: '24px', borderRadius: 'var(--radius-md)', background: 'var(--bg-modal)', border: '1px solid var(--border-subtle)', boxShadow: '0 20px 40px rgba(0,0,0,0.3)' }}>
        
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Zap size={22} />
            </div>
            <div>
              <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                Offline Changes Detected
              </h3>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: '2px 0 0 0' }}>
                Some notes were modified while you were offline.
              </p>
            </div>
          </div>
          <button className="toolbar-btn" onClick={onClose} style={{ color: 'var(--text-muted)' }}>
            <X size={16} />
          </button>
        </div>

        <div style={{ background: 'var(--bg-input)', borderRadius: 'var(--radius-sm)', padding: '12px', marginBottom: '16px', fontSize: '0.78rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: 'var(--text-primary)', fontWeight: 600 }}>
            <span>Pending Sync Items</span>
            <span style={{ color: 'var(--accent-primary)' }}>{pendingItems.length} note{pendingItems.length === 1 ? '' : 's'}</span>
          </div>

          <button
            type="button"
            onClick={() => setShowDetails(!showDetails)}
            style={{ background: 'none', border: 'none', color: 'var(--accent-primary)', fontSize: '0.72rem', cursor: 'pointer', padding: 0, marginTop: '6px', textDecoration: 'underline' }}
          >
            {showDetails ? 'Hide details' : 'Review changes'}
          </button>

          {showDetails && (
            <div style={{ marginTop: '8px', maxHeight: '140px', overflowY: 'auto', borderTop: '1px solid var(--border-subtle)', paddingTop: '6px' }}>
              {pendingItems.map((item) => (
                <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: '0.74rem' }}>
                  <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{item.title || 'Untitled'}</span>
                  <span style={{ color: item.sync_state === 'CONFLICT' ? '#ef4444' : '#f59e0b', fontSize: '0.68rem', fontWeight: 600 }}>
                    {item.sync_state}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button
            type="button"
            className="btn-secondary"
            onClick={onClose}
            style={{ padding: '6px 14px', fontSize: '0.78rem' }}
          >
            Keep Local
          </button>

          <button
            type="button"
            className="btn-primary"
            disabled={isSyncing}
            onClick={handleSyncAll}
            style={{ padding: '6px 16px', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <RefreshCw size={13} className={isSyncing ? 'spin' : ''} />
            <span>{isSyncing ? 'Syncing...' : 'Sync All'}</span>
          </button>
        </div>

      </div>
    </div>
  );
}
