import React, { useState } from 'react';
import ThemeToggle from './ThemeToggle';
import { 
  FileText, 
  BookOpen, 
  Plus, 
  FolderPlus,
  Edit2,
  Trash2,
  Star,
  Clock,
  Settings,
  HelpCircle,
  ChevronDown,
  ChevronRight,
  Share2,
  Link2
} from 'lucide-react';

export default function Sidebar({ 
  activeNav, 
  setActiveNav, 
  notes = [], 
  notebooks = [],
  selectedNotebookId,
  onSelectNotebook,
  onCreateNote,
  onCreateNotebook,
  onRenameNotebook,
  onDeleteNotebook,
  onOpenSettings,
  onOpenAbout,
  theme,
  setTheme,
  showBacklinks,
  setShowBacklinks
}) {
  const [notebooksCollapsed, setNotebooksCollapsed] = useState(false);

  const favoriteCount = notes.filter((n) => n.is_favorite).length;

  return (
    <aside className="sidebar">
      {/* 1. WORKSPACE Section */}
      <div>
        <div className="nav-section-title">Workspace</div>

        {/* Action: New Note Button */}
        <button className="new-note-btn" onClick={onCreateNote} style={{ marginBottom: '8px' }}>
          <Plus size={13} />
          <span>New Note</span>
        </button>

        <div className="nav-group">
          <div
            className={`nav-item ${activeNav === 'all' && !selectedNotebookId ? 'active' : ''}`}
            onClick={() => {
              onSelectNotebook(null);
              setActiveNav('all');
            }}
          >
            <div className="nav-item-left">
              <FileText size={13} />
              <span>All Notes</span>
            </div>
            <span className="badge-count">{notes.filter(n => n.id !== 'draft').length}</span>
          </div>

          <div
            className={`nav-item ${activeNav === 'favorites' ? 'active' : ''}`}
            onClick={() => {
              onSelectNotebook(null);
              setActiveNav('favorites');
            }}
          >
            <div className="nav-item-left">
              <Star size={13} style={{ color: activeNav === 'favorites' ? 'var(--accent-warning)' : 'inherit' }} />
              <span>Favorites</span>
            </div>
            {favoriteCount > 0 && <span className="badge-count">{favoriteCount}</span>}
          </div>

          <div
            className={`nav-item ${activeNav === 'recent' ? 'active' : ''}`}
            onClick={() => {
              onSelectNotebook(null);
              setActiveNav('recent');
            }}
          >
            <div className="nav-item-left">
              <Clock size={13} />
              <span>Recent</span>
            </div>
          </div>
        </div>
      </div>

      {/* 2. KNOWLEDGE Section */}
      <div>
        <div className="nav-section-title">Knowledge</div>
        <div className="nav-group">
          <div
            className={`nav-item ${activeNav === 'graph' ? 'active' : ''}`}
            onClick={() => {
              onSelectNotebook(null);
              setActiveNav('graph');
            }}
          >
            <div className="nav-item-left">
              <Share2 size={13} style={{ color: activeNav === 'graph' ? 'var(--accent-primary)' : 'inherit' }} />
              <span>Graph View</span>
            </div>
          </div>

          <div
            className={`nav-item ${showBacklinks ? 'active' : ''}`}
            onClick={() => {
              setShowBacklinks(!showBacklinks);
            }}
          >
            <div className="nav-item-left">
              <Link2 size={13} style={{ color: showBacklinks ? 'var(--accent-emerald)' : 'inherit' }} />
              <span>Backlinks</span>
            </div>
            <span className="badge-count" style={{ fontSize: '0.65rem' }}>
              {showBacklinks ? 'ON' : 'OFF'}
            </span>
          </div>
        </div>
      </div>

      {/* 3. NOTEBOOKS Section */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: 1, overflowY: 'auto' }}>
        <div 
          className="nav-section-title" 
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
          onClick={() => setNotebooksCollapsed((prev) => !prev)}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            {notebooksCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
            <span>Notebooks</span>
          </div>
          <button 
            onClick={(e) => { e.stopPropagation(); onCreateNotebook(); }}
            style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '2px', fontSize: '0.68rem' }}
            title="Create Notebook"
          >
            <FolderPlus size={12} />
            <span>+ Add</span>
          </button>
        </div>

        {!notebooksCollapsed && (
          <div className="nav-group">
            {notebooks.length === 0 ? (
              <div style={{ padding: '4px 6px', fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                No notebooks created
              </div>
            ) : (
              notebooks.map((nb) => {
                const isSelected = selectedNotebookId === nb.id;
                return (
                  <div
                    key={nb.id}
                    className={`nav-item ${isSelected ? 'active' : ''}`}
                    onClick={() => {
                      onSelectNotebook(nb.id);
                      if (activeNav === 'graph') setActiveNav('all');
                    }}
                  >
                    <div className="nav-item-left" style={{ overflow: 'hidden' }}>
                      <BookOpen size={13} style={{ flexShrink: 0 }} />
                      <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {nb.name}
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <span className="badge-count">{nb.note_count || 0}</span>
                      <button 
                        onClick={(e) => { e.stopPropagation(); onRenameNotebook(nb); }}
                        style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
                        title="Rename notebook"
                      >
                        <Edit2 size={11} />
                      </button>
                      <button 
                        onClick={(e) => { e.stopPropagation(); onDeleteNotebook(nb); }}
                        style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
                        title="Delete notebook"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* 4. BOTTOM Section */}
      <div className="sidebar-footer" style={{ flexDirection: 'column', gap: '6px', alignItems: 'stretch' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div 
            onClick={onOpenSettings}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.76rem', color: 'var(--text-secondary)', cursor: 'pointer' }}
          >
            <Settings size={13} />
            <span>Settings</span>
          </div>

          <div 
            onClick={onOpenAbout}
            style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.76rem', color: 'var(--text-secondary)', cursor: 'pointer' }}
          >
            <HelpCircle size={13} />
            <span>About</span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '4px' }}>
          <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            v1.0.0
          </span>
          <ThemeToggle theme={theme} setTheme={setTheme} />
        </div>
      </div>
    </aside>
  );
}
