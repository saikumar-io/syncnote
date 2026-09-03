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
  BookOpen, 
  RefreshCw,
  ChevronDown,
  ChevronRight,
  LogOut,
  CheckCircle2,
  AlertCircle,
  Wifi,
  WifiOff,
  Laptop,
  ArrowRight,
  Link2
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
  const { user, device, isOffline, logout, refreshUser } = useAuth();
  const sync = useSync();
  const navigate = useNavigate();
  const [syncingNow, setSyncingNow] = useState(false);

  // Accordion state: default 'account' expanded
  const [expandedSection, setExpandedSection] = useState('account');

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

  // Read authoritative sync state directly from SyncContext
  const googleAccountStatus = sync?.googleAccountStatus || { connected: false, email: null };
  const googleDriveStatus = sync?.googleDriveStatus || { connected: false, email: null, folderName: 'SyncNote' };

  useEffect(() => {
    if (sync?.refreshSyncStatus) {
      sync.refreshSyncStatus();
    }
    if (user?.username) setUsernameInput(user.username);
    if (device?.device_name) setDeviceNameInput(device.device_name);
  }, [user, device, sync?.refreshSyncStatus]);

  const toggleSection = (sectionId) => {
    setExpandedSection((prev) => (prev === sectionId ? null : sectionId));
  };

  const handlePasswordChange = async (e) => {
    e.preventDefault();
    if (!currentPassword || !newPassword) return;
    if (newPassword.length < 6) {
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
      await authApi.changePassword({ currentPassword, newPassword, confirmPassword });
      setPwdMsg({ type: 'success', text: 'Password updated successfully!' });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
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
      setProfileMsg({ type: 'success', text: 'Profile updated successfully!' });
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

  return (
    <div className="settings-page-container page-container" style={{ maxWidth: '720px', margin: '0 auto', padding: '24px 16px' }}>
      <div className="page-header-bar" style={{ marginBottom: '24px' }}>
        <div>
          <h1 className="page-heading">Settings</h1>
          <p className="page-subheading">Configure workspace preferences, security credentials, and synchronization</p>
        </div>
      </div>

      <div className="settings-accordion-list" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        
        {/* 1. Account */}
        <div className="settings-accordion-card">
          <button
            type="button"
            className="settings-accordion-header"
            onClick={() => toggleSection('account')}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <User size={16} className="accordion-icon" />
              <span className="accordion-title">Account</span>
            </div>
            {expandedSection === 'account' ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>

          {expandedSection === 'account' && (
            <div className="settings-accordion-body">
              {user ? (
                <form onSubmit={handleProfileUpdate} className="settings-form-block">
                  {profileMsg.text && (
                    <div className={`auth-error-banner ${profileMsg.type === 'success' ? 'success' : ''}`}>
                      {profileMsg.type === 'success' ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
                      <span>{profileMsg.text}</span>
                    </div>
                  )}

                  <div className="setting-item-row">
                    <div>
                      <div className="setting-label">Username</div>
                      <div className="setting-description">Your unique handle</div>
                    </div>
                    <input
                      type="text"
                      className="auth-input input-compact"
                      style={{ width: '220px' }}
                      value={usernameInput}
                      onChange={(e) => setUsernameInput(e.target.value)}
                      required
                    />
                  </div>

                  <div className="setting-item-row">
                    <div>
                      <div className="setting-label">Email Address</div>
                      <div className="setting-description">Associated account email</div>
                    </div>
                    <span className="setting-value-tag">{user.email}</span>
                  </div>

                  <div className="setting-item-row">
                    <div>
                      <div className="setting-label">Device Name</div>
                      <div className="setting-description">Identifier for this machine</div>
                    </div>
                    <input
                      type="text"
                      className="auth-input input-compact"
                      style={{ width: '220px' }}
                      value={deviceNameInput}
                      onChange={(e) => setDeviceNameInput(e.target.value)}
                    />
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-start', marginTop: '12px' }}>
                    <button
                      type="submit"
                      className="btn-secondary"
                      disabled={profileSubmitting}
                    >
                      {profileSubmitting ? 'Saving...' : 'Save Profile Changes'}
                    </button>
                  </div>
                </form>
              ) : (
                <div className="setting-value-tag">Not signed in</div>
              )}
            </div>
          )}
        </div>

        {/* 2. Security */}
        <div className="settings-accordion-card">
          <button
            type="button"
            className="settings-accordion-header"
            onClick={() => toggleSection('security')}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <ShieldCheck size={16} className="accordion-icon" />
              <span className="accordion-title">Security</span>
            </div>
            {expandedSection === 'security' ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>

          {expandedSection === 'security' && (
            <div className="settings-accordion-body">
              <form onSubmit={handlePasswordChange} className="settings-form-block">
                {pwdMsg.text && (
                  <div className={`auth-error-banner ${pwdMsg.type === 'success' ? 'success' : ''}`}>
                    {pwdMsg.type === 'success' ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
                    <span>{pwdMsg.text}</span>
                  </div>
                )}

                <div className="form-group" style={{ marginBottom: '12px' }}>
                  <label className="input-label">Current Password</label>
                  <input
                    type="password"
                    className="auth-input input-compact"
                    placeholder="Enter current password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    required
                  />
                </div>

                <div className="form-group" style={{ marginBottom: '12px' }}>
                  <label className="input-label">New Password</label>
                  <input
                    type="password"
                    className="auth-input input-compact"
                    placeholder="New password (min 6 chars)"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                  />
                </div>

                <div className="form-group" style={{ marginBottom: '16px' }}>
                  <label className="input-label">Confirm New Password</label>
                  <input
                    type="password"
                    className="auth-input input-compact"
                    placeholder="Re-enter new password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                  />
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                  <button
                    type="submit"
                    className="btn-primary"
                    disabled={pwdSubmitting}
                  >
                    {pwdSubmitting ? 'Updating...' : 'Change Password'}
                  </button>
                </div>
              </form>

              <hr className="settings-divider" style={{ marginTop: '20px' }} />

              <div className="setting-item-row" style={{ marginTop: '12px' }}>
                <div>
                  <div className="setting-label text-danger">Sign Out</div>
                  <div className="setting-description">End active session on this device</div>
                </div>
                <button type="button" className="btn-danger" onClick={handleLogout}>
                  <LogOut size={14} style={{ marginRight: '6px' }} />
                  Log Out
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 3. Appearance */}
        <div className="settings-accordion-card">
          <button
            type="button"
            className="settings-accordion-header"
            onClick={() => toggleSection('appearance')}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Palette size={16} className="accordion-icon" />
              <span className="accordion-title">Appearance</span>
            </div>
            {expandedSection === 'appearance' ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>

          {expandedSection === 'appearance' && (
            <div className="settings-accordion-body">
              <div className="setting-item-row">
                <div>
                  <div className="setting-label">Theme Mode</div>
                  <div className="setting-description">Toggle Dark / Light interface theme</div>
                </div>
                <ThemeToggle theme={theme} setTheme={setTheme} />
              </div>
            </div>
          )}
        </div>

        {/* 4. Editor */}
        <div className="settings-accordion-card">
          <button
            type="button"
            className="settings-accordion-header"
            onClick={() => toggleSection('editor')}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <FileCode size={16} className="accordion-icon" />
              <span className="accordion-title">Editor</span>
            </div>
            {expandedSection === 'editor' ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>

          {expandedSection === 'editor' && (
            <div className="settings-accordion-body">
              <div className="setting-item-row">
                <div>
                  <div className="setting-label">Autosave Engine</div>
                  <div className="setting-description">Continuous local file persistence</div>
                </div>
                <span className="setting-value-tag success">Active (Instant)</span>
              </div>

              <div className="setting-item-row">
                <div>
                  <div className="setting-label">WikiLink Syntax</div>
                  <div className="setting-description">Bi-directional linking e.g. [[Note Title]]</div>
                </div>
                <span className="setting-value-tag">Enabled</span>
              </div>
            </div>
          )}
        </div>

        {/* 5. Notes */}
        <div className="settings-accordion-card">
          <button
            type="button"
            className="settings-accordion-header"
            onClick={() => toggleSection('notes')}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <BookOpen size={16} className="accordion-icon" />
              <span className="accordion-title">Notes</span>
            </div>
            {expandedSection === 'notes' ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>

          {expandedSection === 'notes' && (
            <div className="settings-accordion-body">
              <div className="setting-item-row">
                <div>
                  <div className="setting-label">Default Storage</div>
                  <div className="setting-description">Local disk Markdown storage</div>
                </div>
                <span className="setting-value-tag">SQLite + Markdown</span>
              </div>

              <div className="setting-item-row">
                <div>
                  <div className="setting-label">Offline-First Architecture</div>
                  <div className="setting-description">Local Express backend + SQLite engine</div>
                </div>
                <span className="setting-value-tag success">Enabled</span>
              </div>
            </div>
          )}
        </div>

        {/* 6. Sync */}
        <div className="settings-accordion-card">
          <button
            type="button"
            className="settings-accordion-header"
            onClick={() => toggleSection('sync')}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <RefreshCw size={16} className="accordion-icon" />
              <span className="accordion-title">Sync</span>
            </div>
            {expandedSection === 'sync' ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>

          {expandedSection === 'sync' && (
            <div className="settings-accordion-body" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              
              {/* ONLINE SYNC */}
              <div style={{ background: 'var(--bg-app)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', padding: '14px' }}>
                <div style={{ fontSize: '0.84rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
                  Online
                </div>
                <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', marginBottom: '12px' }}>
                  Authentication and cloud storage synchronization are managed separately.
                </div>

                {/* Google Account Row */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', background: 'var(--bg-input)', borderRadius: 'var(--radius-sm)', marginBottom: '8px', fontSize: '0.78rem' }}>
                  <div>
                    <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Google Account: </span>
                    {googleAccountStatus.connected ? (
                      <span style={{ color: 'var(--accent-emerald)', fontWeight: 600 }}>
                        ● Connected {googleAccountStatus.email ? `(${googleAccountStatus.email})` : ''}
                      </span>
                    ) : (
                      <span style={{ color: 'var(--text-muted)' }}>○ Not Connected</span>
                    )}
                  </div>
                  {!googleAccountStatus.connected && (
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => { window.location.href = '/api/auth/google'; }}
                      style={{ padding: '3px 10px', fontSize: '0.72rem' }}
                    >
                      Connect Google
                    </button>
                  )}
                </div>

                {/* Google Drive Sync Row */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '12px', background: 'var(--bg-input)', borderRadius: 'var(--radius-sm)', fontSize: '0.78rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <GoogleDriveIcon size={22} />
                      <div>
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span>Google Drive Sync</span>
                          <span style={{ fontSize: '0.68rem', padding: '1px 6px', borderRadius: '3px', background: 'rgba(99, 102, 241, 0.12)', color: 'var(--accent-primary)', fontWeight: 600 }}>
                            Folder: SyncNote
                          </span>
                        </div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                          {googleDriveStatus.connected ? (
                            <span style={{ color: 'var(--accent-emerald)', fontWeight: 600 }}>
                              ● Connected {googleDriveStatus.email ? `(${googleDriveStatus.email})` : ''}
                            </span>
                          ) : (
                            <span style={{ color: 'var(--text-muted)' }}>○ Not Connected</span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {googleDriveStatus.connected && (
                        <button
                          type="button"
                          className="btn-primary"
                          disabled={sync?.isSyncing || syncingNow}
                          onClick={async () => {
                            setSyncingNow(true);
                            try {
                              if (sync?.triggerSync) {
                                await sync.triggerSync();
                              } else {
                                await apiClient.post('/api/sync/gdrive/sync-now');
                              }
                            } catch (e) {}
                            setSyncingNow(false);
                          }}
                          style={{ padding: '4px 12px', fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: '4px' }}
                        >
                          <RefreshCw size={12} className={(sync?.isSyncing || syncingNow) ? 'spin' : ''} />
                          <span>{(sync?.isSyncing || syncingNow) ? 'Syncing...' : 'Sync Now'}</span>
                        </button>
                      )}

                      {googleDriveStatus.connected ? (
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={async () => {
                            if (sync?.disconnectDrive) {
                              await sync.disconnectDrive();
                            } else {
                              await apiClient.post('/api/auth/google/drive/disconnect');
                            }
                          }}
                          style={{ padding: '4px 10px', fontSize: '0.72rem', color: 'var(--accent-danger)' }}
                        >
                          Disconnect
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn-primary"
                          onClick={() => { window.location.href = '/api/auth/google/drive'; }}
                          style={{ padding: '4px 10px', fontSize: '0.72rem' }}
                        >
                          Connect Google Drive
                        </button>
                      )}
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid var(--border-subtle)', paddingTop: '8px', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                    <div>
                      Pending Google Sync: <strong style={{ color: (sync?.pendingGoogleCount || 0) > 0 ? 'var(--accent-warning)' : 'var(--text-primary)' }}>{sync?.pendingGoogleCount || 0}</strong> note{(sync?.pendingGoogleCount || 0) === 1 ? '' : 's'}
                    </div>
                    <div>
                      Last Sync: <strong style={{ color: 'var(--text-primary)' }}>{sync?.lastSyncedAt ? formatRelativeTime(sync.lastSyncedAt) : 'Never'}</strong>
                    </div>
                  </div>
                </div>
              </div>

              {/* LAN SYNC CARD */}
              <div style={{ background: 'var(--bg-app)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', padding: '14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: '0.84rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '2px' }}>
                    LAN Sync
                  </div>
                  <div style={{ fontSize: '0.74rem', color: 'var(--accent-emerald)', fontWeight: 600 }}>
                    ● Available
                  </div>
                </div>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => navigate('/settings/sync/lan')}
                  style={{ padding: '6px 12px', fontSize: '0.76rem', display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}
                >
                  <span>Scan for Devices</span>
                  <ArrowRight size={13} />
                </button>
              </div>

              {/* PAIRED DEVICES CARD */}
              <div style={{ background: 'var(--bg-app)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', padding: '14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: '0.84rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '2px' }}>
                    Paired Devices
                  </div>
                  <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
                    {sync.pairedDevices ? `${sync.pairedDevices.length} device${sync.pairedDevices.length === 1 ? '' : 's'}` : '0 devices'}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => navigate('/settings/sync/paired-devices')}
                  style={{ padding: '6px 12px', fontSize: '0.76rem', display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}
                >
                  <span>View Devices</span>
                  <ArrowRight size={13} />
                </button>
              </div>

            </div>
          )}
        </div>

      </div>
    </div>
  );
}
