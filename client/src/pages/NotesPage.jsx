import React, { useState, useMemo } from 'react';
import { useNavigate, useParams } from '../utils/router';
import { 
  FileText, 
  Folder, 
  Plus, 
  Search, 
  Star, 
  MoreVertical, 
  Grid, 
  List, 
  ChevronRight, 
  ArrowLeft,
  Trash2, 
  FolderPlus, 
  FolderInput, 
  Edit2, 
  Copy, 
  CheckSquare, 
  X 
} from 'lucide-react';
import { formatRelativeTime } from '../utils/timeUtils';
import { getNotePath, getNotebookPath } from '../utils/pathUtils';
import CustomSelect from '../components/CustomSelect';
import CreateNoteModal from '../components/CreateNoteModal';
import MoveNoteModal from '../components/MoveNoteModal';
import DeleteNotebookModal from '../components/DeleteNotebookModal';
import SyncModeModal from '../components/SyncModeModal';
import { NoteSyncBadge } from '../components/NoteListColumn';

export default function NotesPage({ 
  notes = [], 
  notebooks = [], 
  folderId: propFolderId,
  onCreateNote, 
  onToggleFavorite, 
  onRequestDeleteNote, 
  searchQuery = '', 
  onCreateNotebook, 
  onDeleteNotebook, 
  onUpdateNote 
}) {
  const navigate = useNavigate();
  const params = useParams();

  // Active folder is determined by route param or prop (null = root)
  const currentFolderId = propFolderId !== undefined ? propFolderId : (params.folderId || null);

  const [localSearch, setLocalSearch] = useState('');
  const [activeMenuKey, setActiveMenuKey] = useState(null); // 'folder-id' or 'note-id'

  // Persisted UI preferences via localStorage
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
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [moveNoteTarget, setMoveNoteTarget] = useState(null);
  const [deleteNotebookTarget, setDeleteNotebookTarget] = useState(null);
  const [dragOverFolderId, setDragOverFolderId] = useState(null);

  // Multi-select & Sync Mode states
  const [selectedNoteIds, setSelectedNoteIds] = useState([]);
  const [syncModeModalState, setSyncModeModalState] = useState({ isOpen: false, note: null, targetMode: null });

  const handleRequestSyncModeChange = (note, targetMode) => {
    setSyncModeModalState({ isOpen: true, note, targetMode });
  };

  const handleConfirmSyncModeChange = (noteId, mode) => {
    if (onUpdateNote) {
      onUpdateNote(noteId, { sync_mode: mode });
    }
  };

  const handleBatchSyncModeChange = (mode) => {
    selectedNoteIds.forEach((id) => {
      if (onUpdateNote) onUpdateNote(id, { sync_mode: mode });
    });
    setSelectedNoteIds([]);
  };

  const toggleSelectNote = (e, noteId) => {
    e.stopPropagation();
    setSelectedNoteIds((prev) => 
      prev.includes(noteId) ? prev.filter((id) => id !== noteId) : [...prev, noteId]
    );
  };

  // Current folder object
  const currentFolder = useMemo(() => {
    if (!currentFolderId) return null;
    return notebooks.find((nb) => nb.id === currentFolderId) || null;
  }, [notebooks, currentFolderId]);

  // Clickable Breadcrumbs Chain (Hierarchy)
  const breadcrumbChain = useMemo(() => {
    if (!currentFolderId) return [];
    const chain = [];
    let curr = notebooks.find((nb) => nb.id === currentFolderId);
    const visited = new Set();
    while (curr && !visited.has(curr.id)) {
      visited.add(curr.id);
      chain.unshift(curr);
      if (curr.parent_id) {
        curr = notebooks.find((nb) => nb.id === curr.parent_id);
      } else {
        break;
      }
    }
    return chain;
  }, [notebooks, currentFolderId]);

  // Back button handler
  const handleGoBack = () => {
    if (breadcrumbChain.length > 1) {
      const parentFolder = breadcrumbChain[breadcrumbChain.length - 2];
      navigate(`/notes/folder/${parentFolder.id}`);
    } else {
      navigate('/notes');
    }
  };

  // Combined Search filter
  const activeSearch = (localSearch || searchQuery).trim().toLowerCase();

  // Filter notes by current folder and search query
  const folderNotes = useMemo(() => {
    return notes.filter((n) => {
      if (activeSearch) {
        const titleMatch = n.title && n.title.toLowerCase().includes(activeSearch);
        const contentMatch = n.content && n.content.toLowerCase().includes(activeSearch);
        return titleMatch || contentMatch;
      }
      if (!currentFolderId) {
        return !n.notebook_id; // root notes
      }
      return n.notebook_id === currentFolderId;
    });
  }, [notes, currentFolderId, activeSearch]);

  // Sort notes
  const sortedNotes = useMemo(() => {
    return [...folderNotes].sort((a, b) => {
      if (sortBy === 'name') {
        return (a.title || '').localeCompare(b.title || '');
      }
      if (sortBy === 'created') {
        return new Date(b.created_at || 0) - new Date(a.created_at || 0);
      }
      return new Date(b.updated_at || 0) - new Date(a.updated_at || 0);
    });
  }, [folderNotes, sortBy]);

  // Folders to display at this level
  const displayFolders = useMemo(() => {
    if (activeSearch) return [];
    if (!currentFolderId) {
      // Root folders: any folder with no parent_id
      return notebooks.filter((nb) => !nb.parent_id);
    }
    // Subfolders: child folders whose parent_id matches currentFolderId
    return notebooks.filter((nb) => nb.parent_id === currentFolderId);
  }, [notebooks, currentFolderId, activeSearch]);

  // Count notes inside a folder
  const getFolderNoteCount = (folderId) => {
    return notes.filter((n) => n.notebook_id === folderId).length;
  };

  // Shared note move handler
  const handleMoveNote = (noteId, targetNotebookId) => {
    if (onUpdateNote) {
      onUpdateNote(noteId, { notebook_id: targetNotebookId });
    }
  };

  // Rename note handler
  const handleRenameNote = (note) => {
    const newTitle = prompt('Enter new note title:', note.title || '');
    if (newTitle && newTitle.trim() && newTitle.trim() !== note.title) {
      if (onUpdateNote) {
        onUpdateNote(note.id, { title: newTitle.trim() });
      }
    }
  };

  // Duplicate note handler
  const handleDuplicateNote = (note) => {
    if (onCreateNote) {
      onCreateNote(`${note.title || 'Untitled'} (Copy)`, note.notebook_id);
    }
  };

  // Rename Notebook handler
  const handleRenameNotebook = (folder) => {
    const newName = prompt('Enter new notebook name:', folder.name || '');
    if (newName && newName.trim() && newName.trim() !== folder.name) {
      import('../api/notebooksApi').then(({ notebooksApi }) => {
        notebooksApi.rename(folder.id, newName.trim()).then(() => {
          window.dispatchEvent(new CustomEvent('syncnote:notes-updated'));
        }).catch(err => {
          console.error('[Notebook Rename Error]', err);
        });
      }).catch(err => {
        console.error('[Notebook Rename Import Error]', err);
      });
    }
  };

  // Safe Notebook Deletion
  const handleDeleteNotebookClick = (folder) => {
    setDeleteNotebookTarget(folder);
  };

  const confirmDeleteNotebookWithNotes = (folderId) => {
    if (onDeleteNotebook) onDeleteNotebook(folderId);
    if (currentFolderId === folderId) {
      navigate('/notes');
    }
  };

  // Drag & Drop handlers
  const handleDragOverFolder = (e, folderId) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverFolderId !== folderId) {
      setDragOverFolderId(folderId);
    }
  };

  const handleDropOnFolder = (e, targetFolderId) => {
    e.preventDefault();
    setDragOverFolderId(null);
    const noteId = e.dataTransfer.getData('text/plain');
    if (noteId) {
      handleMoveNote(noteId, targetFolderId);
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
          {/* Breadcrumb Navigation Bar */}
          <div className="breadcrumb-nav-bar" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {currentFolder && (
              <button 
                type="button"
                className="icon-btn-ghost back-nav-btn"
                onClick={handleGoBack}
                title="Go back"
                style={{
                  marginRight: '6px',
                  padding: '4px 8px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  color: 'var(--text-secondary)',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-subtle)',
                  background: 'var(--bg-surface)'
                }}
              >
                <ArrowLeft size={13} />
                <span>Back</span>
              </button>
            )}

            <span 
              className={`breadcrumb-item ${!currentFolder ? 'active' : ''}`}
              onClick={() => navigate('/notes')}
              style={{ cursor: currentFolder ? 'pointer' : 'default' }}
            >
              Notes
            </span>

            {breadcrumbChain.map((crumb, idx) => {
              const isLast = idx === breadcrumbChain.length - 1;
              return (
                <React.Fragment key={crumb.id}>
                  <ChevronRight size={13} className="breadcrumb-separator" />
                  <span 
                    className={`breadcrumb-item ${isLast ? 'active' : ''}`}
                    onClick={() => !isLast && navigate(`/notes/folder/${crumb.id}`)}
                    style={{ cursor: isLast ? 'default' : 'pointer' }}
                  >
                    {crumb.name}
                  </span>
                </React.Fragment>
              );
            })}
          </div>

          <p className="page-subheading">
            {currentFolder ? `Folder: ${currentFolder.name}` : 'Your workspace file explorer'}
          </p>
        </div>

        <div className="page-header-actions">
          {/* Search Box */}
          <div className="header-search-box">
            <Search size={13} className="search-icon" />
            <input
              type="text"
              className="header-search-input"
              placeholder={currentFolder ? `Search in ${currentFolder.name}...` : 'Search notes...'}
              value={localSearch}
              onChange={(e) => setLocalSearch(e.target.value)}
            />
          </div>

          {/* Custom Select Sort Selector */}
          <CustomSelect
            value={sortBy}
            options={sortOptions}
            onChange={handleSortByChange}
            style={{ width: '135px' }}
          />

          {/* Compact Segmented View Mode Switcher */}
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

          {/* Create Folder Button */}
          {onCreateNotebook && (
            <button 
              className="secondary-action-btn"
              onClick={() => {
                const name = prompt(currentFolder ? `Enter new subfolder name inside "${currentFolder.name}":` : 'Enter new notebook name:');
                if (name && name.trim()) {
                  onCreateNotebook(name.trim(), currentFolderId);
                }
              }}
              title={currentFolder ? 'New Subfolder' : 'New Notebook'}
            >
              <FolderPlus size={14} />
              <span>{currentFolder ? 'New Subfolder' : 'New Notebook'}</span>
            </button>
          )}

          {/* New Note Button (Primary Action) */}
          <button 
            className="primary-action-btn" 
            onClick={() => {
              setIsCreateModalOpen(true);
            }}
          >
            <Plus size={14} />
            <span>New Note</span>
          </button>
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

      {/* Main File Explorer Viewport */}
      <div className="file-explorer-viewport">

        {/* 1. FOLDERS / SUBFOLDERS SECTION */}
        {displayFolders.length > 0 && (
          <div className="explorer-section">
            <div className="explorer-section-header">
              <div className="section-title-group">
                <Folder size={13} className="section-header-icon folder" />
                <span className="section-title-text">
                  {currentFolder ? 'Subfolders' : 'Folders / Notebooks'}
                </span>
              </div>
              <span className="section-count-badge">{displayFolders.length}</span>
            </div>

            <div className={viewMode === 'grid' ? 'wide-tile-grid' : 'file-list-view'}>
              {displayFolders.map((folder) => {
                const count = getFolderNoteCount(folder.id);
                const isDragOver = dragOverFolderId === folder.id;

                return (
                  <FolderTile
                    key={`folder-${folder.id}`}
                    folder={folder}
                    noteCount={count}
                    viewMode={viewMode}
                    isDragOver={isDragOver}
                    onOpen={() => navigate(`/notes/folder/${folder.id}`)}
                    onRename={() => { handleRenameNotebook(folder); setActiveMenuKey(null); }}
                    onDelete={() => handleDeleteNotebookClick(folder)}
                    onDragOver={(e) => handleDragOverFolder(e, folder.id)}
                    onDragLeave={() => setDragOverFolderId(null)}
                    onDrop={(e) => handleDropOnFolder(e, folder.id)}
                    isMenuOpen={activeMenuKey === `folder-${folder.id}`}
                    onToggleMenu={(e) => {
                      e.stopPropagation();
                      setActiveMenuKey(activeMenuKey === `folder-${folder.id}` ? null : `folder-${folder.id}`);
                    }}
                  />
                );
              })}
            </div>
          </div>
        )}

        {/* 2. NOTES SECTION */}
        <div className="explorer-section">
          <div className="explorer-section-header">
            <div className="section-title-group">
              <FileText size={13} className="section-header-icon file" />
              <span className="section-title-text">
                {currentFolder ? `${currentFolder.name} Notes` : 'Notes'}
              </span>
            </div>
            <span className="section-count-badge">{sortedNotes.length}</span>
          </div>

          {sortedNotes.length === 0 ? (
            <div className="empty-file-tile-box">
              <FileText size={32} className="empty-icon" />
              <h3>{currentFolder ? 'No notes in this folder yet.' : 'No notes in root workspace.'}</h3>
              <p>Create your first note to start writing in Markdown.</p>
              <button 
                className="primary-action-btn" 
                onClick={() => {
                  setIsCreateModalOpen(true);
                }} 
                style={{ marginTop: '12px' }}
              >
                <Plus size={14} />
                <span>New Note</span>
              </button>
            </div>
          ) : (
            <div className={viewMode === 'grid' ? 'wide-tile-grid' : 'file-list-view'}>
              {sortedNotes.map((note) => (
                <NoteTile 
                  key={`note-${note.id}`}
                  note={note}
                  notebooks={notebooks}
                  viewMode={viewMode}
                  isSelected={selectedNoteIds.includes(note.id)}
                  onToggleSelect={(e) => toggleSelectNote(e, note.id)}
                  onRequestSyncModeChange={handleRequestSyncModeChange}
                  onOpen={() => navigate(`/notes/${note.id}`)}
                  onToggleFavorite={() => onToggleFavorite(note)}
                  onRename={() => handleRenameNote(note)}
                  onDuplicate={() => handleDuplicateNote(note)}
                  onMoveNote={() => setMoveNoteTarget(note)}
                  onDelete={() => onRequestDeleteNote(note)}
                  isMenuOpen={activeMenuKey === `note-${note.id}`}
                  onToggleMenu={(e) => {
                    e.stopPropagation();
                    setActiveMenuKey(activeMenuKey === `note-${note.id}` ? null : `note-${note.id}`);
                  }}
                />
              ))}
            </div>
          )}
        </div>

      </div>

      {/* Sync Mode Change Confirmation Modal */}
      <SyncModeModal
        isOpen={syncModeModalState.isOpen}
        note={syncModeModalState.note}
        targetMode={syncModeModalState.targetMode}
        onClose={() => setSyncModeModalState({ isOpen: false, note: null, targetMode: null })}
        onConfirm={handleConfirmSyncModeChange}
      />

      {/* Shared Modals */}
      <CreateNoteModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onCreate={async (data) => {
          if (onCreateNote) {
            return await onCreateNote(data.title, data.notebook_id || currentFolderId);
          }
        }}
        notebooks={notebooks}
        defaultNotebookId={currentFolderId}
      />

      <MoveNoteModal
        isOpen={!!moveNoteTarget}
        note={moveNoteTarget}
        onClose={() => setMoveNoteTarget(null)}
        notebooks={notebooks}
        onMoveNote={handleMoveNote}
      />

      <DeleteNotebookModal
        isOpen={!!deleteNotebookTarget}
        notebook={deleteNotebookTarget}
        noteCount={deleteNotebookTarget ? getFolderNoteCount(deleteNotebookTarget.id) : 0}
        onClose={() => setDeleteNotebookTarget(null)}
        onConfirmDelete={confirmDeleteNotebookWithNotes}
      />
    </div>
  );
}

