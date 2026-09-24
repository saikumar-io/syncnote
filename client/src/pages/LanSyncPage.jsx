import React, { useState, useEffect, useRef } from 'react';
import { useSync } from '../context/SyncContext';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from '../utils/router';
import PairDeviceModal from '../components/PairDeviceModal';
import { formatRelativeTime } from '../utils/timeUtils';
import { 
  Wifi, 
  Search, 
  Laptop, 
  Smartphone,
  Monitor,
  ShieldCheck, 
  RefreshCw, 
  ArrowLeft, 
  CheckSquare, 
  Square, 
  Lock, 
  AlertCircle,
  XCircle,
  CheckCircle2,
  AlertTriangle,
  Radio,
  Unlink,
  Check,
  X
} from 'lucide-react';

export default function LanSyncPage({ notes = [], notebooks = [] }) {
  const navigate = useNavigate();
  const sync = useSync();
  const { user: currentUser } = useAuth();

  const [isScanning, setIsScanning] = useState(false);
  const [hasScanned, setHasScanned] = useState(false);
  const [nearbyDevices, setNearbyDevices] = useState([]);
  const [scanSecondsRemaining, setScanSecondsRemaining] = useState(10);
  
  const [isPairModalOpen, setIsPairModalOpen] = useState(false);
  const [accountMismatchMsg, setAccountMismatchMsg] = useState('');

  // Per-device pairing state: { [deviceId]: 'Pairing requested' | 'Waiting for approval' | 'Paired' | 'Failed' }
  const [devicePairingState, setDevicePairingState] = useState({});
  // Per-device sync state: { [deviceId]: 'Connecting' | 'Syncing' | 'Synced' | 'Failed' }
  const [deviceSyncState, setDeviceSyncState] = useState({});
  const [deviceSyncMessage, setDeviceSyncMessage] = useState({});

  const scanTimerRef = useRef(null);
  const pollIntervalRef = useRef(null);
  const activePairPollers = useRef({});

  // Stop scanning helper
  const stopScanning = () => {
    if (scanTimerRef.current) clearInterval(scanTimerRef.current);
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    setIsScanning(false);
  };

  // Start 10-second continuous scan
  const startRadarScan = async () => {
    stopScanning();
    setIsScanning(true);
    setHasScanned(true);
    setScanSecondsRemaining(10);
    setAccountMismatchMsg('');

    try {
      await sync.discoverLanDevices();
    } catch (e) {}

    pollIntervalRef.current = setInterval(async () => {
      try {
        await sync.discoverLanDevices();
      } catch (e) {}
    }, 2500);

    let secondsLeft = 10;
    scanTimerRef.current = setInterval(() => {
      secondsLeft -= 1;
      setScanSecondsRemaining(secondsLeft);
      if (secondsLeft <= 0) {
        stopScanning();
      }
    }, 1000);
  };

  useEffect(() => {
    // Initial scan on mount
    startRadarScan();
    return () => {
      stopScanning();
      Object.values(activePairPollers.current).forEach(clearInterval);
    };
  }, []);

  useEffect(() => {
    if (sync.nearbyDevices) {
      setNearbyDevices(sync.nearbyDevices);
    }
  }, [sync.nearbyDevices]);

  // Handle explicit pair request to a discovered device
  const handleInitiatePair = async (device) => {
    const devId = device.deviceId || device.id;
    // Same-account validation
    if (device.userId && currentUser && device.userId !== currentUser.id && device.userId !== 'usr_local_default' && currentUser.id !== 'usr_local_default') {
      setAccountMismatchMsg(`Different SyncNote account on '${device.deviceName || 'Device'}'. Cross-account pairing rejected.`);
      return;
    }

    setAccountMismatchMsg('');
    setDevicePairingState(prev => ({ ...prev, [devId]: 'Pairing requested' }));

    try {
      const res = await sync.requestLanPairing(device);
      if (res && res.alreadyPaired) {
        setDevicePairingState(prev => ({ ...prev, [devId]: 'Paired' }));
        await sync.fetchPairedDevices();
        return;
      }

      if (res && res.requestId) {
        setDevicePairingState(prev => ({ ...prev, [devId]: 'Waiting for approval' }));

        // Start polling for approval from peer
        const pollInterval = setInterval(async () => {
          try {
            const statusRes = await sync.pollOutgoingPairingStatus(
              device.ip,
              device.port || 5000,
              res.requestId,
              devId,
              device.deviceName,
              device.publicKey
            );

            if (statusRes && statusRes.status === 'APPROVED') {
              clearInterval(activePairPollers.current[devId]);
              delete activePairPollers.current[devId];
              setDevicePairingState(prev => ({ ...prev, [devId]: 'Paired' }));
              await sync.fetchPairedDevices();
              await sync.discoverLanDevices();
            } else if (statusRes && statusRes.status === 'REJECTED') {
              clearInterval(activePairPollers.current[devId]);
              delete activePairPollers.current[devId];
              setDevicePairingState(prev => ({ ...prev, [devId]: 'Failed' }));
            }
          } catch (pollErr) {
            // keep polling until timeout
          }
        }, 1500);

        activePairPollers.current[devId] = pollInterval;

        // Auto-timeout polling after 60s
        setTimeout(() => {
          if (activePairPollers.current[devId]) {
            clearInterval(activePairPollers.current[devId]);
            delete activePairPollers.current[devId];
            setDevicePairingState(prev => {
              if (prev[devId] === 'Waiting for approval') {
                return { ...prev, [devId]: 'Failed' };
              }
              return prev;
            });
          }
        }, 60000);
      }
    } catch (err) {
      setDevicePairingState(prev => ({ ...prev, [devId]: 'Failed' }));
      setAccountMismatchMsg(err.message || 'Pairing request failed.');
    }
  };

  // Handle Unpair
  const handleUnpair = async (dev) => {
    if (!window.confirm(`Are you sure you want to unpair '${dev.deviceName || dev.device_name}'? It will no longer be able to sync notes.`)) {
      return;
    }

    try {
      await sync.unpairDevice(dev.id);
      await sync.discoverLanDevices();
    } catch (err) {
      alert(`Failed to unpair: ${err.message}`);
    }
  };

  // Handle Sync Now with Paired Device
  const handleSyncWithDevice = async (dev) => {
    const devId = dev.id;
    setDeviceSyncState(prev => ({ ...prev, [devId]: 'Connecting' }));
    setDeviceSyncMessage(prev => ({ ...prev, [devId]: 'Connecting...' }));

    try {
      await new Promise(r => setTimeout(r, 300));
      setDeviceSyncState(prev => ({ ...prev, [devId]: 'Syncing' }));
      setDeviceSyncMessage(prev => ({ ...prev, [devId]: 'Syncing notes over LAN...' }));

      const res = await sync.triggerLanSync(dev.id);

      setDeviceSyncState(prev => ({ ...prev, [devId]: 'Synced' }));
      const msg = res.conflictCount > 0 
        ? `Synced (${res.conflictCount} conflict copy created)` 
        : `Synced (${res.appliedCount || 0} updated)`;
      setDeviceSyncMessage(prev => ({ ...prev, [devId]: msg }));

      setTimeout(() => {
        setDeviceSyncState(prev => ({ ...prev, [devId]: null }));
        setDeviceSyncMessage(prev => ({ ...prev, [devId]: null }));
      }, 4000);
    } catch (err) {
      console.error('LAN Sync error:', err);
      setDeviceSyncState(prev => ({ ...prev, [devId]: 'Failed' }));
      setDeviceSyncMessage(prev => ({ ...prev, [devId]: err.message || 'Sync failed' }));

      setTimeout(() => {
        setDeviceSyncState(prev => ({ ...prev, [devId]: null }));
        setDeviceSyncMessage(prev => ({ ...prev, [devId]: null }));
      }, 5000);
    }
  };

  // Filter available devices that are NOT yet in paired list
  const pairedIds = new Set((sync.pairedDevices || []).map(d => d.id));
  const availableDevices = nearbyDevices.filter(d => !pairedIds.has(d.deviceId));

  return (
    <div className="page-container" style={{ maxWidth: '880px', margin: '0 auto', padding: '24px 16px' }}>
      {/* Top Header & Breadcrumbs */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
        <button 
          className="btn-secondary"
          onClick={() => navigate('/settings')}
          style={{ padding: '6px 12px', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '6px' }}
        >
          <ArrowLeft size={14} />
          <span>Back to Settings</span>
        </button>

        <button
          className="btn-secondary"
          onClick={() => setIsPairModalOpen(true)}
          style={{ padding: '6px 12px', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '6px' }}
        >
          <Lock size={13} />
          <span>Pair via 6-Digit PIN</span>
        </button>
      </div>

      <div className="page-header-bar" style={{ marginBottom: '20px' }}>
        <div>
          <h1 className="page-heading" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Wifi size={24} style={{ color: 'var(--accent-emerald)' }} />
            <span>LAN Devices & Synchronization</span>
          </h1>
          <p className="page-subheading" style={{ marginTop: '4px' }}>
            Encrypted peer-to-peer note synchronization over local Wi-Fi. Notes marked for LAN are synchronized directly without cloud servers.
          </p>
        </div>

        <div>
          {isScanning ? (
            <button
              type="button"
              className="btn-secondary"
              onClick={stopScanning}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', fontSize: '0.84rem', color: 'var(--accent-danger)' }}
            >
              <XCircle size={15} />
              <span>Stop Scan ({scanSecondsRemaining}s)</span>
            </button>
          ) : (
            <button
              type="button"
              className="btn-primary"
              onClick={startRadarScan}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', fontSize: '0.84rem' }}
            >
              <Search size={15} />
              <span>Scan for Devices</span>
            </button>
          )}
        </div>
      </div>

      {accountMismatchMsg && (
        <div className="auth-error-banner" style={{ marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <AlertTriangle size={16} />
          <span>{accountMismatchMsg}</span>
        </div>
      )}

      {/* PENDING INBOUND PAIRING REQUESTS BANNER */}
      {sync.pendingPairingRequests && sync.pendingPairingRequests.length > 0 && (
        <div style={{
          background: 'rgba(99, 102, 241, 0.1)',
          border: '1px solid var(--accent-primary)',
          borderRadius: 'var(--radius-md)',
          padding: '16px',
          marginBottom: '24px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px', color: 'var(--accent-primary)', fontWeight: 600, fontSize: '0.88rem' }}>
            <Radio size={16} className="spin" />
            <span>Incoming Pairing Requests ({sync.pendingPairingRequests.length})</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {sync.pendingPairingRequests.map(req => (
              <div 
                key={req.id} 
                style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'space-between',
                  padding: '10px 14px',
                  background: 'var(--bg-app)',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-subtle)'
                }}
              >
                <div>
                  <div style={{ fontSize: '0.84rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                    {req.requester_device_name || 'SyncNote Device'}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                    Device ID: {req.requester_device_id} • IP: {req.requester_device_ip || 'LAN'}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => sync.approveLanPairing(req.id)}
                    style={{ padding: '5px 12px', fontSize: '0.76rem', display: 'flex', alignItems: 'center', gap: '4px' }}
                  >
                    <Check size={13} />
                    <span>Approve</span>
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => sync.rejectLanPairing(req.id)}
                    style={{ padding: '5px 12px', fontSize: '0.76rem', color: 'var(--accent-danger)' }}
                  >
                    <X size={13} />
                    <span>Reject</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* DISCOVERING / SCANNING STATE INDICATOR */}
      {isScanning && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '10px',
          padding: '12px',
          background: 'var(--bg-app)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-md)',
          marginBottom: '20px',
          fontSize: '0.82rem',
          color: 'var(--accent-primary)'
        }}>
          <RefreshCw size={15} className="spin" />
          <span><strong>Discovering:</strong> Broadcasting safe UDP discovery probe on local subnet ({scanSecondsRemaining}s remaining)...</span>
        </div>
      )}

      {/* ========================================================
          SECTION 1: AVAILABLE ON LAN
          ======================================================== */}
      <div style={{ marginBottom: '32px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
          <h2 style={{ fontSize: '0.94rem', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Radio size={16} style={{ color: 'var(--accent-primary)' }} />
            <span>Available on LAN ({availableDevices.length})</span>
          </h2>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
            Nearby SyncNote instances detected via safe broadcast
          </span>
        </div>

        {availableDevices.length === 0 ? (
          <div style={{
            background: 'var(--bg-app)',
            border: '1px dashed var(--border-subtle)',
            borderRadius: 'var(--radius-md)',
            padding: '24px',
            textAlign: 'center',
            color: 'var(--text-muted)',
            fontSize: '0.8rem'
          }}>
            {isScanning ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                <RefreshCw size={18} className="spin" style={{ color: 'var(--accent-primary)' }} />
                <span>Searching for other SyncNote devices on this Wi-Fi...</span>
              </div>
            ) : (
              <div>
                <span>No unpaired SyncNote devices currently discovered on this local network.</span>
                <div style={{ marginTop: '8px' }}>
                  <button 
                    type="button" 
                    className="btn-secondary" 
                    onClick={startRadarScan}
                    style={{ padding: '4px 12px', fontSize: '0.74rem' }}
                  >
                    Scan Again
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(270px, 1fr))', gap: '12px' }}>
            {availableDevices.map(dev => {
              const devId = dev.deviceId || dev.id;
              const pairState = devicePairingState[devId] || 'Available';
              const isDiffAccount = dev.userId && currentUser && dev.userId !== currentUser.id && dev.userId !== 'usr_local_default' && currentUser.id !== 'usr_local_default';

              return (
                <div
                  key={devId}
                  style={{
                    background: 'var(--bg-app)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-md)',
                    padding: '16px',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    gap: '12px'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                    <div style={{
                      width: '38px',
                      height: '38px',
                      borderRadius: 'var(--radius-sm)',
                      background: 'rgba(99, 102, 241, 0.1)',
                      color: 'var(--accent-primary)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0
                    }}>
                      {dev.deviceType === 'mobile' ? <Smartphone size={20} /> : dev.deviceType === 'desktop' ? <Monitor size={20} /> : <Laptop size={20} />}
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '0.86rem', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {dev.deviceName || 'SyncNote Device'}
                      </div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                        IP: {dev.ip || 'Local'}:{dev.port || 5000}
                      </div>
                      {isDiffAccount && (
                        <div style={{ fontSize: '0.68rem', color: 'var(--accent-warning)', marginTop: '2px', fontWeight: 600 }}>
                          Different SyncNote Account
                        </div>
                      )}
                    </div>
                  </div>

                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingTop: '10px',
                    borderTop: '1px solid var(--border-subtle)'
                  }}>
                    {/* Pairing status badge */}
                    <div style={{ fontSize: '0.74rem' }}>
                      {pairState === 'Pairing requested' && (
                        <span style={{ color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 600 }}>
                          <RefreshCw size={11} className="spin" />
                          <span>Pairing requested</span>
                        </span>
                      )}
                      {pairState === 'Waiting for approval' && (
                        <span style={{ color: 'var(--accent-warning)', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 600 }}>
                          <RefreshCw size={11} className="spin" />
                          <span>Waiting for approval</span>
                        </span>
                      )}
                      {pairState === 'Paired' && (
                        <span style={{ color: 'var(--accent-emerald)', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 600 }}>
                          <CheckCircle2 size={12} />
                          <span>Paired</span>
                        </span>
                      )}
                      {pairState === 'Failed' && (
                        <span style={{ color: 'var(--accent-danger)', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 600 }}>
                          <AlertCircle size={12} />
                          <span>Failed</span>
                        </span>
                      )}
                      {pairState === 'Available' && (
                        <span style={{ color: 'var(--text-muted)' }}>
                          ○ {isDiffAccount ? 'Unavailable' : 'Available'}
                        </span>
                      )}
                    </div>

                    {/* Pair button */}
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={isDiffAccount || pairState === 'Pairing requested' || pairState === 'Waiting for approval'}
                      onClick={() => handleInitiatePair(dev)}
                      style={{ padding: '4px 12px', fontSize: '0.74rem' }}
                    >
                      {pairState === 'Waiting for approval' ? 'Waiting...' : pairState === 'Pairing requested' ? 'Sending...' : 'Pair'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ========================================================
          SECTION 2: PAIRED DEVICES
          ======================================================== */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
          <h2 style={{ fontSize: '0.94rem', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <ShieldCheck size={16} style={{ color: 'var(--accent-emerald)' }} />
            <span>Paired Devices ({sync.pairedDevices ? sync.pairedDevices.length : 0})</span>
          </h2>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
            Cryptographically authenticated devices trusted for direct note exchange
          </span>
        </div>

        {(!sync.pairedDevices || sync.pairedDevices.length === 0) ? (
          <div style={{
            background: 'var(--bg-app)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-md)',
            padding: '28px',
            textAlign: 'center',
            color: 'var(--text-muted)',
            fontSize: '0.8rem'
          }}>
            <Laptop size={28} style={{ margin: '0 auto 8px auto', display: 'block', opacity: 0.3 }} />
            <div style={{ color: 'var(--text-primary)', fontWeight: 600, marginBottom: '4px' }}>No Paired Devices Yet</div>
            <span>Pair with a nearby device from the "Available on LAN" section above to begin synchronizing.</span>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {sync.pairedDevices.map(dev => {
              const devId = dev.id;
              const syncState = deviceSyncState[devId];
              const syncMsg = deviceSyncMessage[devId];

              return (
                <div
                  key={devId}
                  style={{
                    background: 'var(--bg-app)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-md)',
                    padding: '14px 18px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '14px',
                    flexWrap: 'wrap'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{
                      width: '38px',
                      height: '38px',
                      borderRadius: 'var(--radius-sm)',
                      background: 'rgba(16, 185, 129, 0.1)',
                      color: 'var(--accent-emerald)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0
                    }}>
                      {dev.deviceType === 'mobile' ? <Smartphone size={20} /> : dev.deviceType === 'desktop' ? <Monitor size={20} /> : <Laptop size={20} />}
                    </div>

                    <div>
                      <div style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span>{dev.deviceName || dev.device_name}</span>
                        {/* Online / Offline badge */}
                        <span style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          fontSize: '0.68rem',
                          fontWeight: 600,
                          padding: '1px 6px',
                          borderRadius: '4px',
                          background: dev.isOnline ? 'rgba(16, 185, 129, 0.12)' : 'rgba(156, 163, 175, 0.12)',
                          color: dev.isOnline ? 'var(--accent-emerald)' : 'var(--text-muted)'
                        }}>
                          <span style={{
                            width: '6px',
                            height: '6px',
                            borderRadius: '50%',
                            background: dev.isOnline ? 'var(--accent-emerald)' : 'var(--text-muted)'
                          }} />
                          {dev.isOnline ? 'Online' : 'Offline'}
                        </span>
                      </div>

                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                        Last seen: <strong>{dev.lastSeen ? formatRelativeTime(dev.lastSeen) : 'Never'}</strong> • IP: {dev.deviceIp || dev.device_ip || 'Unknown'}
                      </div>

                      {/* Active state message if syncing/synced/failed */}
                      {syncState && (
                        <div style={{
                          fontSize: '0.7rem',
                          marginTop: '4px',
                          fontWeight: 600,
                          color: syncState === 'Synced' ? 'var(--accent-emerald)' : syncState === 'Failed' ? 'var(--accent-danger)' : 'var(--accent-primary)'
                        }}>
                          {syncState === 'Connecting' && 'Connecting to peer...'}
                          {syncState === 'Syncing' && 'Syncing notes over encrypted channel...'}
                          {syncState === 'Synced' && (syncMsg || 'Successfully synchronized')}
                          {syncState === 'Failed' && (syncMsg || 'Synchronization failed')}
                        </div>
                      )}
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {/* Sync button */}
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={syncState === 'Connecting' || syncState === 'Syncing'}
                      onClick={() => handleSyncWithDevice(dev)}
                      style={{ padding: '6px 14px', fontSize: '0.76rem', display: 'flex', alignItems: 'center', gap: '6px' }}
                    >
                      <RefreshCw size={12} className={(syncState === 'Connecting' || syncState === 'Syncing') ? 'spin' : ''} />
                      <span>
                        {syncState === 'Connecting' ? 'Connecting...' : syncState === 'Syncing' ? 'Syncing...' : 'Sync'}
                      </span>
                    </button>

                    {/* Unpair button */}
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => handleUnpair(dev)}
                      title="Unpair and revoke trust"
                      style={{ padding: '6px 12px', fontSize: '0.76rem', color: 'var(--accent-danger)', display: 'flex', alignItems: 'center', gap: '4px' }}
                    >
                      <Unlink size={13} />
                      <span>Unpair</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 6-Digit PIN Pairing Modal */}
      <PairDeviceModal
        isOpen={isPairModalOpen}
        onClose={() => setIsPairModalOpen(false)}
        onDevicePaired={() => {
          sync.fetchPairedDevices();
          sync.discoverLanDevices();
        }}
      />
    </div>
  );
}
