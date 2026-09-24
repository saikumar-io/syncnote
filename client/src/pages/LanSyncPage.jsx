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
  Unlink 
} from 'lucide-react';

export default function LanSyncPage() {
  const navigate = useNavigate();
  const sync = useSync();

  const [deviceSyncState, setDeviceSyncState] = useState({});
  const [deviceSyncMessage, setDeviceSyncMessage] = useState({});
  const [unpairingDeviceId, setUnpairingDeviceId] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Load devices on mount and refresh reachability
  useEffect(() => {
    sync.fetchPairedDevices();
    if (sync.checkDevicesPresence) {
      sync.checkDevicesPresence();
    }
  }, []);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await sync.fetchPairedDevices();
      if (sync.checkDevicesPresence) {
        await sync.checkDevicesPresence();
      }
    } finally {
      setIsRefreshing(false);
    }
  };

  // Handle Unpair: cleanly remove device locally and remotely without any scan UI or timers
  const handleUnpair = async (dev) => {
    const devId = dev.id;
    const devName = dev.deviceName || dev.device_name || 'this device';
    if (!window.confirm(`Unpair ${devName}? This will remove the trusted connection.`)) {
      return;
    }

    setUnpairingDeviceId(devId);
    setDeviceSyncMessage(prev => ({ ...prev, [devId]: 'Unpairing...' }));

    try {
      await sync.unpairDevice(devId);
    } catch (err) {
      alert(`Failed to unpair: ${err.message}`);
    } finally {
      setUnpairingDeviceId(null);
    }
  };

  // Handle Manual LAN Sync with Device
  const handleSyncWithDevice = async (dev) => {
    const devId = dev.id;
    setDeviceSyncState(prev => ({ ...prev, [devId]: 'Syncing' }));
    setDeviceSyncMessage(prev => ({ ...prev, [devId]: 'Syncing notes over encrypted channel...' }));

    try {
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

  const devices = sync.pairedDevices || [];

  return (
    <div className="page-container" style={{ maxWidth: '820px', margin: '0 auto', padding: '24px 16px' }}>
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
          onClick={handleRefresh}
          disabled={isRefreshing}
          style={{ padding: '6px 12px', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '6px' }}
          title="Refresh device reachability"
        >
          <RefreshCw size={13} className={isRefreshing ? 'spin' : ''} />
          <span>{isRefreshing ? 'Checking...' : 'Refresh'}</span>
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
            Devices detected on your local network. Notes marked for LAN are synchronized directly without cloud servers.
          </p>
        </div>
      </div>

      {/* LAN DEVICES LIST */}
      <div>
        {devices.length === 0 ? (
          <div style={{
            background: 'var(--bg-app)',
            border: '1px dashed var(--border-subtle)',
            borderRadius: 'var(--radius-md)',
            padding: '48px 20px',
            textAlign: 'center',
            color: 'var(--text-muted)'
          }}>
            <Laptop size={36} style={{ margin: '0 auto 12px auto', display: 'block', opacity: 0.3 }} />
            <div style={{ color: 'var(--text-primary)', fontWeight: 600, marginBottom: '6px', fontSize: '0.96rem' }}>
              No LAN Devices Detected
            </div>
            <p style={{ maxWidth: '420px', margin: '0 auto', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              SyncNote automatically discovers other devices running on your local Wi-Fi network. Make sure the other laptop or desktop is connected to the same network.
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {devices.map(dev => {
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
                      {dev.deviceType === 'mobile' ? <Smartphone size={22} /> : dev.deviceType === 'desktop' ? <Monitor size={22} /> : <Laptop size={22} />}
                    </div>

                    <div>
                      <div style={{ fontSize: '0.92rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                        {dev.deviceName || dev.device_name || 'SyncNote Device'}
                      </div>

                      {/* Online / Offline status badge and last seen */}
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
                          Last seen: <strong style={{ color: 'var(--text-primary)' }}>{formatPresenceLastSeen(dev.lastSeen)}</strong>
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

                      {/* Active state message if syncing/synced/failed */}
                      {syncState && (
                        <div style={{
                          fontSize: '0.72rem',
                          marginTop: '5px',
                          fontWeight: 600,
                          color: syncState === 'Synced' ? 'var(--accent-emerald)' : syncState === 'Failed' ? 'var(--accent-danger)' : 'var(--accent-primary)'
                        }}>
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
                      disabled={syncState === 'Syncing'}
                      onClick={() => handleSyncWithDevice(dev)}
                      style={{ padding: '6px 14px', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '6px' }}
                    >
                      <RefreshCw size={12} className={syncState === 'Syncing' ? 'spin' : ''} />
                      <span>{syncState === 'Syncing' ? 'Syncing...' : 'Sync'}</span>
                    </button>

                    {/* Unpair button */}
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => handleUnpair(dev)}
                      disabled={unpairingDeviceId === dev.id}
                      title="Unpair and remove device"
                      style={{ padding: '6px 12px', fontSize: '0.78rem', color: 'var(--accent-danger)', display: 'flex', alignItems: 'center', gap: '4px' }}
                    >
                      <Unlink size={13} className={unpairingDeviceId === dev.id ? 'spin' : ''} />
                      <span>{unpairingDeviceId === dev.id ? 'Unpairing...' : 'Unpair'}</span>
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