/* ==========================================================================
   WIDE HORIZONTAL FOLDER TILE COMPONENT
   ========================================================================== */
function FolderTile({ 
  folder, 
  noteCount, 
  viewMode, 
  isDragOver,
  onOpen,
  onRename,
  onDelete, 
  onDragOver, 
  onDragLeave, 
  onDrop,
  isMenuOpen, 
  onToggleMenu 
}) {
  return (
    <div 
      className={`wide-file-tile folder-tile ${viewMode === 'list' ? 'list-row' : ''} ${isDragOver ? 'drag-over' : ''} ${isMenuOpen ? 'menu-active' : ''}`}
      onClick={onOpen}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="wide-tile-left">
        <Folder size={20} className="wide-folder-icon" />
      </div>

      <div className="wide-tile-center">
        <h4 className="wide-tile-title">{folder.name}</h4>
        <div className="wide-tile-subtext">
          <span>{noteCount} {noteCount === 1 ? 'note' : 'notes'}</span>
          <span>•</span>
          <span className="wide-tile-path">{getNotebookPath(folder)}</span>
        </div>
      </div>

      {isDragOver && (
        <div className="drag-over-overlay">
          <span>Drop note here</span>
        </div>
      )}

      <div className="wide-tile-right" onClick={(e) => e.stopPropagation()}>
        <button className="icon-btn-ghost tile-menu-btn" onClick={onToggleMenu}>
          <MoreVertical size={14} />
        </button>

        {isMenuOpen && (
          <div className="tile-dropdown-popover">
            <button className="dropdown-item-btn" onClick={() => { onOpen(); }}>
              <Folder size={13} />
              <span>Open</span>
            </button>
            {onRename && (
              <button className="dropdown-item-btn" onClick={() => { onRename(); }}>
                <Edit2 size={13} />
                <span>Rename</span>
              </button>
            )}
            {onDelete && (
              <button className="dropdown-item-btn danger" onClick={() => { onDelete(); }}>
                <Trash2 size={13} />
                <span>Delete</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ==========================================================================
   WIDE HORIZONTAL NOTE TILE COMPONENT
   ========================================================================== */
function NoteTile({ 
  note, 
  notebooks = [],
  viewMode, 
  isSelected,
  onToggleSelect,
  onRequestSyncModeChange,
  onOpen, 
  onToggleFavorite, 
  onRename,
  onDuplicate,
  onMoveNote,
  onDelete, 
  isMenuOpen, 
  onToggleMenu 
}) {
  const notePath = getNotePath(note, notebooks);

  const handleDragStart = (e) => {
    e.dataTransfer.setData('text/plain', note.id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const currentMode = (note.sync_mode === 'google' || note.sync_mode === 'cloud') ? 'cloud' : (note.sync_mode || 'local');

  return (
    <div 
      className={`wide-file-tile note-tile ${viewMode === 'list' ? 'list-row' : ''} ${isSelected ? 'selected' : ''} ${isMenuOpen ? 'menu-active' : ''}`}
      onClick={onOpen}
      draggable
      onDragStart={handleDragStart}
      style={{
        border: isSelected ? '1px solid var(--accent-primary)' : undefined,
        background: isSelected ? 'rgba(38, 132, 252, 0.06)' : undefined
      }}
    >
      <div className="wide-tile-left" onClick={(e) => { e.stopPropagation(); onToggleSelect && onToggleSelect(e); }}>
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
            className={`tile-star-btn ${note.is_favorite ? 'pinned' : ''}`}
            onClick={(e) => { e.stopPropagation(); onToggleFavorite && onToggleFavorite(note); }}
            title={note.is_favorite ? 'Pinned to Favorites (Click to unpin ★)' : 'Pin to Favorites (☆)'}
            aria-label={note.is_favorite ? 'Unpin note from favorites' : 'Pin note to favorites'}
          >
            <Star 
              size={12} 
              style={{ 
                color: note.is_favorite ? '#eab308' : 'var(--text-muted)',
                fill: note.is_favorite ? '#eab308' : 'none'
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
              onRequestSyncModeChange && onRequestSyncModeChange(note, nextMode);
            }} 
          />
        </div>
      </div>

      <div className="wide-tile-right" onClick={(e) => e.stopPropagation()}>
        <button className="icon-btn-ghost tile-menu-btn" onClick={onToggleMenu}>
          <MoreVertical size={14} />
        </button>

        {isMenuOpen && (
          <div className="tile-dropdown-popover">
            <button className="dropdown-item-btn" onClick={onOpen}>
              <FileText size={13} />
              <span>Open</span>
            </button>
            <button className="dropdown-item-btn" onClick={onRename}>
              <Edit2 size={13} />
              <span>Rename</span>
            </button>
            <button className="dropdown-item-btn" onClick={onMoveNote}>
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
                onToggleMenu && onToggleMenu(e);
              }}
            >
              <Copy size={13} />
              <span>Copy Local Path</span>
            </button>
            <button className="dropdown-item-btn" onClick={onDuplicate}>
              <Copy size={13} />
              <span>Duplicate</span>
            </button>
            <div style={{ padding: '4px 8px', fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-muted)', borderTop: '1px solid var(--border-subtle)', marginTop: '4px' }}>
              SYNC MODE
            </div>
            <button 
              className={`dropdown-item-btn ${currentMode === 'local' ? 'active' : ''}`} 
              onClick={() => onRequestSyncModeChange && onRequestSyncModeChange(note, 'local')}
            >
              <span>○ Set Local</span>
            </button>
            <button 
              className={`dropdown-item-btn ${currentMode === 'cloud' ? 'active' : ''}`} 
              onClick={() => onRequestSyncModeChange && onRequestSyncModeChange(note, 'cloud')}
            >
              <span>☁ Set Cloud (Drive)</span>
            </button>
            <button 
              className={`dropdown-item-btn ${currentMode === 'lan' ? 'active' : ''}`} 
              onClick={() => onRequestSyncModeChange && onRequestSyncModeChange(note, 'lan')}
            >
              <span>↔ Set LAN Sync</span>
            </button>
            <div style={{ borderTop: '1px solid var(--border-subtle)', margin: '4px 0' }} />
            <button className="dropdown-item-btn" onClick={onToggleFavorite}>
              <Star 
                size={13} 
                style={{ 
                  color: note.is_favorite ? '#eab308' : 'inherit',
                  fill: note.is_favorite ? '#eab308' : 'none'
                }} 
              />
              <span>{note.is_favorite ? 'Unpin from Favorites' : 'Pin to Favorites'}</span>
            </button>
            <button className="dropdown-item-btn danger" onClick={onDelete}>
              <Trash2 size={13} />
              <span>Delete</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
