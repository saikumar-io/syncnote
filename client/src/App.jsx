import React, { useState, useEffect, useCallback } from 'react';
import { Router, Routes, Route, useLocation } from './utils/router';
import { AuthProvider, useAuth } from './context/AuthContext';
import { SyncProvider } from './context/SyncContext';
import AppLayout from './layouts/AppLayout';
import NotesPage from './pages/NotesPage';
import NoteEditorPage from './pages/NoteEditorPage';
import SingleNoteHistoryPage from './pages/SingleNoteHistoryPage';
import KnowledgeGraphPage from './pages/KnowledgeGraphPage';
import SettingsPage from './pages/SettingsPage';
import LanSyncPage from './pages/LanSyncPage';
import PairedDevicesPage from './pages/PairedDevicesPage';
import AboutPage from './pages/AboutPage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';

import CheckpointModal from './components/CheckpointModal';
import DiffViewerModal from './components/DiffViewerModal';
import VersionPreviewModal from './components/VersionPreviewModal';
import DeleteModal from './components/DeleteModal';
import UsernameOnboardingModal from './components/UsernameOnboardingModal';

import { notesApi } from './api/notesApi';
import { notebooksApi } from './api/notebooksApi';
import { Loader2 } from 'lucide-react';

export function AppContent() {
  const location = useLocation();
  const { isAuthenticated, isLoading, user } = useAuth();

  // Primary State
  const [notes, setNotes] = useState([]);
  const [notebooks, setNotebooks] = useState([]);
  const [activeNoteId, setActiveNoteId] = useState(null);
  const [globalSearchQuery, setGlobalSearchQuery] = useState('');
  const [apiConnected, setApiConnected] = useState(true);

  // Preference States with LocalStorage Persistence
  const [theme, setTheme] = useState(() => localStorage.getItem('syncnote_theme') || 'dark');

  // Interactive Modal States
  const [checkpointModalOpen, setCheckpointModalOpen] = useState(false);
  const [checkpointStatusMsg, setCheckpointStatusMsg] = useState('');
  const [isSubmittingCheckpoint, setIsSubmittingCheckpoint] = useState(false);

  const [diffModal, setDiffModal] = useState({ isOpen: false, data: null });
  const [previewModal, setPreviewModal] = useState({ isOpen: false, data: null });
  const [deleteModal, setDeleteModal] = useState({ isOpen: false, item: null, type: 'note' });
  const [isOnboardingModalOpen, setIsOnboardingModalOpen] = useState(false);

  // Theme Sync
  useEffect(() => {
    let activeTheme = theme;
    if (theme === 'system') {
      const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      activeTheme = isDark ? 'dark' : 'light';
    }
    document.documentElement.setAttribute('data-theme', activeTheme);
    localStorage.setItem('syncnote_theme', theme);
  }, [theme]);

  // First-time Google login username onboarding check
  useEffect(() => {
    if (user && (user.needs_username || (user.username && user.username.startsWith('user_')))) {
      setIsOnboardingModalOpen(true);
    } else {
      setIsOnboardingModalOpen(false);
    }
  }, [user]);

  // Load Notes
  const loadNotes = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const fetched = await notesApi.getAll();
      setNotes(fetched || []);
    } catch (err) {
      console.error('Failed to fetch notes:', err);
      setApiConnected(false);
    }
  }, [isAuthenticated]);

  // Load Notebooks
  const loadNotebooks = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const fetched = await notebooksApi.getAll();
      setNotebooks(fetched || []);
    } catch (err) {
      console.error('Failed to fetch notebooks:', err);
    }
  }, [isAuthenticated]);

  // Health Check
  const checkHealth = useCallback(async () => {
    try {
      const res = await fetch('/api/health');
      const data = await res.json();
      if (data && data.status === 'ok') {
        setApiConnected(true);
      } else {
        setApiConnected(false);
      }
    } catch (err) {
      setApiConnected(false);
    }
  }, []);

  useEffect(() => {
    checkHealth();
    if (isAuthenticated) {
      loadNotes();
      loadNotebooks();
    }
  }, [isAuthenticated, loadNotes, loadNotebooks, checkHealth]);

  // Active Note Computation
  const activeNote = notes.find((n) => n.id === activeNoteId) || notes[0] || null;

  // Actions
  const handleCreateNote = async (titleOrPayload = 'Untitled Note', notebookId = null) => {
    try {
      let title = 'Untitled Note';
      let content = '';
      let nbId = notebookId;

      if (typeof titleOrPayload === 'object' && titleOrPayload !== null) {
        title = titleOrPayload.title !== undefined ? titleOrPayload.title : 'Untitled Note';
        content = titleOrPayload.content !== undefined ? titleOrPayload.content : '';
        nbId = titleOrPayload.notebook_id !== undefined ? titleOrPayload.notebook_id : notebookId;
      } else if (typeof titleOrPayload === 'string') {
        title = titleOrPayload.trim() || 'Untitled Note';
      }

      const created = await notesApi.create({ title, content, notebook_id: nbId });
      if (created) {
        setNotes((prevNotes) => [created, ...prevNotes.filter((n) => n.id !== created.id)]);
        setActiveNoteId(created.id);
        window.history.pushState(null, '', `/notes/${created.id}`);
        window.dispatchEvent(new PopStateEvent('popstate'));
      }
      return created;
    } catch (err) {
      console.error('Error creating note:', err);
    }
  };

  const handleUpdateNote = async (id, titleOrFields, content, notebook_id) => {
    try {
      let fields = {};
      if (typeof titleOrFields === 'object' && titleOrFields !== null) {
        fields = titleOrFields;
      } else {
        fields = { title: titleOrFields, content, notebook_id };
      }

      const updated = await notesApi.update(id, fields);
      if (updated) {
        setNotes((prevNotes) =>
          prevNotes.map((n) => (n.id === id ? { ...n, ...updated } : n))
        );
      }
      return updated;
    } catch (err) {
      console.error('Error updating note:', err);
    }
  };

  const handleKeepRecovery = async (id) => {
    try {
      await notesApi.keepRecovery(id);
      await loadNotes();
    } catch (err) {
      console.error('Error keeping recovery:', err);
    }
  };

  const handleDiscardRecovery = async (id) => {
    try {
      const restored = await notesApi.discardRecovery(id);
      setNotes((prevNotes) =>
        prevNotes.map((n) => (n.id === id ? { ...n, ...restored } : n))
      );
    } catch (err) {
      console.error('Error discarding recovery:', err);
    }
  };

  const handleToggleFavorite = async (id) => {
    // Local preference toggle
  };

  const handleConfirmCheckpoint = async (msg) => {
    if (!activeNote) return;
    setIsSubmittingCheckpoint(true);
    setCheckpointStatusMsg('');
    try {
      const res = await notesApi.createCheckpoint(activeNote.id, msg, activeNote.content);
      if (res.status === 'no_change') {
        setCheckpointStatusMsg('No changes detected since last checkpoint.');
        return;
      }
      await loadNotes();
      setCheckpointModalOpen(false);
    } catch (err) {
      console.error('Error creating checkpoint:', err);
      setCheckpointStatusMsg(err.message || 'Failed to create checkpoint');
    } finally {
      setIsSubmittingCheckpoint(false);
    }
  };

  const handleViewChanges = async (ver) => {
    try {
      const diffData = await notesApi.getVersionDiff(ver.note_id, ver.id);
      setDiffModal({ isOpen: true, data: { ...diffData, version: ver } });
    } catch (err) {
      console.error('Error fetching version diff:', err);
    }
  };

  const handleViewVersion = async (ver) => {
    try {
      const verData = await notesApi.getVersionContent(ver.note_id, ver.id);
      setPreviewModal({ isOpen: true, data: verData });
    } catch (err) {
      console.error('Error fetching version content:', err);
    }
  };

  const handleRestoreVersion = async (ver) => {
    try {
      await notesApi.restoreVersion(ver.note_id, ver.id);
      await loadNotes();
      window.history.pushState(null, '', `/notes/${ver.note_id}`);
      window.dispatchEvent(new PopStateEvent('popstate'));
    } catch (err) {
      console.error('Error restoring version:', err);
    }
  };

  const requestDeleteNote = (note) => {
    setDeleteModal({ isOpen: true, item: note, type: 'note' });
  };

  const confirmDelete = async () => {
    if (!deleteModal.item) return;
    try {
      await notesApi.delete(deleteModal.item.id);
      await loadNotes();
      window.history.pushState(null, '', '/notes');
      window.dispatchEvent(new PopStateEvent('popstate'));
    } catch (err) {
      console.error('Error deleting note:', err);
    } finally {
      setDeleteModal({ isOpen: false, item: null, type: 'note' });
    }
  };

  const handleCreateNotebook = async (name) => {
    try {
      await notebooksApi.create(name);
      await loadNotebooks();
    } catch (err) {
      console.error('Error creating notebook:', err);
    }
  };

  const handleDeleteNotebook = async (id) => {
    try {
      await notebooksApi.delete(id);
      await loadNotebooks();
      await loadNotes();
    } catch (err) {
      console.error('Error deleting notebook:', err);
    }
  };

  const getPageTitle = () => {
    const p = location.pathname;
    if (p === '/notes') return 'Notes Explorer';
    if (p.startsWith('/notes/') && p.endsWith('/history')) {
      return activeNote ? `${activeNote.title} · History` : 'Note History';
    }
    if (p.startsWith('/notes/')) {
      return activeNote ? activeNote.title : 'Note Editor';
    }
    if (p === '/graph') return 'Knowledge Graph';
    if (p === '/settings') return 'Settings';
    if (p === '/settings/sync/lan') return 'LAN Sync';
    if (p === '/settings/sync/paired-devices') return 'Paired Devices';
    if (p === '/about') return 'About SyncNote';
    return '';
  };

  // Loading State Screen
  if (isLoading) {
    return (
      <div className="auth-loading-screen">
        <Loader2 size={24} className="spin-icon text-muted" />
      </div>
    );
  }

  // Auth Protection Guards
  const publicPaths = ['/login', '/register'];
  const isPublicPath = publicPaths.includes(location.pathname);

  if (!isAuthenticated) {
    if (location.pathname === '/register') {
      return <RegisterPage />;
    }
    return <LoginPage />;
  }

  if (isAuthenticated && isPublicPath) {
    window.history.pushState(null, '', '/notes');
    window.dispatchEvent(new PopStateEvent('popstate'));
  }

  return (
    <AppLayout
      theme={theme}
      setTheme={setTheme}
      apiConnected={apiConnected}
      globalSearchQuery={globalSearchQuery}
      setGlobalSearchQuery={setGlobalSearchQuery}
      pageTitle={getPageTitle()}
      notes={notes}
      onCreateNote={handleCreateNote}
    >
      <Routes>
        <Route 
          path="/" 
          redirect="/notes" 
        />
        <Route 
          path="/notes" 
          element={
            <NotesPage 
              notes={notes}
              notebooks={notebooks}
              onCreateNote={handleCreateNote}
              onUpdateNote={handleUpdateNote}
              onToggleFavorite={handleToggleFavorite}
              onRequestDeleteNote={requestDeleteNote}
              searchQuery={globalSearchQuery}
              onCreateNotebook={handleCreateNotebook}
              onDeleteNotebook={handleDeleteNotebook}
            />
          } 
        />
        <Route 
          path="/notes/:noteId" 
          element={
            <NoteEditorPage 
              notes={notes}
              notebooks={notebooks}
              activeNote={activeNote}
              setActiveNoteId={setActiveNoteId}
              onUpdateNote={handleUpdateNote}
              onOpenCheckpointModal={() => {
                setCheckpointStatusMsg('');
                setCheckpointModalOpen(true);
              }}
              onKeepRecovery={handleKeepRecovery}
              onDiscardRecovery={handleDiscardRecovery}
              onToggleFavorite={handleToggleFavorite}
              onRequestDeleteNote={requestDeleteNote}
            />
          } 
        />
        <Route 
          path="/notes/:noteId/history" 
          element={
            <SingleNoteHistoryPage 
              noteId={location.pathname.split('/')[2]}
              notes={notes}
              notebooks={notebooks}
              onViewChanges={handleViewChanges}
              onRestoreVersion={handleRestoreVersion}
            />
          } 
        />
        <Route 
          path="/graph" 
          element={
            <KnowledgeGraphPage 
              notes={notes}
              onCreateNote={handleCreateNote}
            />
          } 
        />
        <Route 
          path="/settings" 
          element={
            <SettingsPage 
              theme={theme} 
              setTheme={setTheme} 
            />
          } 
        />
        <Route 
          path="/settings/sync/lan" 
          element={
            <LanSyncPage 
              notes={notes}
              notebooks={notebooks}
            />
          } 
        />
        <Route 
          path="/settings/sync/paired-devices" 
          element={<PairedDevicesPage />} 
        />
        <Route 
          path="/about" 
          element={<AboutPage />} 
        />
      </Routes>

      {/* Shared Interactive Modals */}
      <CheckpointModal 
        isOpen={checkpointModalOpen}
        onConfirm={handleConfirmCheckpoint}
        onCancel={() => setCheckpointModalOpen(false)}
        statusMessage={checkpointStatusMsg}
        isSubmitting={isSubmittingCheckpoint}
      />

      <DiffViewerModal 
        isOpen={diffModal.isOpen}
        onClose={() => setDiffModal({ isOpen: false, data: null })}
        diffData={diffModal.data}
      />

      <VersionPreviewModal 
        isOpen={previewModal.isOpen}
        onClose={() => setPreviewModal({ isOpen: false, data: null })}
        versionData={previewModal.data}
        onRestore={() => {
          if (previewModal.data?.version) {
            handleRestoreVersion(previewModal.data.version);
            setPreviewModal({ isOpen: false, data: null });
          }
        }}
      />

      <DeleteModal 
        isOpen={deleteModal.isOpen}
        title={deleteModal.item ? deleteModal.item.title : ''}
        itemType="Note"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteModal({ isOpen: false, item: null, type: 'note' })}
      />

      <UsernameOnboardingModal
        isOpen={isOnboardingModalOpen}
        onClose={() => setIsOnboardingModalOpen(false)}
      />
    </AppLayout>
  );
}

export default function App() {
  return (
    <Router>
      <AuthProvider>
        <SyncProvider>
          <AppContent />
        </SyncProvider>
      </AuthProvider>
    </Router>
  );
}
