import React, { useState, useEffect, useRef } from 'react';
import { useSync } from '../context/SyncContext';
import { 
  Key, 
  RefreshCw, 
  X, 
  Laptop, 
  Smartphone, 
  Monitor,
  CheckCircle2, 
  AlertCircle, 
  Lock, 
  ArrowRight,
  ShieldCheck,
  Check,
  ChevronDown,
  ChevronUp
} from 'lucide-react';

export default function PairDeviceModal({ isOpen, onClose, onDevicePaired }) {
  const sync = useSync();
  const [pinCode, setPinCode] = useState('');
  const [generatedPin, setGeneratedPin] = useState(null);
  const [isGeneratingPin, setIsGeneratingPin] = useState(false);
  const [targetIp, setTargetIp] = useState('');
  const [showManualIp, setShowManualIp] = useState(false);

  const [pairingStatus, setPairingStatus] = useState(null); // null, 'connecting', 'waiting_approval', 'paired', 'error'
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const pollTimerRef = useRef(null);

  // Generate local PIN when modal opens
  useEffect(() => {
    if (isOpen) {
      resetState();
      handleGeneratePin();
    } else {
      cleanup();
    }
    return () => cleanup();
  }, [isOpen]);

  const cleanup = () => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  };

  const resetState = () => {
    cleanup();
    setPinCode('');
    setTargetIp('');
    setShowManualIp(false);
    setPairingStatus(null);
    setStatusMessage('');
    setErrorMessage('');
  };

  const handleGeneratePin = async () => {
    setIsGeneratingPin(true);
    setErrorMessage('');
    try {
      const res = await sync.generatePairingPin();
      if (res && res.pairingCode) {
        setGeneratedPin(res.pairingCode);
      }
    } catch (err) {
      setErrorMessage(err.data?.error || err.message || 'Failed to generate PIN code.');
    } finally {
      setIsGeneratingPin(false);
    }
  };

  const handleSubmitPin = async (e) => {
    e.preventDefault();
    const cleanPin = pinCode.replace(/\s+/g, '');
    if (!cleanPin || cleanPin.length < 6) {
      setErrorMessage('Please enter a 6-digit PIN code.');
      return;
    }

    setErrorMessage('');
    setPairingStatus('connecting');
    setStatusMessage('Searching for peer device with this PIN on LAN...');

    try {
      const res = await sync.submitPairingPin(cleanPin, targetIp ? targetIp.trim() : null);

      if (res && (res.status === 'APPROVED' || res.alreadyPaired)) {
        setPairingStatus('paired');
        setStatusMessage('Device successfully paired!');
        await sync.fetchPairedDevices();
        if (sync.checkDevicesPresence) sync.checkDevicesPresence();
        if (onDevicePaired) onDevicePaired(res.pairedDevice);
        setTimeout(() => {
          onClose();
        }, 1200);
        return;
      }

      if (res && res.requestId) {
        setPairingStatus('waiting_approval');
        const peerName = res.remoteDevice?.deviceName || 'other device';
        setStatusMessage(`PIN verified! Waiting for approval on '${peerName}'...`);

        // Start polling peer for approval
        const devId = res.remoteDevice?.deviceId || res.remoteDeviceId;
        const devName = res.remoteDevice?.deviceName || res.remoteDeviceName;
        const devKey = res.remoteDevice?.publicKey || res.remotePublicKey;

        pollTimerRef.current = setInterval(async () => {
          try {
            const statusRes = await sync.pollOutgoingPairingStatus(
              res.remoteIp,
              res.remotePort || 5000,
              res.requestId,
              devId,
              devName,
              devKey
            );

            if (statusRes && statusRes.status === 'APPROVED') {
              cleanup();
              setPairingStatus('paired');
              setStatusMessage('Pairing approved! Device is now connected.');
              await sync.fetchPairedDevices();
              if (sync.checkDevicesPresence) sync.checkDevicesPresence();
              if (onDevicePaired) onDevicePaired(statusRes.pairedDevice);
              setTimeout(() => {
                onClose();
              }, 1200);
            } else if (statusRes && statusRes.status === 'REJECTED') {
              cleanup();
              setPairingStatus('error');
              setErrorMessage('Pairing request was declined by the remote device.');
            }
          } catch (pollErr) {
            // Keep polling until user cancels or timeout
          }
        }, 1500);

        // Timeout polling after 60 seconds
        setTimeout(() => {
          if (pollTimerRef.current) {
            cleanup();
            setPairingStatus('error');
            setErrorMessage('Pairing request timed out waiting for approval.');
          }
        }, 60000);
      }
    } catch (err) {
      setPairingStatus('error');
      setErrorMessage(err.data?.error || err.message || 'Failed to connect. Ensure both devices are on the same Wi-Fi network.');
    }
  };

  const handleApproveIncoming = async (requestId) => {
    try {
      await sync.approveLanPairing(requestId);
      await sync.fetchPairedDevices();
      if (sync.checkDevicesPresence) sync.checkDevicesPresence();
      setPairingStatus('paired');
      setStatusMessage('Pairing approved! Both devices are now trusted.');
      setTimeout(() => {
        onClose();
      }, 1200);
    } catch (err) {
      setErrorMessage(err.data?.error || err.message || 'Failed to approve pairing.');
    }
  };

  const handleRejectIncoming = async (requestId) => {
    try {
      await sync.rejectLanPairing(requestId);
    } catch (err) {
      setErrorMessage(err.data?.error || err.message || 'Failed to reject pairing.');
    }
  };

  if (!isOpen) return null;

  const pendingRequests = sync.pendingPairingRequests || [];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div 
        className="modal-content" 
        onClick={(e) => e.stopPropagation()} 
        style={{ maxWidth: '460px', width: '100%', padding: '24px' }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              width: '32px',
              height: '32px',
              borderRadius: 'var(--radius-sm)',
              background: 'rgba(99, 102, 241, 0.12)',
              color: 'var(--accent-primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <Key size={18} />
            </div>
            <div>
              <div style={{ fontWeight: 600, fontSize: '0.98rem', color: 'var(--text-primary)' }}>
                Pair New Device
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                Pair via 6-Digit PIN over local Wi-Fi
              </div>
            </div>
          </div>
          <button 
            type="button" 
            onClick={onClose} 
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '4px' }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Error message */}
        {errorMessage && (
          <div style={{
            padding: '10px 12px',
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--accent-danger)',
            fontSize: '0.8rem',
            marginBottom: '16px',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '8px'
          }}>
            <AlertCircle size={15} style={{ flexShrink: 0, marginTop: '2px' }} />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Status progress message */}
        {(pairingStatus === 'connecting' || pairingStatus === 'waiting_approval' || pairingStatus === 'paired') && (
          <div style={{
            padding: '12px 14px',
            background: pairingStatus === 'paired' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(99, 102, 241, 0.1)',
            border: `1px solid ${pairingStatus === 'paired' ? 'var(--accent-emerald)' : 'var(--accent-primary)'}`,
            borderRadius: 'var(--radius-sm)',
            color: pairingStatus === 'paired' ? 'var(--accent-emerald)' : 'var(--accent-primary)',
            fontSize: '0.82rem',
            marginBottom: '16px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px'
          }}>
            {pairingStatus === 'paired' ? (
              <CheckCircle2 size={18} style={{ color: 'var(--accent-emerald)' }} />
            ) : (
              <RefreshCw size={18} className="spin" style={{ color: 'var(--accent-primary)' }} />
            )}
            <div style={{ fontWeight: 600 }}>{statusMessage}</div>
          </div>
        )}

        {/* INBOUND PAIRING REQUEST (IF ANY ARRIVES ON THIS DEVICE) */}
        {pendingRequests.length > 0 && (
          <div style={{
            background: 'rgba(245, 158, 11, 0.08)',
            border: '1px solid var(--accent-amber, #f59e0b)',
            borderRadius: 'var(--radius-sm)',
            padding: '14px',
            marginBottom: '18px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.84rem', fontWeight: 600, color: 'var(--accent-amber, #f59e0b)', marginBottom: '8px' }}>
              <ShieldCheck size={16} />
              <span>Incoming Pairing Request (PIN Matched)</span>
            </div>
            {pendingRequests.map(req => (
              <div key={req.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '6px' }}>
                <div>
                  <div style={{ fontSize: '0.86rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                    {req.requester_device_name}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                    Device ID: ••••{req.requester_device_id?.slice(-6)} • IP: {req.requester_device_ip || 'Local'}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => handleApproveIncoming(req.id)}
                    style={{ padding: '5px 12px', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '4px' }}
                  >
                    <Check size={13} />
                    <span>Approve</span>
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => handleRejectIncoming(req.id)}
                    style={{ padding: '5px 10px', fontSize: '0.78rem', color: 'var(--accent-danger)' }}
                  >
                    <X size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
          {/* SECTION 1: THIS DEVICE'S PIN */}
          <div style={{
            background: 'var(--bg-app)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-md)',
            padding: '16px',
            textAlign: 'center'
          }}>
            <div style={{ fontSize: '0.74rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>
              This Device's 6-Digit PIN
            </div>
            <div style={{
              fontSize: '1.8rem',
              fontWeight: 700,
              letterSpacing: '6px',
              color: 'var(--accent-primary)',
              fontFamily: 'var(--font-mono, monospace)',
              margin: '8px 0'
            }}>
              {isGeneratingPin ? '••••••' : (generatedPin || '••••••')}
            </div>
            <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>
              Share this PIN with the other SyncNote device
            </div>
            <button
              type="button"
              onClick={handleGeneratePin}
              disabled={isGeneratingPin}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--accent-primary)',
                fontSize: '0.74rem',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                textDecoration: 'underline'
              }}
            >
              <RefreshCw size={11} className={isGeneratingPin ? 'spin' : ''} />
              <span>Generate New PIN</span>
            </button>
          </div>

          {/* DIVIDER */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ flex: 1, height: '1px', background: 'var(--border-subtle)' }} />
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>
              Or Enter PIN From Other Device
            </span>
            <div style={{ flex: 1, height: '1px', background: 'var(--border-subtle)' }} />
          </div>

          {/* SECTION 2: ENTER OTHER DEVICE'S PIN */}
          <form onSubmit={handleSubmitPin} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '6px' }}>
                Enter 6-Digit PIN shown on the other device:
              </label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  maxLength={7}
                  placeholder="e.g. 849 201"
                  value={pinCode}
                  onChange={(e) => setPinCode(e.target.value)}
                  disabled={pairingStatus === 'connecting' || pairingStatus === 'waiting_approval'}
                  style={{
                    flex: 1,
                    padding: '10px 14px',
                    fontSize: '1.1rem',
                    letterSpacing: '3px',
                    textAlign: 'center',
                    fontFamily: 'var(--font-mono, monospace)',
                    background: 'var(--bg-input)',
                    border: '1px solid var(--border-subtle)',
                    color: 'var(--text-primary)',
                    borderRadius: 'var(--radius-sm)'
                  }}
                />
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={pairingStatus === 'connecting' || pairingStatus === 'waiting_approval' || !pinCode || pinCode.replace(/\s+/g, '').length < 6}
                  style={{ padding: '10px 20px', fontSize: '0.84rem', display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <Lock size={13} />
                  <span>Pair</span>
                </button>
              </div>
            </div>

            {/* Optional Target IP Toggle */}
            <div style={{ marginTop: '4px' }}>
              <button
                type="button"
                onClick={() => setShowManualIp(!showManualIp)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  fontSize: '0.72rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: 0
                }}
              >
                <span>Target IP address (optional)</span>
                {showManualIp ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              </button>

              {showManualIp && (
                <div style={{ marginTop: '8px' }}>
                  <input
                    type="text"
                    placeholder="e.g. 10.20.89.181"
                    value={targetIp}
                    onChange={(e) => setTargetIp(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '6px 10px',
                      fontSize: '0.78rem',
                      fontFamily: 'var(--font-mono, monospace)',
                      background: 'var(--bg-input)',
                      border: '1px solid var(--border-subtle)',
                      color: 'var(--text-primary)',
                      borderRadius: 'var(--radius-sm)'
                    }}
                  />
                  <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '3px', display: 'block' }}>
                    Only needed if automatic local network discovery is blocked on your router.
                  </span>
                </div>
              )}
            </div>
          </form>
        </div>

        {/* Footer note */}
        <div style={{ marginTop: '20px', borderTop: '1px solid var(--border-subtle)', paddingTop: '12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '5px' }}>
            <Lock size={11} />
            <span>End-to-end encrypted with ECDH & AES-256-GCM</span>
          </div>
          <button
            type="button"
            className="btn-secondary"
            onClick={onClose}
            style={{ padding: '4px 12px', fontSize: '0.74rem' }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
