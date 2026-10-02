import React, { useState, useMemo } from 'react';
import { useNavigate } from '../utils/router';
import { 
  Star, 
  Search, 
  Grid, 
  List, 
  Plus, 
  FileText, 
  MoreVertical, 
  Edit2, 
  Copy, 
  FolderInput, 
  Trash2, 
  CheckSquare, 
  X 
} from 'lucide-react';
import CustomSelect from '../components/CustomSelect';
import SyncModeModal from '../components/SyncModeModal';
import MoveNoteModal from '../components/MoveNoteModal';
import DeleteModal from '../components/DeleteModal';
import { NoteSyncBadge } from '../components/NoteListColumn';
import { formatRelativeTime } from '../utils/timeUtils';
import { getNotePath } from '../utils/pathUtils';

export default function FavoritesPage({
  notes = [],
  notebooks = [],
  onCreateNote,
  onUpdateNote,
  onToggleFavorite,
  onRequestDeleteNote
}) {
  const navigate = useNavigate();
  const [localSearch, setLocalSearch] = useState('');
  const [activeMenuKey, setActiveMenuKey] = useState(null);

  // Persisted view & sort preferences
  const [viewMode, setViewMode] = useState(() => {
    return localStorage.getItem('syncnote-view-mode') || 'grid';
  });
  const [sortBy, setSortBy] = useState(() => {
    return localStorage.getItem('syncnote-sort-mode') || 'updated';
  });

  const handleViewModeChange = (mode) => {
    setViewMode(mode);
    localStorage.setItem('syncnote-view-mode', mode);
  };

  const handleSortByChange = (sort) => {
    setSortBy(sort);
    localStorage.setItem('syncnote-sort-mode', sort);
  };

  // Modals state
  const [moveNoteTarget, setMoveNoteTarget] = useState(null);
  const [selectedNoteIds, setSelectedNoteIds] = useState([]);
  const [syncModeModalState, setSyncModeModalState] = useState({ isOpen: false, note: null, targetMode: null });

  // Only favorited notes
  const favoriteNotes = useMemo(() => {
    return notes.filter((n) => Boolean(n.is_favorite));
  }, [notes]);

  const activeSearch = localSearch.trim().toLowerCase();

  // Filter by search
  const filteredNotes = useMemo(() => {
    return favoriteNotes.filter((n) => {
      if (!activeSearch) return true;
      const titleMatch = n.title && n.title.toLowerCase().includes(activeSearch);
      const contentMatch = n.content && n.content.toLowerCase().includes(activeSearch);
      return titleMatch || contentMatch;
    });
  }, [favoriteNotes, activeSearch]);

  // Sort notes
  const sortedNotes = useMemo(() => {
    return [...filteredNotes].sort((a, b) => {
      if (sortBy === 'name') {
        return (a.title || '').localeCompare(b.title || '');
      }
      if (sortBy === 'created') {
        return new Date(b.created_at || 0) - new Date(a.created_at || 0);
      }
      return new Date(b.updated_at || 0) - new Date(a.updated_at || 0);
    });
  }, [filteredNotes, sortBy]);

  const toggleSelectNote = (e, noteId) => {
    e.stopPropagation();
    setSelectedNoteIds((prev) =>
      prev.includes(noteId) ? prev.filter((id) => id !== noteId) : [...prev, noteId]
    );
  };

  const handleBatchSyncModeChange = (mode) => {
    selectedNoteIds.forEach((id) => {
      if (onUpdateNote) onUpdateNote(id, { sync_mode: mode });
    });
    setSelectedNoteIds([]);
  };

  const handleMoveNote = (noteId, targetNotebookId) => {
    if (onUpdateNote) {
      onUpdateNote(noteId, { notebook_id: targetNotebookId });
    }
  };

  const handleRenameNote = (note) => {
    const newTitle = prompt('Enter new note title:', note.title || '');
    if (newTitle && newTitle.trim() && newTitle.trim() !== note.title) {
      if (onUpdateNote) {
        onUpdateNote(note.id, { title: newTitle.trim() });
      }
    }
  };

  const handleDuplicateNote = (note) => {
    if (onCreateNote) {
      onCreateNote(`${note.title || 'Untitled'} (Copy)`, note.notebook_id);
    }
  };

  const sortOptions = [
    { value: 'updated', label: 'Sort: Updated' },
    { value: 'name', label: 'Sort: Name' },
    { value: 'created', label: 'Sort: Created' }
  ];

  return (
    <div className="notes-page-container page-container" onClick={() => setActiveMenuKey(null)}>
      {/* Top Header & Search Bar */}
      <div className="page-header-bar">
        <div>
          <div className="breadcrumb-nav-bar" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Star size={16} style={{ color: '#eab308', fill: '#eab308' }} />
            <span className="breadcrumb-item active" style={{ fontSize: '1.2rem', fontWeight: 700 }}>
              Favorites
            </span>
          </div>
          <p className="page-subheading">Your starred notes</p>
        </div>

        <div className="page-header-actions">
          {/* Search Box */}
          <div className="header-search-box">
            <Search size={13} className="search-icon" />
            <input
              type="text"
              className="header-search-input"
              placeholder="Search favorites..."
              value={localSearch}
              onChange={(e) => setLocalSearch(e.target.value)}
            />
          </div>

          {/* Sort Selector */}
          <CustomSelect
            value={sortBy}
            options={sortOptions}
            onChange={handleSortByChange}
            style={{ width: '135px' }}
          />

          {/* Segmented View Mode Switcher */}
          <div className="segmented-view-switcher">
            <button 
              className={`segmented-btn ${viewMode === 'grid' ? 'active' : ''}`}
              onClick={() => handleViewModeChange('grid')}
              title="Grid View"
            >
              <Grid size={13} />
            </button>
            <button 
              className={`segmented-btn ${viewMode === 'list' ? 'active' : ''}`}
              onClick={() => handleViewModeChange('list')}
              title="List View"
            >
              <List size={13} />
            </button>
          </div>

          {/* New Note Button */}
          {onCreateNote && (
            <button 
              className="primary-action-btn" 
              onClick={() => onCreateNote()}
            >
              <Plus size={14} />
              <span>New Note</span>
            </button>
          )}
        </div>
      </div>

      {/* Multi-Select Batch Action Bar */}
      {selectedNoteIds.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 16px', background: 'rgba(38, 132, 252, 0.1)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', marginBottom: '16px' }}>
          <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>
            Selected {selectedNoteIds.length} {selectedNoteIds.length === 1 ? 'note' : 'notes'}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '0.74rem', color: 'var(--text-secondary)' }}>Set Sync Mode:</span>
            <button className="btn-secondary" style={{ padding: '3px 10px', fontSize: '0.72rem' }} onClick={() => handleBatchSyncModeChange('local')}>
              ○ Local
            </button>
            <button className="btn-secondary" style={{ padding: '3px 10px', fontSize: '0.72rem', color: '#2684fc' }} onClick={() => handleBatchSyncModeChange('cloud')}>
              ☁ Cloud
            </button>
            <button className="btn-secondary" style={{ padding: '3px 10px', fontSize: '0.72rem', color: 'var(--accent-emerald)' }} onClick={() => handleBatchSyncModeChange('lan')}>
              ↔ LAN
            </button>
            <button className="icon-btn-ghost" style={{ padding: '4px' }} onClick={() => setSelectedNoteIds([])} title="Deselect All">
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Favorites Content */}
      <div className="file-explorer-viewport">
        {sortedNotes.length === 0 ? (
          <div className="empty-file-tile-box" style={{ padding: '60px 20px', textAlign: 'center' }}>
            <Star size={38} className="empty-icon" style={{ color: '#eab308', opacity: 0.6, margin: '0 auto 12px auto' }} />
            <h3 style={{ fontSize: '1.05rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '6px' }}>
              No favorites yet
            </h3>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', maxWidth: '320px', margin: '0 auto 18px auto' }}>
              Star notes to quickly access them here.
            </p>
            <button
              className="secondary-action-btn"
              onClick={() => navigate('/notes')}
              style={{ margin: '0 auto' }}
            >
              <FileText size={14} />
              <span>Browse Notes</span>
            </button>
          </div>
        ) : (
          <div className={viewMode === 'grid' ? 'wide-tile-grid' : 'file-list-view'}>
            {sortedNotes.map((note) => {
              const notePath = getNotePath(note, notebooks);
              const isSelected = selectedNoteIds.includes(note.id);
              const isMenuOpen = activeMenuKey === `fav-card-${note.id}`;
              const currentMode = (note.sync_mode === 'google' || note.sync_mode === 'cloud') ? 'cloud' : (note.sync_mode || 'local');

              return (
                <div 
                  key={`fav-card-${note.id}`}
                  className={`wide-file-tile note-tile ${viewMode === 'list' ? 'list-row' : ''} ${isSelected ? 'selected' : ''} ${isMenuOpen ? 'menu-active' : ''}`}
                  onClick={() => navigate(`/notes/${note.id}`)}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/plain', note.id);
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  style={{
                    border: isSelected ? '1px solid var(--accent-primary)' : undefined,
                    background: isSelected ? 'rgba(38, 132, 252, 0.06)' : undefined
                  }}
                >
                  <div className="wide-tile-left" onClick={(e) => toggleSelectNote(e, note.id)}>
                    {isSelected ? (
                      <CheckSquare size={18} style={{ color: 'var(--accent-primary)' }} />
                    ) : (
                      <FileText size={18} className="wide-file-icon" />
                    )}
                  </div>

                  <div className="wide-tile-center">
                    <div className="wide-title-row">
                      <h4 className="wide-tile-title" title={note.title || 'Untitled Note'}>
                        {note.title || 'Untitled Note'}
                      </h4>
                      <button 
                        type="button"
                        className="tile-star-btn pinned"
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleFavorite && onToggleFavorite(note);
                        }}
                        title="Unpin from Favorites (★)"
                        aria-label="Unpin note from favorites"
                      >
                        <Star 
                          size={12} 
                          style={{ 
                            color: '#eab308',
                            fill: '#eab308'
                          }} 
                        />
                      </button>
                    </div>
                    <div className="wide-tile-subtext" style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <span>Updated {formatRelativeTime(note.updated_at)}</span>
                      <span>•</span>
                      <span className="wide-tile-path">{notePath}</span>
                      <span>•</span>
                      <NoteSyncBadge 
                        note={note} 
                        onClick={(e) => {
                          e.stopPropagation();
                          const nextMode = currentMode === 'local' ? 'cloud' : (currentMode === 'cloud' ? 'lan' : 'local');
                          setSyncModeModalState({ isOpen: true, note, targetMode: nextMode });
                        }} 
                      />
                    </div>
                  </div>

                  <div className="wide-tile-right" onClick={(e) => e.stopPropagation()}>
                    <button 
                      className="icon-btn-ghost tile-menu-btn" 
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveMenuKey(isMenuOpen ? null : `fav-card-${note.id}`);
                      }}
                    >
                      <MoreVertical size={14} />
                    </button>

                    {isMenuOpen && (
                      <div className="tile-dropdown-popover">
                        <button className="dropdown-item-btn" onClick={() => navigate(`/notes/${note.id}`)}>
                          <FileText size={13} />
                          <span>Open</span>
                        </button>
                        <button className="dropdown-item-btn" onClick={() => { setActiveMenuKey(null); handleRenameNote(note); }}>
                          <Edit2 size={13} />
                          <span>Rename</span>
                        </button>
                        <button className="dropdown-item-btn" onClick={() => { setActiveMenuKey(null); setMoveNoteTarget(note); }}>
                          <FolderInput size={13} />
                          <span>Move</span>
                        </button>
                        <button 
                          className="dropdown-item-btn" 
                          onClick={(e) => {
                            e.stopPropagation();
                            if (note?.file_path) {
                              navigator.clipboard.writeText(note.file_path);
                            }
                            setActiveMenuKey(null);
                          }}
                        >
                          <Copy size={13} />
                          <span>Copy Local Path</span>
                        </button>
                        <button className="dropdown-item-btn" onClick={() => { setActiveMenuKey(null); handleDuplicateNote(note); }}>
                          <Copy size={13} />
                          <span>Duplicate</span>
                        </button>
                        <div style={{ borderTop: '1px solid var(--border-subtle)', margin: '4px 0' }} />
                        <button 
                          className="dropdown-item-btn" 
                          onClick={() => {
                            setActiveMenuKey(null);
                            onToggleFavorite && onToggleFavorite(note);
                          }}
                        >
                          <Star size={13} style={{ color: '#eab308', fill: '#eab308' }} />
                          <span>Unpin from Favorites</span>
                        </button>
                        <button 
                          className="dropdown-item-btn danger" 
                          onClick={() => {
                            setActiveMenuKey(null);
                            onRequestDeleteNote && onRequestDeleteNote(note);
                          }}
                        >
                          <Trash2 size={13} />
                          <span>Delete</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Sync Mode Confirmation Modal */}
      <SyncModeModal
        isOpen={syncModeModalState.isOpen}
        note={syncModeModalState.note}
        targetMode={syncModeModalState.targetMode}
        onClose={() => setSyncModeModalState({ isOpen: false, note: null, targetMode: null })}
        onConfirm={(noteId, mode) => {
          if (onUpdateNote) onUpdateNote(noteId, { sync_mode: mode });
        }}
      />

      {/* Move Note Modal */}
      <MoveNoteModal
        isOpen={!!moveNoteTarget}
        note={moveNoteTarget}
        onClose={() => setMoveNoteTarget(null)}
        notebooks={notebooks}
        onMoveNote={handleMoveNote}
      />
    </div>
  );
}
