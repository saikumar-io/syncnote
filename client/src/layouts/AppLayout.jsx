import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate, Link } from '../utils/router';
import SyncNoteLogo from '../components/SyncNoteLogo';
import ThemeToggle from '../components/ThemeToggle';
import UserMenu from '../components/UserMenu';
import GlobalSyncIndicator from '../components/GlobalSyncIndicator';
import CommandPaletteModal from '../components/CommandPaletteModal';
import { useSync } from '../context/SyncContext';
import { 
  FileText, 
  Share2, 
  Settings, 
  HelpCircle, 
  Search,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Star,
  Folder,
  FolderPlus,
  Wifi,
  ChevronDown,
  ChevronRight,
  Edit2,
  Trash2,
  BookOpen,
  Clock,
  Sparkles
} from 'lucide-react';

export default function AppLayout({ 
  children, 
  theme, 
  setTheme, 
  globalSearchQuery,
  setGlobalSearchQuery,
  pageTitle,
  notes = [],
  notebooks = [],
  activeNote = null,
  onCreateNote,
  onCreateNotebook,
  onDeleteNotebook
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const sync = useSync();

  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    return localStorage.getItem('syncnote_sidebar_collapsed') === 'true';
  });
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [notebooksCollapsed, setNotebooksCollapsed] = useState(false);

  const toggleSidebar = () => {
    setIsSidebarCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem('syncnote_sidebar_collapsed', String(next));
      return next;
    });
  };

  // Global keyboard shortcuts: Ctrl+Alt+N (New Note), Ctrl+Alt+G (Knowledge Graph), Ctrl+K (Command Palette)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandPaletteOpen((prev) => !prev);
      }
      if ((e.ctrlKey || e.metaKey) && e.altKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        if (onCreateNote) onCreateNote();
      }
      if ((e.ctrlKey || e.metaKey) && e.altKey && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        navigate('/graph');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCreateNote, navigate]);

  const favoritesCount = notes.filter((n) => n.is_favorite).length;
  const pairedCount = sync?.pairedDevices?.length || 0;

  const isActive = (path) => {
    if (path === '/notes') {
      return location.pathname === '/notes' || (location.pathname.startsWith('/notes/') && !location.pathname.includes('/history') && !location.pathname.startsWith('/notes/folder'));
    }
    if (path === '/favorites') {
      return location.pathname === '/favorites';
    }
    if (path === '/graph') {
      return location.pathname === '/graph';
    }
    if (path === '/settings') {
      return location.pathname === '/settings';
    }
    if (path === '/settings/sync/lan') {
      return location.pathname.includes('/lan');
    }
    if (path === '/about') {
      return location.pathname === '/about';
    }
    return location.pathname === path;
  };

  const handleAddNotebookPrompt = (e) => {
    e.stopPropagation();
    const name = window.prompt('Enter new notebook name:');
    if (name && name.trim() && onCreateNotebook) {
      onCreateNotebook(name.trim());
    }
  };

  const handleRenameNotebook = async (e, folder) => {
    e.stopPropagation();
    const newName = window.prompt('Enter new notebook name:', folder.name || '');
    if (newName && newName.trim() && newName.trim() !== folder.name) {
      try {
        const { notebooksApi } = await import('../api/notebooksApi');
        await notebooksApi.rename(folder.id, newName.trim());
        window.dispatchEvent(new CustomEvent('syncnote:notes-updated'));
      } catch (err) {
        console.error('Failed to rename notebook:', err);
      }
    }
  };

  const handleDeleteNotebookClick = (e, folder) => {
    e.stopPropagation();
    if (window.confirm(`Delete notebook "${folder.name}"? Notes inside will become unassigned.`)) {
      if (onDeleteNotebook) onDeleteNotebook(folder.id);
    }
  };

  return (
    <div className="app-shell-root">
      {/* Top Application Header Bar */}
      <header className="app-header-bar">
        {/* Left Section: Sidebar Toggle + Brand Logo + Breadcrumb */}
        <div className="header-left-cluster">
          <button
            className="icon-btn-ghost sidebar-collapse-trigger"
            onClick={toggleSidebar}
            title={isSidebarCollapsed ? 'Expand Sidebar (Ctrl+\\)' : 'Collapse Sidebar (Ctrl+\\)'}
            type="button"
          >
            {isSidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>

          <Link to="/notes" className="header-brand-link" title="SyncNote Home">
            <SyncNoteLogo showText={true} />
            <span className="live-engine-status-dot" title="Local Express + SQLite Engine Online" />
          </Link>

          {pageTitle && (
            <div className="header-breadcrumb-badge">
              <span className="breadcrumb-slash">/</span>
              <span className="breadcrumb-current-text">{pageTitle}</span>
            </div>
          )}
        </div>

        {/* Center Section: Quick Search Bar (Command Palette Trigger) */}
        <div className="header-center-cluster">
          <div 
            className="header-command-palette-trigger"
            onClick={() => setCommandPaletteOpen(true)}
            title="Open Command Palette (Ctrl+K)"
          >
            <Search size={13} className="search-symbol" />
            <span className="search-text-placeholder">
              {globalSearchQuery || 'Search notes, tags, commands...'}
            </span>
            <kbd className="search-shortcut-badge">Ctrl K</kbd>
          </div>
        </div>

        {/* Right Section: Sync Badge + Theme + User Menu */}
        <div className="header-right-cluster">
          <GlobalSyncIndicator />
          <ThemeToggle theme={theme} setTheme={setTheme} />
          <UserMenu />
        </div>
      </header>

      {/* Main Desktop Shell: Sidebar + Content Viewport */}
      <div className={`app-workspace-body ${isSidebarCollapsed ? 'sidebar-minimized' : ''}`}>
        
        {/* Left Navigation Sidebar */}
        <aside className={`desktop-sidebar ${isSidebarCollapsed ? 'collapsed' : ''}`}>
          
          {/* Action: Primary New Note Button */}
          <div className="sidebar-action-wrap">
            <button 
              className="sidebar-new-note-btn" 
              onClick={() => onCreateNote && onCreateNote()}
              title="Create New Note (Ctrl+Alt+N)"
              type="button"
            >
              <Plus size={15} />
              {!isSidebarCollapsed && <span>New Note</span>}
              {!isSidebarCollapsed && <kbd className="btn-kbd-hint">Ctrl Alt N</kbd>}
            </button>
          </div>

          <div className="sidebar-scrollable-content">
            
            {/* WORKSPACE NAVIGATION */}
            <div className="sidebar-nav-group">
              {!isSidebarCollapsed && <div className="sidebar-group-title">WORKSPACE</div>}
              
              <Link
                to="/notes"
                className={`sidebar-nav-item ${isActive('/notes') ? 'active' : ''}`}
                title="Notes Explorer"
              >
                <div className="nav-item-content-left">
                  <FileText size={15} />
                  {!isSidebarCollapsed && <span>Notes</span>}
                </div>
                {!isSidebarCollapsed && (
                  <span className="nav-pill-badge">{notes.filter(n => n.id !== 'draft').length}</span>
                )}
              </Link>

              {/* Favorites Nav Item (Clean single item) */}
              <Link
                to="/favorites"
                className={`sidebar-nav-item ${isActive('/favorites') ? 'active' : ''}`}
                title="Starred / Favorites"
              >
                <div className="nav-item-content-left">
                  <Star 
                    size={15} 
                    className="fav-star-icon" 
                    style={{ 
                      color: favoritesCount > 0 ? '#eab308' : 'inherit',
                      fill: favoritesCount > 0 ? '#eab308' : 'none'
                    }} 
                  />
                  {!isSidebarCollapsed && <span>Favorites</span>}
                </div>
                {!isSidebarCollapsed && favoritesCount > 0 && (
                  <span className="nav-pill-badge highlight" style={{ background: 'rgba(234, 179, 8, 0.15)', color: '#eab308' }}>
                    {favoritesCount}
                  </span>
                )}
              </Link>

              <Link
                to="/graph"
                className={`sidebar-nav-item ${isActive('/graph') ? 'active' : ''}`}
                title="Interactive Knowledge Graph (Ctrl+Alt+G)"
              >
                <div className="nav-item-content-left">
                  <Share2 size={15} />
                  {!isSidebarCollapsed && <span>Knowledge Graph</span>}
                </div>
              </Link>

              <Link
                to="/settings/sync/lan"
                className={`sidebar-nav-item ${isActive('/settings/sync/lan') ? 'active' : ''}`}
                title="LAN Peer Sync"
              >
                <div className="nav-item-content-left">
                  <Wifi size={15} />
                  {!isSidebarCollapsed && <span>LAN Sync</span>}
                </div>
                {!isSidebarCollapsed && pairedCount > 0 && (
                  <span className="nav-pill-badge success">{pairedCount} paired</span>
                )}
              </Link>
            </div>

            {/* FOLDERS / NOTEBOOKS SECTION */}
            {!isSidebarCollapsed && (
              <div className="sidebar-nav-group">
                <div 
                  className="sidebar-group-title clickable-header"
                  onClick={() => setNotebooksCollapsed(!notebooksCollapsed)}
                >
                  <div className="title-left-wrap">
                    {notebooksCollapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
                    <span>NOTEBOOKS</span>
                  </div>
                  <button
                    className="add-notebook-inline-btn"
                    onClick={handleAddNotebookPrompt}
                    title="Create Notebook"
                    type="button"
                  >
                    <FolderPlus size={12} />
                    <span>+ Add</span>
                  </button>
                </div>

                {!notebooksCollapsed && (
                  <div className="notebooks-nested-tree">
                    {notebooks.length === 0 ? (
                      <div className="notebook-empty-subtext">No notebooks created</div>
                    ) : (
                      notebooks.map((nb) => {
                        const noteCount = notes.filter((n) => n.notebook_id === nb.id).length;
                        const isFolderActive = location.pathname === `/notes/folder/${nb.id}`;
                        return (
                          <div 
                            key={nb.id} 
                            className={`sidebar-notebook-row ${isFolderActive ? 'active' : ''}`}
                            onClick={() => navigate(`/notes/folder/${nb.id}`)}
                            style={{ cursor: 'pointer' }}
                          >
                            <div className="notebook-row-left">
                              <BookOpen size={13} className="nb-icon" />
                              <span className="notebook-title-text" title={nb.name}>{nb.name}</span>
                            </div>

                            <div className="notebook-row-actions">
                              <span className="nb-count-pill">{noteCount}</span>
                              <button
                                className="icon-btn-ghost nb-mini-btn"
                                onClick={(e) => handleRenameNotebook(e, nb)}
                                title="Rename Notebook"
                                type="button"
                              >
                                <Edit2 size={10} />
                              </button>
                              <button
                                className="icon-btn-ghost nb-mini-btn danger"
                                onClick={(e) => handleDeleteNotebookClick(e, nb)}
                                title="Delete Notebook"
                                type="button"
                              >
                                <Trash2 size={10} />
                              </button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            )}

            {/* FOOTER NAVIGATION */}
            <div className="sidebar-nav-group footer-group">
              {!isSidebarCollapsed && <div className="sidebar-group-title">PREFERENCES</div>}

              <Link
                to="/settings"
                className={`sidebar-nav-item ${isActive('/settings') ? 'active' : ''}`}
                title="Settings"
              >
                <div className="nav-item-content-left">
                  <Settings size={15} />
                  {!isSidebarCollapsed && <span>Settings</span>}
                </div>
              </Link>
            </div>
          </div>

          {/* Sidebar Bottom Status Strip */}
          <div className="sidebar-bottom-strip">
            {!isSidebarCollapsed ? (
              <div className="strip-info-wrap">
                <span className="app-version-pill">SyncNote v1.0.0</span>
                <span className="engine-offline-tag">Offline-First</span>
              </div>
            ) : (
              <div className="mini-status-dot" title="SyncNote v1.0.0 Online" />
            )}
          </div>
        </aside>

        {/* Dynamic Page Viewport */}
        <main className="application-main-viewport">
          {children}
        </main>
      </div>

      {/* Global Command Palette (Ctrl+K) */}
      <CommandPaletteModal
        isOpen={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        notes={notes}
        onCreateNote={onCreateNote}
        theme={theme}
        setTheme={setTheme}
      />
    </div>
  );
}
