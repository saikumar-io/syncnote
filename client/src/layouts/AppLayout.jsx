import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate, Link } from '../utils/router';
import SyncNoteLogo from '../components/SyncNoteLogo';
import ThemeToggle from '../components/ThemeToggle';
import UserMenu from '../components/UserMenu';
import GlobalSyncIndicator from '../components/GlobalSyncIndicator';
import CommandPaletteModal from '../components/CommandPaletteModal';
import { 
  FileText, 
  Share2, 
  Settings, 
  HelpCircle, 
  Search,
  PanelLeftClose,
  PanelLeftOpen
} from 'lucide-react';

export default function AppLayout({ 
  children, 
  theme, 
  setTheme, 
  globalSearchQuery,
  setGlobalSearchQuery,
  pageTitle,
  notes = [],
  onCreateNote
}) {
  const location = useLocation();
  const navigate = useNavigate();

  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

  // Global Ctrl+K / Cmd+K listener
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setCommandPaletteOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const navItems = [
    { path: '/notes', label: 'Notes', icon: FileText },
    { path: '/graph', label: 'Graph', icon: Share2 }
  ];

  const footerItems = [
    { path: '/settings', label: 'Settings', icon: Settings },
    { path: '/about', label: 'About', icon: HelpCircle }
  ];

  const isActive = (path) => {
    if (path === '/notes') {
      return location.pathname.startsWith('/notes');
    }
    return location.pathname === path;
  };

  return (
    <div className="app-container">
      {/* Minimal Top Header Bar */}
      <header className="top-header-bar">
        <div className="top-header-left">
          <button
            className="icon-btn-ghost sidebar-toggle-btn"
            onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
            title={isSidebarCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
          >
            {isSidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>

          <SyncNoteLogo showText={!isSidebarCollapsed} />

          {pageTitle && (
            <div className="top-header-title-badge">
              <span className="title-divider">/</span>
              <span className="current-page-title">{pageTitle}</span>
            </div>
          )}
        </div>

        <div className="top-header-center">
          <div 
            className="global-search-container clickable"
            onClick={() => setCommandPaletteOpen(true)}
            title="Open Command Palette (Ctrl+K)"
          >
            <Search size={13} className="search-icon" />
            <span className="search-placeholder-text">
              {globalSearchQuery || 'Search notes, tags, commands...'}
            </span>
            <span className="keyboard-shortcut-tag">Ctrl K</span>
          </div>
        </div>

        <div className="top-header-right">
          <GlobalSyncIndicator />
          <ThemeToggle theme={theme} setTheme={setTheme} />
          <UserMenu />
        </div>
      </header>

      {/* Main Layout Container */}
      <div className={`main-layout ${isSidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
        {/* Compact Navigation Sidebar */}
        <aside className={`sidebar compact-sidebar ${isSidebarCollapsed ? 'collapsed' : ''}`}>
          <div className="sidebar-nav-section">
            <nav className="nav-group-compact">
              {navItems.map((item) => {
                const Icon = item.icon;
                const active = isActive(item.path);
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={`compact-nav-item ${active ? 'active' : ''}`}
                    title={item.label}
                  >
                    <Icon size={15} />
                    {!isSidebarCollapsed && <span>{item.label}</span>}
                  </Link>
                );
              })}
            </nav>

            <div className="compact-sidebar-divider" />

            <nav className="nav-group-compact">
              {footerItems.map((item) => {
                const Icon = item.icon;
                const active = location.pathname === item.path;
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={`compact-nav-item ${active ? 'active' : ''}`}
                    title={item.label}
                  >
                    <Icon size={15} />
                    {!isSidebarCollapsed && <span>{item.label}</span>}
                  </Link>
                );
              })}
            </nav>
          </div>
        </aside>

        {/* Dynamic Page Viewport */}
        <main className="page-content-viewport">
          {children}
        </main>
      </div>

      {/* Command Palette Overlay Modal */}
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
