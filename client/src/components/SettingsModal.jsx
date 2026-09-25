import React, { useState, useEffect } from 'react';
import { Settings, X, Command, Database, Moon, Sun, Monitor, Type, HardDrive, Copy, Check, Palette, Sparkles, Activity } from 'lucide-react';
import { apiClient } from '../api/apiClient';

export default function SettingsModal({ 
  isOpen, 
  onClose,
  theme,
  setTheme,
  accentColor,
  setAccentColor,
  fontSize,
  setFontSize,
  lineNumbers,
  setLineNumbers
}) {
  const [storagePath, setStoragePath] = useState(null);
  const [copied, setCopied] = useState(false);
  const [conflictMetrics, setConflictMetrics] = useState(null);
  const [ollamaStatus, setOllamaStatus] = useState(null);

  // Fetch dynamic storage location and AI conflict research metrics from backend API
  useEffect(() => {
    if (isOpen) {
      apiClient.get('/api/health')
        .then((data) => {
          if (data && data.notes_dir) {
            setStoragePath(data.notes_dir);
          } else {
            setStoragePath(null);
          }
        })
        .catch(() => setStoragePath(null));

      apiClient.get('/api/conflicts/status')
        .then((data) => {
          if (data && data.ollama) {
            setOllamaStatus(data.ollama);
          }
        })
        .catch(() => {});

      apiClient.get('/api/conflicts/metrics')
        .then((data) => {
          if (data && data.metrics) {
            setConflictMetrics(data.metrics.summary);
          }
        })
        .catch(() => {});
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const accentOptions = [
    { name: 'Indigo', color: '#6366f1' },
    { name: 'Emerald', color: '#10b981' },
    { name: 'Amber', color: '#f59e0b' },
    { name: 'Rose', color: '#f43f5e' },
    { name: 'Cyan', color: '#06b6d4' }
  ];

  const copyPath = () => {
    if (storagePath) {
      navigator.clipboard.writeText(storagePath);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const formatShortPath = (fullPath) => {
    if (!fullPath) return '';
    const parts = fullPath.split(/[\\/]/);
    if (parts.length <= 3) return fullPath;
    return `.../${parts.slice(-3).join('/')}`;
  };

  return (
    <div className="modal-overlay">
      <div className="modal-container" style={{ maxWidth: '520px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.9rem', fontWeight: 600 }}>
            <Settings size={16} />
            <span>SyncNote Settings & Preferences</span>
          </div>
          <button style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }} onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginTop: '6px', maxHeight: '70vh', overflowY: 'auto', paddingRight: '4px' }}>
          
          {/* 1. Theme Preferences */}
          <div className="settings-card">
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '8px' }}>
              <Sun size={13} />
              <span>Appearance Theme</span>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                className={`theme-select-btn ${theme === 'dark' ? 'active' : ''}`}
                onClick={() => setTheme('dark')}
              >
                <Moon size={12} />
                <span>Dark</span>
              </button>
              <button
                className={`theme-select-btn ${theme === 'light' ? 'active' : ''}`}
                onClick={() => setTheme('light')}
              >
                <Sun size={12} />
                <span>Light</span>
              </button>
              <button
                className={`theme-select-btn ${theme === 'system' ? 'active' : ''}`}
                onClick={() => setTheme('system')}
              >
                <Monitor size={12} />
                <span>System</span>
              </button>
            </div>
          </div>

          {/* 2. Accent Color Preferences */}
          <div className="settings-card">
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '8px' }}>
              <Palette size={13} />
              <span>Accent Color</span>
            </div>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              {accentOptions.map((item) => (
                <button
                  key={item.color}
                  onClick={() => setAccentColor(item.color)}
                  title={item.name}
                  style={{
                    width: '24px',
                    height: '24px',
                    borderRadius: '50%',
                    background: item.color,
                    border: accentColor === item.color ? '2px solid var(--text-primary)' : '2px solid transparent',
                    cursor: 'pointer',
                    outline: 'none',
                    transition: 'transform 0.1s ease'
                  }}
                />
              ))}
            </div>
          </div>

          {/* 3. Editor Preferences */}
          <div className="settings-card">
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '8px' }}>
              <Type size={13} />
              <span>Editor Preferences</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div className="shortcut-row">
                <span className="shortcut-label">Editor Font Size</span>
                <div style={{ display: 'flex', gap: '4px' }}>
                  {['small', 'medium', 'large'].map((size) => (
                    <button
                      key={size}
                      className={`theme-select-btn ${fontSize === size ? 'active' : ''}`}
                      style={{ padding: '2px 8px', fontSize: '0.72rem' }}
                      onClick={() => setFontSize(size)}
                    >
                      {size.charAt(0).toUpperCase() + size.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="shortcut-row">
                <span className="shortcut-label">Auto-save Status</span>
                <span style={{ fontSize: '0.74rem', color: 'var(--accent-emerald)', fontFamily: 'var(--font-mono)' }}>
                  Enabled (Instant File I/O)
                </span>
              </div>
            </div>
          </div>

          {/* 4. Storage Location Info (Dynamic backend retrieval) */}
          <div className="settings-card">
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '6px' }}>
              <HardDrive size={13} style={{ color: 'var(--accent-emerald)' }} />
              <span>Storage Location</span>
            </div>

            {storagePath ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div 
                  title={storagePath}
                  style={{ 
                    background: 'var(--bg-app)', 
                    border: '1px solid var(--border-subtle)', 
                    padding: '6px 10px', 
                    borderRadius: 'var(--radius-sm)', 
                    fontFamily: 'var(--font-mono)', 
                    fontSize: '0.74rem', 
                    color: 'var(--text-primary)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between'
                  }}
                >
                  <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {formatShortPath(storagePath)}
                  </span>
                  <button
                    onClick={copyPath}
                    title="Copy Full Storage Path"
                    style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '2px' }}
                  >
                    {copied ? <Check size={13} style={{ color: 'var(--accent-emerald)' }} /> : <Copy size={13} />}
                  </button>
                </div>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                  Notes are stored directly as Markdown .md files.
                </span>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                  Managed by SyncNote
                </div>
                <p style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                  The storage location is managed by the current application environment.
                </p>
              </div>
            )}
          </div>

          {/* AI Conflict Resolution & Evaluation Metrics */}
          <div className="settings-card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                <Sparkles size={13} style={{ color: 'var(--accent-primary)' }} />
                <span>AI Semantic Conflict Resolution</span>
              </div>
              <span style={{ 
                fontSize: '0.66rem', 
                padding: '2px 6px', 
                borderRadius: '4px', 
                background: ollamaStatus?.available ? 'rgba(16, 185, 129, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                color: ollamaStatus?.available ? '#10b981' : '#f59e0b',
                border: `1px solid ${ollamaStatus?.available ? 'rgba(16, 185, 129, 0.3)' : 'rgba(245, 158, 11, 0.3)'}`
              }}>
                {ollamaStatus?.available ? `Ollama (${ollamaStatus.configuredModel || 'llama3.2:1b'})` : 'Ollama Offline'}
              </span>
            </div>

            <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', margin: '0 0 10px 0', lineHeight: 1.4 }}>
              Offline-first semantic analysis for concurrent conflicts using local LLM inference.
            </p>

            {conflictMetrics && conflictMetrics.totalConflicts > 0 ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', background: 'var(--bg-input)', padding: '8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '0.86rem', fontWeight: 700, color: 'var(--text-primary)' }}>{conflictMetrics.totalConflicts}</div>
                  <div style={{ fontSize: '0.64rem', color: 'var(--text-muted)' }}>Conflicts</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '0.86rem', fontWeight: 700, color: '#10b981' }}>{conflictMetrics.aiAcceptanceRate}%</div>
                  <div style={{ fontSize: '0.64rem', color: 'var(--text-muted)' }}>AI Acceptance</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '0.86rem', fontWeight: 700, color: 'var(--accent-primary)' }}>{conflictMetrics.avgAiLatencyMs}ms</div>
                  <div style={{ fontSize: '0.64rem', color: 'var(--text-muted)' }}>Avg AI Latency</div>
                </div>
              </div>
            ) : (
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                No conflict events recorded yet. Metrics will appear here as concurrent edits are resolved.
              </div>
            )}
          </div>

          {/* 5. Keyboard Shortcuts */}
          <div className="settings-card">
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '6px' }}>
              <Command size={13} />
              <span>Shortcuts Reference</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div className="shortcut-row">
                <span className="shortcut-label">Focus Global Search</span>
                <kbd className="shortcut-kbd">Ctrl K</kbd>
              </div>
              <div className="shortcut-row">
                <span className="shortcut-label">Create New Markdown Note</span>
                <kbd className="shortcut-kbd">Ctrl N</kbd>
              </div>
            </div>
          </div>

        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '8px' }}>
          <button 
            onClick={onClose}
            style={{
              background: 'var(--text-primary)',
              color: 'var(--bg-app)',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              padding: '5px 14px',
              fontSize: '0.78rem',
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            Save & Close
          </button>
        </div>
      </div>
    </div>
  );
}
