import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
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

  // Presence monitoring refs: track consecutive failures per device and guard concurrent checks
  const consecutiveFailuresRef = useRef({});
  const isCheckingPresenceRef = useRef(false);

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
        setPairedDevices(prev => {
          const prevMap = new Map((prev || []).map(d => [d.id, d]));
          return res.devices.map(dev => {
            const prevDev = prevMap.get(dev.id);
            return {
              ...dev,
              // If previous presence state existed, retain it while checking
              isOnline: dev.isOnline !== undefined ? dev.isOnline : (prevDev ? prevDev.isOnline : false),
              lastSeen: dev.lastSeen || (prevDev ? prevDev.lastSeen : dev.last_seen),
              isChecking: false
            };
          });
        });
      }
    } catch (err) {}
  }, []);

  // Background presence checking for paired devices via lightweight authenticated heartbeat
  const checkDevicesPresence = useCallback(async () => {
    if (isCheckingPresenceRef.current) return;
    isCheckingPresenceRef.current = true;

    try {
      const res = await apiClient.get('/api/lan/devices/presence');
      if (res && res.presence) {
        // If peer informed us that we were unpaired/revoked while offline, reload paired list
        const hadRevocation = res.presence.some(p => p.revoked);
        if (hadRevocation) {
          await fetchPairedDevices();
          return;
        }

        const presenceMap = new Map();
        for (const p of res.presence) {
          presenceMap.set(p.id, p);
        }

        setPairedDevices(prevDevices => {
          if (!prevDevices || prevDevices.length === 0) return prevDevices;

          return prevDevices.map(device => {
            const p = presenceMap.get(device.id);
            if (!p) return device;

            if (p.isOnline) {
              // Successfully received heartbeat response!
              consecutiveFailuresRef.current[device.id] = 0;
              return {
                ...device,
                isOnline: true,
                isChecking: false,
                lastSeen: p.lastSeen || new Date().toISOString()
              };
            } else {
              // Heartbeat failed or timed out
              const currentFailures = (consecutiveFailuresRef.current[device.id] || 0) + 1;
              consecutiveFailuresRef.current[device.id] = currentFailures;

              // Require 2 consecutive failures before transitioning ONLINE -> OFFLINE to eliminate jitter
              const shouldMarkOffline = currentFailures >= 2 || !device.isOnline;

              return {
                ...device,
                isOnline: shouldMarkOffline ? false : device.isOnline,
                isChecking: false,
                // Retain previous lastSeen timestamp! Do not overwrite with null or "never"
                lastSeen: device.lastSeen || p.lastSeen || device.last_seen
              };
            }
          });
        });
      }
    } catch (err) {
      // Local network error
    } finally {
      isCheckingPresenceRef.current = false;
    }
  }, [fetchPairedDevices]);

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
      
      // Dispatch real-time note update event for UI
      window.dispatchEvent(new CustomEvent('syncnote:notes-updated'));

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

      // Dispatch real-time note update event for UI
      window.dispatchEvent(new CustomEvent('syncnote:notes-updated'));

      return res;
    } catch (err) {
      setSyncStatus('FAILED');
      await refreshSyncStatus();
      throw err;
    } finally {
      setIsSyncing(false);
    }
  }, [refreshSyncStatus]);

  // Fetch Pending Inbound Pairing Requests
  const fetchPendingPairingRequests = useCallback(async () => {
    try {
      const res = await apiClient.get('/api/lan/pair/pending');
      if (res && res.pending) {
        setPendingPairingRequests(res.pending);
      }
    } catch (err) {}
  }, []);

  // Request LAN Pairing with a discovered peer
  const requestLanPairing = async (device) => {
    try {
      const res = await apiClient.post('/api/lan/pair/send-request', {
        remoteIp: device.ip,
        remotePort: device.port || 5000,
        remoteDeviceId: device.deviceId
      });
      return res;
    } catch (err) {
      throw err;
    }
  };

  // Poll status of an outgoing pairing request
  const pollOutgoingPairingStatus = async (remoteIp, remotePort, requestId, remoteDeviceId, remoteDeviceName, remotePublicKey) => {
    try {
      const res = await apiClient.post('/api/lan/pair/check-status', {
        remoteIp,
        remotePort: remotePort || 5000,
        requestId,
        remoteDeviceId,
        remoteDeviceName,
        remotePublicKey
      });
      if (res && res.status === 'APPROVED') {
        await fetchPairedDevices();
        checkDevicesPresence();
      }
      return res;
    } catch (err) {
      throw err;
    }
  };

  // Approve LAN Pairing
  const approveLanPairing = async (requestId) => {
    try {
      const res = await apiClient.post('/api/lan/pair/approve', { requestId });
      await fetchPairedDevices();
      await fetchPendingPairingRequests();
      checkDevicesPresence();
      return res;
    } catch (err) {
      throw err;
    }
  };

  // Reject LAN Pairing
  const rejectLanPairing = async (requestId) => {
    try {
      const res = await apiClient.post('/api/lan/pair/reject', { requestId });
      await fetchPendingPairingRequests();
      return res;
    } catch (err) {
      throw err;
    }
  };

  // Unpair / Revoke LAN Device
  const unpairDevice = async (deviceId) => {
    try {
      // Optimistically remove immediately from local state
      setPairedDevices(prev => (prev || []).filter(d => d.id !== deviceId));
      delete consecutiveFailuresRef.current[deviceId];
      const res = await apiClient.delete(`/api/lan/devices/${deviceId}`);
      await fetchPairedDevices();
      return res;
    } catch (err) {
      await fetchPairedDevices();
      throw err;
    }
  };

  // Outbound LAN sync with a paired device
  const triggerLanSync = async (deviceId) => {
    setSyncStatus('SYNCING');
    setIsSyncing(true);
    try {
      const res = await apiClient.post('/api/lan/sync/outbound', { deviceId });
      if (res && res.success) {
        if (res.conflictCount > 0) {
          setSyncStatus('CONFLICT');
          setActiveConflicts(res.conflicts || []);
        } else {
          setSyncStatus('SYNCED');
        }
        await fetchPairedDevices();
        window.dispatchEvent(new CustomEvent('syncnote:notes-updated'));
      }
      return res;
    } catch (err) {
      setSyncStatus('FAILED');
      throw err;
    } finally {
      setIsSyncing(false);
    }
  };

  // Synchronize over LAN with a paired device (direct payload fallback)
  const syncOverLan = async (pairedDevice, notes, notebooks) => {
    return triggerLanSync(pairedDevice.id || pairedDevice.deviceId);
  };

  // Single Presence-Monitoring Scheduler & Lifecycle Manager
  useEffect(() => {
    let isMounted = true;

    // 1. Initial load
    refreshSyncStatus();
    fetchPendingPairingRequests();

    // 2. Load paired devices on startup and immediately probe presence
    const startupSequence = async () => {
      try {
        await fetchPairedDevices();
        if (isMounted) {
          await checkDevicesPresence();
        }
      } catch (e) {}
    };
    startupSequence();

    // 3. Exactly ONE presence-monitoring scheduler: check every 5 seconds
    const presenceInterval = setInterval(() => {
      if (isMounted) {
        checkDevicesPresence();
      }
    }, 5000);

    // 4. Background refresh interval for cloud sync & pairing requests (10s)
    const backgroundSyncInterval = setInterval(() => {
      if (isMounted) {
        refreshSyncStatus();
        fetchPendingPairingRequests();
      }
    }, 10000);

    return () => {
      isMounted = false;
      clearInterval(presenceInterval);
      clearInterval(backgroundSyncInterval);
    };
  }, [refreshSyncStatus, fetchPairedDevices, fetchPendingPairingRequests, checkDevicesPresence]);

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
    checkDevicesPresence,
    fetchPendingPairingRequests,
    requestLanPairing,
    pollOutgoingPairingStatus,
    approveLanPairing,
    rejectLanPairing,
    unpairDevice,
    triggerLanSync,
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
