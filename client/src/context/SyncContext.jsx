import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { apiClient } from '../api/apiClient';
import OfflineReconnectionModal from '../components/OfflineReconnectionModal';

const SyncContext = createContext(null);

export function SyncProvider({ children }) {
  const [syncStatus, setSyncStatus] = useState('SYNCED'); // 'SYNCED', 'SYNCING', 'OFFLINE', 'CONFLICT', 'FAILED'
  const [isSyncing, setIsSyncing] = useState(false);
  const [internetConnected, setInternetConnected] = useState(true);
  const [lanAvailable, setLanAvailable] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [pendingGoogleCount, setPendingGoogleCount] = useState(0);
  const [pendingGoogleItems, setPendingGoogleItems] = useState([]);
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const [nearbyDevices, setNearbyDevices] = useState([]);
  const [pairedDevices, setPairedDevices] = useState([]);
  const [pendingPairingRequests, setPendingPairingRequests] = useState([]);
  const [activeConflicts, setActiveConflicts] = useState([]);
  const [showReconnectionModal, setShowReconnectionModal] = useState(false);
  const [wasOffline, setWasOffline] = useState(false);

  // Separate Authoritative State for Google Login vs Google Drive Sync
  const [googleAccountStatus, setGoogleAccountStatus] = useState({ connected: false, email: null });
  const [googleDriveStatus, setGoogleDriveStatus] = useState({
    connected: false,
    email: null,
    folderName: 'SyncNote',
    folderId: null,
    pendingCount: 0,
    lastSyncedAt: null
  });

  // Fetch current backend health and authoritative Google Drive status
  const refreshSyncStatus = useCallback(async () => {
    try {
      const health = await apiClient.get('/api/health').catch(() => null);
      let currentlyConnected = false;
      if (health && health.backend) {
        currentlyConnected = true;
        setInternetConnected(true);
      } else {
        setInternetConnected(false);
        setSyncStatus('OFFLINE');
        setWasOffline(true);
      }

      // 1. Fetch general sync status
      const statusRes = await apiClient.get('/api/sync/status').catch(() => null);
      if (statusRes) {
        if (statusRes.googleAccount) setGoogleAccountStatus(statusRes.googleAccount);
        setPendingCount(statusRes.pendingCount || 0);
        if (statusRes.lastSyncedAt) {
          setLastSyncedAt(statusRes.lastSyncedAt);
        }
      }

      // 2. Fetch canonical Google Drive status endpoint (/api/sync/gdrive/status)
      const gdriveRes = await apiClient.get('/api/sync/gdrive/status').catch(() => null);
      if (gdriveRes) {
        setGoogleDriveStatus({
          connected: !!gdriveRes.connected,
          email: gdriveRes.email || null,
          folderName: gdriveRes.folderName || 'SyncNote',
          folderId: gdriveRes.folderId || null,
          pendingCount: gdriveRes.pendingCount || 0,
          lastSyncedAt: gdriveRes.lastSyncAt || gdriveRes.lastSyncedAt || lastSyncedAt
        });
        setPendingGoogleCount(gdriveRes.pendingCount || 0);
        if (gdriveRes.lastSyncAt) {
          setLastSyncedAt(gdriveRes.lastSyncAt);
        }
      }

      // Check pending items if reconnecting
      if (currentlyConnected && wasOffline) {
        setWasOffline(false);
        try {
          const pendingRes = await apiClient.get('/api/sync/gdrive/pending').catch(() => null);
          if (pendingRes && pendingRes.items && pendingRes.items.length > 0) {
            setPendingGoogleItems(pendingRes.items);
            setShowReconnectionModal(true);
          }
        } catch (e) {}
      }
    } catch (err) {
      setInternetConnected(false);
      setSyncStatus('OFFLINE');
      setWasOffline(true);
    }
  }, [wasOffline, lastSyncedAt]);

  // Immediately Disconnect Google Drive & Update Central State
  const disconnectDrive = useCallback(async () => {
    try {
      await apiClient.post('/api/auth/google/drive/disconnect');
    } catch (e) {
      console.warn('Backend disconnect endpoint error:', e.message);
    } finally {
      // Immediately reset Google Drive state (preserving Google Account state)
      setGoogleDriveStatus({
        connected: false,
        email: null,
        folderName: 'SyncNote',
        folderId: null,
        pendingCount: 0,
        lastSyncedAt: null,
        syncing: false,
        error: null
      });
      setPendingGoogleCount(0);
      await refreshSyncStatus();
    }
  }, [refreshSyncStatus]);

  // Discover LAN devices
  const discoverLanDevices = useCallback(async () => {
    try {
      const res = await apiClient.get('/api/lan/discover');
      if (res && res.discovered) {
        setNearbyDevices(res.discovered);
        setLanAvailable(res.discovered.length > 0);
      }
    } catch (err) {
      setLanAvailable(false);
    }
  }, []);

  // Fetch Paired Devices
  const fetchPairedDevices = useCallback(async () => {
    try {
      const res = await apiClient.get('/api/lan/devices');
      if (res && res.devices) {
        setPairedDevices(res.devices);
      }
    } catch (err) {}
  }, []);

  // Trigger manual Google Drive / Cloud push sync
  const triggerSync = useCallback(async () => {
    if (isSyncing || syncStatus === 'SYNCING') return;

    setSyncStatus('SYNCING');
    setIsSyncing(true);
    try {
      const gdriveRes = await apiClient.post('/api/sync/gdrive/sync-now', {});
      const res = await apiClient.post('/api/sync/push', {}).catch(() => ({}));
      
      const syncedCount = (gdriveRes?.result?.synced || 0) + (res?.syncedCount || 0);
      const syncedAt = gdriveRes?.result?.lastSyncAt || gdriveRes?.lastSyncAt || res?.lastSyncedAt || new Date().toISOString();

      if (syncedCount >= 0) {
        setLastSyncedAt(syncedAt);
      }

      setSyncStatus('SYNCED');
      await refreshSyncStatus();
      return gdriveRes;
    } catch (err) {
      console.error('Trigger sync error:', err);
      setSyncStatus('FAILED');
      await refreshSyncStatus();
      throw err;
    } finally {
      setIsSyncing(false);
    }
  }, [isSyncing, syncStatus, refreshSyncStatus]);

  // Single Note Google Drive Sync
  const syncSingleNote = useCallback(async (noteId) => {
    if (!noteId) return;
    setSyncStatus('SYNCING');
    setIsSyncing(true);
    try {
      const res = await apiClient.post(`/api/sync/gdrive/notes/${noteId}/sync`, {});
      if (res && res.result && res.result.lastSyncAt) {
        setLastSyncedAt(res.result.lastSyncAt);
      }
      await refreshSyncStatus();
      setSyncStatus('SYNCED');
      return res;
    } catch (err) {
      setSyncStatus('FAILED');
      await refreshSyncStatus();
      throw err;
    } finally {
      setIsSyncing(false);
    }
  }, [refreshSyncStatus]);

  // Request LAN Pairing
  const requestLanPairing = async (device) => {
    try {
      const res = await apiClient.post('/api/lan/pair/request', {
        requestingDeviceId: device.deviceId,
        requestingDeviceName: device.deviceName,
        requestingDeviceIp: device.ip
      });
      fetchPairedDevices();
      return res;
    } catch (err) {
      throw err;
    }
  };

  // Approve LAN Pairing
  const approveLanPairing = async (requestId) => {
    try {
      const res = await apiClient.post('/api/lan/pair/approve', { requestId });
      fetchPairedDevices();
      return res;
    } catch (err) {
      throw err;
    }
  };

  // Synchronize over LAN with a paired device
  const syncOverLan = async (pairedDevice, notes, notebooks) => {
    setSyncStatus('SYNCING');
    setIsSyncing(true);
    try {
      const res = await apiClient.post('/api/lan/sync', { notes, notebooks }, {
        headers: { 'X-LAN-Pairing-Token': pairedDevice.pairing_token }
      });
      if (res && res.success) {
        if (res.conflictCount > 0) {
          setSyncStatus('CONFLICT');
          setActiveConflicts(res.conflicts || []);
        } else {
          setSyncStatus('SYNCED');
        }
      }
      return res;
    } catch (err) {
      setSyncStatus('FAILED');
      throw err;
    } finally {
      setIsSyncing(false);
    }
  };

  // Initial load and status polling
  useEffect(() => {
    refreshSyncStatus();
    fetchPairedDevices();

    const interval = setInterval(() => {
      refreshSyncStatus();
    }, 15000);

    return () => clearInterval(interval);
  }, [refreshSyncStatus, fetchPairedDevices]);

  const value = {
    syncStatus,
    isSyncing,
    internetConnected,
    lanAvailable,
    googleAccountStatus,
    googleDriveStatus,
    pendingCount,
    pendingGoogleCount,
    pendingGoogleItems,
    lastSyncedAt,
    nearbyDevices,
    pairedDevices,
    pendingPairingRequests,
    activeConflicts,
    showReconnectionModal,
    setShowReconnectionModal,
    triggerSync,
    syncSingleNote,
    disconnectDrive,
    refreshSyncStatus,
    discoverLanDevices,
    fetchPairedDevices,
    requestLanPairing,
    approveLanPairing,
    syncOverLan
  };

  return (
    <SyncContext.Provider value={value}>
      {children}
      <OfflineReconnectionModal
        isOpen={showReconnectionModal}
        pendingItems={pendingGoogleItems}
        onClose={() => setShowReconnectionModal(false)}
        onSyncCompleted={() => refreshSyncStatus()}
      />
    </SyncContext.Provider>
  );
}

export function useSync() {
  const context = useContext(SyncContext);
  if (!context) {
    throw new Error('useSync must be used within a SyncProvider');
  }
  return context;
}
