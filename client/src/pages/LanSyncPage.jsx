import React, { useState, useEffect } from 'react';
import { useSync } from '../context/SyncContext';
import { useNavigate } from '../utils/router';
import PairDeviceModal from '../components/PairDeviceModal';
import { formatPresenceLastSeen } from '../utils/timeUtils';
import { 
  Wifi, 
  Laptop, 
  Smartphone, 
  Monitor, 
  ShieldCheck, 
  RefreshCw, 
  ArrowLeft, 
  Lock, 
  Unlink, 
  Check, 
  X,
  Key,
  Plus
} from 'lucide-react';

export default function LanSyncPage({ notes = [], notebooks = [] }) {
  const navigate = useNavigate();
  const sync = useSync();

  const [isPairModalOpen, setIsPairModalOpen] = useState(false);
  const [deviceSyncState, setDeviceSyncState] = useState({});
  const [deviceSyncMessage, setDeviceSyncMessage] = useState({});
  const [unpairingDeviceId, setUnpairingDeviceId] = useState(null);

  // Poll for pending inbound pairing requests periodically while on this page
  useEffect(() => {
    let isMounted = true;
    sync.fetchPendingPairingRequests();
    sync.fetchPairedDevices();

    const interval = setInterval(() => {
      if (isMounted) {
        sync.fetchPendingPairingRequests();
      }
    }, 3000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  // Handle Unpair: cleanly remove device locally and remotely without any scan UI or timers
  const handleUnpair = async (dev) => {
    const devId = dev.id;
    const devName = dev.deviceName || dev.device_name || 'this device';
    if (!window.confirm(`Unpair ${devName}? This will remove the trusted cryptographic connection.`)) {
      return;
    }

    setUnpairingDeviceId(devId);
    setDeviceSyncMessage(prev => ({ ...prev, [devId]: 'Unpairing...' }));

    try {
      await sync.unpairDevice(devId);
      // Immediately refreshed by unpairDevice; no discovery or scanning counter triggered
    } catch (err) {
      alert(`Failed to unpair: ${err.message}`);
    } finally {
      setUnpairingDeviceId(null);
    }
  };

  // Handle Manual LAN Sync with Paired Device
  const handleSyncWithDevice = async (dev) => {
    const devId = dev.id;
    setDeviceSyncState(prev => ({ ...prev, [devId]: 'Connecting' }));
    setDeviceSyncMessage(prev => ({ ...prev, [devId]: 'Connecting...' }));

    try {
      await new Promise(r => setTimeout(r, 200));
      setDeviceSyncState(prev => ({ ...prev, [devId]: 'Syncing' }));
      setDeviceSyncMessage(prev => ({ ...prev, [devId]: 'Syncing notes over encrypted channel...' }));

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

  const pairedDevices = sync.pairedDevices || [];
  const pendingRequests = sync.pendingPairingRequests || [];

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
          className="btn-primary"
          onClick={() => setIsPairModalOpen(true)}
          style={{ padding: '7px 14px', fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '6px' }}
        >
          <Key size={14} />
          <span>Pair New Device (PIN)</span>
        </button>
      </div>

      {/* Page Heading Bar */}
      <div className="page-header-bar" style={{ marginBottom: '24px' }}>
        <div>
          <h1 className="page-heading" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Wifi size={24} style={{ color: 'var(--accent-emerald)' }} />
            <span>LAN Devices & Synchronization</span>
          </h1>
          <p className="page-subheading" style={{ marginTop: '4px' }}>
            Encrypted peer-to-peer note synchronization over local Wi-Fi. Notes marked for LAN are synchronized directly without cloud servers.
          </p>
        </div>
      </div>

      {/* PENDING INBOUND PAIRING REQUESTS BANNER */}
      {pendingRequests.length > 0 && (
        <div style={{
          background: 'rgba(99, 102, 241, 0.08)',
          border: '1px solid var(--accent-primary)',
          borderRadius: 'var(--radius-md)',
          padding: '16px',
          marginBottom: '24px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px', color: 'var(--accent-primary)', fontWeight: 600, fontSize: '0.88rem' }}>
            <Lock size={16} />
            <span>Incoming Pairing Requests ({pendingRequests.length})</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {pendingRequests.map(req => (
              <div 
                key={req.id} 
                style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'space-between', 
                  padding: '12px 14px',
                  background: 'var(--bg-app)',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-subtle)',
                  flexWrap: 'wrap',
                  gap: '10px'
                }}
              >
                <div>
                  <div style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                    {req.requester_device_name || 'SyncNote Device'}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                    Device ID: ••••{req.requester_device_id?.slice(-6)} • IP: {req.requester_device_ip || 'Local Network'}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={async () => {
                      await sync.approveLanPairing(req.id);
                      await sync.fetchPairedDevices();
                      if (sync.checkDevicesPresence) sync.checkDevicesPresence();
                    }}
                    style={{ padding: '6px 14px', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '5px' }}
                  >
                    <Check size={14} />
                    <span>Approve</span>
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => sync.rejectLanPairing(req.id)}
                    style={{ padding: '6px 12px', fontSize: '0.78rem', color: 'var(--accent-danger)', display: 'flex', alignItems: 'center', gap: '4px' }}
                  >
                    <X size={14} />
                    <span>Reject</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* PAIRED DEVICES (MAIN LIST) */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
          <div>
            <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <ShieldCheck size={18} style={{ color: 'var(--accent-emerald)' }} />
              <span>Paired Devices ({pairedDevices.length})</span>
            </h2>
            <p style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: '2px' }}>
              Cryptographically trusted devices. Reachability is continuously monitored in the background.
            </p>
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
            <div style={{ color: 'var(--text-primary)', fontWeight: 600, marginBottom: '6px', fontSize: '0.94rem' }}>
              No Paired Devices Yet
            </div>
            <p style={{ maxWidth: '420px', margin: '0 auto 16px auto', fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
              Pair with another laptop or desktop over your local Wi-Fi using a 6-digit PIN. Once paired, you can synchronize notes directly peer-to-peer.
            </p>
            <button
              type="button"
              className="btn-primary"
              onClick={() => setIsPairModalOpen(true)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 18px', fontSize: '0.82rem' }}
            >
              <Key size={14} />
              <span>Pair New Device via PIN</span>
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {pairedDevices.map(dev => {
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
                      <div style={{ fontSize: '0.92rem', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span>{dev.deviceName || dev.device_name}</span>
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
                              IP: {dev.deviceIp}:{dev.devicePort || 5000}
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
                          {syncState === 'Connecting' && 'Connecting to peer...'}
                          {syncState === 'Syncing' && 'Syncing notes over encrypted channel...'}
                          {syncState === 'Synced' && (syncMsg || 'Successfully synchronized')}
                          {syncState === 'Failed' && (syncMsg || 'Synchronization failed')}
                        </div>
                      )}
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {/* Manual Sync button */}
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={syncState === 'Connecting' || syncState === 'Syncing'}
                      onClick={() => handleSyncWithDevice(dev)}
                      style={{ padding: '6px 14px', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '6px' }}
                    >
                      <RefreshCw size={12} className={(syncState === 'Connecting' || syncState === 'Syncing') ? 'spin' : ''} />
                      <span>
                        {syncState === 'Connecting' ? 'Connecting...' : syncState === 'Syncing' ? 'Syncing...' : 'Sync'}
                      </span>
                    </button>

                    {/* Unpair button: Immediately revokes locally and sends authenticated unpair to peer */}
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => handleUnpair(dev)}
                      disabled={unpairingDeviceId === dev.id}
                      title="Unpair and revoke trust"
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

      {/* 6-Digit PIN Pairing Modal */}
      <PairDeviceModal
        isOpen={isPairModalOpen}
        onClose={() => setIsPairModalOpen(false)}
        onDevicePaired={async () => {
          await sync.fetchPairedDevices();
          if (sync.checkDevicesPresence) sync.checkDevicesPresence();
        }}
      />
    </div>
  );
}
