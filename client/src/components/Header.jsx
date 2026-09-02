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

      {/* Dual Sync Architecture Badges */}
      <div className="header-actions">
        <div 
          className="sync-status-badge" 
          title="Google Drive Cloud Sync"
          style={{ background: 'rgba(59, 130, 246, 0.08)', borderColor: 'rgba(59, 130, 246, 0.25)', color: 'var(--accent-primary)' }}
        >
          <span>☁ Google Sync</span>
        </div>

        <div 
          className="sync-status-badge" 
          title="Encrypted P2P LAN Sync"
          style={{ background: 'rgba(16, 185, 129, 0.08)', borderColor: 'rgba(16, 185, 129, 0.25)', color: 'var(--accent-emerald)' }}
        >
          <span>↔ LAN Sync</span>
        </div>

        <div className="sync-status-badge">
          <div className="sync-dot" />
          <span>Local SQLite</span>
        </div>
      </div>
    </header>
  );
}
