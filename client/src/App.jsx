import React, { useState, useEffect, useRef } from 'react';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import NoteListColumn from './components/NoteListColumn';
import MainContent from './components/MainContent';
import KnowledgeGraph from './components/KnowledgeGraph';
import DeleteModal from './components/DeleteModal';
import NotebookModal from './components/NotebookModal';
import MoveNotebookModal from './components/MoveNotebookModal';
import SettingsModal from './components/SettingsModal';
import AboutModal from './components/AboutModal';
import { notesApi } from './api/notesApi';
import { notebooksApi } from './api/notebooksApi';

export default function App() {
  const [activeNav, setActiveNav] = useState('all'); // 'all' | 'favorites' | 'recent' | 'graph'
  const [searchQuery, setSearchQuery] = useState('');
  const [apiConnected, setApiConnected] = useState(true);
  const [graphFocusNoteId, setGraphFocusNoteId] = useState(null);
  const [showBacklinks, setShowBacklinks] = useState(false);

  // Preference States with LocalStorage Persistence
  const [theme, setTheme] = useState(() => localStorage.getItem('syncnote_theme') || 'dark');
  const [accentColor, setAccentColor] = useState(() => localStorage.getItem('syncnote_accent') || '#6366f1');
  const [fontSize, setFontSize] = useState('medium');
  const [lineNumbers, setLineNumbers] = useState(false);
  const [isFilesCollapsed, setIsFilesCollapsed] = useState(() => localStorage.getItem('syncnote_files_collapsed') === 'true');

  // Notes and Notebooks State
  const [notes, setNotes] = useState([]);
  const [notebooks, setNotebooks] = useState([]);
  const [selectedNoteId, setSelectedNoteId] = useState(null);
  const [selectedNotebookId, setSelectedNotebookId] = useState(null);
  const [draftNote, setDraftNote] = useState(null); // In-memory unsaved draft

  // Modal Dialog States
  const [deleteModal, setDeleteModal] = useState({ isOpen: false, item: null, type: 'note' });
  const [notebookModal, setNotebookModal] = useState({ isOpen: false, notebook: null });
  const [moveModal, setMoveModal] = useState({ isOpen: false, note: null });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);

  const searchInputRef = useRef(null);

  // Effect: Handle Theme Attribute & LocalStorage
  useEffect(() => {
    let activeTheme = theme;
    if (theme === 'system') {
      const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      activeTheme = isDark ? 'dark' : 'light';
    }
    document.documentElement.setAttribute('data-theme', activeTheme);
    localStorage.setItem('syncnote_theme', theme);
  }, [theme]);

  // Effect: Handle Accent Color & LocalStorage
  useEffect(() => {
    document.documentElement.style.setProperty('--accent-primary', accentColor);
    localStorage.setItem('syncnote_accent', accentColor);
  }, [accentColor]);

  // Effect: Handle Collapsed Files LocalStorage
  useEffect(() => {
    localStorage.setItem('syncnote_files_collapsed', isFilesCollapsed ? 'true' : 'false');
  }, [isFilesCollapsed]);

  // Effect: Handle Editor Font Size
  useEffect(() => {
    document.body.setAttribute('data-font-size', fontSize);
  }, [fontSize]);

  // Load notes from API
  const loadNotes = async () => {
    try {
      const fetchedNotes = await notesApi.getAll();
      setNotes(fetchedNotes);
      if (fetchedNotes.length > 0 && !selectedNoteId) {
        setSelectedNoteId(fetchedNotes[0].id);
      }
    } catch (err) {
      console.error('Failed to fetch notes:', err);
      setApiConnected(false);
    }
  };

  // Load notebooks from API
  const loadNotebooks = async () => {
    try {
      const fetchedNotebooks = await notebooksApi.getAll();
      setNotebooks(fetchedNotebooks);
    } catch (err) {
      console.error('Failed to fetch notebooks:', err);
      setApiConnected(false);
    }
  };

  // Check backend health status
  const checkHealth = async () => {
    try {
      const res = await fetch('/api/health');
      setApiConnected(res.ok);
    } catch {
      setApiConnected(false);
    }
  };

  useEffect(() => {
    checkHealth();
    loadNotes();
    loadNotebooks();
  }, []);

  // Global Keyboard Shortcuts (Ctrl+K for search, Ctrl+N for new note)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (searchInputRef.current) {
          searchInputRef.current.focus();
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        handleCreateNote();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [notes, draftNote, selectedNotebookId]);

  // Draft Cleanup Helper: Discards draft if empty
  const cleanupEmptyDraft = () => {
    if (draftNote) {
      const titleEmpty = !draftNote.title || draftNote.title.trim() === '' || draftNote.title.trim().toLowerCase() === 'untitled';
      const contentEmpty = !draftNote.content || draftNote.content.trim() === '';
      if (titleEmpty && contentEmpty) {
        setDraftNote(null);
      }
    }
  };

  // Note Selection Handler
  const handleSelectNote = (id) => {
    if (id !== 'draft') {
      cleanupEmptyDraft();
    }
    setSelectedNoteId(id);
  };

  // Create In-Memory Temporary Draft
  const handleCreateNote = () => {
    if (draftNote) {
      setSelectedNoteId('draft');
      if (activeNav === 'graph') setActiveNav('all');
      return;
    }

    const newDraft = {
      id: 'draft',
      title: '',
      content: '',
      notebook_id: selectedNotebookId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      is_favorite: false
    };

    setDraftNote(newDraft);
    setSelectedNoteId('draft');
    if (activeNav === 'graph') setActiveNav('all');
  };

  // Create & Persist Note with specific title (e.g. from [[Wiki-Link]] click)
  const handleCreateNoteWithTitle = async (title) => {
    cleanupEmptyDraft();
    try {
      const createdNote = await notesApi.create({
        title,
        content: `# ${title}\n\n`,
        notebook_id: selectedNotebookId
      });
      setNotes((prev) => [createdNote, ...prev]);
      setSelectedNoteId(createdNote.id);
      loadNotebooks();
    } catch (err) {
      console.error('Error creating note with title:', err);
    }
  };

  // Note Update & Auto-Save Persistence
  const handleUpdateNote = async (id, updatedFields) => {
    if (id === 'draft') {
      const newTitle = updatedFields.title !== undefined ? updatedFields.title : draftNote.title;
      const newContent = updatedFields.content !== undefined ? updatedFields.content : draftNote.content;
      const updatedDraft = { ...draftNote, ...updatedFields };
      setDraftNote(updatedDraft);

      const hasMeaningfulTitle = newTitle && newTitle.trim() !== '' && newTitle.trim().toLowerCase() !== 'untitled';
      const hasMeaningfulContent = newContent && newContent.trim() !== '';

      if (hasMeaningfulTitle || hasMeaningfulContent) {
        try {
          const finalTitle = newTitle.trim() || 'Untitled Note';
          const createdNote = await notesApi.create({
            title: finalTitle,
            content: newContent,
            notebook_id: updatedDraft.notebook_id
          });

          setNotes((prev) => [createdNote, ...prev]);
          setDraftNote(null);
          setSelectedNoteId(createdNote.id);
          loadNotebooks();
        } catch (err) {
          console.error('Failed to convert draft to persistent note:', err);
        }
      }
      return;
    }

    setNotes((prev) =>
      prev.map((n) => (n.id === id ? { ...n, ...updatedFields, updated_at: new Date().toISOString() } : n))
    );

    try {
      await notesApi.update(id, updatedFields);
      loadNotebooks();
    } catch (err) {
      console.error(`Error updating note ${id}:`, err);
    }
  };

  const handleToggleFavorite = async (note) => {
    if (note.id === 'draft') return;
    const isFav = !note.is_favorite;
    handleUpdateNote(note.id, { ...note, is_favorite: isFav });
  };

  const handleMoveNoteToNotebook = async (noteId, targetNotebookId) => {
    if (noteId === 'draft') {
      setDraftNote((prev) => (prev ? { ...prev, notebook_id: targetNotebookId } : prev));
      setMoveModal({ isOpen: false, note: null });
      return;
    }
    const targetNote = notes.find((n) => n.id === noteId);
    if (!targetNote) return;

    handleUpdateNote(noteId, { ...targetNote, notebook_id: targetNotebookId });
    setMoveModal({ isOpen: false, note: null });
  };

  const handleWikiLinkClick = (targetTitle) => {
    const norm = targetTitle.trim().toLowerCase();
    const existing = notes.find((n) => n.title && n.title.trim().toLowerCase() === norm);
    if (existing) {
      handleSelectNote(existing.id);
    } else {
      handleCreateNoteWithTitle(targetTitle);
    }
  };

  const handleSelectNoteFromGraph = (noteId) => {
    handleSelectNote(noteId);
    setActiveNav('all');
  };

  const handleOpenGraphView = (noteId = null) => {
    cleanupEmptyDraft();
    setGraphFocusNoteId(noteId);
    setActiveNav('graph');
  };

  const requestDeleteNote = (note) => {
    setDeleteModal({ isOpen: true, item: note, type: 'note' });
  };

  const requestDeleteNotebook = (notebook) => {
    setDeleteModal({ isOpen: true, item: notebook, type: 'notebook' });
  };

  const confirmDelete = async () => {
    const { item, type } = deleteModal;
    if (!item) return;

    try {
      if (type === 'note') {
        if (item.id === 'draft') {
          setDraftNote(null);
          setSelectedNoteId(notes.length > 0 ? notes[0].id : null);
        } else {
          await notesApi.delete(item.id);
          const updated = notes.filter((n) => n.id !== item.id);
          setNotes(updated);
          if (selectedNoteId === item.id) {
            setSelectedNoteId(updated.length > 0 ? updated[0].id : null);
          }
        }
      } else if (type === 'notebook') {
        await notebooksApi.delete(item.id);
        setNotebooks((prev) => prev.filter((nb) => nb.id !== item.id));
        if (selectedNotebookId === item.id) setSelectedNotebookId(null);
        loadNotes();
      }
    } catch (err) {
      console.error(`Error deleting ${type}:`, err);
    } finally {
      setDeleteModal({ isOpen: false, item: null, type: 'note' });
      loadNotebooks();
    }
  };

  const handleOpenCreateNotebook = () => {
    setNotebookModal({ isOpen: true, notebook: null });
  };

  const handleOpenRenameNotebook = (notebook) => {
    setNotebookModal({ isOpen: true, notebook });
  };

  const handleSaveNotebook = async (name) => {
    try {
      if (notebookModal.notebook) {
        const updated = await notebooksApi.rename(notebookModal.notebook.id, name);
        setNotebooks((prev) => prev.map((nb) => (nb.id === updated.id ? updated : nb)));
      } else {
        const created = await notebooksApi.create(name);
        setNotebooks((prev) => [...prev, created]);
        setSelectedNotebookId(created.id);
      }
    } catch (err) {
      console.error('Error saving notebook:', err);
    } finally {
      setNotebookModal({ isOpen: false, notebook: null });
    }
  };

  const displayNotes = draftNote ? [draftNote, ...notes] : notes;
  const selectedNote = displayNotes.find((n) => n.id === selectedNoteId) || null;

  return (
    <div className="app-container">
      {/* Top Header Bar */}
      <Header 
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        searchInputRef={searchInputRef}
        apiConnected={apiConnected}
      />

      {/* Main Layout Area */}
      <div className="main-layout">
        {/* Column 1: Sidebar */}
        <Sidebar 
          activeNav={activeNav} 
          setActiveNav={(nav) => {
            cleanupEmptyDraft();
            setActiveNav(nav);
          }} 
          notes={displayNotes}
          notebooks={notebooks}
          selectedNotebookId={selectedNotebookId}
          onSelectNotebook={(nbId) => {
            cleanupEmptyDraft();
            setSelectedNotebookId(nbId);
          }}
          onCreateNote={handleCreateNote}
          onCreateNotebook={handleOpenCreateNotebook}
          onRenameNotebook={handleOpenRenameNotebook}
          onDeleteNotebook={requestDeleteNotebook}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenAbout={() => setAboutOpen(true)}
          theme={theme}
          setTheme={setTheme}
          showBacklinks={showBacklinks}
          setShowBacklinks={setShowBacklinks}
        />

        {/* View Switcher: Graph View vs 2-Column Note Editor View */}
        {activeNav === 'graph' ? (
          <div style={{ flex: 1, height: '100%', position: 'relative' }}>
            <KnowledgeGraph 
              notes={notes}
              selectedNoteId={selectedNoteId}
              onSelectNote={handleSelectNoteFromGraph}
              onCreateNote={handleCreateNote}
              focusNoteId={graphFocusNoteId}
            />
          </div>
        ) : (
          <>
            {/* Column 2: Note List Pane (Collapsible) */}
            <NoteListColumn 
              notes={displayNotes}
              notebooks={notebooks}
              selectedNoteId={selectedNoteId}
              selectedNotebookId={selectedNotebookId}
              activeNav={activeNav}
              searchQuery={searchQuery}
              onSelectNote={handleSelectNote}
              onCreateNote={handleCreateNote}
              onRenameNote={(note) => handleSelectNote(note.id)}
              onFavoriteNote={handleToggleFavorite}
              onMoveToNotebook={(note) => setMoveModal({ isOpen: true, note })}
              onDeleteNote={requestDeleteNote}
              isCollapsed={isFilesCollapsed}
              onToggleCollapse={() => setIsFilesCollapsed((prev) => !prev)}
            />

            {/* Column 3: Main Editor Pane */}
            <MainContent 
              selectedNote={selectedNote}
              allNotes={notes}
              notebooks={notebooks}
              onUpdateNote={handleUpdateNote}
              onToggleFavorite={handleToggleFavorite}
              onRequestMoveNotebook={(note) => setMoveModal({ isOpen: true, note })}
              onRequestDeleteNote={requestDeleteNote}
              onCreateNote={handleCreateNote}
              onOpenGraphView={handleOpenGraphView}
              onNavigateToNote={handleSelectNote}
              onWikiLinkClick={handleWikiLinkClick}
              showBacklinks={showBacklinks}
              setShowBacklinks={setShowBacklinks}
            />
          </>
        )}
      </div>

      {/* Modals & Dialogs */}
      <DeleteModal 
        isOpen={deleteModal.isOpen}
        title={deleteModal.item ? (deleteModal.item.title || deleteModal.item.name) : ''}
        itemType={deleteModal.type === 'note' ? 'Note' : 'Notebook'}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteModal({ isOpen: false, item: null, type: 'note' })}
      />

      <NotebookModal 
        isOpen={notebookModal.isOpen}
        initialName={notebookModal.notebook ? notebookModal.notebook.name : ''}
        isEditing={!!notebookModal.notebook}
        onSave={handleSaveNotebook}
        onCancel={() => setNotebookModal({ isOpen: false, notebook: null })}
      />

      <MoveNotebookModal
        isOpen={moveModal.isOpen}
        note={moveModal.note}
        notebooks={notebooks}
        onMove={handleMoveNoteToNotebook}
        onCancel={() => setMoveModal({ isOpen: false, note: null })}
      />

      <SettingsModal 
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        theme={theme}
        setTheme={setTheme}
        accentColor={accentColor}
        setAccentColor={setAccentColor}
        fontSize={fontSize}
        setFontSize={setFontSize}
        lineNumbers={lineNumbers}
        setLineNumbers={setLineNumbers}
      />

      <AboutModal 
        isOpen={aboutOpen}
        onClose={() => setAboutOpen(false)}
      />
    </div>
  );
}
