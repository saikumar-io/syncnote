import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { apiClient } from '../api/apiClient';
import OfflineReconnectionModal from '../components/OfflineReconnectionModal';
import ConflictResolverModal from '../components/ConflictResolverModal';

const SyncContext = createContext(null);

export function SyncProvider({ children }) {
  const [syncStatus, setSyncStatus] = useState('DRIVE_DISCONNECTED'); // 'SYNCED', 'SYNCING', 'PENDING', 'DRIVE_DISCONNECTED', 'OFFLINE', 'CONFLICT', 'ERROR', 'AUTH_REQUIRED'
  const [isSyncing, setIsSyncing] = useState(false);
  const [internetConnected, setInternetConnected] = useState(true);
  const [lanAvailable, setLanAvailable] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [pendingGoogleCount, setPendingGoogleCount] = useState(0);
  const [pendingGoogleItems, setPendingGoogleItems] = useState([]);
  const [isAllLocal, setIsAllLocal] = useState(false);
  const [failedCount, setFailedCount] = useState(0);
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const [nearbyDevices, setNearbyDevices] = useState([]);
  const [pairedDevices, setPairedDevices] = useState([]);
  const [pendingPairingRequests, setPendingPairingRequests] = useState([]);
  const [activeConflicts, setActiveConflicts] = useState([]);
  const [unresolvedConflicts, setUnresolvedConflicts] = useState([]);
  const [activeConflictModal, setActiveConflictModal] = useState(null);
  const [showReconnectionModal, setShowReconnectionModal] = useState(false);
  const [wasOffline, setWasOffline] = useState(false);

  // Presence monitoring refs: track consecutive failures per device and guard concurrent checks
  const isSyncingRef = useRef(false);
  const consecutiveFailuresRef = useRef({});
  const isCheckingPresenceRef = useRef(false);
  const pairedDevicesRef = useRef([]);
  const isAllLocalRef = useRef(false);
  const syncConfigRef = useRef({
    isAllLocal: true,
    hasSyncEnabledNotes: false,
    lanEnabled: false,
    cloudEnabled: false
  });

  // Keep refs in sync with state
  useEffect(() => {
    pairedDevicesRef.current = pairedDevices;
  }, [pairedDevices]);

  useEffect(() => {
    isAllLocalRef.current = isAllLocal;
  }, [isAllLocal]);

  // Separate Authoritative State for Google Login vs Google Drive Sync
  const [googleAccountStatus, setGoogleAccountStatus] = useState({ connected: false, email: null });
  const [googleDriveStatus, setGoogleDriveStatus] = useState({
    connected: false,
    authRequired: false,
    syncState: 'DISABLED',
    error: null,
    email: null,
    folderName: 'SyncNote',
    folderId: null,
    pendingCount: 0,
    lastSyncedAt: null
  });

  // Fetch current backend health and authoritative Google Drive status
  const refreshSyncStatus = useCallback(async (overrideSyncing) => {
    try {
      const activeSyncing = overrideSyncing !== undefined ? overrideSyncing : isSyncingRef.current;
      const health = await apiClient.get('/api/health').catch(() => null);
      let currentlyConnected = false;
      if (health && health.backend) {
        currentlyConnected = true;
        setInternetConnected(true);
      } else {
        setInternetConnected(false);
        setSyncStatus('OFFLINE');
        setWasOffline(true);
        return;
      }

      // 1. Concurrently fetch general sync status & canonical Google Drive status
      const [statusRes, gdriveRes] = await Promise.all([
        apiClient.get('/api/sync/status').catch(() => null),
        apiClient.get('/api/sync/gdrive/status').catch(() => null)
      ]);

      if (statusRes && statusRes.googleAccount) {
        setGoogleAccountStatus(statusRes.googleAccount);
      }

      const pCount = statusRes?.pendingCount || 0;
      setPendingCount(pCount);
      const isAllLocalVal = Boolean(statusRes?.isAllLocal);
      setIsAllLocal(isAllLocalVal);
      const fCount = statusRes?.failedCount || 0;
      setFailedCount(fCount);
      if (statusRes?.lastSyncedAt) {
        setLastSyncedAt(statusRes.lastSyncedAt);
      }

      const breakdown = statusRes?.breakdown || {};
      const lanEnabled = (breakdown.lan || 0) > 0 || (breakdown.both || 0) > 0;
      const cloudEnabled = (breakdown.google || 0) > 0 || (breakdown.both || 0) > 0;
      syncConfigRef.current = {
        isAllLocal: isAllLocalVal,
        hasSyncEnabledNotes: Boolean(statusRes?.hasSyncEnabledNotes),
        lanEnabled,
        cloudEnabled
      };

      // 2. Canonical Drive connection and auth state from authoritative endpoint (/api/sync/gdrive/status)
      // and /api/sync/status (same source of truth across UI and service)
      const driveInfo = gdriveRes || statusRes?.googleDrive || {};
      const isAuthReq = Boolean(
        driveInfo.authRequired ||
        driveInfo.syncState === 'AUTHENTICATION REQUIRED' ||
        statusRes?.googleDrive?.authRequired ||
        statusRes?.googleDrive?.syncState === 'AUTHENTICATION REQUIRED'
      );
      const isDriveConnected = Boolean(driveInfo.connected ?? statusRes?.googleDrive?.connected) && !isAuthReq;
      const gState = driveInfo.syncState || (isAuthReq ? 'AUTHENTICATION REQUIRED' : isDriveConnected ? 'CONNECTED' : 'DISABLED');

      const updatedDriveStatus = {
        connected: isDriveConnected,
        authRequired: isAuthReq,
        syncState: gState,
        error: driveInfo.error || null,
        email: driveInfo.email || null,
        folderName: driveInfo.folderName || 'SyncNote',
        folderId: driveInfo.folderId || null,
        pendingCount: driveInfo.pendingCount || 0,
        lastSyncedAt: driveInfo.lastSyncAt || driveInfo.lastSyncedAt || lastSyncedAt
      };
      setGoogleDriveStatus(updatedDriveStatus);
      setPendingGoogleCount(driveInfo.pendingCount || 0);
      if (driveInfo.lastSyncAt) {
        setLastSyncedAt(driveInfo.lastSyncAt);
      }

      // 3. Fetch canonical unresolved conflicts
      let currentConflicts = [];
      try {
        const conflictRes = await apiClient.get('/api/conflicts').catch(() => null);
        if (conflictRes && Array.isArray(conflictRes.conflicts)) {
          currentConflicts = conflictRes.conflicts;
          setUnresolvedConflicts(conflictRes.conflicts);
          setActiveConflicts(conflictRes.conflicts);
          if (conflictRes.conflicts.length === 0) {
            setActiveConflictModal(null);
          }
        }
      } catch (cErr) {}

      // Authoritative Global Sync Status Determination:
      // Must strictly distinguish between:
      // 1. SYNCED: Google Drive is connected and all enabled synchronization targets are up to date.
      // 2. SYNCING: A real synchronization operation is currently running.
      // 3. PENDING: Actual synchronization operations are waiting.
      // 4. DISCONNECTED: Google Drive is not connected/authenticated.
      // 5. OFFLINE: Required network connection is unavailable.
      // 6. ERROR: A synchronization operation failed.
      // 7. AUTH_REQUIRED: Google Drive authentication expired.
      //
      // "pendingCount === 0" MUST NOT automatically mean "Synced".
      if (!currentlyConnected) {
        setSyncStatus('OFFLINE');
      } else if (activeSyncing) {
        setSyncStatus('SYNCING');
      } else if (currentConflicts.length > 0) {
        setSyncStatus('CONFLICT');
      } else if (isAuthReq) {
        setSyncStatus('AUTH_REQUIRED');
      } else if (fCount > 0) {
        setSyncStatus('ERROR');
      } else if (pCount > 0) {
        setSyncStatus('PENDING');
      } else if (!isDriveConnected) {
        setSyncStatus('DRIVE_DISCONNECTED');
      } else {
        setSyncStatus('SYNCED');
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
        authRequired: false,
        syncState: 'DISABLED',
        error: null,
        email: null,
        folderName: 'SyncNote',
        folderId: null,
        pendingCount: 0,
        lastSyncedAt: null
      });
      setPendingGoogleCount(0);
      setSyncStatus('DRIVE_DISCONNECTED');
      await refreshSyncStatus(false);
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
        const presenceMap = new Map();
        for (const p of res.presence) {
          presenceMap.set(p.id, p);
        }

        setPairedDevices(prevDevices => {
          if (!prevDevices || prevDevices.length === 0) {
            if (res.presence.length > 0) {
              fetchPairedDevices();
            }
            return [];
          }

          const prevIds = new Set(prevDevices.map(d => d.id));
          const hasNew = res.presence.some(p => !prevIds.has(p.id));
          if (hasNew) {
            fetchPairedDevices();
          }

          return prevDevices
            .filter(device => presenceMap.has(device.id))
            .map(device => {
              const p = presenceMap.get(device.id);

              if (p.isOnline) {
                // Successfully received heartbeat response!
                consecutiveFailuresRef.current[device.id] = 0;
                return {
                  ...device,
                  isOnline: true,
                  isChecking: false,
                  lastSeen: p.lastSeen || new Date().toISOString(),
                  notesToSync: p.notesToSync !== undefined ? p.notesToSync : (device.notesToSync ?? 0),
                  notebooksToSync: p.notebooksToSync !== undefined ? p.notebooksToSync : (device.notebooksToSync ?? 0),
                  isUpToDate: p.isUpToDate !== undefined ? p.isUpToDate : (device.isUpToDate ?? false)
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
                  lastSeen: device.lastSeen || p.lastSeen || device.last_seen,
                  notesToSync: shouldMarkOffline ? null : device.notesToSync,
                  notebooksToSync: shouldMarkOffline ? null : device.notebooksToSync,
                  isUpToDate: shouldMarkOffline ? false : device.isUpToDate
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
    if (isSyncingRef.current || isSyncing || syncStatus === 'SYNCING') return;

    if (googleDriveStatus?.authRequired || googleDriveStatus?.syncState === 'AUTHENTICATION REQUIRED') {
      console.warn('[Google Drive] Cannot sync: Authentication required. Reconnect Google Drive in Settings.');
      setSyncStatus('AUTH_REQUIRED');
      return;
    }

    if (!googleDriveStatus?.connected) {
      console.warn('[Google Drive] Cannot sync: Google Drive is disconnected. Connect Google Drive in Settings.');
      setSyncStatus('DRIVE_DISCONNECTED');
      return;
    }

    isSyncingRef.current = true;
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

      // Clear syncing flags BEFORE refreshing status
      isSyncingRef.current = false;
      setIsSyncing(false);

      await refreshSyncStatus(false);
      
      // Dispatch real-time note update event for UI
      window.dispatchEvent(new CustomEvent('syncnote:notes-updated'));

      return gdriveRes;
    } catch (err) {
      console.error('Trigger sync error:', err);
      isSyncingRef.current = false;
      setIsSyncing(false);
      if (err?.message?.includes('401') || err?.message?.includes('authentication expired') || err?.status === 401) {
        setSyncStatus('AUTH_REQUIRED');
      } else if (err?.message?.includes('disconnected') || err?.status === 400) {
        setSyncStatus('DRIVE_DISCONNECTED');
      } else {
        setSyncStatus('FAILED');
      }
      await refreshSyncStatus(false);
      throw err;
    } finally {
      isSyncingRef.current = false;
      setIsSyncing(false);
    }
  }, [isSyncing, syncStatus, googleDriveStatus, refreshSyncStatus]);

  // Single Note Google Drive Sync
  const syncSingleNote = useCallback(async (noteId) => {
    if (!noteId || isSyncingRef.current) return;

    if (googleDriveStatus?.authRequired || googleDriveStatus?.syncState === 'AUTHENTICATION REQUIRED') {
      console.warn('[Google Drive] Cannot sync note: Authentication required. Reconnect Google Drive in Settings.');
      setSyncStatus('AUTH_REQUIRED');
      throw new Error('Google Drive authentication expired. Reconnect Google Drive in Settings.');
    }

    if (!googleDriveStatus?.connected) {
      console.warn('[Google Drive] Cannot sync note: Google Drive is disconnected.');
      setSyncStatus('DRIVE_DISCONNECTED');
      throw new Error('Google Drive is disconnected. Connect Google Drive in Settings to enable Cloud Synchronization for this note.');
    }

    isSyncingRef.current = true;
    setSyncStatus('SYNCING');
    setIsSyncing(true);
    try {
      const res = await apiClient.post(`/api/sync/gdrive/notes/${noteId}/sync`, {});
      if (res && res.result && res.result.lastSyncAt) {
        setLastSyncedAt(res.result.lastSyncAt);
      }
      isSyncingRef.current = false;
      setIsSyncing(false);
      await refreshSyncStatus(false);

      // Dispatch real-time note update event for UI
      window.dispatchEvent(new CustomEvent('syncnote:notes-updated'));

      return res;
    } catch (err) {
      isSyncingRef.current = false;
      setIsSyncing(false);
      if (err?.message?.includes('401') || err?.message?.includes('authentication expired') || err?.status === 401) {
        setSyncStatus('AUTH_REQUIRED');
      } else if (err?.message?.includes('disconnected') || err?.status === 400) {
        setSyncStatus('DRIVE_DISCONNECTED');
      } else {
        setSyncStatus('FAILED');
      }
      await refreshSyncStatus(false);
      throw err;
    } finally {
      isSyncingRef.current = false;
      setIsSyncing(false);
    }
  }, [googleDriveStatus, refreshSyncStatus]);

  // Fetch Pending Inbound Pairing Requests
  const fetchPendingPairingRequests = useCallback(async () => {
    try {
      const res = await apiClient.get('/api/lan/pair/pending');
      if (res && res.pending) {
        setPendingPairingRequests(res.pending);
      }
    } catch (err) {}
  }, []);

  // Generate 6-Digit PIN for LAN Pairing
  const generatePairingPin = async () => {
    return apiClient.post('/api/lan/pair/generate-code', {});
  };

  // Submit 6-Digit PIN to initiate pairing with a peer on LAN
  const submitPairingPin = async (pin, targetIp = null) => {
    return apiClient.post('/api/lan/pair/submit-pin', { pin, targetIp });
  };

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

  // Pair an available LAN device
  const pairDevice = async (device, onStatusChange) => {
    try {
      const targetDeviceId = device.deviceId || device.id;
      const targetIp = device.ip || device.deviceIp;
      const targetPort = device.port || device.devicePort || 5000;
      const targetPublicKey = device.publicKey;
      const targetDeviceName = device.deviceName || 'SyncNote Device';
      const targetDeviceType = device.deviceType || 'desktop';

      const res = await apiClient.post('/api/lan/pair', {
        targetDeviceId,
        targetIp,
        targetPort,
        targetPublicKey,
        targetDeviceName,
        targetDeviceType
      });

      if (res && res.status === 'APPROVED') {
        await fetchPairedDevices();
        await discoverLanDevices();
        checkDevicesPresence();
        return { status: 'APPROVED', pairedDevice: res.pairedDevice };
      }

      if (res && res.status === 'PENDING' && res.requestId) {
        if (onStatusChange) onStatusChange('AWAITING_APPROVAL');

        const startTime = Date.now();
        const timeoutMs = 30000;

        while (Date.now() - startTime < timeoutMs) {
          await new Promise(r => setTimeout(r, 1500));

          const checkRes = await apiClient.post('/api/lan/pair/check-status', {
            remoteIp: targetIp,
            remotePort: targetPort,
            requestId: res.requestId,
            targetDeviceId,
            targetDeviceName,
            targetDeviceType,
            targetPublicKey
          });

          if (checkRes && checkRes.status === 'APPROVED') {
            await fetchPairedDevices();
            await discoverLanDevices();
            checkDevicesPresence();
            return { status: 'APPROVED', pairedDevice: checkRes.pairedDevice };
          }

          if (checkRes && checkRes.status === 'REJECTED') {
            return { status: 'REJECTED' };
          }
        }

        return { status: 'TIMEOUT' };
      }

      return res;
    } catch (err) {
      throw err;
    }
  };

  // Unpair / Revoke LAN Device
  const unpairDevice = async (deviceId) => {
    try {
      // Optimistically remove immediately from local state
      setPairedDevices(prev => (prev || []).filter(d => d.id !== deviceId && d.deviceId !== deviceId));
      delete consecutiveFailuresRef.current[deviceId];
      const res = await apiClient.delete(`/api/lan/devices/${deviceId}`);
      await fetchPairedDevices();
      await discoverLanDevices();
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
          const conflictList = res.conflicts || [];
          setActiveConflicts(conflictList);
          setUnresolvedConflicts(conflictList);
          if (conflictList.length > 0) {
            setActiveConflictModal(conflictList[0]);
          }
        } else {
          setSyncStatus('SYNCED');
        }
        await fetchPairedDevices();
        window.dispatchEvent(new CustomEvent('syncnote:notes-updated'));
      }
      return res;
    } catch (err) {
      setSyncStatus('ERROR');
      throw err;
    } finally {
      setIsSyncing(false);
      try {
        await refreshSyncStatus(false);
      } catch (e) {}
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

    // 2. Load paired devices on startup and probe presence only if LAN sync is enabled
    const startupSequence = async () => {
      try {
        await fetchPairedDevices();
        if (isMounted && !syncConfigRef.current.isAllLocal && syncConfigRef.current.lanEnabled && pairedDevicesRef.current.length > 0) {
          await checkDevicesPresence();
        }
      } catch (e) {}
    };
    startupSequence();

    // 3. Exactly ONE presence-monitoring scheduler: runs only when LAN sync is active
    const presenceInterval = setInterval(() => {
      if (isMounted) {
        // Services must depend on actual configuration:
        // If LOCAL ONLY or LAN sync disabled or no paired devices: STOP/SKIP LAN heartbeat requests.
        if (syncConfigRef.current.isAllLocal || !syncConfigRef.current.lanEnabled || pairedDevicesRef.current.length === 0) {
          return;
        }
        checkDevicesPresence();
      }
    }, 15000);

    // 4. Background refresh interval for cloud sync & pairing requests (15s)
    const backgroundSyncInterval = setInterval(() => {
      if (isMounted) {
        refreshSyncStatus();
        if (syncConfigRef.current.lanEnabled) {
          fetchPendingPairingRequests();
        }
      }
    }, 15000);

    // 5. Update sync counts immediately when local notes are created, edited, or saved
    const handleNotesUpdated = () => {
      if (isMounted) {
        refreshSyncStatus();
        if (!syncConfigRef.current.isAllLocal && syncConfigRef.current.lanEnabled && pairedDevicesRef.current.length > 0) {
          checkDevicesPresence();
        }
      }
    };
    window.addEventListener('syncnote:notes-updated', handleNotesUpdated);

    return () => {
      isMounted = false;
      clearInterval(presenceInterval);
      clearInterval(backgroundSyncInterval);
      window.removeEventListener('syncnote:notes-updated', handleNotesUpdated);
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
    isAllLocal,
    failedCount,
    lastSyncedAt,
    nearbyDevices,
    pairedDevices,
    pendingPairingRequests,
    activeConflicts,
    unresolvedConflicts,
    unresolvedCount: unresolvedConflicts.length,
    openConflictModal: (conflictOrNoteId) => {
      if (!conflictOrNoteId) return;
      if (typeof conflictOrNoteId === 'object') {
        setActiveConflictModal(conflictOrNoteId);
      } else {
        const found = unresolvedConflicts.find(c => c.note_id === conflictOrNoteId);
        setActiveConflictModal(found || { note_id: conflictOrNoteId });
      }
    },
    closeConflictModal: () => setActiveConflictModal(null),
    showReconnectionModal,
    setShowReconnectionModal,
    triggerSync,
    syncSingleNote,
    disconnectDrive,
    refreshSyncStatus,
    discoverLanDevices,
    fetchPairedDevices,
    checkDevicesPresence,
    pairDevice,
    fetchPendingPairingRequests,
    requestLanPairing,
    pollOutgoingPairingStatus,
    approveLanPairing,
    rejectLanPairing,
    generatePairingPin,
    submitPairingPin,
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
      <ConflictResolverModal
        isOpen={Boolean(activeConflictModal)}
        conflict={activeConflictModal}
        onClose={() => setActiveConflictModal(null)}
        onResolved={() => {
          refreshSyncStatus();
          window.dispatchEvent(new CustomEvent('syncnote:notes-updated'));
        }}
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
