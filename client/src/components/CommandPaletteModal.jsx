import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from '../utils/router';
import { 
  Search, 
  FileText, 
  Plus, 
  Share2, 
  Settings, 
  Sparkles,
  ArrowRight, 
  X,
  Tag,
  Clock,
  ExternalLink,
  Command,
  BookOpen,
  Star,
  Wifi,
  HelpCircle
} from 'lucide-react';
import { formatRelativeTime } from '../utils/timeUtils';

export default function CommandPaletteModal({ 
  isOpen, 
  onClose, 
  notes = [], 
  onCreateNote, 
  theme, 
  setTheme 
}) {
  const [query, setQuery] = useState('');
  const [searchMode, setSearchMode] = useState('all'); // 'all' | 'notes' | 'semantic' | 'actions'
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setSearchMode('all');
      setTimeout(() => inputRef.current?.focus(), 50);
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }

    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const q = query.toLowerCase().trim();

  // Filter notes based on query & mode
  const matchingNotes = notes.filter((n) => {
    if (!q) return true;
    const titleMatch = n.title && n.title.toLowerCase().includes(q);
    const contentMatch = n.content && n.content.toLowerCase().includes(q);
    return titleMatch || contentMatch;
  }).slice(0, 8);

  // Extract snippet highlighting match
  const getExcerpt = (content) => {
    if (!content) return '';
    if (!q) return content.substring(0, 90).replace(/\n/g, ' ') + (content.length > 90 ? '...' : '');
    const idx = content.toLowerCase().indexOf(q);
    if (idx === -1) return content.substring(0, 90).replace(/\n/g, ' ') + (content.length > 90 ? '...' : '');
    const start = Math.max(0, idx - 30);
    const end = Math.min(content.length, idx + q.length + 50);
    return (start > 0 ? '...' : '') + content.substring(start, end).replace(/\n/g, ' ') + (end < content.length ? '...' : '');
  };

  // Actions list
  const actions = [
    {
      id: 'action-new-note',
      title: 'Create New Note',
      shortcut: 'Ctrl+Alt+N',
      icon: Plus,
      run: () => { onClose(); if (onCreateNote) onCreateNote(); }
    },
    {
      id: 'action-notes',
      title: 'Open Notes Explorer',
      shortcut: 'Notes',
      icon: FileText,
      run: () => { onClose(); navigate('/notes'); }
    },
    {
      id: 'action-favorites',
      title: 'Open Starred Favorites',
      shortcut: 'Favorites',
      icon: Star,
      run: () => { onClose(); navigate('/favorites'); }
    },
    {
      id: 'action-graph',
      title: 'Open Interactive Knowledge Graph',
      shortcut: 'Ctrl+Alt+G',
      icon: Share2,
      run: () => { onClose(); navigate('/graph'); }
    },
    {
      id: 'action-lan-sync',
      title: 'Open LAN Peer Sync',
      shortcut: 'LAN Sync',
      icon: Wifi,
      run: () => { onClose(); navigate('/settings/sync/lan'); }
    },
    {
      id: 'action-settings',
      title: 'Open Application Settings',
      shortcut: 'Ctrl+,',
      icon: Settings,
      run: () => { onClose(); navigate('/settings'); }
    },
    {
      id: 'action-about',
      title: 'About SyncNote',
      shortcut: 'About',
      icon: HelpCircle,
      run: () => { onClose(); navigate('/about'); }
    }
  ];

  const filteredActions = actions.filter(a => !q || a.title.toLowerCase().includes(q));

  const totalItems = matchingNotes.length + filteredActions.length;

  const handleSelectNote = (noteId) => {
    onClose();
    navigate(`/notes/${noteId}`);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % Math.max(totalItems, 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + Math.max(totalItems, 1)) % Math.max(totalItems, 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedIndex < matchingNotes.length) {
        handleSelectNote(matchingNotes[selectedIndex].id);
      } else {
        const actionIdx = selectedIndex - matchingNotes.length;
        if (filteredActions[actionIdx]) {
          filteredActions[actionIdx].run();
        }
      }
    }
  };

  return (
    <div className="modal-backdrop cp-backdrop" onClick={onClose}>
      <div 
        className="cp-floating-palette"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Input Header */}
        <div className="cp-search-header-bar">
          <Search size={17} className="cp-search-icon" />
          <input
            ref={inputRef}
            type="text"
            className="cp-main-input"
            placeholder="Search notes, semantic concepts, or run a command..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
          />
          <div className="cp-header-badges">
            <span className="cp-mode-badge">
              <Sparkles size={11} />
              <span>Full-Text & Semantic</span>
            </span>
            <button className="icon-btn-ghost cp-close-btn" onClick={onClose} type="button">
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Results List Viewport */}
        <div className="cp-results-viewport">
          {matchingNotes.length > 0 && (
            <div className="cp-category-header">
              <span>Matching Notes ({matchingNotes.length})</span>
            </div>
          )}

          {matchingNotes.map((note, idx) => {
            const isSelected = idx === selectedIndex;
            const excerpt = getExcerpt(note.content);
            return (
              <div
                key={note.id}
                className={`cp-result-row ${isSelected ? 'focused' : ''}`}
                onClick={() => handleSelectNote(note.id)}
              >
                <div className="row-left-icon">
                  <FileText size={15} />
                </div>
                <div className="row-content-body">
                  <div className="row-title-bar">
                    <span className="row-note-title">{note.title || 'Untitled Note'}</span>
                    {note.is_favorite && <span className="star-tag">★</span>}
                    <span className="row-updated-time">Updated {formatRelativeTime(note.updated_at)}</span>
                  </div>
                  {excerpt && (
                    <p className="row-excerpt-snippet">{excerpt}</p>
                  )}
                </div>
                <ArrowRight size={12} className="row-arrow" />
              </div>
            );
          })}

          {filteredActions.length > 0 && (
            <div className="cp-category-header" style={{ marginTop: '8px' }}>
              <span>Commands & Quick Navigation</span>
            </div>
          )}

          {filteredActions.map((action, idx) => {
            const overallIdx = matchingNotes.length + idx;
            const isSelected = overallIdx === selectedIndex;
            const ActionIcon = action.icon;
            return (
              <div
                key={action.id}
                className={`cp-result-row action-row ${isSelected ? 'focused' : ''}`}
                onClick={action.run}
              >
                <div className="row-left-icon action">
                  <ActionIcon size={14} />
                </div>
                <div className="row-content-body">
                  <span className="action-title-text">{action.title}</span>
                </div>
                <kbd className="action-shortcut-kbd">{action.shortcut}</kbd>
              </div>
            );
          })}

          {totalItems === 0 && (
            <div className="cp-empty-state">
              <Search size={24} className="empty-search-icon" />
              <p>No notes or actions matching "{query}"</p>
            </div>
          )}
        </div>

        {/* Command Palette Footer */}
        <footer className="cp-dock-footer">
          <div className="footer-keys">
            <span><kbd>↑</kbd> <kbd>↓</kbd> navigate</span>
            <span><kbd>Enter</kbd> open</span>
            <span><kbd>Esc</kbd> dismiss</span>
          </div>
          <span className="footer-brand">SyncNote Command Palette</span>
        </footer>
      </div>
    </div>
  );
}
