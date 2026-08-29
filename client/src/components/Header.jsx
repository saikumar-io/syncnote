import React from 'react';
import { Search } from 'lucide-react';

export default function Header({ 
  searchQuery, 
  setSearchQuery, 
  searchInputRef,
  apiConnected = true 
}) {
  return (
    <header className="top-header">
      {/* Brand Identity */}
      <div className="brand-section">
        <div className="brand-logo">S</div>
        <span className="brand-title">SyncNote</span>
      </div>

      {/* Global Search Bar with Ctrl K Badge */}
      <div className="header-search-container">
        <Search size={13} className="header-search-icon" />
        <input
          ref={searchInputRef}
          type="text"
          className="header-search-input"
          placeholder="Search notes (Title, Content)..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        <kbd className="kbd-badge">Ctrl K</kbd>
      </div>

      {/* Sync Status Badge */}
      <div className="header-actions">
        <div className="sync-status-badge">
          <div className="sync-dot" />
          <span>Saved locally</span>
        </div>

        <div 
          className="sync-status-badge" 
          style={{ 
            borderColor: apiConnected ? 'var(--border-subtle)' : 'var(--accent-danger)', 
            color: apiConnected ? 'var(--text-secondary)' : 'var(--accent-danger)',
            background: 'transparent'
          }}
        >
          <span>{apiConnected ? 'SQLite' : 'Offline'}</span>
        </div>
      </div>
    </header>
  );
}
