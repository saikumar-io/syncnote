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
  const [syncingDeviceId, setSyncingDeviceId] = useState(null);
  const [unpairingDeviceId, setUnpairingDeviceId] = useState(null);
  const [deviceMessages, setDeviceMessages] = useState({});

  // On mount: load paired devices, run discovery, and check reachability
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
      } catch (e) {}
    };

    init();

    return () => {
      isMounted = false;
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
    } catch (err) {
      console.warn('LAN scan error:', err);
    } finally {
      setTimeout(() => setIsScanning(false), 600);
    }
  };

  // Handle Pair: establishes mutual cryptographic trust
  const handlePair = async (dev) => {
    const devId = dev.deviceId || dev.id;
    setPairingDeviceId(devId);
    setDeviceMessages(prev => ({ ...prev, [devId]: { type: 'info', text: 'Connecting...' } }));

    try {
      await sync.pairDevice(dev);
      setDeviceMessages(prev => ({ ...prev, [devId]: { type: 'success', text: 'Connected' } }));
      setTimeout(() => {
        setDeviceMessages(prev => {
          const next = { ...prev };
          delete next[devId];
          return next;
        });
      }, 3000);
    } catch (err) {
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
    }
  };

  // Handle Manual Sync with a paired device
  const handleSync = async (dev) => {
    const devId = dev.id || dev.deviceId;
    setSyncingDeviceId(devId);
    setDeviceMessages(prev => ({ ...prev, [devId]: { type: 'info', text: 'Syncing notes over encrypted channel...' } }));

    try {
      const res = await sync.triggerLanSync(devId);
      const msg = res?.conflictCount > 0 
        ? `Synced (${res.conflictCount} conflict copy created)` 
        : 'Synced just now';
      setDeviceMessages(prev => ({ ...prev, [devId]: { type: 'success', text: msg } }));

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
    setDeviceMessages(prev => ({ ...prev, [devId]: { type: 'info', text: 'Unpairing...' } }));

    try {
      await sync.unpairDevice(devId);
    } catch (err) {
      alert(`Failed to unpair: ${err.message}`);
    } finally {
      setUnpairingDeviceId(null);
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
                      disabled={isPairing}
                      onClick={() => handlePair(dev)}
                      style={{ padding: '6px 16px', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '6px' }}
                    >
                      <Link size={13} className={isPairing ? 'spin' : ''} />
                      <span>{isPairing ? 'Pairing...' : 'Pair'}</span>
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
