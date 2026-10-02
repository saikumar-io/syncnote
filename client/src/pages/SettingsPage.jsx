import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSync } from '../context/SyncContext';
import { useNavigate } from '../utils/router';
import ThemeToggle from '../components/ThemeToggle';
import { authApi } from '../api/authApi';
import { apiClient } from '../api/apiClient';
import { formatRelativeTime } from '../utils/timeUtils';
import { 
  User, 
  ShieldCheck, 
  Palette, 
  FileCode, 
  RefreshCw,
  LogOut,
  CheckCircle2,
  AlertCircle,
  Wifi,
  HardDrive,
  Copy,
  Check,
  Sparkles,
  Command,
  HelpCircle,
  ArrowRight,
  ExternalLink,
  Laptop,
  Folder,
  Sliders,
  Type
} from 'lucide-react';

export function GoogleDriveIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 87.3 78" xmlns="http://www.w3.org/2000/svg" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
      <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/>
      <path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0 -1.2 4.5h27.5z" fill="#00ac47"/>
      <path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.2-2.1 7.45-12.9c.8-1.4 1.2-2.95 1.2-4.5h-27.5l6.85 11.85z" fill="#ea4335"/>
      <path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.55-1.2h-18.4c-1.65 0-3.2.45-4.55 1.2z" fill="#00832d"/>
      <path d="m59.8 53h27.5c0-1.55-.4-3.1-1.2-4.5l-12.85-22.25c-.8-1.4-1.95-2.5-3.3-3.35l-13.75 23.8z" fill="#ffba00"/>
      <path d="m27.5 53h32.3l13.75-23.85h-32.3z" fill="#2684fc"/>
    </svg>
  );
}

