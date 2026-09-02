import React, { useState, useEffect } from 'react';
import { useSync } from '../context/SyncContext';
import { useNavigate } from '../utils/router';
import { apiClient } from '../api/apiClient';
import { formatRelativeTime } from '../utils/timeUtils';
import { 
  Laptop, 
  ShieldCheck, 
  ArrowLeft, 
  Edit3, 
  Trash2, 
  RefreshCw, 
  Wifi,
  CheckCircle2
} from 'lucide-react';

export default function PairedDevicesPage() {
  const navigate = useNavigate();
  const sync = useSync();

  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingDeviceId, setEditingDeviceId] = useState(null);
  const [editNameInput, setEditNameInput] = useState('');
  const [actionMsg, setActionMsg] = useState({ type: '', text: '' });

  const loadDevices = async () => {
    setLoading(true);
    try {
      await sync.fetchPairedDevices();
    } catch (err) {
      console.error('Failed to load paired devices:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDevices();
  }, []);

  useEffect(() => {
    if (sync.pairedDevices) {
      setDevices(sync.pairedDevices);
    }
  }, [sync.pairedDevices]);

  const handleRename = async (deviceId) => {
    if (!editNameInput.trim()) return;
    try {
      await apiClient.patch(`/api/lan/devices/${deviceId}`, { deviceName: editNameInput.trim() });
      setActionMsg({ type: 'success', text: 'Device renamed successfully.' });
      setEditingDeviceId(null);
      setEditNameInput('');
      sync.fetchPairedDevices();
    } catch (err) {
      setActionMsg({ type: 'error', text: err.message || 'Failed to rename device.' });
    }
  };

  const handleForgetDevice = async (deviceId, deviceName) => {
    if (!window.confirm(`Are you sure you want to forget '${deviceName}'? It will no longer be able to sync notes until paired again.`)) {
      return;
    }

    try {
      await apiClient.delete(`/api/lan/devices/${deviceId}`);
      setActionMsg({ type: 'success', text: `Device '${deviceName}' removed.` });
      sync.fetchPairedDevices();
    } catch (err) {
      setActionMsg({ type: 'error', text: err.message || 'Failed to remove device.' });
    }
  };

  return (
    <div className="page-container" style={{ maxWidth: '840px', margin: '0 auto', padding: '24px 16px' }}>
      {/* Top Header & Breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
        <button 
          className="btn-secondary"
          onClick={() => navigate('/settings')}
          style={{ padding: '6px 10px', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '4px' }}
        >
          <ArrowLeft size={14} />
          <span>Back to Settings</span>
        </button>
      </div>

      <div className="page-header-bar" style={{ marginBottom: '24px' }}>
        <div>
          <h1 className="page-heading" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <ShieldCheck size={24} style={{ color: 'var(--accent-emerald)' }} />
            <span>Paired Devices</span>
          </h1>
          <p className="page-subheading" style={{ marginTop: '4px' }}>
            Manage previously paired trusted devices on your local network. Trusted devices can exchange encrypted LAN-enabled notes.
          </p>
        </div>

        <button
          type="button"
          className="btn-secondary"
          onClick={() => navigate('/settings/sync/lan')}
          style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', fontSize: '0.82rem' }}
        >
          <Wifi size={14} />
          <span>Scan New Devices</span>
        </button>
      </div>

      {actionMsg.text && (
        <div className={`auth-error-banner ${actionMsg.type === 'success' ? 'success' : ''}`} style={{ marginBottom: '16px' }}>
          <CheckCircle2 size={15} />
          <span>{actionMsg.text}</span>
        </div>
      )}

      {loading ? (
        <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
          <RefreshCw size={20} className="spin-icon" style={{ margin: '0 auto 8px auto', display: 'block' }} />
          <span style={{ fontSize: '0.82rem' }}>Loading paired devices...</span>
        </div>
      ) : devices.length === 0 ? (
        <div style={{
          background: 'var(--bg-app)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-md)',
          padding: '36px',
          textAlign: 'center',
          color: 'var(--text-muted)'
        }}>
          <Laptop size={32} style={{ margin: '0 auto 12px auto', display: 'block', opacity: 0.4 }} />
          <h3 style={{ fontSize: '0.9rem', color: 'var(--text-primary)', marginBottom: '4px' }}>No Paired Devices</h3>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: '16px' }}>
            You haven't paired any devices for LAN synchronization yet.
          </p>
          <button
            type="button"
            className="btn-primary"
            onClick={() => navigate('/settings/sync/lan')}
            style={{ padding: '6px 14px', fontSize: '0.8rem' }}
          >
            Pair a Device
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {devices.map((dev) => (
            <div
              key={dev.id}
              style={{
                background: 'var(--bg-app)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
                padding: '16px 20px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '16px'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                <div style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: 'var(--radius-sm)',
                  background: 'rgba(16, 185, 129, 0.1)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--accent-emerald)'
                }}>
                  <Laptop size={22} />
                </div>

                <div>
                  {editingDeviceId === dev.id ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                      <input
                        type="text"
                        className="auth-input input-compact"
                        style={{ width: '200px', fontSize: '0.84rem' }}
                        value={editNameInput}
                        onChange={(e) => setEditNameInput(e.target.value)}
                        autoFocus
                      />
                      <button
                        type="button"
                        className="btn-primary"
                        onClick={() => handleRename(dev.id)}
                        style={{ padding: '3px 8px', fontSize: '0.74rem' }}
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => setEditingDeviceId(null)}
                        style={{ padding: '3px 8px', fontSize: '0.74rem' }}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                        {dev.deviceName || 'Paired SyncNote Device'}
                      </span>
                      <button
                        type="button"
                        className="more-btn"
                        title="Rename Device"
                        onClick={() => {
                          setEditingDeviceId(dev.id);
                          setEditNameInput(dev.deviceName || '');
                        }}
                      >
                        <Edit3 size={13} />
                      </button>
                    </div>
                  )}

                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                    <span style={{ color: 'var(--accent-emerald)', fontWeight: 600 }}>● Trusted</span>
                    <span>•</span>
                    <span>{dev.deviceType || 'Desktop'}</span>
                    <span>•</span>
                    <span>Last seen: {dev.lastSeen ? formatRelativeTime(dev.lastSeen) : 'Recently'}</span>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => navigate('/settings/sync/lan')}
                  style={{ padding: '5px 12px', fontSize: '0.76rem' }}
                >
                  Connect & Sync
                </button>

                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => handleForgetDevice(dev.id, dev.deviceName)}
                  title="Forget Device"
                  style={{ padding: '5px 10px', fontSize: '0.76rem', color: 'var(--accent-danger)' }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
