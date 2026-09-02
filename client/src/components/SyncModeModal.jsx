import React, { useState, useEffect } from 'react';
import { Shield, Cloud, Wifi, HardDrive, AlertCircle, X, ExternalLink } from 'lucide-react';
import { apiClient } from '../api/apiClient';
import { useNavigate } from '../utils/router';
import { useSync } from '../context/SyncContext';

export function GoogleDriveIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 87.3 78" xmlns="http://www.w3.org/2000/svg" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
      <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/>
      <path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0 -1.2 4.5h27.5z" fill="#00ac47"/>
      <path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.2-2.1 7.45-12.9c.8-1.4 1.2-2.95 1.2-4.5h-27.5l6.85 11.85z" fill="#ea4335"/>
      <path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.55-1.2h-18.4c-1.65 0-3.2.45-4.55 1.2z" fill="#00832d"/>
      <path d="m59.8 53h27.5c0-1.55-.4-3.1-1.2-4.5l-12.85-22.25c-.8-1.4-1.95-2.5-3.3-3.35l-13.75 23.8z" fill="#ffba00"/>
      <path d="m27.5 53h32.3l13.75-23.85h-32.3z" fill="#2684fc"/>
    </svg>
  );
}

export default function SyncModeModal({
  isOpen,
  note,
  targetMode, // 'local' | 'cloud' | 'lan'
  onClose,
  onConfirm
}) {
  const navigate = useNavigate();
  const sync = useSync();
  const [isCheckingDrive, setIsCheckingDrive] = useState(false);
  const [isDriveConnected, setIsDriveConnected] = useState(sync?.googleDriveStatus?.connected || false);

  useEffect(() => {
    if (isOpen && targetMode === 'cloud') {
      let isMounted = true;
      setIsCheckingDrive(true);

      // Read from authoritative SyncContext first
      if (sync && sync.googleDriveStatus) {
        setIsDriveConnected(!!sync.googleDriveStatus.connected);
      }

      // Fetch fresh status from canonical backend endpoint /api/sync/gdrive/status
      apiClient.get('/api/sync/gdrive/status')
        .then((res) => {
          if (isMounted && res) {
            setIsDriveConnected(!!res.connected);
          }
        })
        .catch(() => {
          if (isMounted) setIsDriveConnected(false);
        })
        .finally(() => {
          if (isMounted) setIsCheckingDrive(false);
        });

      return () => { isMounted = false; };
    }
  }, [isOpen, targetMode, sync?.googleDriveStatus]);

  if (!isOpen || !note || !targetMode) return null;

  const currentMode = note.sync_mode === 'google' ? 'cloud' : (note.sync_mode || 'local');

  // If selecting current mode, just close
  if (currentMode === targetMode) {
    onClose();
    return null;
  }

  // Handle confirmation click
  const handleConfirm = () => {
    if (onConfirm) {
      onConfirm(note.id, targetMode);
    }
    onClose();
  };

  // Render modal content based on transition
  let title = 'Change Sync Mode';
  let message = '';
  let icon = <HardDrive size={22} className="text-accent" />;
  let confirmBtnLabel = 'Confirm';
  let showDriveConnectBtn = false;

  if (targetMode === 'cloud') {
    icon = <GoogleDriveIcon size={24} />;
    title = 'Google Drive Sync';

    if (!isDriveConnected && !isCheckingDrive) {
      message = 'Google Drive is not connected. Connect your Google Drive account in Settings to enable Cloud Synchronization for this note.';
      confirmBtnLabel = 'Set to Cloud Anyway';
      showDriveConnectBtn = true;
    } else {
      message = `Make "${note.title || 'Untitled Note'}" available for Google Drive Sync? All changes will be securely synchronized to your Google Drive "SyncNote" folder.`;
      confirmBtnLabel = 'Enable Cloud Sync';
    }
  } else if (currentMode === 'cloud' && (targetMode === 'local' || targetMode === 'lan')) {
    icon = <Shield size={24} style={{ color: '#f59e0b' }} />;
    title = targetMode === 'local' ? 'Switch to Local Only' : 'Switch to LAN Sync';
    message = `This note will no longer sync with Google Drive. The existing Google Drive copy will remain unchanged in your Drive storage.`;
    confirmBtnLabel = targetMode === 'local' ? 'Set to Local' : 'Set to LAN';
  } else if (targetMode === 'lan') {
    icon = <Wifi size={24} style={{ color: '#10b981' }} />;
    title = 'Enable LAN Sync';
    message = `Make "${note.title || 'Untitled Note'}" available for encrypted peer-to-peer LAN Synchronization?`;
    confirmBtnLabel = 'Enable LAN Sync';
  } else {
    title = 'Switch to Local Only';
    message = `Store "${note.title || 'Untitled Note'}" on this device only. It will not be uploaded to Google Drive or shared over LAN.`;
    confirmBtnLabel = 'Set to Local';
  }

  return (
    <div 
      className="modal-overlay" 
      style={{ 
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.68)', 
        backdropFilter: 'blur(5px)', 
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justify: 'center'
      }}
      onClick={onClose}
    >
      <div 
        className="modal-content" 
        style={{ 
          maxWidth: '460px', 
          width: '90%', 
          padding: '24px', 
          borderRadius: 'var(--radius-lg, 12px)', 
          background: 'var(--bg-card, #1e1e24)', 
          border: '1px solid var(--border-subtle, rgba(255,255,255,0.12))', 
          boxShadow: '0 24px 48px rgba(0,0,0,0.45)',
          color: 'var(--text-primary, #ffffff)'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ width: '42px', height: '42px', borderRadius: '10px', background: 'var(--bg-input, rgba(255,255,255,0.06))', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--border-subtle, rgba(255,255,255,0.08))' }}>
              {icon}
            </div>
            <div>
              <h3 style={{ fontSize: '1.05rem', fontWeight: 600, color: 'var(--text-primary, #ffffff)', margin: 0, letterSpacing: '-0.01em' }}>
                {title}
              </h3>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary, rgba(255,255,255,0.7))', margin: '2px 0 0 0' }}>
                Target Note: <strong style={{ color: 'var(--text-primary, #ffffff)' }}>{note.title || 'Untitled Note'}</strong>
              </p>
            </div>
          </div>
          <button 
            type="button"
            className="toolbar-btn" 
            onClick={onClose} 
            style={{ color: 'var(--text-muted, #9ca3af)', background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px' }}
          >
            <X size={18} />
          </button>
        </div>

        <p style={{ fontSize: '0.86rem', color: 'var(--text-secondary, rgba(255,255,255,0.85))', lineHeight: 1.55, marginBottom: '22px', borderTop: '1px solid var(--border-subtle, rgba(255,255,255,0.08))', paddingTop: '14px' }}>
          {message}
        </p>

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button
            type="button"
            className="btn-secondary"
            onClick={onClose}
            style={{ padding: '8px 16px', fontSize: '0.82rem', borderRadius: '6px' }}
          >
            Cancel
          </button>

          {showDriveConnectBtn && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                onClose();
                navigate('/settings');
              }}
              style={{ padding: '8px 16px', fontSize: '0.82rem', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '6px', color: '#2684fc', borderColor: '#2684fc' }}
            >
              <ExternalLink size={14} />
              <span>Connect Drive</span>
            </button>
          )}

          <button
            type="button"
            className="btn-primary"
            onClick={handleConfirm}
            style={{ padding: '8px 18px', fontSize: '0.82rem', borderRadius: '6px', fontWeight: 600 }}
          >
            {confirmBtnLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
