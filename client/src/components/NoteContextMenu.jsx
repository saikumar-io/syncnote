import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Edit2, Star, Trash2, Folder, RefreshCw, ChevronRight, FileText, History, Check, Copy } from 'lucide-react';

export default function NoteContextMenu({
  note,
  isOpen,
  position,
  onClose,
  onOpen,
  onRename,
  onFavorite,
  onMoveToNotebook,
  onHistory,
  onDelete,
  onRequestSyncModeChange
}) {
  const menuRef = useRef(null);
  const [showSyncSubmenu, setShowSyncSubmenu] = useState(false);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        onClose();
      }
    };
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen || !note) return null;

  const currentMode = (note.sync_mode === 'google' || note.sync_mode === 'cloud') ? 'cloud' : (note.sync_mode || 'local');

  const handleSelectMode = (mode) => {
    onClose();
    if (onRequestSyncModeChange) {
      onRequestSyncModeChange(note, mode);
    }
  };

  const posX = position ? position.x : 0;
  const posY = position ? position.y : 0;
  const clampedX = Math.max(12, Math.min(posX, window.innerWidth - 220));
  const clampedY = Math.max(12, Math.min(posY, window.innerHeight - 340));

  return createPortal(
    <>
      <div 
        className="portal-menu-backdrop" 
        onClick={onClose}
        onContextMenu={(e) => { e.preventDefault(); onClose(); }}
      />
      <div
        ref={menuRef}
        className="context-menu-popover floating-portal-menu"
        style={{
          position: 'fixed',
          top: `${clampedY}px`,
          left: `${clampedX}px`,
          zIndex: 'var(--z-dropdown, 1000)'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {onOpen && (
          <div
            className="context-menu-item"
            onClick={() => {
              onClose();
              onOpen(note);
            }}
          >
            <FileText size={13} />
            <span>Open</span>
          </div>
        )}

      <div
        className="context-menu-item"
        onClick={() => {
          onClose();
          onRename && onRename(note);
        }}
      >
        <Edit2 size={13} />
        <span>Rename</span>
      </div>

      {onFavorite && (
        <div
          className="context-menu-item"
          onClick={() => {
            onClose();
            onFavorite(note);
          }}
        >
          <Star 
            size={13} 
            style={{ 
              color: note.is_favorite ? '#eab308' : 'inherit',
              fill: note.is_favorite ? '#eab308' : 'none'
            }} 
          />
          <span>{note.is_favorite ? 'Unpin from Favorites' : 'Pin to Favorites'}</span>
        </div>
      )}

      <div
        className="context-menu-item"
        onClick={() => {
          onClose();
          if (note?.file_path) {
            navigator.clipboard.writeText(note.file_path);
          }
        }}
      >
        <Copy size={13} />
        <span>Copy Local Path</span>
      </div>

      <div
        className="context-menu-item"
        onClick={() => {
          onClose();
          onMoveToNotebook && onMoveToNotebook(note);
        }}
      >
        <Folder size={13} />
        <span>Move to Notebook</span>
      </div>

      {/* Sync Mode Submenu Header */}
      <div
        className="context-menu-item"
        onMouseEnter={() => setShowSyncSubmenu(true)}
        onClick={() => setShowSyncSubmenu(!showSyncSubmenu)}
        style={{ justifyContent: 'space-between', position: 'relative' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <RefreshCw size={13} />
          <span>Sync Mode</span>
        </div>
        <ChevronRight size={12} />
      </div>

      {/* Sync Submenu Options */}
      {showSyncSubmenu && (
        <div style={{ background: 'var(--bg-app)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', margin: '4px 8px', padding: '4px' }}>
          <div
            className={`context-menu-item ${currentMode === 'local' ? 'active' : ''}`}
            onClick={() => handleSelectMode('local')}
            style={{ fontSize: '0.74rem', padding: '5px 8px', justifyContent: 'space-between' }}
          >
            <span>○ Local Only</span>
            {currentMode === 'local' && <Check size={12} style={{ color: 'var(--accent-primary)' }} />}
          </div>
          <div
            className={`context-menu-item ${currentMode === 'cloud' ? 'active' : ''}`}
            onClick={() => handleSelectMode('cloud')}
            style={{ fontSize: '0.74rem', padding: '5px 8px', justifyContent: 'space-between' }}
          >
            <span>☁ Cloud (Drive)</span>
            {currentMode === 'cloud' && <Check size={12} style={{ color: '#2684fc' }} />}
          </div>
          <div
            className={`context-menu-item ${currentMode === 'lan' ? 'active' : ''}`}
            onClick={() => handleSelectMode('lan')}
            style={{ fontSize: '0.74rem', padding: '5px 8px', justifyContent: 'space-between' }}
          >
            <span>↔ LAN Sync</span>
            {currentMode === 'lan' && <Check size={12} style={{ color: 'var(--accent-emerald)' }} />}
          </div>
          <div
            className={`context-menu-item ${currentMode === 'both' ? 'active' : ''}`}
            onClick={() => handleSelectMode('both')}
            style={{ fontSize: '0.74rem', padding: '5px 8px', justifyContent: 'space-between' }}
          >
            <span>◈ Both (LAN + Cloud)</span>
            {currentMode === 'both' && <Check size={12} style={{ color: '#06b6d4' }} />}
          </div>
        </div>
      )}

      {onHistory && (
        <div
          className="context-menu-item"
          onClick={() => {
            onClose();
            onHistory(note);
          }}
        >
          <History size={13} />
          <span>Version History</span>
        </div>
      )}

      <div className="context-menu-divider" />

      <div
        className="context-menu-item danger"
        onClick={() => {
          onClose();
          onDelete && onDelete(note);
        }}
      >
        <Trash2 size={13} />
        <span>Delete</span>
      </div>
    </div>
  </>,
  document.body
);
}
