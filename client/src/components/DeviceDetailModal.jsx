import React, { useState, useEffect } from 'react';
import { apiClient } from '../api/apiClient';
import { 
  Laptop, 
  ShieldCheck, 
  RefreshCw, 
  FileText, 
  Trash2, 
  Edit3, 
  X, 
  Check, 
  AlertCircle 
} from 'lucide-react';
import NotePickerModal from './NotePickerModal';

export default function DeviceDetailModal({ isOpen, device, onClose, onDeviceUpdated, onDeviceUnpaired }) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [newName, setNewName] = useState('');
  const [isNotePickerOpen, setIsNotePickerOpen] = useState(false);
  const [selectedNoteIds, setSelectedNoteIds] = useState([]);
  const [syncing, setSyncing] = useState(false);
  const [statusMsg, setStatusMsg] = useState({ type: '', text: '' });

  useEffect(() => {
    if (device && isOpen) {
      setNewName(device.deviceName || device.device_name || '');
      fetchSelectedNotes();
    }
  }, [device, isOpen]);

  const fetchSelectedNotes = async () => {
    if (!device) return;
    try {
      const res = await apiClient.get(`/api/lan/devices/${device.id}/notes`);
      if (res && res.selectedNoteIds) {
        setSelectedNoteIds(res.selectedNoteIds);
      }
    } catch (err) {}
  };

  const handleRenameSubmit = async (e) => {
    e.preventDefault();
    if (!newName.trim() || !device) return;
    try {
      const res = await apiClient.patch(`/api/lan/devices/${device.id}`, { deviceName: newName.trim() });
      if (res && res.device) {
        setIsRenaming(false);
        setStatusMsg({ type: 'success', text: 'Device renamed successfully.' });
        if (onDeviceUpdated) onDeviceUpdated(res.device);
      }
    } catch (err) {
      setStatusMsg({ type: 'error', text: 'Failed to rename device.' });
    }
  };

  const handleUnpair = async () => {
    if (!device) return;
    if (!window.confirm(`Are you sure you want to unpair '${device.deviceName || device.device_name}'?`)) return;

    try {
      await apiClient.delete(`/api/lan/devices/${device.id}`);
      if (onDeviceUnpaired) onDeviceUnpaired(device.id);
      onClose();
    } catch (err) {
      setStatusMsg({ type: 'error', text: 'Failed to unpair device.' });
    }
  };

  const handleSaveNotesSelection = async (newNoteIds) => {
    if (!device) return;
    try {
      const res = await apiClient.post(`/api/lan/devices/${device.id}/notes`, { noteIds: newNoteIds });
      if (res && res.selectedNoteIds) {
        setSelectedNoteIds(res.selectedNoteIds);
        setStatusMsg({ type: 'success', text: `Saved ${res.selectedNoteIds.length} selected notes for LAN sync.` });
      }
    } catch (err) {
      setStatusMsg({ type: 'error', text: 'Failed to save note selection.' });
    }
  };

  const handleSyncNow = async () => {
    setSyncing(true);
    setStatusMsg({ type: '', text: '' });
    try {
      // Trigger LAN sync endpoint
      await apiClient.post('/api/sync/push', {});
      setSyncing(false);
      setStatusMsg({ type: 'success', text: 'P2P LAN sync cycle completed.' });
    } catch (err) {
      setSyncing(false);
      setStatusMsg({ type: 'error', text: 'LAN sync failed or device unreachable.' });
    }
  };

  if (!isOpen || !device) return null;

  return (
    <>
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '440px', width: '100%', padding: '20px' }}>
          
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Laptop size={18} style={{ color: 'var(--accent-primary)' }} />
              <span style={{ fontWeight: 600, fontSize: '0.92rem', color: 'var(--text-primary)' }}>
                Device Profile & LAN Settings
              </span>
            </div>
            <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
              <X size={18} />
            </button>
          </div>

          {/* Status Message */}
          {statusMsg.text && (
            <div style={{ padding: '8px 12px', background: statusMsg.type === 'error' ? 'rgba(239, 68, 68, 0.1)' : 'rgba(16, 185, 129, 0.1)', border: `1px solid ${statusMsg.type === 'error' ? 'rgba(239, 68, 68, 0.3)' : 'rgba(16, 185, 129, 0.3)'}`, borderRadius: 'var(--radius-sm)', color: statusMsg.type === 'error' ? 'var(--accent-danger)' : 'var(--accent-emerald)', fontSize: '0.76rem', marginBottom: '12px' }}>
              {statusMsg.text}
            </div>
          )}

          {/* Device Profile Box */}
          <div style={{ background: 'var(--bg-app)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', padding: '12px', marginBottom: '14px' }}>
            {isRenaming ? (
              <form onSubmit={handleRenameSubmit} style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  style={{ flex: 1, padding: '4px 8px', fontSize: '0.82rem', background: 'var(--bg-input)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', borderRadius: 'var(--radius-sm)' }}
                />
                <button type="submit" className="btn-primary" style={{ padding: '4px 10px', fontSize: '0.74rem' }}>
                  Save
                </button>
                <button type="button" className="btn-secondary" onClick={() => setIsRenaming(false)} style={{ padding: '4px 8px', fontSize: '0.74rem' }}>
                  Cancel
                </button>
              </form>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                  {device.deviceName || device.device_name}
                </div>
                <button
                  type="button"
                  onClick={() => setIsRenaming(true)}
                  style={{ background: 'none', border: 'none', color: 'var(--accent-primary)', fontSize: '0.72rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '3px' }}
                >
                  <Edit3 size={12} />
                  <span>Rename</span>
                </button>
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Device Type:</span> {device.deviceType || device.device_type || 'Desktop'}
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Device ID:</span> ••••{(device.id || '8F21').slice(-4)}
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Trust Status:</span> <span style={{ color: 'var(--accent-emerald)', fontWeight: 600 }}>● Trusted</span>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Selected Notes:</span> <strong>{selectedNoteIds.length} notes</strong>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setIsNotePickerOpen(true)}
              style={{ width: '100%', padding: '8px 12px', fontSize: '0.8rem', justifyContent: 'flex-start', display: 'flex', alignItems: 'center', gap: '8px' }}
            >
              <FileText size={15} style={{ color: 'var(--accent-primary)' }} />
              <span>Select Notes to Sync ({selectedNoteIds.length} selected)</span>
            </button>

            <button
              type="button"
              className="btn-secondary"
              onClick={handleSyncNow}
              disabled={syncing}
              style={{ width: '100%', padding: '8px 12px', fontSize: '0.8rem', justifyContent: 'flex-start', display: 'flex', alignItems: 'center', gap: '8px' }}
            >
              <RefreshCw size={15} className={syncing ? 'spin-icon' : ''} style={{ color: 'var(--accent-emerald)' }} />
              <span>{syncing ? 'Syncing...' : 'Sync Now with Device'}</span>
            </button>

            <button
              type="button"
              onClick={handleUnpair}
              style={{
                width: '100%',
                padding: '8px 12px',
                fontSize: '0.8rem',
                justifyContent: 'flex-start',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                background: 'rgba(239, 68, 68, 0.08)',
                border: '1px solid rgba(239, 68, 68, 0.25)',
                color: 'var(--accent-danger)',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
                fontWeight: 600
              }}
            >
              <Trash2 size={15} />
              <span>Unpair Device</span>
            </button>
          </div>

        </div>
      </div>

      {/* Note Picker Modal */}
      <NotePickerModal
        isOpen={isNotePickerOpen}
        initialSelectedIds={selectedNoteIds}
        onClose={() => setIsNotePickerOpen(false)}
        onSave={handleSaveNotesSelection}
      />
    </>
  );
}
