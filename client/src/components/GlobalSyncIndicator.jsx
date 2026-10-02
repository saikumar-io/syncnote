import React from 'react';
import { useSync } from '../context/SyncContext';
import { useNavigate } from '../utils/router';
import { Check, RefreshCw, AlertCircle, WifiOff, CloudOff } from 'lucide-react';

export default function GlobalSyncIndicator() {
  const { 
    syncStatus, 
    pendingCount = 0, 
    failedCount = 0,
    googleDriveStatus,
    triggerSync, 
    unresolvedCount = 0, 
    unresolvedConflicts = [], 
    openConflictModal 
  } = useSync();
  const navigate = useNavigate();

  const isDriveConnected = Boolean(googleDriveStatus?.connected);
  const isAuthRequired = Boolean(
    googleDriveStatus?.authRequired || 
    googleDriveStatus?.syncState === 'AUTHENTICATION REQUIRED' || 
    syncStatus === 'AUTH_REQUIRED'
  );

  const handleClick = (e) => {
    e.stopPropagation();
    if (unresolvedCount > 0 && unresolvedConflicts.length > 0 && openConflictModal) {
      openConflictModal(unresolvedConflicts[0]);
    } else if (pendingCount > 0 && syncStatus !== 'SYNCING' && isDriveConnected) {
      triggerSync();
    } else {
      navigate('/settings?tab=sync');
    }
  };

  const renderBadgeContent = () => {
    // 1. CONFLICT: Synchronization requires conflict resolution
    if (unresolvedCount > 0 || syncStatus === 'CONFLICT') {
      const count = unresolvedCount || 1;
      return (
        <span 
          className="global-sync-badge conflict" 
          style={{ background: 'rgba(239, 68, 68, 0.15)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.35)' }}
          title={`${count} concurrent conflict(s) detected. Click to resolve with AI.`}
        >
          <AlertCircle size={12} />
          <span>⚠ {count} conflict{count > 1 ? 's' : ''}</span>
        </span>
      );
    }

    // 2. SYNCING: Real synchronization operation currently running
    if (syncStatus === 'SYNCING') {
      return (
        <span className="global-sync-badge syncing" title="Synchronizing changes...">
          <RefreshCw size={12} className="spin-icon" />
          <span>Syncing...</span>
        </span>
      );
    }

    // 3. OFFLINE: Required network connection is unavailable
    if (syncStatus === 'OFFLINE') {
      return (
        <span className="global-sync-badge offline" title="Offline mode active. Network connection unavailable.">
          <WifiOff size={12} />
          <span>Offline</span>
        </span>
      );
    }

    // 4. AUTH_REQUIRED: Google Drive authentication expired
    if (syncStatus === 'AUTH_REQUIRED' || isAuthRequired) {
      return (
        <span 
          className="global-sync-badge auth-required" 
          title="Google Drive authentication expired. Click to reconnect Google Drive in Settings."
        >
          <AlertCircle size={12} />
          <span>Drive Authentication Required</span>
        </span>
      );
    }

    // 5. ERROR: A synchronization operation failed
    if (syncStatus === 'ERROR' || syncStatus === 'FAILED' || failedCount > 0) {
      return (
        <span 
          className="global-sync-badge error" 
          title="Synchronization failed and requires retry. Click to view Settings."
        >
          <AlertCircle size={12} />
          <span>Sync error</span>
        </span>
      );
    }

    // 6. PENDING: Actual synchronization operations waiting
    if (pendingCount > 0 || syncStatus === 'PENDING') {
      return (
        <span 
          className="global-sync-badge pending" 
          title={`${pendingCount} change(s) waiting for sync.${!isDriveConnected ? ' (Google Drive is disconnected)' : ' Click to sync now.'}`}
        >
          <AlertCircle size={12} />
          <span>{pendingCount > 0 ? `${pendingCount} pending` : 'Pending'}</span>
        </span>
      );
    }

    // 7. DISCONNECTED: Google Drive is not connected/authenticated and no pending uploads
    if (syncStatus === 'DRIVE_DISCONNECTED' || syncStatus === 'DISCONNECTED' || !isDriveConnected) {
      return (
        <span 
          className="global-sync-badge disconnected" 
          title="Google Drive is disconnected. Click to connect Google Drive in Settings."
        >
          <CloudOff size={12} />
          <span>Drive Disconnected</span>
        </span>
      );
    }

    // 8. SYNCED: Google Drive is connected and all enabled synchronization targets are up to date
    return (
      <span className="global-sync-badge synced" title="All changes saved & synced. Google Drive is connected.">
        <Check size={12} />
        <span>Synced</span>
      </span>
    );
  };

  return (
    <button
      type="button"
      className="global-sync-button-container"
      onClick={handleClick}
    >
      {renderBadgeContent()}
    </button>
  );
}
