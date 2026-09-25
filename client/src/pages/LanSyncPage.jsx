import React, { useState, useEffect } from 'react';
import { useSync } from '../context/SyncContext';
import { useNavigate } from '../utils/router';
import { formatPresenceLastSeen } from '../utils/timeUtils';
import { 
  Wifi, 
  Laptop, 
  Smartphone, 
  Monitor, 
  RefreshCw, 
  ArrowLeft, 
  Unlink,
  Link,
  ShieldCheck,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';

export default function LanSyncPage() {
  const navigate = useNavigate();
  const sync = useSync();

  const [isScanning, setIsScanning] = useState(false);
  const [pairingDeviceId, setPairingDeviceId] = useState(null);
  const [pairingStatus, setPairingStatus] = useState({}); // { [devId]: 'WAITING_APPROVAL' }
  const [syncingDeviceId, setSyncingDeviceId] = useState(null);
  const [unpairingDeviceId, setUnpairingDeviceId] = useState(null);
  const [deviceMessages, setDeviceMessages] = useState({});

  // On mount: load paired devices, run discovery, check reachability, and poll for pending requests
  useEffect(() => {
    let isMounted = true;

    const init = async () => {
      try {
        await sync.fetchPairedDevices();
        if (sync.discoverLanDevices) {
          await sync.discoverLanDevices();
        }
        if (sync.checkDevicesPresence) {
          await sync.checkDevicesPresence();
        }
        if (sync.fetchPendingPairingRequests) {
          await sync.fetchPendingPairingRequests();
        }
      } catch (e) {}
    };

    init();

    // Fast poll for pending incoming pairing requests so approval prompt appears promptly
    const pendingInterval = setInterval(() => {
      if (isMounted && sync.fetchPendingPairingRequests) {
        sync.fetchPendingPairingRequests();
      }
    }, 2000);

    return () => {
      isMounted = false;
      clearInterval(pendingInterval);
    };
  }, []);

  // Handle Scan: triggers fresh UDP discovery without modals or counters
  const handleScan = async () => {
    if (isScanning) return;
    setIsScanning(true);
    try {
      if (sync.discoverLanDevices) {
        await sync.discoverLanDevices();
      }
      await sync.fetchPairedDevices();
      if (sync.checkDevicesPresence) {
        await sync.checkDevicesPresence();
      }
      if (sync.fetchPendingPairingRequests) {
        await sync.fetchPendingPairingRequests();
      }
    } catch (err) {
      console.warn('LAN scan error:', err);
    } finally {
      setTimeout(() => setIsScanning(false), 600);
    }
  };

  // Handle Approve: user accepts incoming pairing request
  const handleApprove = async (requestId) => {
    try {
      await sync.approveLanPairing(requestId);
    } catch (err) {
      console.error('Failed to approve pairing:', err);
      alert(`Approval error: ${err.message}`);
    }
  };

  // Handle Reject: user declines incoming pairing request
  const handleReject = async (requestId) => {
    try {
      await sync.rejectLanPairing(requestId);
    } catch (err) {
      console.error('Failed to reject pairing:', err);
    }
  };

  // Handle Pair: initiates pairing and waits for remote approval
  const handlePair = async (dev) => {
    const devId = dev.deviceId || dev.id;
    setPairingDeviceId(devId);
    setPairingStatus(prev => ({ ...prev, [devId]: 'WAITING_APPROVAL' }));

    try {
      const result = await sync.pairDevice(dev);
      if (result && result.status === 'APPROVED') {
        // Automatically moved to Paired Devices
      } else if (result && result.status === 'REJECTED') {
        // Reverted to UNPAIRED without popup
      } else if (result && result.status === 'TIMEOUT') {
        // Timed out waiting for approval: reverted cleanly
      }
    } catch (err) {
      console.warn('Pairing error:', err);
      setDeviceMessages(prev => ({ ...prev, [devId]: { type: 'error', text: err.message || 'Pairing failed' } }));
      setTimeout(() => {
        setDeviceMessages(prev => {
          const next = { ...prev };
          delete next[devId];
          return next;
        });
      }, 5000);
    } finally {
      setPairingDeviceId(null);
      setPairingStatus(prev => {
        const next = { ...prev };
        delete next[devId];
        return next;
      });
    }
  };

  // Handle Manual Sync with a paired device
  const handleSync = async (dev) => {
    const devId = dev.id || dev.deviceId;
    setSyncingDeviceId(devId);
    setDeviceMessages(prev => ({ ...prev, [devId]: { type: 'info', text: 'Syncing notes over encrypted channel...' } }));

    try {
      const res = await sync.triggerLanSync(devId);
      const isConflict = (res?.conflictCount || 0) > 0;
      const msg = isConflict 
        ? `Conflict detected (${res.conflictCount}) - awaiting resolution` 
        : 'Synced just now';
      setDeviceMessages(prev => ({ 
        ...prev, 
        [devId]: { 
          type: isConflict ? 'warning' : 'success', 
          text: msg 
        } 
      }));

      // Immediately refresh presence and sync status to reflect '✓ Up to date'
      if (sync.checkDevicesPresence) {
        await sync.checkDevicesPresence();
      }
      if (sync.fetchPairedDevices) {
        await sync.fetchPairedDevices();
      }

      setTimeout(() => {
        setDeviceMessages(prev => {
          const next = { ...prev };
          delete next[devId];
          return next;
        });
      }, 4000);
    } catch (err) {
      console.error('LAN Sync error:', err);
      setDeviceMessages(prev => ({ ...prev, [devId]: { type: 'error', text: err.message || 'Sync failed' } }));

      setTimeout(() => {
        setDeviceMessages(prev => {
          const next = { ...prev };
          delete next[devId];
          return next;
        });
      }, 5000);
    } finally {
      setSyncingDeviceId(null);
    }
  };

  // Handle Unpair: cleanly revokes locally and remotely
  const handleUnpair = async (dev) => {
    const devId = dev.id || dev.deviceId;
    const devName = dev.deviceName || dev.device_name || 'this device';
    if (!window.confirm(`Unpair ${devName}? This will remove the trusted connection.`)) {
      return;
    }

    setUnpairingDeviceId(devId);

    try {
      await sync.unpairDevice(devId);
    } catch (err) {
      console.warn('Unpair warning:', err);
    } finally {
      setUnpairingDeviceId(null);
      setDeviceMessages(prev => {
        const next = { ...prev };
        delete next[devId];
        return next;
      });
    }
  };

  const pairedDevices = sync.pairedDevices || [];
  const pairedIds = new Set(pairedDevices.map(d => d.id || d.deviceId));

  // Available devices are discovered devices that are NOT currently paired
  const availableDevices = (sync.nearbyDevices || []).filter(d => {
    const id = d.deviceId || d.id;
    return id && !pairedIds.has(id);
  });

  const getDeviceIcon = (deviceType) => {
    if (deviceType === 'mobile') return <Smartphone size={22} />;
    if (deviceType === 'desktop') return <Monitor size={22} />;
    return <Laptop size={22} />;
  };

  return (
    <div className="page-container" style={{ maxWidth: '840px', margin: '0 auto', padding: '24px 16px' }}>
      {/* Top Navigation & Scan Bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
        <button 
          className="btn-secondary"
          onClick={() => navigate('/settings')}
          style={{ padding: '6px 12px', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '6px' }}
        >
          <ArrowLeft size={14} />
          <span>Back to Settings</span>
        </button>

        {/* Visible [↻ Scan] Button */}
        <button
          className="btn-primary"
          onClick={handleScan}
          disabled={isScanning}
          style={{ padding: '7px 16px', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '6px' }}
          title="Scan local network for SyncNote devices"
        >
          <RefreshCw size={13} className={isScanning ? 'spin' : ''} />
          <span>{isScanning ? 'Scanning...' : 'Scan'}</span>
        </button>
      </div>

      {/* Page Heading Bar */}
      <div className="page-header-bar" style={{ marginBottom: '24px' }}>
        <div>
          <h1 className="page-heading" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Wifi size={24} style={{ color: 'var(--accent-emerald)' }} />
            <span>LAN Devices</span>
          </h1>
          <p className="page-subheading" style={{ marginTop: '4px' }}>
            Devices detected on your local network. Exchange notes peer-to-peer without cloud servers.
          </p>
        </div>
      </div>

      {/* Subtle scanning notification */}
      {isScanning && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '10px 14px',
          background: 'rgba(99, 102, 241, 0.08)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-sm)',
          marginBottom: '20px',
          fontSize: '0.78rem',
          color: 'var(--accent-primary)'
        }}>
          <RefreshCw size={13} className="spin" />
          <span>Scanning local network for SyncNote devices...</span>
        </div>
      )}

      {/* SECTION: INCOMING PAIRING REQUEST APPROVAL PROMPT */}
      {sync.pendingPairingRequests && sync.pendingPairingRequests.length > 0 && (
        <div style={{ marginBottom: '24px' }}>
          {sync.pendingPairingRequests.map(req => (
            <div
              key={req.id}
              style={{
                background: 'var(--bg-app)',
                border: '1.5px solid var(--accent-primary)',
                boxShadow: '0 4px 14px rgba(99, 102, 241, 0.12)',
                borderRadius: 'var(--radius-md)',
                padding: '16px 20px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '16px',
                flexWrap: 'wrap',
                marginBottom: '12px'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                <div style={{
                  width: '42px',
                  height: '42px',
                  borderRadius: 'var(--radius-sm)',
                  background: 'rgba(99, 102, 241, 0.12)',
                  color: 'var(--accent-primary)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0
                }}>
                  {getDeviceIcon(req.requesterDeviceType)}
                </div>
                <div>
                  <div style={{ fontSize: '0.94rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                    SyncNote device wants to connect
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                    Device: <strong style={{ color: 'var(--text-primary)' }}>{req.requesterDeviceName} ({req.requesterDeviceType || 'desktop'})</strong>
                  </div>
                  {req.requesterDeviceIp && (
                    <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                      IP: <strong>{req.requesterDeviceIp}</strong>
                    </div>
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => handleApprove(req.id)}
                  style={{
                    padding: '6px 18px',
                    fontSize: '0.8rem',
                    background: 'var(--accent-emerald)',
                    borderColor: 'var(--accent-emerald)',
                    fontWeight: 600
                  }}
                >
                  Approve
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => handleReject(req.id)}
                  style={{
                    padding: '6px 14px',
                    fontSize: '0.8rem',
                    color: 'var(--accent-danger)',
                    fontWeight: 600
                  }}
                >
                  Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* SECTION 1: AVAILABLE ON LAN */}
      <div style={{ marginBottom: '32px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
          <h2 style={{ fontSize: '0.96rem', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Wifi size={17} style={{ color: 'var(--accent-primary)' }} />
            <span>Available on LAN</span>
            <span style={{ fontSize: '0.74rem', padding: '1px 7px', borderRadius: '10px', background: 'var(--bg-app)', color: 'var(--text-muted)', border: '1px solid var(--border-subtle)' }}>
              {availableDevices.length}
            </span>
          </h2>
        </div>

        {availableDevices.length === 0 ? (
          <div style={{
            background: 'var(--bg-app)',
            border: '1px dashed var(--border-subtle)',
            borderRadius: 'var(--radius-md)',
            padding: '24px 16px',
            textAlign: 'center',
            color: 'var(--text-muted)',
            fontSize: '0.8rem'
          }}>
            {isScanning ? (
              <span>Searching for nearby SyncNote devices...</span>
            ) : (
              <span>No unpaired devices detected. Click <strong>[↻ Scan]</strong> to search your local network.</span>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {availableDevices.map(dev => {
              const devId = dev.deviceId || dev.id;
              const isPairing = pairingDeviceId === devId;
              const isWaitingApproval = pairingStatus[devId] === 'WAITING_APPROVAL';
              const msg = deviceMessages[devId];

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
                    gap: '12px',
                    flexWrap: 'wrap'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                    <div style={{
                      width: '40px',
                      height: '40px',
                      borderRadius: 'var(--radius-sm)',
                      background: 'rgba(99, 102, 241, 0.1)',
                      color: 'var(--accent-primary)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0
                    }}>
                      {getDeviceIcon(dev.deviceType)}
                    </div>

                    <div>
                      <div style={{ fontSize: '0.92rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                        {dev.deviceName || 'SyncNote Device'}
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px', fontSize: '0.76rem' }}>
                        <span style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          fontWeight: 600,
                          color: 'var(--accent-emerald)'
                        }}>
                          <span style={{ fontSize: '0.78rem' }}>🟢</span>
                          <span>Online</span>
                        </span>

                        {dev.ip && (
                          <>
                            <span style={{ color: 'var(--text-muted)' }}>•</span>
                            <span style={{ color: 'var(--text-muted)' }}>
                              {dev.ip}:{dev.port || 5000}
                            </span>
                          </>
                        )}
                      </div>

                      {msg && (
                        <div style={{
                          fontSize: '0.72rem',
                          marginTop: '4px',
                          fontWeight: 600,
                          color: msg.type === 'success' ? 'var(--accent-emerald)' : msg.type === 'error' ? 'var(--accent-danger)' : 'var(--accent-primary)'
                        }}>
                          {msg.text}
                        </div>
                      )}
                    </div>
                  </div>

                  <div>
                    {/* [Pair] Button */}
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={isPairing || isWaitingApproval}
                      onClick={() => handlePair(dev)}
                      style={{ padding: '6px 16px', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '6px' }}
                    >
                      {isWaitingApproval ? (
                        <>
                          <RefreshCw size={13} className="spin" />
                          <span>Waiting for approval...</span>
                        </>
                      ) : (
                        <>
                          <Link size={13} className={isPairing ? 'spin' : ''} />
                          <span>Pair</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* SECTION 2: PAIRED DEVICES */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
          <div>
            <h2 style={{ fontSize: '0.96rem', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <ShieldCheck size={18} style={{ color: 'var(--accent-emerald)' }} />
              <span>Paired Devices</span>
              <span style={{ fontSize: '0.74rem', padding: '1px 7px', borderRadius: '10px', background: 'var(--bg-app)', color: 'var(--text-muted)', border: '1px solid var(--border-subtle)' }}>
                {pairedDevices.length}
              </span>
            </h2>
          </div>
        </div>

        {pairedDevices.length === 0 ? (
          <div style={{
            background: 'var(--bg-app)',
            border: '1px dashed var(--border-subtle)',
            borderRadius: 'var(--radius-md)',
            padding: '36px 20px',
            textAlign: 'center',
            color: 'var(--text-muted)',
            fontSize: '0.84rem'
          }}>
            <Laptop size={32} style={{ margin: '0 auto 10px auto', display: 'block', opacity: 0.3 }} />
            <div style={{ color: 'var(--text-primary)', fontWeight: 600, marginBottom: '6px', fontSize: '0.92rem' }}>
              No Paired Devices
            </div>
            <p style={{ maxWidth: '400px', margin: '0 auto', fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
              Devices discovered on your local network will appear in <strong>Available on LAN</strong> above. Click <strong>[Pair]</strong> to establish a secure connection.
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {pairedDevices.map(dev => {
              const devId = dev.id || dev.deviceId;
              const isSyncing = syncingDeviceId === devId;
              const isUnpairing = unpairingDeviceId === devId;
              const msg = deviceMessages[devId];

              return (
                <div
                  key={devId}
                  style={{
                    background: 'var(--bg-app)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-md)',
                    padding: '16px 20px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '14px',
                    flexWrap: 'wrap'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                    <div style={{
                      width: '42px',
                      height: '42px',
                      borderRadius: 'var(--radius-sm)',
                      background: dev.isOnline ? 'rgba(16, 185, 129, 0.12)' : 'rgba(156, 163, 175, 0.1)',
                      color: dev.isOnline ? 'var(--accent-emerald)' : 'var(--text-muted)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0
                    }}>
                      {getDeviceIcon(dev.deviceType)}
                    </div>

                    <div>
                      <div style={{ fontSize: '0.92rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                        {dev.deviceName || dev.device_name || 'SyncNote Device'}
                      </div>

                      {/* Online / Offline badge and Last seen */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px', fontSize: '0.78rem' }}>
                        <span style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '5px',
                          fontWeight: 600,
                          color: dev.isOnline ? 'var(--accent-emerald)' : 'var(--text-muted)'
                        }}>
                          <span style={{ fontSize: '0.82rem', lineHeight: 1 }}>
                            {dev.isOnline ? '🟢' : '⚪'}
                          </span>
                          <span>{dev.isOnline ? 'Online' : 'Offline'}</span>
                        </span>

                        <span style={{ color: 'var(--text-muted)' }}>•</span>

                        <span style={{ color: 'var(--text-secondary)' }}>
                          Last seen: <strong style={{ color: 'var(--text-primary)' }}>{dev.isOnline ? 'Just now' : formatPresenceLastSeen(dev.lastSeen)}</strong>
                        </span>

                        {dev.deviceIp && (
                          <>
                            <span style={{ color: 'var(--text-muted)' }}>•</span>
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>
                              {dev.deviceIp}:{dev.devicePort || 5000}
                            </span>
                          </>
                        )}
                      </div>

                      {/* Sync status / pending count row */}
                      <div style={{ marginTop: '5px', fontSize: '0.78rem' }}>
                        {!dev.isOnline ? (
                          <span style={{ color: 'var(--text-muted)' }}>
                            Sync status unavailable while offline
                          </span>
                        ) : (dev.notesToSync === 0 && dev.notebooksToSync === 0) || dev.isUpToDate ? (
                          <span style={{ color: 'var(--accent-emerald)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                            <CheckCircle2 size={13} />
                            <span>Up to date</span>
                          </span>
                        ) : (
                          <span style={{ color: 'var(--accent-primary)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                            <RefreshCw size={12} />
                            <span>
                              {dev.notesToSync > 0 && dev.notebooksToSync > 0 ? (
                                `${dev.notesToSync} ${dev.notesToSync === 1 ? 'note' : 'notes'} • ${dev.notebooksToSync} ${dev.notebooksToSync === 1 ? 'notebook' : 'notebooks'} to sync`
                              ) : dev.notesToSync > 0 ? (
                                `${dev.notesToSync} ${dev.notesToSync === 1 ? 'note' : 'notes'} to sync`
                              ) : dev.notebooksToSync > 0 ? (
                                `${dev.notebooksToSync} ${dev.notebooksToSync === 1 ? 'notebook' : 'notebooks'} to sync`
                              ) : (
                                'Up to date'
                              )}
                            </span>
                          </span>
                        )}
                      </div>

                      {msg && (
                        <div style={{
                          fontSize: '0.72rem',
                          marginTop: '5px',
                          fontWeight: 600,
                          color: msg.type === 'success' ? 'var(--accent-emerald)' : msg.type === 'error' ? 'var(--accent-danger)' : 'var(--accent-primary)'
                        }}>
                          {msg.text}
                        </div>
                      )}
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {/* [Sync] Button */}
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={isSyncing}
                      onClick={() => handleSync(dev)}
                      style={{ padding: '6px 14px', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '6px' }}
                    >
                      <RefreshCw size={12} className={isSyncing ? 'spin' : ''} />
                      <span>{isSyncing ? 'Syncing...' : 'Sync'}</span>
                    </button>

                    {/* [Unpair] Button */}
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => handleUnpair(dev)}
                      disabled={isUnpairing}
                      title="Unpair and remove device"
                      style={{ padding: '6px 12px', fontSize: '0.78rem', color: 'var(--accent-danger)', display: 'flex', alignItems: 'center', gap: '4px' }}
                    >
                      <Unlink size={13} className={isUnpairing ? 'spin' : ''} />
                      <span>{isUnpairing ? 'Unpairing...' : 'Unpair'}</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
