import React, { useState, useEffect, useRef } from 'react';
import { Edit2, Star, Trash2, Folder, RefreshCw, ChevronRight, FileText, History, Check } from 'lucide-react';

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
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, onClose]);

  if (!isOpen || !note) return null;

  const currentMode = (note.sync_mode === 'google' || note.sync_mode === 'cloud') ? 'cloud' : (note.sync_mode || 'local');

  const handleSelectMode = (mode) => {
    onClose();
    if (onRequestSyncModeChange) {
      onRequestSyncModeChange(note, mode);
    }
  };

  return (
    <div
      ref={menuRef}
      className="context-menu-popover"
      style={{ top: position.y, left: position.x }}
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
          <Star size={13} style={{ color: note.is_favorite ? 'var(--accent-warning)' : 'inherit' }} />
          <span>{note.is_favorite ? 'Unfavorite' : 'Favorite'}</span>
        </div>
      )}

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
  );
}
