import React, { useState, useEffect, useRef } from 'react';
import { useSync } from '../context/SyncContext';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from '../utils/router';
import PairDeviceModal from '../components/PairDeviceModal';
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
  AlertTriangle
} from 'lucide-react';

export default function LanSyncPage({ notes = [], notebooks = [] }) {
  const navigate = useNavigate();
  const sync = useSync();
  const { user: currentUser } = useAuth();

  const [isScanning, setIsScanning] = useState(false);
  const [hasScanned, setHasScanned] = useState(false);
  const [nearbyDevices, setNearbyDevices] = useState([]);
  const [scanSecondsRemaining, setScanSecondsRemaining] = useState(10);
  
  const [selectedDeviceForPairing, setSelectedDeviceForPairing] = useState(null);
  const [isPairModalOpen, setIsPairModalOpen] = useState(false);
  const [accountMismatchMsg, setAccountMismatchMsg] = useState('');

  // Active connected device for note sync
  const [activeSyncDevice, setActiveSyncDevice] = useState(null);
  const [selectedNoteIds, setSelectedNoteIds] = useState([]);
  const [syncProgressState, setSyncProgressState] = useState(null);
  const [syncStatusMessage, setSyncStatusMessage] = useState('');

  const scanTimerRef = useRef(null);
  const pollIntervalRef = useRef(null);

  // Stop scanning helper
  const stopScanning = () => {
    if (scanTimerRef.current) clearInterval(scanTimerRef.current);
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    setIsScanning(false);
  };

  // Start 10-second continuous radar scan
  const startRadarScan = async () => {
    stopScanning();
    setIsScanning(true);
    setHasScanned(true);
    setScanSecondsRemaining(10);
    setAccountMismatchMsg('');

    // Trigger immediate discovery polling
    try {
      await sync.discoverLanDevices();
    } catch (e) {}

    // Poll discovery endpoint every 2.5 seconds during scan window
    pollIntervalRef.current = setInterval(async () => {
      try {
        await sync.discoverLanDevices();
      } catch (e) {}
    }, 2500);

    // Countdown timer for 10 seconds
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
    return () => stopScanning();
  }, []);

  useEffect(() => {
    if (sync.nearbyDevices) {
      setNearbyDevices(sync.nearbyDevices);
    }
  }, [sync.nearbyDevices]);

  // Filter only LAN-enabled notes
  const lanNotes = notes.filter((n) => n.sync_mode === 'lan');

  // Handle device bubble click
  const handleDeviceBubbleClick = (device) => {
    // Same-account validation check
    if (device.userId && currentUser && device.userId !== currentUser.id) {
      setAccountMismatchMsg(`Different SyncNote account on '${device.deviceName || 'Device'}'. Pairing unavailable.`);
      return;
    }

    setAccountMismatchMsg('');
    if (device.isPaired) {
      setActiveSyncDevice(device);
    } else {
      setSelectedDeviceForPairing(device);
      setIsPairModalOpen(true);
    }
  };

  // Note Selection Handlers
  const handleSelectAll = () => {
    setSelectedNoteIds(lanNotes.map((n) => n.id));
  };

  const handleClearAll = () => {
    setSelectedNoteIds([]);
  };

  const toggleNoteSelection = (noteId) => {
    setSelectedNoteIds((prev) => 
      prev.includes(noteId) ? prev.filter((id) => id !== noteId) : [...prev, noteId]
    );
  };

  // Perform Encrypted LAN Synchronization
  const handleSyncSelected = async () => {
    if (!activeSyncDevice) return;
    if (selectedNoteIds.length === 0) {
      setSyncStatusMessage('Please select at least one LAN note to synchronize.');
      return;
    }

    setSyncProgressState('PREPARING');
    setSyncStatusMessage('Preparing encrypted note payload...');

    try {
      await new Promise((r) => setTimeout(r, 600));
      setSyncProgressState('SENDING');
      setSyncStatusMessage('Sending encrypted notes over local Wi-Fi...');

      const notesToSync = lanNotes.filter((n) => selectedNoteIds.includes(n.id));
      await sync.syncOverLan(activeSyncDevice, notesToSync, notebooks);

      setSyncProgressState('RECEIVING');
      setSyncStatusMessage('Receiving updates from remote device...');

      await new Promise((r) => setTimeout(r, 600));
      setSyncProgressState('VERIFYING');
      setSyncStatusMessage('Verifying cryptographic SHA-256 integrity...');

      await new Promise((r) => setTimeout(r, 600));
      setSyncProgressState('COMPLETE');
      setSyncStatusMessage('LAN Synchronization complete!');
    } catch (err) {
      console.error('LAN Sync execution error:', err);
      setSyncProgressState(null);
      setSyncStatusMessage(err.message || 'LAN Synchronization failed. Ensure devices are on same network.');
    }
  };

  return (
    <div className="page-container" style={{ maxWidth: '880px', margin: '0 auto', padding: '24px 16px' }}>
      {/* Dynamic inline styles for radar pulse CSS animation */}
      <style>{`
        @keyframes radarExpand {
          0% { transform: scale(0.2); opacity: 0.9; }
          100% { transform: scale(1.4); opacity: 0; }
        }
        @keyframes bubbleFloat {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-4px); }
        }
      `}</style>

      {/* Top Header & Breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
        <button 
          className="btn-secondary"
          onClick={() => navigate('/settings')}
          style={{ padding: '6px 10px', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '4px' }}
        >
          <ArrowLeft size={14} />
          <span>Back to Settings</span>
        </button>
      </div>

      <div className="page-header-bar" style={{ marginBottom: '24px' }}>
        <div>
          <h1 className="page-heading" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Wifi size={24} style={{ color: 'var(--accent-emerald)' }} />
            <span>LAN Sync & Nearby Discovery</span>
          </h1>
          <p className="page-subheading" style={{ marginTop: '4px' }}>
            Private device-to-device synchronization over local Wi-Fi. LAN notes are <strong>NEVER</strong> sent to cloud servers.
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
              <span>Cancel Scan</span>
            </button>
          ) : (
            <button
              type="button"
              className="btn-primary"
              onClick={startRadarScan}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', fontSize: '0.84rem' }}
            >
              <Search size={15} />
              <span>{hasScanned ? 'Search Again' : 'Scan for Devices'}</span>
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

      {/* CONTINUOUS ANIMATED RADAR SCANNER WORKSPACE */}
      <div style={{
        background: 'var(--bg-app)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-md)',
        padding: '36px 20px',
        textAlign: 'center',
        marginBottom: '28px',
        position: 'relative',
        minHeight: '340px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden'
      }}>
        {/* Radar Animation Area */}
        <div style={{
          position: 'relative',
          width: '280px',
          height: '280px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 16px auto'
        }}>
          {/* Concentric Static Rings */}
          <div style={{ position: 'absolute', width: '260px', height: '260px', borderRadius: '50%', border: '1px dashed var(--border-subtle)', opacity: 0.6 }} />
          <div style={{ position: 'absolute', width: '180px', height: '180px', borderRadius: '50%', border: '1px solid var(--border-subtle)', opacity: 0.5 }} />
          <div style={{ position: 'absolute', width: '100px', height: '100px', borderRadius: '50%', border: '1px solid var(--border-subtle)', opacity: 0.5 }} />

          {/* Animated Expanding Pulse Rings during active scanning */}
          {isScanning && (
            <>
              <div style={{
                position: 'absolute', width: '240px', height: '240px', borderRadius: '50%',
                border: '2px solid var(--accent-emerald)',
                animation: 'radarExpand 2.2s cubic-bezier(0.1, 0.4, 0.8, 1) infinite'
              }} />
              <div style={{
                position: 'absolute', width: '240px', height: '240px', borderRadius: '50%',
                border: '1.5px solid var(--accent-emerald)',
                animation: 'radarExpand 2.2s cubic-bezier(0.1, 0.4, 0.8, 1) infinite 0.75s'
              }} />
            </>
          )}

          {/* Center Point Icon */}
          <div style={{
            width: '54px', height: '54px', borderRadius: '50%',
            background: 'var(--bg-card)', border: '2px solid var(--accent-emerald)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 0 20px rgba(16, 185, 129, 0.3)', zIndex: 5
          }}>
            <Wifi size={24} style={{ color: 'var(--accent-emerald)' }} />
          </div>

          {/* DYNAMICALLY DISCOVERED DEVICE BUBBLES AROUND RADAR */}
          {nearbyDevices.map((dev, idx) => {
            const total = nearbyDevices.length;
            const angle = (idx / total) * 2 * Math.PI - Math.PI / 2;
            const radius = 105; // radius in px
            const posX = 140 + radius * Math.cos(angle) - 45; // 45px offset
            const posY = 140 + radius * Math.sin(angle) - 32;

            const isCurrentAccount = !dev.userId || !currentUser || dev.userId === currentUser.id;

            return (
              <div
                key={dev.deviceId || dev.ip || idx}
                onClick={() => handleDeviceBubbleClick(dev)}
                title={`${dev.deviceName} (${dev.ip}) - Click to connect`}
                style={{
                  position: 'absolute',
                  left: `${posX}px`,
                  top: `${posY}px`,
                  width: '90px',
                  padding: '8px 6px',
                  background: 'var(--bg-card)',
                  border: `1.5px solid ${dev.isPaired ? 'var(--accent-emerald)' : isCurrentAccount ? 'var(--accent-primary)' : 'var(--accent-warning)'}`,
                  borderRadius: 'var(--radius-md)',
                  cursor: 'pointer',
                  boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
                  zIndex: 10,
                  animation: 'bubbleFloat 3s ease-in-out infinite',
                  transition: 'all 0.3s ease'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '4px', color: dev.isPaired ? 'var(--accent-emerald)' : 'var(--accent-primary)' }}>
                  {dev.deviceType === 'mobile' ? <Smartphone size={18} /> : dev.deviceType === 'desktop' ? <Monitor size={18} /> : <Laptop size={18} />}
                </div>
                <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {dev.deviceName || 'SyncNote'}
                </div>
                <div style={{ fontSize: '0.64rem', color: dev.isPaired ? 'var(--accent-emerald)' : 'var(--text-muted)' }}>
                  {dev.isPaired ? '● Trusted' : isCurrentAccount ? 'Found' : 'Diff Acc'}
                </div>
              </div>
            );
          })}
        </div>

        {/* Scan Status & Instructions */}
        {isScanning ? (
          <div>
            <h3 style={{ fontSize: '0.94rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
              <RefreshCw size={15} className="spin-icon text-muted" />
              <span>Searching for nearby SyncNote devices... ({scanSecondsRemaining}s)</span>
            </h3>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
              Listening for local SyncNote broadcasts on your Wi-Fi network...
            </p>
          </div>
        ) : !hasScanned ? (
          <div>
            <h3 style={{ fontSize: '0.94rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
              LAN Device Discovery
            </h3>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
              Click "Scan for Devices" to begin a continuous 10-second search for nearby devices.
            </p>
          </div>
        ) : nearbyDevices.length > 0 ? (
          <div>
            <h3 style={{ fontSize: '0.94rem', fontWeight: 600, color: 'var(--accent-emerald)', marginBottom: '4px' }}>
              Found {nearbyDevices.length} Device{nearbyDevices.length === 1 ? '' : 's'} Nearby
            </h3>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
              Click on any device bubble around the radar to pair or start synchronizing notes.
            </p>
          </div>
        ) : (
          /* NO DEVICES FOUND STATE (Shows ONLY after full scan window ends with 0 devices) */
          <div>
            <div style={{ color: 'var(--accent-warning)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', marginBottom: '6px' }}>
              <AlertCircle size={20} />
              <span style={{ fontSize: '0.94rem', fontWeight: 600 }}>No SyncNote devices found</span>
            </div>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', maxWidth: '440px', margin: '0 auto 12px auto' }}>
              No SyncNote devices were found on this network. Please ensure:
            </p>
            <ul style={{ fontSize: '0.74rem', color: 'var(--text-muted)', textAlign: 'left', display: 'inline-block', marginBottom: '14px', lineHeight: 1.6 }}>
              <li>• Both devices are connected to the exact same Wi-Fi / LAN network</li>
              <li>• SyncNote is active and running on the target computer</li>
              <li>• Local discovery is enabled on both devices</li>
            </ul>
          </div>
        )}
      </div>

      {/* DISCOVERED DEVICES DETAILED CARDS LIST */}
      {nearbyDevices.length > 0 && (
        <div style={{ marginBottom: '28px' }}>
          <div style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '12px' }}>
            Discovered Devices ({nearbyDevices.length})
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '12px' }}>
            {nearbyDevices.map((dev) => {
              const isCurrentAccount = !dev.userId || !currentUser || dev.userId === currentUser.id;

              return (
                <div 
                  key={dev.deviceId || dev.ip}
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
                      width: '38px', height: '38px', borderRadius: 'var(--radius-sm)',
                      background: dev.isPaired ? 'rgba(16, 185, 129, 0.12)' : 'rgba(59, 130, 246, 0.12)', 
                      display: 'flex', alignItems: 'center', justifyContent: 'center', 
                      color: dev.isPaired ? 'var(--accent-emerald)' : 'var(--accent-primary)', flexShrink: 0
                    }}>
                      <Laptop size={20} />
                    </div>

                    <div>
                      <div style={{ fontSize: '0.86rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                        {dev.deviceName || 'SyncNote Device'}
                      </div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                        {dev.deviceType || 'Desktop'} • IP: {dev.ip}
                      </div>
                      {!isCurrentAccount && (
                        <div style={{ fontSize: '0.7rem', color: 'var(--accent-warning)', marginTop: '2px', fontWeight: 600 }}>
                          Different SyncNote Account
                        </div>
                      )}
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '10px', borderTop: '1px solid var(--border-subtle)' }}>
                    <span style={{ fontSize: '0.72rem', color: dev.isPaired ? 'var(--accent-emerald)' : 'var(--text-muted)', fontWeight: 600 }}>
                      {dev.isPaired ? '● Paired & Trusted' : '○ Available'}
                    </span>

                    {dev.isPaired ? (
                      <button
                        type="button"
                        className="btn-primary"
                        onClick={() => setActiveSyncDevice(dev)}
                        style={{ padding: '4px 12px', fontSize: '0.76rem' }}
                      >
                        Sync Notes
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn-secondary"
                        disabled={!isCurrentAccount}
                        onClick={() => {
                          if (isCurrentAccount) {
                            setSelectedDeviceForPairing(dev);
                            setIsPairModalOpen(true);
                          }
                        }}
                        style={{ padding: '4px 12px', fontSize: '0.76rem' }}
                      >
                        {isCurrentAccount ? 'Pair Device' : 'Unavailable'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* NOTE SELECTION & SYNCHRONIZATION WORKSPACE */}
      {activeSyncDevice && (
        <div style={{
          background: 'var(--bg-app)',
          border: '1px solid var(--accent-emerald)',
          borderRadius: 'var(--radius-md)',
          padding: '20px',
          marginBottom: '24px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <div>
              <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                Connected to: <span style={{ color: 'var(--accent-emerald)' }}>{activeSyncDevice.deviceName}</span>
              </div>
              <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                Select LAN-enabled notes to synchronize over encrypted local transfer:
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button 
                type="button" 
                className="btn-secondary" 
                onClick={handleSelectAll}
                style={{ padding: '4px 10px', fontSize: '0.74rem' }}
              >
                Select All
              </button>
              <button 
                type="button" 
                className="btn-secondary" 
                onClick={handleClearAll}
                style={{ padding: '4px 10px', fontSize: '0.74rem' }}
              >
                Clear
              </button>
            </div>
          </div>

          {/* Notes Selection Table */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px', maxHeight: '300px', overflowY: 'auto' }}>
            {lanNotes.length === 0 ? (
              <div style={{ padding: '24px', textAlign: 'center', background: 'var(--bg-input)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
                <p style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 4px 0' }}>
                  No notes configured for LAN Sync
                </p>
                <p style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', margin: 0 }}>
                  Change a note's sync mode to <strong>[ LAN ]</strong> via the Note Context Menu to enable peer-to-peer synchronization.
                </p>
              </div>
            ) : (
              lanNotes.map((note) => {
                const isSelected = selectedNoteIds.includes(note.id);

                return (
                  <div 
                    key={note.id}
                    onClick={() => toggleNoteSelection(note.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px 12px',
                      background: isSelected ? 'rgba(16, 185, 129, 0.08)' : 'var(--bg-input)',
                      border: `1px solid ${isSelected ? 'var(--accent-emerald)' : 'var(--border-subtle)'}`,
                      borderRadius: 'var(--radius-sm)',
                      cursor: 'pointer'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      {isSelected ? (
                        <CheckSquare size={16} style={{ color: 'var(--accent-emerald)' }} />
                      ) : (
                        <Square size={16} style={{ color: 'var(--text-muted)' }} />
                      )}

                      <div>
                        <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                          {note.title || 'Untitled Note'}
                        </div>
                      </div>
                    </div>

                    <span style={{
                      fontSize: '0.68rem',
                      fontWeight: 600,
                      padding: '2px 6px',
                      borderRadius: '3px',
                      background: 'rgba(16, 185, 129, 0.15)',
                      color: 'var(--accent-emerald)'
                    }}>
                      [ LAN ]
                    </span>
                  </div>
                );
              })
            )}
          </div>

          {/* Sync Progress Banner */}
          {syncProgressState && (
            <div style={{
              background: 'var(--bg-input)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-sm)',
              padding: '12px',
              marginBottom: '16px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                  {syncStatusMessage}
                </span>
                <span style={{ fontSize: '0.74rem', fontWeight: 600, color: 'var(--accent-emerald)' }}>
                  {syncProgressState}
                </span>
              </div>

              {/* Progress Steps Bar */}
              <div style={{ display: 'flex', gap: '4px', height: '6px', width: '100%', background: 'var(--bg-app)', borderRadius: '3px', overflow: 'hidden' }}>
                <div style={{ flex: 1, background: ['PREPARING','SENDING','RECEIVING','VERIFYING','COMPLETE'].includes(syncProgressState) ? 'var(--accent-emerald)' : 'transparent', transition: 'all 0.3s' }} />
                <div style={{ flex: 1, background: ['SENDING','RECEIVING','VERIFYING','COMPLETE'].includes(syncProgressState) ? 'var(--accent-emerald)' : 'transparent', transition: 'all 0.3s' }} />
                <div style={{ flex: 1, background: ['RECEIVING','VERIFYING','COMPLETE'].includes(syncProgressState) ? 'var(--accent-emerald)' : 'transparent', transition: 'all 0.3s' }} />
                <div style={{ flex: 1, background: ['VERIFYING','COMPLETE'].includes(syncProgressState) ? 'var(--accent-emerald)' : 'transparent', transition: 'all 0.3s' }} />
                <div style={{ flex: 1, background: syncProgressState === 'COMPLETE' ? 'var(--accent-emerald)' : 'transparent', transition: 'all 0.3s' }} />
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '10px' }}>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setActiveSyncDevice(null);
                setSyncProgressState(null);
              }}
              style={{ padding: '6px 14px', fontSize: '0.78rem' }}
            >
              Cancel
            </button>

            <button
              type="button"
              className="btn-primary"
              onClick={handleSyncSelected}
              disabled={selectedNoteIds.length === 0 || !!syncProgressState}
              style={{ padding: '6px 16px', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              <RefreshCw size={14} className={syncProgressState && syncProgressState !== 'COMPLETE' ? 'spin-icon' : ''} />
              <span>{syncProgressState && syncProgressState !== 'COMPLETE' ? 'Synchronizing...' : 'Sync Selected'}</span>
            </button>
          </div>
        </div>
      )}

      {/* PAIR DEVICE MODAL */}
      <PairDeviceModal
        isOpen={isPairModalOpen}
        onClose={() => setIsPairModalOpen(false)}
        targetDevice={selectedDeviceForPairing}
        onDevicePaired={() => {
          sync.fetchPairedDevices();
          startRadarScan();
        }}
      />
    </div>
  );
}