export default function SettingsPage({ theme, setTheme }) {
  const { user, device, logout, refreshUser } = useAuth();
  const sync = useSync();
  const navigate = useNavigate();

  // Active Category Section: 'general' | 'editor' | 'appearance' | 'sync' | 'ai' | 'storage' | 'shortcuts' | 'about'
  const [activeTab, setActiveTab] = useState(() => {
    if (typeof window !== 'undefined') {
      const search = window.location.search;
      const hash = window.location.hash;
      if (search.includes('tab=about') || hash.includes('about')) return 'about';
      if (search.includes('tab=sync') || hash.includes('sync')) return 'sync';
    }
    return 'general';
  });

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const search = window.location.search;
      const hash = window.location.hash;
      if (search.includes('tab=sync') || hash.includes('sync')) {
        setActiveTab('sync');
      } else if (search.includes('tab=about') || hash.includes('about')) {
        setActiveTab('about');
      }
    }
  }, []);

  // Password change state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwdSubmitting, setPwdSubmitting] = useState(false);
  const [pwdMsg, setPwdMsg] = useState({ type: '', text: '' });

  // Profile update state
  const [usernameInput, setUsernameInput] = useState(user?.username || '');
  const [deviceNameInput, setDeviceNameInput] = useState(device?.device_name || '');
  const [profileSubmitting, setProfileSubmitting] = useState(false);
  const [profileMsg, setProfileMsg] = useState({ type: '', text: '' });

  // Storage and AI metrics
  const [storagePath, setStoragePath] = useState(null);
  const [copiedStorage, setCopiedStorage] = useState(false);
  const [ollamaStatus, setOllamaStatus] = useState(null);
  const [conflictMetrics, setConflictMetrics] = useState(null);
  const [syncingNow, setSyncingNow] = useState(false);

  // Editor preferences
  const [editorFontSize, setEditorFontSize] = useState(() => localStorage.getItem('syncnote_font_size') || 'medium');
  const [accentColor, setAccentColor] = useState(() => localStorage.getItem('syncnote_accent_color') || '#0070f3');

  const handleFontSizeChange = (size) => {
    setEditorFontSize(size);
    localStorage.setItem('syncnote_font_size', size);
    document.documentElement.setAttribute('data-font-size', size);
  };

  const handleAccentChange = (color) => {
    setAccentColor(color);
    localStorage.setItem('syncnote_accent_color', color);
    document.documentElement.style.setProperty('--accent-primary', color);
  };

  // Authoritative sync state
  const googleAccountStatus = sync?.googleAccountStatus || { connected: false, email: null };
  const googleDriveStatus = sync?.googleDriveStatus || { connected: false, email: null, folderName: 'SyncNote' };

  useEffect(() => {
    if (sync?.refreshSyncStatus) {
      sync.refreshSyncStatus();
    }
    if (user?.username) setUsernameInput(user.username);
    if (device?.device_name) setDeviceNameInput(device.device_name);

    // Fetch dynamic storage location and AI status
    apiClient.get('/api/health')
      .then((data) => {
        if (data && data.notes_dir) setStoragePath(data.notes_dir);
      })
      .catch(() => {});

    apiClient.get('/api/conflicts/status')
      .then((data) => {
        if (data && data.ollama) setOllamaStatus(data.ollama);
      })
      .catch(() => {});

    apiClient.get('/api/conflicts/metrics')
      .then((data) => {
        if (data && data.metrics) setConflictMetrics(data.metrics.summary);
      })
      .catch(() => {});
  }, [user, device, sync?.refreshSyncStatus]);

  const hasPassword = Boolean(user?.hasPassword ?? user?.has_password);

  const handlePasswordChange = async (e) => {
    e.preventDefault();
    if (hasPassword && !currentPassword) {
      setPwdMsg({ type: 'error', text: 'Please enter your current password.' });
      return;
    }
    if (!newPassword || newPassword.length < 6) {
      setPwdMsg({ type: 'error', text: 'New password must be at least 6 characters long.' });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwdMsg({ type: 'error', text: 'New passwords do not match.' });
      return;
    }

    setPwdSubmitting(true);
    setPwdMsg({ type: '', text: '' });

    try {
      if (hasPassword) {
        await authApi.changePassword({ currentPassword, newPassword, confirmPassword });
        setPwdMsg({ type: 'success', text: 'Password updated successfully!' });
      } else {
        await authApi.setPassword({ newPassword, confirmPassword });
        setPwdMsg({ type: 'success', text: 'Password configured successfully!' });
      }
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      await refreshUser();
    } catch (err) {
      setPwdMsg({ type: 'error', text: err.message || 'Failed to update password.' });
    } finally {
      setPwdSubmitting(false);
    }
  };

  const handleProfileUpdate = async (e) => {
    e.preventDefault();
    setProfileSubmitting(true);
    setProfileMsg({ type: '', text: '' });

    try {
      await authApi.updateProfile({ username: usernameInput, deviceName: deviceNameInput });
      await refreshUser();
      setProfileMsg({ type: 'success', text: 'Profile saved successfully!' });
    } catch (err) {
      setProfileMsg({ type: 'error', text: err.message || 'Failed to update profile.' });
    } finally {
      setProfileSubmitting(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const copyPath = () => {
    if (storagePath) {
      navigator.clipboard.writeText(storagePath);
      setCopiedStorage(true);
      setTimeout(() => setCopiedStorage(false), 2000);
    }
  };

  const accentOptions = [
    { name: 'Electric Blue', color: '#0070f3' },
    { name: 'Indigo Purple', color: '#6366f1' },
    { name: 'Emerald Cyan', color: '#10b981' },
    { name: 'Amber Gold', color: '#f59e0b' },
    { name: 'Rose Coral', color: '#f43f5e' }
  ];

  return (
    <div className="settings-page-wrapper">
      {/* Settings Navigation Sidebar */}
      <aside className="settings-nav-pane">
        <div className="settings-pane-header">
          <Sliders size={16} className="settings-header-icon" />
          <h2 className="settings-header-title">Settings</h2>
        </div>

        <nav className="settings-menu-list">
          <button
            type="button"
            className={`settings-menu-item ${activeTab === 'general' ? 'active' : ''}`}
            onClick={() => setActiveTab('general')}
          >
            <User size={15} />
            <span>GENERAL</span>
          </button>

          <button
            type="button"
            className={`settings-menu-item ${activeTab === 'editor' ? 'active' : ''}`}
            onClick={() => setActiveTab('editor')}
          >
            <FileCode size={15} />
            <span>EDITOR</span>
          </button>

          <button
            type="button"
            className={`settings-menu-item ${activeTab === 'appearance' ? 'active' : ''}`}
            onClick={() => setActiveTab('appearance')}
          >
            <Palette size={15} />
            <span>APPEARANCE</span>
          </button>

          <button
            type="button"
            className={`settings-menu-item ${activeTab === 'sync' ? 'active' : ''}`}
            onClick={() => setActiveTab('sync')}
          >
            <RefreshCw size={15} />
            <span>SYNC</span>
          </button>

          <button
            type="button"
            className={`settings-menu-item ${activeTab === 'ai' ? 'active' : ''}`}
            onClick={() => setActiveTab('ai')}
          >
            <Sparkles size={15} />
            <span>AI / OLLAMA</span>
          </button>

          <button
            type="button"
            className={`settings-menu-item ${activeTab === 'storage' ? 'active' : ''}`}
            onClick={() => setActiveTab('storage')}
          >
            <HardDrive size={15} />
            <span>STORAGE</span>
          </button>

          <button
            type="button"
            className={`settings-menu-item ${activeTab === 'shortcuts' ? 'active' : ''}`}
            onClick={() => setActiveTab('shortcuts')}
          >
            <Command size={15} />
            <span>KEYBOARD SHORTCUTS</span>
          </button>

          <button
            type="button"
            className={`settings-menu-item ${activeTab === 'about' ? 'active' : ''}`}
            onClick={() => setActiveTab('about')}
            title="About SyncNote"
          >
            <HelpCircle size={15} />
            <span>ABOUT SYNCNOTE</span>
          </button>
        </nav>
      </aside>

      {/* Settings Main Content Area */}
      <main className="settings-content-viewport">
        
        {/* 1. GENERAL / ACCOUNT SECTION */}
        {activeTab === 'general' && (
          <div className="settings-section-container">
            <div className="section-title-wrap">
              <h3 className="section-heading">General Settings</h3>
              <p className="section-subtext">Manage your workspace identity, machine profile, and credentials</p>
            </div>

            {profileMsg.text && (
              <div className={`settings-banner ${profileMsg.type}`}>
                {profileMsg.type === 'success' ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
                <span>{profileMsg.text}</span>
              </div>
            )}

            <form onSubmit={handleProfileUpdate} className="settings-card-group">
              <div className="settings-form-row">
                <div className="field-meta">
                  <label className="field-title">Username</label>
                  <span className="field-hint">Your unique workspace identifier</span>
                </div>
                <input
                  type="text"
                  className="settings-text-input"
                  value={usernameInput}
                  onChange={(e) => setUsernameInput(e.target.value)}
                  required
                />
              </div>

              <div className="settings-form-row">
                <div className="field-meta">
                  <label className="field-title">Email Address</label>
                  <span className="field-hint">Account recovery and Google Drive link</span>
                </div>
                <span className="readonly-badge">{user?.email || 'No email attached'}</span>
              </div>

              <div className="settings-form-row">
                <div className="field-meta">
                  <label className="field-title">Device Name</label>
                  <span className="field-hint">Human-readable label for P2P LAN sync discovery</span>
                </div>
                <input
                  type="text"
                  className="settings-text-input"
                  value={deviceNameInput}
                  onChange={(e) => setDeviceNameInput(e.target.value)}
                />
              </div>

              <div className="settings-card-actions">
                <button type="submit" className="primary-action-btn" disabled={profileSubmitting}>
                  {profileSubmitting ? 'Saving Changes...' : 'Save Profile Changes'}
                </button>
              </div>
            </form>

            {/* Security Subcard */}
            <div className="settings-card-group" style={{ marginTop: '24px' }}>
              <div className="subcard-header">
                <ShieldCheck size={16} />
                <h4 className="subcard-title">{hasPassword ? 'Change Password' : 'Set Password'}</h4>
              </div>

              {!hasPassword && (
                <div className="settings-info-alert">
                  <strong>Google Account Linked:</strong> You signed in via Google OAuth. Set a password to also allow email/password login.
                </div>
              )}

              {pwdMsg.text && (
                <div className={`settings-banner ${pwdMsg.type}`}>
                  {pwdMsg.type === 'success' ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
                  <span>{pwdMsg.text}</span>
                </div>
              )}

              <form onSubmit={handlePasswordChange}>
                {hasPassword && (
                  <div className="settings-form-row">
                    <div className="field-meta">
                      <label className="field-title">Current Password</label>
                    </div>
                    <input
                      type="password"
                      className="settings-text-input"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      required
                    />
                  </div>
                )}

                <div className="settings-form-row">
                  <div className="field-meta">
                    <label className="field-title">New Password</label>
                    <span className="field-hint">Minimum 6 characters</span>
                  </div>
                  <input
                    type="password"
                    className="settings-text-input"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                  />
                </div>

                <div className="settings-form-row">
                  <div className="field-meta">
                    <label className="field-title">Confirm Password</label>
                  </div>
                  <input
                    type="password"
                    className="settings-text-input"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                  />
                </div>

                <div className="settings-card-actions">
                  <button type="submit" className="secondary-action-btn" disabled={pwdSubmitting}>
                    {pwdSubmitting ? 'Updating...' : (hasPassword ? 'Change Password' : 'Set Password')}
                  </button>
                </div>
              </form>
            </div>

            {/* Sign Out Card */}
            <div className="settings-danger-card" style={{ marginTop: '24px' }}>
              <div className="danger-left">
                <span className="danger-title">Sign Out of Session</span>
                <span className="danger-hint">Safely end active session on this device. Local files remain intact.</span>
              </div>
              <button type="button" className="danger-action-btn" onClick={handleLogout}>
                <LogOut size={14} />
                <span>Log Out</span>
              </button>
            </div>
          </div>
        )}

        {/* 2. EDITOR SECTION */}
        {activeTab === 'editor' && (
          <div className="settings-section-container">
            <div className="section-title-wrap">
              <h3 className="section-heading">Editor Preferences</h3>
              <p className="section-subtext">Configure Markdown writing canvas, line spacing, and auto-persistence</p>
            </div>

            <div className="settings-card-group">
              <div className="settings-form-row">
                <div className="field-meta">
                  <label className="field-title">Editor Font Size</label>
                  <span className="field-hint">Adjust comfortable typography scale</span>
                </div>
                <div className="segmented-font-selector">
                  {['small', 'medium', 'large'].map((size) => (
                    <button
                      key={size}
                      type="button"
                      className={`font-select-btn ${editorFontSize === size ? 'active' : ''}`}
                      onClick={() => handleFontSizeChange(size)}
                    >
                      {size.charAt(0).toUpperCase() + size.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="settings-form-row">
                <div className="field-meta">
                  <label className="field-title">Autosave Engine</label>
                  <span className="field-hint">Debounced 750ms background file flush with integrity hash</span>
                </div>
                <span className="status-badge-emerald">Active (Local File I/O)</span>
              </div>

              <div className="settings-form-row">
                <div className="field-meta">
                  <label className="field-title">Bi-Directional WikiLinks</label>
                  <span className="field-hint">Type [[Note Title]] to auto-link and update knowledge graph</span>
                </div>
                <span className="status-badge-blue">Enabled</span>
              </div>
            </div>
          </div>
        )}

        {/* 3. APPEARANCE SECTION */}
        {activeTab === 'appearance' && (
          <div className="settings-section-container">
            <div className="section-title-wrap">
              <h3 className="section-heading">Appearance & Themes</h3>
              <p className="section-subtext">Customize interface brightness and brand accent colors</p>
            </div>

            <div className="settings-card-group">
              <div className="settings-form-row">
                <div className="field-meta">
                  <label className="field-title">Theme Mode</label>
                  <span className="field-hint">Switch between Dark, Light, or follow System OS preference</span>
                </div>
                <ThemeToggle theme={theme} setTheme={setTheme} />
              </div>

              <div className="settings-form-row">
                <div className="field-meta">
                  <label className="field-title">Brand Accent Color</label>
                  <span className="field-hint">Primary interactive highlight color</span>
                </div>
                <div className="accent-color-swatches">
                  {accentOptions.map((opt) => (
                    <button
                      key={opt.color}
                      type="button"
                      className={`accent-swatch-circle ${accentColor === opt.color ? 'active' : ''}`}
                      style={{ background: opt.color }}
                      onClick={() => handleAccentChange(opt.color)}
                      title={opt.name}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 4. SYNC SECTION */}
        {activeTab === 'sync' && (
          <div className="settings-section-container">
            <div className="section-title-wrap">
              <h3 className="section-heading">Synchronization Center</h3>
              <p className="section-subtext">Multi-device sync: Google Drive Cloud Sync and Encrypted P2P LAN Sync</p>
            </div>

            <div className="settings-card-group">
              <div className="subcard-header">
                <GoogleDriveIcon size={20} />
                <h4 className="subcard-title">Google Drive Cloud Storage</h4>
              </div>

              <div className="settings-form-row">
                <div className="field-meta">
                  <label className="field-title">Google Account</label>
                  <span className="field-hint">Identity provider for central account credentials</span>
                </div>
                {googleAccountStatus.connected ? (
                  <span className="status-badge-emerald">Connected ({googleAccountStatus.email})</span>
                ) : (
                  <button
                    type="button"
                    className="secondary-action-btn"
                    onClick={() => { window.location.href = '/api/auth/google'; }}
                  >
                    Connect Google Account
                  </button>
                )}
              </div>

              <div className="settings-form-row">
                <div className="field-meta">
                  <label className="field-title">Google Drive Vault Sync</label>
                  <span className="field-hint">Cloud folder: "SyncNote" · Notes synced automatically</span>
                </div>
                {(googleDriveStatus?.authRequired || googleDriveStatus?.syncState === 'AUTHENTICATION REQUIRED') ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'flex-end' }}>
                    <span className="status-badge-amber" style={{ color: '#d97706', background: 'rgba(217, 119, 6, 0.1)', border: '1px solid rgba(217, 119, 6, 0.3)', padding: '2px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 600 }}>
                      Authentication required
                    </span>
                    <span style={{ fontSize: '12px', color: 'var(--text-muted, #888)' }}>
                      Reconnect Google Drive to continue cloud synchronization.
                    </span>
                    <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                      <button
                        type="button"
                        className="primary-action-btn"
                        onClick={() => { window.location.href = '/api/auth/google/drive'; }}
                      >
                        Reconnect Google Drive
                      </button>
                      <button
                        type="button"
                        className="danger-ghost-btn"
                        onClick={() => sync?.disconnectDrive && sync.disconnectDrive()}
                      >
                        Disconnect
                      </button>
                    </div>
                  </div>
                ) : googleDriveStatus.connected ? (
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <button
                      type="button"
                      className="primary-action-btn"
                      disabled={sync?.isSyncing || syncingNow}
                      onClick={async () => {
                        setSyncingNow(true);
                        try {
                          if (sync?.triggerSync) await sync.triggerSync();
                          else await apiClient.post('/api/sync/gdrive/sync-now');
                        } catch (e) {}
                        setSyncingNow(false);
                      }}
                    >
                      <RefreshCw size={12} className={(sync?.isSyncing || syncingNow) ? 'spin' : ''} />
                      <span>{(sync?.isSyncing || syncingNow) ? 'Syncing...' : 'Sync Now'}</span>
                    </button>
                    <button
                      type="button"
                      className="danger-ghost-btn"
                      onClick={() => sync?.disconnectDrive && sync.disconnectDrive()}
                    >
                      Disconnect
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="primary-action-btn"
                    onClick={() => { window.location.href = '/api/auth/google/drive'; }}
                  >
                    Connect Google Drive
                  </button>
                )}
              </div>

              <div className="sync-stats-summary-row">
                <span>Pending Cloud Uploads: <strong>{sync?.pendingGoogleCount || 0}</strong></span>
                <span>Last Cloud Sync: <strong>{sync?.lastSyncedAt ? formatRelativeTime(sync.lastSyncedAt) : 'Never'}</strong></span>
              </div>
            </div>

            {/* LAN Sync Card */}
            <div className="settings-card-group" style={{ marginTop: '20px' }}>
              <div className="subcard-header">
                <Wifi size={18} />
                <h4 className="subcard-title">Local Network (LAN) Peer Sync</h4>
              </div>

              <p className="settings-card-desc">
                Sync notes peer-to-peer over local Wi-Fi with cryptographic device signatures without sending unencrypted data to the public internet.
              </p>

              <div className="settings-card-actions" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="lan-paired-counter">
                  {sync?.pairedDevices?.length || 0} paired device{(sync?.pairedDevices?.length || 0) === 1 ? '' : 's'} on local network
                </span>
                <button
                  type="button"
                  className="primary-action-btn"
                  onClick={() => navigate('/settings/sync/lan')}
                >
                  <span>Open LAN Sync Manager</span>
                  <ArrowRight size={13} />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 5. AI / OLLAMA SECTION */}
        {activeTab === 'ai' && (
          <div className="settings-section-container">
            <div className="section-title-wrap">
              <h3 className="section-heading">Local AI & Ollama Integration</h3>
              <p className="section-subtext">Zero-cloud private local LLM inference for semantic conflict resolution</p>
            </div>

            <div className="settings-card-group">
              <div className="settings-form-row">
                <div className="field-meta">
                  <label className="field-title">Ollama Daemon Status</label>
                  <span className="field-hint">
                    {ollamaStatus?.available 
                      ? `Local HTTP daemon at ${ollamaStatus?.host || 'http://127.0.0.1:11434'}`
                      : 'Start Ollama to use local AI features.'}
                  </span>
                </div>
                {ollamaStatus?.available ? (
                  <span className="status-badge-emerald">● Online ({ollamaStatus.configuredModel || 'llama3.2:1b'})</span>
                ) : (
                  <span className="status-badge-amber">○ Ollama Offline</span>
                )}
              </div>

              <div className="settings-form-row">
                <div className="field-meta">
                  <label className="field-title">Configured Model</label>
                  <span className="field-hint">Quantized local model used for structured JSON merge reconciliation</span>
                </div>
                <span className="monospace-tag">{ollamaStatus?.configuredModel || 'llama3.2:1b'}</span>
              </div>

              <div className="settings-form-row">
                <div className="field-meta">
                  <label className="field-title">Privacy Guarantee</label>
                  <span className="field-hint">Notes are never transmitted to external cloud AI APIs</span>
                </div>
                <span className="status-badge-emerald">100% Offline-First</span>
              </div>
            </div>

            {/* Conflict Metrics Card */}
            <div className="settings-card-group" style={{ marginTop: '20px' }}>
              <div className="subcard-header">
                <Sparkles size={16} />
                <h4 className="subcard-title">Semantic Resolution Performance Metrics</h4>
              </div>

              {conflictMetrics && conflictMetrics.totalConflicts > 0 ? (
                <div className="metrics-triad-grid">
                  <div className="metric-box">
                    <span className="m-val">{conflictMetrics.totalConflicts}</span>
                    <span className="m-lbl">Total Conflicts Detected</span>
                  </div>
                  <div className="metric-box">
                    <span className="m-val text-success">{conflictMetrics.aiAcceptanceRate}%</span>
                    <span className="m-lbl">AI Acceptance Rate</span>
                  </div>
                  <div className="metric-box">
                    <span className="m-val text-primary">{conflictMetrics.avgAiLatencyMs}ms</span>
                    <span className="m-lbl">Average AI Inference Latency</span>
                  </div>
                </div>
              ) : (
                <p className="empty-subtext">
                  No concurrent conflicts resolved yet. Metrics will appear here as multi-device edits are reconciled.
                </p>
              )}
            </div>
          </div>
        )}

        {/* 6. STORAGE SECTION */}
        {activeTab === 'storage' && (
          <div className="settings-section-container">
            <div className="section-title-wrap">
              <h3 className="section-heading">Local Storage & Database</h3>
              <p className="section-subtext">Direct physical file system storage and SQLite metadata indexing</p>
            </div>

            <div className="settings-card-group">
              <div className="settings-form-row">
                <div className="field-meta">
                  <label className="field-title">Notes Physical Directory</label>
                  <span className="field-hint">Physical .md files on your machine</span>
                </div>
                <div className="copyable-path-card" onClick={copyPath} title="Click to copy full path">
                  <span className="path-text">{storagePath || 'data/notes'}</span>
                  <button type="button" className="copy-icon-btn">
                    {copiedStorage ? <Check size={13} className="text-success" /> : <Copy size={13} />}
                  </button>
                </div>
              </div>

              <div className="settings-form-row">
                <div className="field-meta">
                  <label className="field-title">Database Storage</label>
                  <span className="field-hint">SQLite WAL mode database storing diff hunks & version history</span>
                </div>
                <span className="monospace-tag">better-sqlite3 / syncnote.db</span>
              </div>

              <div className="settings-form-row">
                <div className="field-meta">
                  <label className="field-title">Automatic Backup</label>
                  <span className="field-hint">Safety database snapshot created before startup</span>
                </div>
                <span className="status-badge-emerald">syncnote.db.bak Verified</span>
              </div>
            </div>
          </div>
        )}

        {/* 7. KEYBOARD SHORTCUTS SECTION */}
        {activeTab === 'shortcuts' && (
          <div className="settings-section-container">
            <div className="section-title-wrap">
              <h3 className="section-heading">Keyboard Shortcuts</h3>
              <p className="section-subtext">Quick navigation and productivity commands for SyncNote</p>
            </div>

            <div className="settings-card-group">
              <div className="shortcut-table-grid">
                <div className="shortcut-row-item">
                  <span className="action-desc">Open Command Palette / Search</span>
                  <div className="kbd-cluster"><kbd>Ctrl</kbd> + <kbd>K</kbd></div>
                </div>
                <div className="shortcut-row-item">
                  <span className="action-desc">Create New Note</span>
                  <div className="kbd-cluster"><kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>N</kbd></div>
                </div>
                <div className="shortcut-row-item">
                  <span className="action-desc">Open Knowledge Graph</span>
                  <div className="kbd-cluster"><kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>G</kbd></div>
                </div>
                <div className="shortcut-row-item">
                  <span className="action-desc">Close Modal / Dismiss Dialog</span>
                  <div className="kbd-cluster"><kbd>Esc</kbd></div>
                </div>
                <div className="shortcut-row-item">
                  <span className="action-desc">Insert WikiLink Connection</span>
                  <div className="kbd-cluster"><kbd>[[</kbd></div>
                </div>
                <div className="shortcut-row-item">
                  <span className="action-desc">Format Bold Text</span>
                  <div className="kbd-cluster"><kbd>**</kbd></div>
                </div>
                <div className="shortcut-row-item">
                  <span className="action-desc">Format Italic Text</span>
                  <div className="kbd-cluster"><kbd>*</kbd></div>
                </div>
                <div className="shortcut-row-item">
                  <span className="action-desc">Code Block</span>
                  <div className="kbd-cluster"><kbd>```</kbd></div>
                </div>
              </div>
            </div>
          </div>
        )}
 
        {/* 8. ABOUT SYNCNOTE SECTION */}
        {activeTab === 'about' && (
          <div className="settings-section-container">
            <div className="section-title-wrap">
              <h3 className="section-heading">About SyncNote</h3>
              <p className="section-subtext">Application details, storage architecture, and connectivity matrix</p>
            </div>

            <div className="settings-card-group about-minimal-card">
              <div className="about-identity-block">
                <div className="about-title-row">
                  <h4 className="about-app-name">SyncNote</h4>
                  <span className="app-version-pill">Version 1.0.0</span>
                </div>
                <p className="about-summary-text">
                  Offline-first intelligent knowledge management with AI-assisted semantic synchronization.
                </p>
              </div>

              <div className="about-spec-grid">
                <div className="about-spec-row">
                  <span className="spec-label">Storage</span>
                  <span className="spec-value">SQLite + Markdown (.md)</span>
                </div>
                <div className="about-spec-row">
                  <span className="spec-label">AI</span>
                  <span className="spec-value">Ollama • Local</span>
                </div>
                <div className="about-spec-row">
                  <span className="spec-label">Sync</span>
                  <span className="spec-value">LAN • Local &nbsp;|&nbsp; Cloud • Online/Optional</span>
                </div>
              </div>

              <div className="about-connectivity-matrix">
                <div className="matrix-column">
                  <div className="matrix-header offline-tag">OFFLINE / LOCAL</div>
                  <ul className="matrix-list">
                    <li>Markdown notes</li>
                    <li>SQLite metadata</li>
                    <li>Version history</li>
                    <li>Local editing</li>
                    <li>Ollama AI</li>
                    <li>LAN Sync</li>
                  </ul>
                </div>

                <div className="matrix-column">
                  <div className="matrix-header online-tag">ONLINE / OPTIONAL</div>
                  <ul className="matrix-list">
                    <li>Cloud synchronization (Optional)</li>
                    <li>Google Drive (Optional)</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        )}

      </main>
    </div>
  );
}
