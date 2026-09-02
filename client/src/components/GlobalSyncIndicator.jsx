import React from 'react';
import { useSync } from '../context/SyncContext';
import { useNavigate } from '../utils/router';
import { Check, RefreshCw, AlertCircle, WifiOff } from 'lucide-react';

export default function GlobalSyncIndicator() {
  const { syncStatus, pendingCount, triggerSync } = useSync();
  const navigate = useNavigate();

  const handleClick = (e) => {
    e.stopPropagation();
    if (pendingCount > 0 && syncStatus !== 'SYNCING') {
      triggerSync();
    } else {
      navigate('/settings');
    }
  };

  const renderBadgeContent = () => {
    if (syncStatus === 'SYNCING') {
      return (
        <span className="global-sync-badge syncing" title="Synchronizing changes...">
          <RefreshCw size={12} className="spin-icon" />
          <span>Syncing...</span>
        </span>
      );
    }

    if (syncStatus === 'CONFLICT') {
      return (
        <span className="global-sync-badge conflict" title="Conflict detected. Both states preserved. Click to view Settings.">
          <AlertCircle size={12} />
          <span>Conflict detected</span>
        </span>
      );
    }

    if (syncStatus === 'OFFLINE') {
      return (
        <span className="global-sync-badge offline" title="Offline mode active. Edits saved locally.">
          <WifiOff size={12} />
          <span>Offline</span>
        </span>
      );
    }

    if (pendingCount > 0) {
      return (
        <span className="global-sync-badge pending" title={`${pendingCount} change(s) pending sync. Click to sync now.`}>
          <AlertCircle size={12} />
          <span>{pendingCount} pending</span>
        </span>
      );
    }

    return (
      <span className="global-sync-badge synced" title="All changes saved & synced.">
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
