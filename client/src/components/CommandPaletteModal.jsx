import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from '../utils/router';
import { 
  Search, 
  FileText, 
  Plus, 
  Share2, 
  Settings, 
  Sun, 
  Moon, 
  Hash, 
  ArrowRight, 
  X 
} from 'lucide-react';

export default function CommandPaletteModal({ 
  isOpen, 
  onClose, 
  notes = [], 
  onCreateNote, 
  theme, 
  setTheme 
}) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // Filter notes based on query
  const q = query.toLowerCase().trim();
  const matchingNotes = notes.filter((n) => {
    if (!q) return true;
    const titleMatch = n.title && n.title.toLowerCase().includes(q);
    const contentMatch = n.content && n.content.toLowerCase().includes(q);
    return titleMatch || contentMatch;
  }).slice(0, 8);

  const handleSelectNote = (noteId) => {
    onClose();
    navigate(`/notes/${noteId}`);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % (matchingNotes.length + 3));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + matchingNotes.length + 3) % (matchingNotes.length + 3));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (matchingNotes[selectedIndex]) {
        handleSelectNote(matchingNotes[selectedIndex].id);
      } else if (selectedIndex === matchingNotes.length) {
        onClose();
        onCreateNote();
      } else if (selectedIndex === matchingNotes.length + 1) {
        onClose();
        navigate('/graph');
      } else if (selectedIndex === matchingNotes.length + 2) {
        onClose();
        navigate('/settings');
      }
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div 
        className="command-palette-card"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Header */}
        <div className="cp-search-header">
          <Search size={16} className="cp-search-icon" />
          <input
            ref={inputRef}
            type="text"
            className="cp-search-input"
            placeholder="Type a command or search notes (Esc to cancel)..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
          />
          <button className="cp-close-btn" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        {/* Results List */}
        <div className="cp-results-list">
          {matchingNotes.length > 0 && (
            <div className="cp-section-label">Matching Notes ({matchingNotes.length})</div>
          )}

          {matchingNotes.map((note, idx) => {
            const isSelected = idx === selectedIndex;
            return (
              <div
                key={note.id}
                className={`cp-item-row ${isSelected ? 'selected' : ''}`}
                onClick={() => handleSelectNote(note.id)}
              >
                <div className="cp-item-left">
                  <FileText size={14} className="cp-icon" />
                  <span className="cp-title">{note.title || 'Untitled Note'}</span>
                </div>
                <ArrowRight size={12} className="cp-arrow" />
              </div>
            );
          })}

          <div className="cp-section-label">Quick Actions</div>

          <div
            className={`cp-item-row ${selectedIndex === matchingNotes.length ? 'selected' : ''}`}
            onClick={() => {
              onClose();
              onCreateNote();
            }}
          >
            <div className="cp-item-left">
              <Plus size={14} className="cp-icon action" />
              <span className="cp-title"> Create New Note</span>
            </div>
            <span className="cp-shortcut">Ctrl+N</span>
          </div>

          <div
            className={`cp-item-row ${selectedIndex === matchingNotes.length + 1 ? 'selected' : ''}`}
            onClick={() => {
              onClose();
              navigate('/graph');
            }}
          >
            <div className="cp-item-left">
              <Share2 size={14} className="cp-icon action" />
              <span className="cp-title">Open Knowledge Graph</span>
            </div>
          </div>

          <div
            className={`cp-item-row ${selectedIndex === matchingNotes.length + 2 ? 'selected' : ''}`}
            onClick={() => {
              onClose();
              navigate('/settings');
            }}
          >
            <div className="cp-item-left">
              <Settings size={14} className="cp-icon action" />
              <span className="cp-title">Open Settings</span>
            </div>
          </div>
        </div>

        {/* Footer info */}
        <div className="cp-footer">
          <span>Use <kbd>↑</kbd> <kbd>↓</kbd> to navigate, <kbd>Enter</kbd> to select</span>
          <span><kbd>Esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
