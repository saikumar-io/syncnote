import React, { useState } from 'react';
import { 
  Folder, 
  FolderPlus, 
  ChevronRight, 
  ChevronDown, 
  FileText, 
  Star, 
  MoreVertical, 
  Plus, 
  Edit2, 
  Trash2 
} from 'lucide-react';
import { useNavigate } from '../utils/router';

export default function FolderTree({ 
  notes = [], 
  notebooks = [], 
  activeNoteId, 
  onCreateNote, 
  onToggleFavorite, 
  onCreateFolder, 
  onRenameFolder, 
  onDeleteFolder,
  onMoveNote
}) {
  const navigate = useNavigate();
  const [collapsedFolders, setCollapsedFolders] = useState({});
  const [collapsedSections, setCollapsedSections] = useState({
    favorites: false,
    folders: false,
    notes: false
  });
  const [editingFolderId, setEditingFolderId] = useState(null);
  const [editingName, setEditingName] = useState('');
  const [showNewFolderInput, setShowNewFolderInput] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  const toggleFolder = (folderId) => {
    setCollapsedFolders((prev) => ({ ...prev, [folderId]: !prev[folderId] }));
  };

  const toggleSection = (sectionKey) => {
    setCollapsedSections((prev) => ({ ...prev, [sectionKey]: !prev[sectionKey] }));
  };

  const handleCreateFolderSubmit = (e) => {
    e.preventDefault();
    if (newFolderName.trim() && onCreateFolder) {
      onCreateFolder(newFolderName.trim());
      setNewFolderName('');
      setShowNewFolderInput(false);
    }
  };

  const handleRenameSubmit = (folderId) => {
    if (editingName.trim() && onRenameFolder) {
      onRenameFolder(folderId, editingName.trim());
      setEditingFolderId(null);
    }
  };

  const favorites = notes.filter((n) => n.is_favorite);

  return (
    <div className="folder-tree-container">
      {/* 1. Favorites Section */}
      {favorites.length > 0 && (
        <div className="tree-section">
          <div 
            className="tree-section-header"
            onClick={() => toggleSection('favorites')}
          >
            <div className="section-title-left">
              {collapsedSections.favorites ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
              <Star size={12} className="star-icon" />
              <span>Favorites</span>
            </div>
            <span className="section-count">{favorites.length}</span>
          </div>

          {!collapsedSections.favorites && (
            <div className="tree-section-body">
              {favorites.map((note) => (
                <div
                  key={note.id}
                  className={`tree-note-item ${note.id === activeNoteId ? 'active' : ''}`}
                  onClick={() => navigate(`/notes/${note.id}`)}
                >
                  <FileText size={13} className="tree-icon" />
                  <span className="tree-label">{note.title || 'Untitled Note'}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 2. Folders Section */}
      <div className="tree-section">
        <div className="tree-section-header">
          <div className="section-title-left" onClick={() => toggleSection('folders')}>
            {collapsedSections.folders ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
            <Folder size={12} className="folder-icon" />
            <span>Folders</span>
          </div>

          <button 
            className="add-folder-btn"
            onClick={(e) => {
              e.stopPropagation();
              setShowNewFolderInput(true);
            }}
            title="Create new folder"
          >
            <FolderPlus size={12} />
          </button>
        </div>

        {!collapsedSections.folders && (
          <div className="tree-section-body">
            {/* Create Folder Inline Input */}
            {showNewFolderInput && (
              <form onSubmit={handleCreateFolderSubmit} className="tree-inline-input-row">
                <Folder size={13} className="folder-icon" />
                <input
                  type="text"
                  className="tree-inline-input"
                  placeholder="Folder name..."
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  autoFocus
                  onBlur={() => setShowNewFolderInput(false)}
                />
              </form>
            )}

            {/* Folder List */}
            {notebooks.map((nb) => {
              const isCollapsed = collapsedFolders[nb.id];
              const folderNotes = notes.filter((n) => n.notebook_id === nb.id);
              const isEditing = editingFolderId === nb.id;

              return (
                <div key={nb.id} className="tree-folder-group">
                  <div className="tree-folder-header">
                    <div 
                      className="folder-left"
                      onClick={() => toggleFolder(nb.id)}
                    >
                      {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                      <Folder size={13} className="folder-icon" />

                      {isEditing ? (
                        <input
                          type="text"
                          className="tree-inline-input"
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleRenameSubmit(nb.id);
                            if (e.key === 'Escape') setEditingFolderId(null);
                          }}
                          autoFocus
                          onBlur={() => handleRenameSubmit(nb.id)}
                        />
                      ) : (
                        <span className="folder-name">{nb.name}</span>
                      )}
                    </div>

                    <div className="folder-actions">
                      <button 
                        className="folder-action-btn"
                        onClick={() => {
                          setEditingFolderId(nb.id);
                          setEditingName(nb.name);
                        }}
                        title="Rename folder"
                      >
                        <Edit2 size={11} />
                      </button>
                      {onDeleteFolder && (
                        <button 
                          className="folder-action-btn danger"
                          onClick={() => onDeleteFolder(nb.id)}
                          title="Delete folder"
                        >
                          <Trash2 size={11} />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Folder Children Notes */}
                  {!isCollapsed && (
                    <div className="tree-folder-children">
                      {folderNotes.length === 0 ? (
                        <div className="tree-empty-folder">Empty folder</div>
                      ) : (
                        folderNotes.map((n) => (
                          <div
                            key={n.id}
                            className={`tree-note-item ${n.id === activeNoteId ? 'active' : ''}`}
                            onClick={() => navigate(`/notes/${n.id}`)}
                          >
                            <FileText size={12} className="tree-icon" />
                            <span className="tree-label">{n.title || 'Untitled Note'}</span>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 3. Root Notes Section (Unassigned Notes) */}
      <div className="tree-section">
        <div className="tree-section-header" onClick={() => toggleSection('notes')}>
          <div className="section-title-left">
            {collapsedSections.notes ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
            <FileText size={12} />
            <span>All Notes</span>
          </div>
          <span className="section-count">{notes.length}</span>
        </div>

        {!collapsedSections.notes && (
          <div className="tree-section-body">
            {notes.map((note) => (
              <div
                key={note.id}
                className={`tree-note-item ${note.id === activeNoteId ? 'active' : ''}`}
                onClick={() => navigate(`/notes/${note.id}`)}
              >
                <FileText size={13} className="tree-icon" />
                <span className="tree-label">{note.title || 'Untitled Note'}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
