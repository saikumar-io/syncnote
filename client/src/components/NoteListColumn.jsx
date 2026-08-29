import React, { useState } from 'react';
import NoteContextMenu from './NoteContextMenu';
import { formatRelativeTime } from '../utils/timeUtils';
import { 
  FileText, 
  Plus, 
  Search,
  PanelLeftClose,
  PanelLeftOpen,
  Star,
  BookOpen,
  MoreVertical,
  MoreHorizontal
} from 'lucide-react';

export default function NoteListColumn({ 
  notes = [],
  notebooks = [],
  selectedNoteId,
  selectedNotebookId,
  activeNav,
  searchQuery,
  onSelectNote,
  onCreateNote,
  onRenameNote,
  onFavoriteNote,
  onMoveToNotebook,
  onDeleteNote,
  isCollapsed = false,
  onToggleCollapse
}) {
  const [contextMenu, setContextMenu] = useState({ isOpen: false, x: 0, y: 0, note: null });

  // Filter notes based on activeNav view & search query
  const filteredNotes = notes.filter((n) => {
    // 1. Notebook filter
    if (selectedNotebookId && n.notebook_id !== selectedNotebookId) {
      return false;
    }

    // 2. Navigation tab filter
    if (activeNav === 'favorites' && !n.is_favorite) return false;
    
    // 3. Search query filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchTitle = n.title && n.title.toLowerCase().includes(q);
      const matchContent = n.content && n.content.toLowerCase().includes(q);
      return matchTitle || matchContent;
    }

    return true;
  });

  const getNotebookName = (notebookId) => {
    const nb = notebooks.find((item) => item.id === notebookId);
    return nb ? nb.name : null;
  };

  const getHeaderTitle = () => {
    if (selectedNotebookId) {
      const nb = notebooks.find((item) => item.id === selectedNotebookId);
      return nb ? nb.name : 'Notebook';
    }
    if (activeNav === 'favorites') return 'Favorites';
    if (activeNav === 'recent') return 'Recent Notes';
    return 'All Notes';
  };

  const handleContextMenu = (e, note) => {
    e.preventDefault();
    setContextMenu({
      isOpen: true,
      x: e.clientX,
      y: e.clientY,
      note
    });
  };

  const closeContextMenu = () => {
    setContextMenu({ isOpen: false, x: 0, y: 0, note: null });
  };

  // Render Collapsed Mini-Strip View
  if (isCollapsed) {
    return (
      <aside className="note-list-pane collapsed" style={{ width: '38px', minWidth: '38px', alignItems: 'center', padding: '8px 0' }}>
        <button
          className="toolbar-btn"
          onClick={onToggleCollapse}
          title="Expand Note Explorer"
          style={{ width: '28px', height: '28px', borderRadius: 'var(--radius-sm)' }}
        >
          <PanelLeftOpen size={15} />
        </button>

        <div style={{ height: '1px', width: '20px', background: 'var(--border-subtle)', margin: '8px 0' }} />

        {/* Quick New Note Button */}
        <button
          className="toolbar-btn"
          onClick={onCreateNote}
          title="New Note"
          style={{ width: '28px', height: '28px', borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)' }}
        >
          <Plus size={15} />
        </button>

        {/* Note Icons Mini List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '10px', overflowY: 'auto', width: '100%', alignItems: 'center' }}>
          {filteredNotes.slice(0, 10).map((note) => (
            <button
              key={note.id}
              onClick={() => onSelectNote(note.id)}
              title={note.title || 'Untitled'}
              style={{
                width: '26px',
                height: '26px',
                borderRadius: 'var(--radius-sm)',
                border: 'none',
                background: selectedNoteId === note.id ? 'var(--bg-active)' : 'transparent',
                color: selectedNoteId === note.id ? 'var(--accent-primary)' : 'var(--text-muted)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <FileText size={13} />
            </button>
          ))}
        </div>
      </aside>
    );
  }

  // Render Full Expanded View
  return (
    <aside className="note-list-pane">
      {/* List Header */}
      <div className="note-list-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-primary)' }}>
            {getHeaderTitle()}
          </span>
          <span className="badge-count">({filteredNotes.length})</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
          <button 
            className="toolbar-btn"
            onClick={onCreateNote}
            title="New Note (+)"
          >
            <Plus size={14} />
          </button>
          
          <button 
            className="toolbar-btn"
            onClick={onToggleCollapse}
            title="Collapse Note Explorer"
          >
            <PanelLeftClose size={14} />
          </button>
        </div>
      </div>

      {/* Note List Scroll View */}
      <div className="note-list-items">
        {filteredNotes.length === 0 ? (
          <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--text-muted)' }}>
            <FileText size={24} style={{ margin: '0 auto 8px auto', display: 'block', opacity: 0.4 }} />
            <p style={{ fontSize: '0.78rem' }}>
              {searchQuery ? 'No matching notes found' : 'No notes in this view'}
            </p>
          </div>
        ) : (
          filteredNotes.map((note) => {
            const isSelected = selectedNoteId === note.id;
            const isDraft = note.id === 'draft';
            const notebookName = getNotebookName(note.notebook_id);

            return (
              <div
                key={note.id}
                className={`note-item-card ${isSelected ? 'active' : ''}`}
                onClick={() => onSelectNote(note.id)}
                onContextMenu={(e) => handleContextMenu(e, note)}
              >
                <div className="note-item-title-row">
                  <span className="note-item-title" style={{ fontStyle: isDraft ? 'italic' : 'normal' }}>
                    {isDraft ? '[Draft] ' : ''}{note.title || 'Untitled'}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    {note.is_favorite && <Star size={11} style={{ color: 'var(--accent-warning)', fill: 'var(--accent-warning)' }} />}
                    <button
                      className="more-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleContextMenu(e, note);
                      }}
                    >
                      <MoreHorizontal size={13} />
                    </button>
                  </div>
                </div>

                <div className="note-item-snippet">
                  {note.content ? note.content.substring(0, 80) : 'Empty note'}
                </div>

                <div className="note-item-meta">
                  <span>{formatRelativeTime(note.updated_at)}</span>
                  {notebookName && (
                    <span style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                      <BookOpen size={10} />
                      {notebookName}
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Context Menu */}
      <NoteContextMenu
        note={contextMenu.note}
        isOpen={contextMenu.isOpen}
        position={{ x: contextMenu.x, y: contextMenu.y }}
        onClose={closeContextMenu}
        onRename={() => onRenameNote(contextMenu.note)}
        onFavorite={() => onFavoriteNote(contextMenu.note)}
        onMoveToNotebook={() => onMoveToNotebook(contextMenu.note)}
        onDelete={() => onDeleteNote(contextMenu.note)}
      />
    </aside>
  );
}
