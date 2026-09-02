import React, { useState, useEffect } from 'react';
import { apiClient } from '../api/apiClient';
import { 
  Wifi, 
  RefreshCw, 
  X, 
  Laptop, 
  Smartphone, 
  ShieldCheck, 
  AlertCircle, 
  Key,
  CheckCircle2,
  Lock
} from 'lucide-react';

export default function PairDeviceModal({ isOpen, onClose, onDevicePaired }) {
  const [mode, setMode] = useState('searching'); // 'searching', 'discovered', 'no_devices', 'pin'
  const [discoveredDevices, setDiscoveredDevices] = useState([]);
  const [isScanning, setIsScanning] = useState(false);
  const [pinCode, setPinCode] = useState('');
  const [generatedPin, setGeneratedPin] = useState(null);
  const [pairingError, setPairingError] = useState('');
  const [pairingSuccess, setPairingSuccess] = useState('');
  const [pairingInProgress, setPairingInProgress] = useState(false);

  // Auto-scan on open
  useEffect(() => {
    if (isOpen) {
      startDiscovery();
    } else {
      resetState();
    }
  }, [isOpen]);

  const resetState = () => {
    setMode('searching');
    setDiscoveredDevices([]);
    setIsScanning(false);
    setPinCode('');
    setGeneratedPin(null);
    setPairingError('');
    setPairingSuccess('');
    setPairingInProgress(false);
  };

  const startDiscovery = async () => {
    setMode('searching');
    setIsScanning(true);
    setPairingError('');
    setPairingSuccess('');

    try {
      const res = await apiClient.get('/api/lan/discover');
      setIsScanning(false);
      if (res && res.discovered && res.discovered.length > 0) {
        setDiscoveredDevices(res.discovered);
        setMode('discovered');
      } else {
        setDiscoveredDevices([]);
        setMode('no_devices');
      }
    } catch (err) {
      setIsScanning(false);
      setMode('no_devices');
    }
  };

  const handlePairDirect = async (device) => {
    setPairingInProgress(true);
    setPairingError('');
    setPairingSuccess('');

    try {
      const res = await apiClient.post('/api/lan/pair/direct', {
        remoteDeviceId: device.deviceId || device.id,
        remoteDeviceName: device.deviceName,
        remotePublicKey: device.publicKey || 'pub_' + (device.deviceId || device.id),
        remoteDeviceType: device.deviceType || 'desktop',
        remoteUserId: device.userId
      });

      setPairingInProgress(false);
      if (res && res.success) {
        setPairingSuccess(`Successfully paired with ${device.deviceName}!`);
        if (onDevicePaired) onDevicePaired(res.pairedDevice);
        setTimeout(() => {
          onClose();
        }, 1200);
      } else {
        setPairingError(res?.error || 'Failed to pair device.');
      }
    } catch (err) {
      setPairingInProgress(false);
      setPairingError(err.data?.error || err.message || 'Pairing failed. Ensure devices belong to the same account.');
    }
  };

  const handleGeneratePin = async () => {
    setPairingError('');
    try {
      const res = await apiClient.post('/api/lan/pair/generate-code', {});
      if (res && res.pairingCode) {
        setGeneratedPin(res.pairingCode);
      }
    } catch (err) {
      setPairingError('Failed to generate pairing PIN.');
    }
  };

  const handleVerifyPinSubmit = async (e) => {
    e.preventDefault();
    if (!pinCode || pinCode.trim().length < 6) return;

    setPairingInProgress(true);
    setPairingError('');
    setPairingSuccess('');

    try {
      const res = await apiClient.post('/api/lan/pair/verify-code', {
        code: pinCode.trim(),
        remoteDeviceId: 'dev_' + Math.random().toString(36).substring(2, 8),
        remoteDeviceName: 'Remote Device (' + pinCode.trim() + ')',
        remotePublicKey: 'pub_pin_' + Date.now(),
        remoteDeviceType: 'desktop'
      });

      setPairingInProgress(false);
      if (res && res.success) {
        setPairingSuccess('Pairing verified and trusted relationship established!');
        if (onDevicePaired) onDevicePaired(res.pairedDevice);
        setTimeout(() => {
          onClose();
        }, 1200);
      } else {
        setPairingError(res?.error || 'Invalid pairing PIN code.');
      }
    } catch (err) {
      setPairingInProgress(false);
      setPairingError(err.data?.error || err.message || 'Invalid or expired pairing code.');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div 
        className="modal-content" 
        onClick={(e) => e.stopPropagation()} 
        style={{ maxWidth: '480px', width: '100%', padding: '20px' }}
      >
        {/* Modal Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Wifi size={18} style={{ color: 'var(--accent-primary)' }} />
            <span style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--text-primary)' }}>
              Pair New Device (LAN Sync)
            </span>
          </div>
          <button 
            type="button" 
            onClick={onClose} 
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Status Banners */}
        {pairingError && (
          <div style={{ padding: '8px 12px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: 'var(--radius-sm)', color: 'var(--accent-danger)', fontSize: '0.78rem', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <AlertCircle size={14} />
            <span>{pairingError}</span>
          </div>
        )}

        {pairingSuccess && (
          <div style={{ padding: '8px 12px', background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.3)', borderRadius: 'var(--radius-sm)', color: 'var(--accent-emerald)', fontSize: '0.78rem', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <CheckCircle2 size={14} />
            <span>{pairingSuccess}</span>
          </div>
        )}

        {/* Tab Selector */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
          <button
            type="button"
            className={`btn-secondary ${mode !== 'pin' ? 'active' : ''}`}
            onClick={startDiscovery}
            style={{ flex: 1, padding: '6px', fontSize: '0.78rem', justifyContent: 'center', display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <Wifi size={14} />
            <span>Local Network Scan</span>
          </button>
          <button
            type="button"
            className={`btn-secondary ${mode === 'pin' ? 'active' : ''}`}
            onClick={() => { setMode('pin'); if (!generatedPin) handleGeneratePin(); }}
            style={{ flex: 1, padding: '6px', fontSize: '0.78rem', justifyContent: 'center', display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <Key size={14} />
            <span>Pair via 6-Digit PIN</span>
          </button>
        </div>

        {/* MODE 1: SEARCHING LOADING STATE */}
        {mode === 'searching' && (
          <div style={{ textAlign: 'center', padding: '32px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
            <RefreshCw size={28} className="spin-icon" style={{ color: 'var(--accent-primary)' }} />
            <div>
              <div style={{ fontWeight: 600, fontSize: '0.88rem', color: 'var(--text-primary)' }}>
                Searching for nearby SyncNote devices...
              </div>
              <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                Scanning local Wi-Fi network for active pairing candidates
              </div>
            </div>
            <button
              type="button"
              className="btn-secondary"
              onClick={onClose}
              style={{ marginTop: '8px', padding: '4px 16px', fontSize: '0.78rem' }}
            >
              Cancel
            </button>
          </div>
        )}

        {/* MODE 2: DISCOVERED DEVICES */}
        {mode === 'discovered' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)' }}>
              Discovered Devices on Local Network ({discoveredDevices.length})
            </div>

            {discoveredDevices.map((dev) => (
              <div
                key={dev.deviceId || dev.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 12px',
                  background: 'var(--bg-app)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-sm)'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ padding: '8px', borderRadius: '50%', background: 'var(--bg-input)', color: 'var(--accent-primary)' }}>
                    <Laptop size={18} />
                  </div>
                  <div>
                    <div style={{ fontSize: '0.84rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                      {dev.deviceName || 'SyncNote Device'}
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                      {dev.deviceType || 'Desktop'} • SyncNote {dev.syncnoteVersion || '1.x'} • Device ••••{(dev.deviceId || dev.id || '8F21').slice(-4)}
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => handlePairDirect(dev)}
                  disabled={pairingInProgress}
                  style={{ padding: '4px 12px', fontSize: '0.76rem', display: 'flex', alignItems: 'center', gap: '4px' }}
                >
                  <Lock size={12} />
                  <span>{pairingInProgress ? 'Pairing...' : 'Pair Device'}</span>
                </button>
              </div>
            ))}

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '8px' }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={startDiscovery}
                style={{ padding: '4px 12px', fontSize: '0.76rem', display: 'flex', alignItems: 'center', gap: '4px' }}
              >
                <RefreshCw size={12} />
                <span>Search Again</span>
              </button>
            </div>
          </div>
        )}

        {/* MODE 3: NO DEVICES FOUND */}
        {mode === 'no_devices' && (
          <div style={{ textAlign: 'center', padding: '20px 12px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
            <AlertCircle size={28} style={{ color: 'var(--accent-amber, #f59e0b)' }} />
            <div>
              <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                No devices found
              </div>
              <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', marginTop: '4px', maxWidth: '340px' }}>
                Make sure:
                <ul style={{ textAlign: 'left', marginTop: '6px', paddingLeft: '20px', lineHeight: '1.4' }}>
                  <li>Both devices are connected to the same LAN / Wi-Fi</li>
                  <li>SyncNote is running on the other device</li>
                  <li>LAN Discovery is enabled on both devices</li>
                </ul>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
              <button
                type="button"
                className="btn-primary"
                onClick={startDiscovery}
                style={{ padding: '6px 14px', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <RefreshCw size={13} />
                <span>Search Again</span>
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => { setMode('pin'); if (!generatedPin) handleGeneratePin(); }}
                style={{ padding: '6px 14px', fontSize: '0.78rem' }}
              >
                Pair via 6-Digit PIN
              </button>
            </div>
          </div>
        )}

        {/* MODE 4: PAIR VIA 6-DIGIT PIN */}
        {mode === 'pin' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {/* Generated PIN display */}
            <div style={{ background: 'var(--bg-app)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', padding: '12px', textAlign: 'center' }}>
              <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginBottom: '4px' }}>
                THIS DEVICE'S PAIRING PIN (Share with target device):
              </div>
              <div style={{ fontSize: '1.4rem', fontWeight: 700, letterSpacing: '4px', color: 'var(--accent-primary)', fontFamily: 'var(--font-mono)' }}>
                {generatedPin || '••••••'}
              </div>
              <button
                type="button"
                onClick={handleGeneratePin}
                style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: '0.7rem', cursor: 'pointer', marginTop: '4px', textDecoration: 'underline' }}
              >
                Generate New Code
              </button>
            </div>

            {/* Enter Remote PIN input */}
            <form onSubmit={handleVerifyPinSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                Enter Pairing PIN from target device:
              </label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  placeholder="e.g. 849 201"
                  value={pinCode}
                  onChange={(e) => setPinCode(e.target.value)}
                  style={{ flex: 1, padding: '8px 12px', fontSize: '0.9rem', letterSpacing: '2px', textAlign: 'center', fontFamily: 'var(--font-mono)', background: 'var(--bg-input)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', borderRadius: 'var(--radius-sm)' }}
                />
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={pairingInProgress || !pinCode}
                  style={{ padding: '8px 16px', fontSize: '0.8rem' }}
                >
                  {pairingInProgress ? 'Verifying...' : 'Verify & Pair'}
                </button>
              </div>
            </form>
          </div>
        )}

      </div>
    </div>
  );
}
