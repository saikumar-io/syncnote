import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import MarkdownRenderer from './MarkdownRenderer';
import EditorToolbar from './EditorToolbar';
import CheckpointModal from './CheckpointModal';
import VersionHistoryDrawer from './VersionHistoryDrawer';
import DiffViewerModal from './DiffViewerModal';
import VersionPreviewModal from './VersionPreviewModal';
import SyncModeModal from './SyncModeModal';
import ContextualAiPanel from './ContextualAiPanel';
import { NoteSyncBadge } from './NoteListColumn';
import { formatRelativeTime } from '../utils/timeUtils';
import { getBacklinksForNote } from '../utils/backlinksParser';
import { getNotePath } from '../utils/pathUtils';
import { notesApi } from '../api/notesApi';
import { useSync } from '../context/SyncContext';
import { 
  FileText, 
  Trash2, 
  Edit3,
  Eye,
  BookOpen,
  Hash,
  GitBranch,
  History,
  RefreshCw,
  MoreHorizontal,
  Copy,
  Star,
  Folder,
  Check,
  Share2,
  Link2,
  ArrowLeft,
  GitCommit,
  AlertTriangle,
  Sparkles,
  Clock,
  ChevronRight
} from 'lucide-react';

export default function MainContent({ 
  selectedNote,
  allNotes = [],
  notebooks = [],
  onUpdateNote,
  onToggleFavorite,
  onRequestMoveNotebook,
  onRequestDeleteNote,
  onCreateNote,
  onOpenGraphView,
  onNavigateToNote,
  onWikiLinkClick,
  showBacklinks,
  setShowBacklinks
}) {
  const [editorTitle, setEditorTitle] = useState('');
  const [editorContent, setEditorContent] = useState('');
  const [editorNotebookId, setEditorNotebookId] = useState('');
  const [viewMode, setViewMode] = useState('edit'); // 'edit' | 'preview'
  const [savingStatus, setSavingStatus] = useState('Saved locally');

  const { unresolvedConflicts = [], openConflictModal } = useSync();
  const activeNoteConflict = selectedNote 
    ? (unresolvedConflicts.find(c => c.note_id === selectedNote.id) || (selectedNote.sync_state === 'CONFLICT' ? { note_id: selectedNote.id, note_title: selectedNote.title } : null))
    : null;

  // Interactive Action Drawers & Modals State
  const [showHistoryDrawer, setShowHistoryDrawer] = useState(false);
  const [showSyncDrawer, setShowSyncDrawer] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const moreButtonRef = useRef(null);
  const [moreMenuPos, setMoreMenuPos] = useState({ top: 0, right: 0 });

  const toggleMoreMenu = (e) => {
    e.stopPropagation();
    if (!showMoreMenu && moreButtonRef.current) {
      const rect = moreButtonRef.current.getBoundingClientRect();
      const top = Math.min(rect.bottom + 6, window.innerHeight - 200);
      const right = Math.max(12, window.innerWidth - rect.right);
      setMoreMenuPos({ top, right });
      setShowHistoryDrawer(false);
      setShowSyncDrawer(false);
    }
    setShowMoreMenu(!showMoreMenu);
  };

  useEffect(() => {
    if (!showMoreMenu) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setShowMoreMenu(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showMoreMenu]);

  const [showAiPanel, setShowAiPanel] = useState(() => {
    return localStorage.getItem('syncnote_ai_panel_open') === 'true';
  });
  const [copiedToast, setCopiedToast] = useState(false);

  const toggleAiPanel = () => {
    setShowAiPanel(prev => {
      const next = !prev;
      localStorage.setItem('syncnote_ai_panel_open', String(next));
      return next;
    });
  };

  // Version Control States
  const [showCheckpointModal, setShowCheckpointModal] = useState(false);
  const [showDiffModal, setShowDiffModal] = useState(false);
  const [showPreviewModal, setShowPreviewModal] = useState(false);

  const [historyList, setHistoryList] = useState([]);
  const [selectedDiffData, setSelectedDiffData] = useState(null);
  const [selectedPreviewData, setSelectedPreviewData] = useState(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [previewError, setPreviewError] = useState(null);
  const [checkpointStatusMsg, setCheckpointStatusMsg] = useState('');
  const [isSubmittingCheckpoint, setIsSubmittingCheckpoint] = useState(false);
  const [toastNotification, setToastNotification] = useState('');

  // Session Recovery States
  const [dismissedRecoveryNoteId, setDismissedRecoveryNoteId] = useState(null);
  const [isProcessingRecovery, setIsProcessingRecovery] = useState(false);

  // Sync Mode modal state
  const [syncModeModalState, setSyncModeModalState] = useState({ isOpen: false, targetMode: null });

  const currentNoteMode = selectedNote ? ((selectedNote.sync_mode === 'google' || selectedNote.sync_mode === 'cloud') ? 'cloud' : (selectedNote.sync_mode || 'local')) : 'local';

  const handleDirectModeChange = async (targetMode) => {
    if (!selectedNote || selectedNote.id === 'draft') return;
    if (currentNoteMode === targetMode) return;

    if (onUpdateNote) {
      await onUpdateNote(selectedNote.id, { sync_mode: targetMode });
    }

    if (targetMode === 'cloud' && sync && !sync.googleDriveStatus?.connected) {
      setSyncModeModalState({ isOpen: true, targetMode: 'cloud' });
    }

    if (sync && sync.refreshSyncStatus) {
      sync.refreshSyncStatus();
    }
  };

  const sync = useSync();
  const [isSyncingSingle, setIsSyncingSingle] = useState(false);

  const handleSyncSingleNote = async () => {
    if (!selectedNote || !sync?.syncSingleNote) return;
    setIsSyncingSingle(true);
    try {
      const res = await sync.syncSingleNote(selectedNote.id);
      if (res && res.result && res.result.note) {
        if (onUpdateNote) {
          onUpdateNote(selectedNote.id, res.result.note);
        }
      }
    } catch (err) {
      console.error('Failed to sync single note:', err);
    } finally {
      setIsSyncingSingle(false);
    }
  };

  const handleConfirmSyncMode = (noteId, mode) => {
    if (onUpdateNote) {
      onUpdateNote(noteId, { sync_mode: mode });
    }
  };

  const textareaRef = useRef(null);

  // Autosave & Debounce refs
  const noteIdRef = useRef(selectedNote?.id);
  const titleRef = useRef(editorTitle);
  const contentRef = useRef(editorContent);
  const notebookIdRef = useRef(editorNotebookId);
  const debounceTimerRef = useRef(null);
  const pendingSaveRef = useRef(false);
  const latestRequestIdRef = useRef(0);

  // Sync refs with latest state
  useEffect(() => {
    titleRef.current = editorTitle;
  }, [editorTitle]);

  useEffect(() => {
    contentRef.current = editorContent;
  }, [editorContent]);

  useEffect(() => {
    notebookIdRef.current = editorNotebookId;
  }, [editorNotebookId]);

  // Flush pending save function
  const flushSave = useCallback(async (targetNoteId) => {
    if (!targetNoteId || targetNoteId === 'draft' || !pendingSaveRef.current) return;
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    
    // Capture snapshot of what we are saving right now
    const savingTitle = titleRef.current;
    const savingContent = contentRef.current;
    const savingNotebookId = notebookIdRef.current;
    const currentReqId = ++latestRequestIdRef.current;

    try {
      setSavingStatus('Saving...');
      const updated = await onUpdateNote(targetNoteId, {
        title: savingTitle,
        content: savingContent,
        notebook_id: savingNotebookId
      });
      
      if (currentReqId === latestRequestIdRef.current) {
        if (contentRef.current === savingContent && titleRef.current === savingTitle && notebookIdRef.current === savingNotebookId) {
          pendingSaveRef.current = false;
          setSavingStatus('Saved locally');
        } else {
          pendingSaveRef.current = true;
          setSavingStatus('Saving...');
          scheduleAutosave(targetNoteId);
        }
      }
      return updated;
    } catch (err) {
      console.error('Failed to save note:', err);
      if (currentReqId === latestRequestIdRef.current) {
        setSavingStatus('Save failed');
      }
    }
  }, [onUpdateNote]);

  // Schedule debounced save function (750ms delay)
  const scheduleAutosave = useCallback((targetNoteId) => {
    if (!targetNoteId || targetNoteId === 'draft') return;
    pendingSaveRef.current = true;
    setSavingStatus('Saving...');
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      flushSave(targetNoteId);
    }, 750);
  }, [flushSave]);

  // Handle note switching & unmounting
  useEffect(() => {
    const prevNoteId = noteIdRef.current;
    const isDifferentNote = selectedNote?.id && selectedNote.id !== prevNoteId;

    if (prevNoteId && isDifferentNote && pendingSaveRef.current) {
      flushSave(prevNoteId);
    }
    noteIdRef.current = selectedNote?.id;

    if (selectedNote) {
      const isInitialMount = prevNoteId === undefined;
      const isNoteContentUpdated = !pendingSaveRef.current && selectedNote.content !== undefined && selectedNote.content !== contentRef.current;

      if (isDifferentNote || isInitialMount || isNoteContentUpdated) {
        setEditorTitle(selectedNote.title || '');
        setEditorContent(selectedNote.content || '');
        setEditorNotebookId(selectedNote.notebook_id || '');
        titleRef.current = selectedNote.title || '';
        contentRef.current = selectedNote.content || '';
        notebookIdRef.current = selectedNote.notebook_id || '';
        if (isDifferentNote || isInitialMount) {
          pendingSaveRef.current = false;
          setSavingStatus(selectedNote.id === 'draft' ? 'Unsaved draft' : 'Saved locally');
          setDismissedRecoveryNoteId(null);
          if (selectedNote.id !== 'draft') {
            loadHistory(selectedNote.id);
          } else {
            setHistoryList([]);
          }
        }
      }
    }

    return () => {
      const currentNoteId = noteIdRef.current;
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      if (currentNoteId && currentNoteId !== 'draft' && pendingSaveRef.current) {
        flushSave(currentNoteId);
      }
    };
  }, [selectedNote?.id, selectedNote?.content]);

  const getRecoveryKey = (note) => {
    if (!note || !note.id) return null;
    const hash = note.session_info?.current_content_hash || note.content_hash || '';
    return `syncnote:recovery:${note.id}:${hash}`;
  };

  const isRecoveryHandled = (note) => {
    const key = getRecoveryKey(note);
    if (!key) return false;
    try {
      const val = localStorage.getItem(key);
      return val === 'kept' || val === 'discarded';
    } catch (e) {
      return false;
    }
  };

  const showToast = (msg) => {
    setToastNotification(msg);
    setTimeout(() => setToastNotification(''), 3000);
  };

  const loadHistory = async (noteId) => {
    try {
      const historyData = await notesApi.getHistory(noteId);
      setHistoryList(historyData || []);
    } catch (err) {
      console.error('Failed to load history:', err);
    }
  };

  const handleKeepChanges = async () => {
    if (!selectedNote || selectedNote.id === 'draft') return;
    setIsProcessingRecovery(true);
    const key = getRecoveryKey(selectedNote);
    try {
      if (key) {
        try { localStorage.setItem(key, 'kept'); } catch (e) {}
      }
      const res = await notesApi.keepRecovery(selectedNote.id);
      setDismissedRecoveryNoteId(selectedNote.id);
      const updatedSessionInfo = res?.data?.session_info || {
        ...(selectedNote.session_info || {}),
        has_uncheckpointed_changes: false,
        session_status: 'acknowledged'
      };
      onUpdateNote(selectedNote.id, { session_info: updatedSessionInfo });
      showToast('Kept working changes from previous session');
    } catch (err) {
      console.error('Failed to keep changes:', err);
      showToast('Failed to acknowledge changes');
    } finally {
      setIsProcessingRecovery(false);
    }
  };

  const handleDiscardChanges = async () => {
    if (!selectedNote || selectedNote.id === 'draft') return;
    setIsProcessingRecovery(true);
    const key = getRecoveryKey(selectedNote);
    try {
      if (key) {
        try { localStorage.setItem(key, 'discarded'); } catch (e) {}
      }
      const res = await notesApi.discardRecovery(selectedNote.id);
      if (res.status === 'success') {
        const restoredContent = res.data.content;
        setEditorContent(restoredContent);
        contentRef.current = restoredContent;
        setDismissedRecoveryNoteId(selectedNote.id);
        onUpdateNote(selectedNote.id, {
          content: restoredContent,
          content_hash: res.data.content_hash,
          current_version_id: res.data.current_version_id,
          session_info: res.data.session_info
        });
        showToast('Discarded uncheckpointed changes; restored to latest checkpoint');
        await loadHistory(selectedNote.id);
      }
    } catch (err) {
      console.error('Failed to discard changes:', err);
      showToast('Failed to discard changes');
    } finally {
      setIsProcessingRecovery(false);
    }
  };

  const handleTitleChange = (e) => {
    const newTitle = e.target.value;
    setEditorTitle(newTitle);
    titleRef.current = newTitle;
    scheduleAutosave(selectedNote.id);
  };

  const [wikiSuggestOpen, setWikiSuggestOpen] = useState(false);
  const [wikiQuery, setWikiQuery] = useState('');
  const [cursorPos, setCursorPos] = useState(0);

  const handleContentChange = (e) => {
    const newContent = e.target.value;
    const cursor = e.target.selectionStart;
    setEditorContent(newContent);
    contentRef.current = newContent;
    setCursorPos(cursor);
    scheduleAutosave(selectedNote.id);

    // Detect [[ trigger for WikiLink suggestion
    const textBeforeCursor = newContent.substring(0, cursor);
    const match = textBeforeCursor.match(/\[\[([^\]]*)$/);
    if (match) {
      setWikiQuery(match[1]);
      setWikiSuggestOpen(true);
    } else {
      setWikiSuggestOpen(false);
    }
  };

  const handleSelectWikiSuggestion = (targetTitle) => {
    if (!textareaRef.current) return;
    const textBeforeCursor = editorContent.substring(0, cursorPos);
    const textAfterCursor = editorContent.substring(cursorPos);
    const openIndex = textBeforeCursor.lastIndexOf('[[');
    if (openIndex !== -1) {
      const newTextBefore = textBeforeCursor.substring(0, openIndex) + `[[${targetTitle}]]`;
      const fullNewContent = newTextBefore + textAfterCursor;
      setEditorContent(fullNewContent);
      contentRef.current = fullNewContent;
      scheduleAutosave(selectedNote.id);
      setWikiSuggestOpen(false);
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
          const newPos = newTextBefore.length;
          textareaRef.current.setSelectionRange(newPos, newPos);
        }
      }, 10);
    }
  };

  const handleNotebookChange = (e) => {
    const newNbId = e.target.value || null;
    setEditorNotebookId(newNbId);
    notebookIdRef.current = newNbId;
    scheduleAutosave(selectedNote.id);
  };

  const handleInsertSyntax = (tool) => {
    if (!textareaRef.current) return;
    const el = textareaRef.current;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selectedText = editorContent.substring(start, end);

    let insertion = '';
    if (tool.type === 'wrap') {
      insertion = `${tool.syntax}${selectedText || 'text'}${tool.syntax}`;
    } else if (tool.type === 'prefix') {
      insertion = `${tool.syntax}${selectedText}`;
    } else {
      insertion = tool.syntax;
    }

    const newContent = editorContent.substring(0, start) + insertion + editorContent.substring(end);
    setEditorContent(newContent);
    contentRef.current = newContent;
    scheduleAutosave(selectedNote.id);
    
    setTimeout(() => {
      el.focus();
      el.setSelectionRange(start + insertion.length, start + insertion.length);
    }, 10);
  };

  const copyFilePath = () => {
    if (selectedNote && selectedNote.file_path) {
      navigator.clipboard.writeText(selectedNote.file_path);
      setCopiedToast(true);
      setTimeout(() => setCopiedToast(false), 2000);
    }
  };

  const handleOpenCheckpointModal = () => {
    if (!selectedNote || selectedNote.id === 'draft') return;
    setCheckpointStatusMsg('');
    setShowCheckpointModal(true);
  };

  const handleCreateCheckpoint = async (message) => {
    if (!selectedNote || selectedNote.id === 'draft') return;
    setIsSubmittingCheckpoint(true);
    setCheckpointStatusMsg('');

    try {
      if (pendingSaveRef.current) {
        await flushSave(selectedNote.id);
      }
      const currentContent = contentRef.current;
      const res = await notesApi.createCheckpoint(selectedNote.id, message, currentContent);
      if (res.status === 'no_change') {
        setCheckpointStatusMsg('No changes since the last checkpoint.');
      } else {
        setShowCheckpointModal(false);
        showToast('Checkpoint created');
        await loadHistory(selectedNote.id);
        onUpdateNote(selectedNote.id, { current_version_id: res.data.id, content_hash: res.data.content_hash });
      }
    } catch (err) {
      console.error('Error creating checkpoint:', err);
      setCheckpointStatusMsg(err.message || 'Failed to create checkpoint');
    } finally {
      setIsSubmittingCheckpoint(false);
    }
  };

  const handleViewChanges = async (version) => {
    try {
      const diffData = await notesApi.getVersionDiff(selectedNote.id, version.id);
      setSelectedDiffData(diffData);
      setShowDiffModal(true);
    } catch (err) {
      console.error('Failed to fetch diff:', err);
    }
  };

  const handleViewVersion = async (version) => {
    if (!selectedNote || !version?.id) return;
    setIsLoadingPreview(true);
    setPreviewError(null);
    setSelectedPreviewData({ version });
    setShowPreviewModal(true);
    try {
      const verData = await notesApi.getVersionContent(selectedNote.id, version.id);
      setSelectedPreviewData(verData);
    } catch (err) {
      console.error('Failed to fetch version content:', err);
      setPreviewError(err.message || 'Failed to load historical version');
    } finally {
      setIsLoadingPreview(false);
    }
  };

  const handleRestoreVersion = async (version) => {
    if (!selectedNote || !version?.id) return;
    try {
      const currentReqId = ++latestRequestIdRef.current;
      const res = await notesApi.restoreVersion(selectedNote.id, version.id);
      const payload = res?.data || res;
      const restoredContent = payload?.content;
      const newVersion = payload?.version;

      if (!newVersion || !newVersion.id || restoredContent === undefined) {
        throw new Error('Invalid version payload returned from restore API');
      }

      if (currentReqId !== latestRequestIdRef.current) return;

      setEditorContent(restoredContent);
      contentRef.current = restoredContent;
      pendingSaveRef.current = false;
      setSavingStatus('Saved locally');

      onUpdateNote(selectedNote.id, { 
        content: restoredContent, 
        current_version_id: newVersion.id, 
        content_hash: newVersion.content_hash 
      });

      setHistoryList((prev) => {
        const filtered = (prev || []).filter((v) => v.id !== newVersion.id);
        return [...filtered, newVersion].sort((a, b) => a.version_number - b.version_number);
      });

      await loadHistory(selectedNote.id);
      showToast(`Restored V${version.version_number} as V${newVersion.version_number}`);
    } catch (err) {
      console.error('Failed to restore version:', err);
      showToast('Failed to restore version');
    }
  };

  const backlinks = selectedNote ? getBacklinksForNote(selectedNote, allNotes) : [];

  // Empty state if no note selected
  if (!selectedNote) {
    return (
      <main className="editor-pane-empty">
        <div className="empty-selection-card">
          <div className="empty-icon-wrap">
            <FileText size={32} />
          </div>
          <h3>No Note Selected</h3>
          <p>Select a note from the file explorer or create a new note to start writing.</p>
          <button className="primary-action-btn" onClick={onCreateNote}>
            <span>+ New Note</span>
          </button>
        </div>
      </main>
    );
  }

  const isDraft = selectedNote.id === 'draft';
  const wordCount = editorContent ? editorContent.split(/\s+/).filter(Boolean).length : 0;
  const charCount = editorContent ? editorContent.length : 0;

  return (
    <main className="editor-pane-root">
      {/* Toast Notification */}
      {toastNotification && (
        <div className="editor-floating-toast">
          <Check size={14} className="toast-check-icon" />
          <span>{toastNotification}</span>
        </div>
      )}

      {/* Editor Header Bar */}
      <div className="editor-header-bar">
        {/* Left: Edit / Preview Switcher & Formatting Dock */}
        <div className="editor-header-left">
          <div className="segmented-tab-control">
            <button 
              className={`segmented-tab-btn ${viewMode === 'edit' ? 'active' : ''}`}
              onClick={() => setViewMode('edit')}
              type="button"
            >
              <Edit3 size={13} />
              <span>Edit</span>
            </button>
            <button 
              className={`segmented-tab-btn ${viewMode === 'preview' ? 'active' : ''}`}
              onClick={() => setViewMode('preview')}
              type="button"
            >
              <Eye size={13} />
              <span>Preview</span>
            </button>
          </div>

          {viewMode === 'edit' && <EditorToolbar onInsertSyntax={handleInsertSyntax} />}
        </div>

        {/* Right Action Tools */}
        <div className="editor-header-right">
          {/* Checkpoint Button */}
          {!isDraft && (
            <button 
              className="checkpoint-action-btn"
              onClick={handleOpenCheckpointModal}
              title="Create Version Snapshot"
              type="button"
            >
              <GitCommit size={13} />
              <span>Checkpoint</span>
            </button>
          )}

          {/* Notebook Selector */}
          <div className="notebook-selector-wrap">
            <BookOpen size={12} className="nb-icon" />
            <select
              value={editorNotebookId || ''}
              onChange={handleNotebookChange}
              className="notebook-select"
            >
              <option value="">Unassigned</option>
              {notebooks.map((nb) => (
                <option key={nb.id} value={nb.id}>
                  {nb.name}
                </option>
              ))}
            </select>
          </div>

          {/* 1-Click Sync Mode Pills */}
          <div className="sync-mode-segmented-pills">
            {['local', 'cloud', 'lan', 'both'].map((mode) => (
              <button
                key={mode}
                type="button"
                className={`sync-pill-btn ${currentNoteMode === mode ? 'active' : ''}`}
                onClick={() => handleDirectModeChange(mode)}
                title={`Set note sync mode to ${mode.toUpperCase()}`}
              >
                {mode.toUpperCase()}
              </button>
            ))}
          </div>

          {/* Note Sync Badge & Manual Trigger */}
          <div className="sync-status-indicator-group">
            <NoteSyncBadge note={selectedNote} />
            {currentNoteMode === 'cloud' && (
              <button
                type="button"
                className="single-sync-btn"
                onClick={handleSyncSingleNote}
                disabled={isSyncingSingle || sync?.isSyncing}
                title="Synchronize note with Google Drive"
              >
                <RefreshCw size={11} className={(isSyncingSingle || sync?.isSyncing) ? 'spin' : ''} />
                <span>{(isSyncingSingle || sync?.isSyncing) ? 'Syncing...' : 'Sync Now'}</span>
              </button>
            )}
          </div>

          {/* Knowledge Graph Button */}
          <button 
            className="toolbar-tool-btn"
            onClick={() => onOpenGraphView && onOpenGraphView(selectedNote.id)}
            title="View in Knowledge Graph"
            type="button"
          >
            <Share2 size={13} />
          </button>

          {/* Version History Drawer Trigger */}
          <button 
            className={`toolbar-tool-btn ${showHistoryDrawer ? 'active' : ''}`} 
            onClick={() => { 
              if (!isDraft) loadHistory(selectedNote.id);
              setShowHistoryDrawer(!showHistoryDrawer); 
              setShowSyncDrawer(false); 
              setShowMoreMenu(false); 
            }}
            title="Version History Timeline"
            type="button"
          >
            <History size={13} />
          </button>

          {/* AI Panel Toggle Button */}
          <button
            className={`ai-toggle-btn ${showAiPanel ? 'active' : ''}`}
            onClick={toggleAiPanel}
            title={showAiPanel ? 'Hide AI Assistant' : 'Show AI & Knowledge Assistant'}
            type="button"
          >
            <Sparkles size={13} />
            <span>AI</span>
          </button>

          {/* Direct Star / Pin Quick Action */}
          <button 
            className={`toolbar-tool-btn star-tool-btn ${selectedNote?.is_favorite ? 'pinned active' : ''}`}
            onClick={() => onToggleFavorite && onToggleFavorite(selectedNote)}
            title={selectedNote?.is_favorite ? 'Pinned to Favorites (Click to unpin ★)' : 'Pin to Favorites (☆)'}
            aria-label={selectedNote?.is_favorite ? 'Unpin note from favorites' : 'Pin note to favorites'}
            type="button"
          >
            <Star 
              size={14} 
              style={{ 
                color: selectedNote?.is_favorite ? '#eab308' : 'inherit',
                fill: selectedNote?.is_favorite ? '#eab308' : 'none'
              }} 
            />
          </button>

          {/* More Actions Dropdown Trigger Button */}
          <button 
            ref={moreButtonRef}
            className={`toolbar-tool-btn ${showMoreMenu ? 'active' : ''}`} 
            onClick={toggleMoreMenu}
            title="More Actions"
            aria-label="More Note Actions"
            type="button"
          >
            <MoreHorizontal size={13} />
          </button>

          {/* High-Level Portal Context Menu: Always renders above all content and AI panel */}
          {showMoreMenu && createPortal(
            <>
              <div 
                className="portal-menu-backdrop" 
                onClick={() => setShowMoreMenu(false)}
                onContextMenu={(e) => { e.preventDefault(); setShowMoreMenu(false); }}
              />
              <div 
                className="editor-dropdown-popover floating-portal-menu"
                style={{
                  position: 'fixed',
                  top: `${moreMenuPos.top}px`,
                  right: `${moreMenuPos.right}px`,
                  zIndex: 'var(--z-dropdown, 1000)'
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <button 
                  className="dropdown-action-item" 
                  onClick={() => { copyFilePath(); setShowMoreMenu(false); }}
                  type="button"
                >
                  {copiedToast ? <Check size={13} className="text-success" /> : <Copy size={13} />}
                  <span>{copiedToast ? 'Copied File Path!' : 'Copy Local Path'}</span>
                </button>

                <button 
                  className="dropdown-action-item" 
                  onClick={() => { onToggleFavorite && onToggleFavorite(selectedNote); setShowMoreMenu(false); }}
                  type="button"
                >
                  <Star 
                    size={13} 
                    style={{ 
                      color: selectedNote?.is_favorite ? '#eab308' : 'inherit',
                      fill: selectedNote?.is_favorite ? '#eab308' : 'none'
                    }} 
                  />
                  <span>{selectedNote?.is_favorite ? 'Unpin from Favorites' : 'Pin to Favorites'}</span>
                </button>

                <button 
                  className="dropdown-action-item" 
                  onClick={() => { onRequestMoveNotebook && onRequestMoveNotebook(selectedNote); setShowMoreMenu(false); }}
                  type="button"
                >
                  <Folder size={13} />
                  <span>Move Notebook...</span>
                </button>

                <div className="popover-divider" />

                {!isDraft && (
                  <button 
                    className="dropdown-action-item danger" 
                    onClick={() => { onRequestDeleteNote && onRequestDeleteNote(selectedNote); setShowMoreMenu(false); }}
                    type="button"
                  >
                    <Trash2 size={13} />
                    <span>Delete Note</span>
                  </button>
                )}
              </div>
            </>,
            document.body
          )}
        </div>
      </div>

      {/* Main Workspace Body: Editor + Contextual AI Right Panel */}
      <div className="editor-split-body">
        {/* Left / Center Writing Canvas */}
        <div className="editor-canvas-container">
          
          {/* Recovery Notification Banner */}
          {selectedNote && 
           selectedNote.id !== 'draft' && 
           selectedNote.session_info?.has_uncheckpointed_changes && 
           dismissedRecoveryNoteId !== selectedNote.id &&
           !isRecoveryHandled(selectedNote) && (
            <div className="recovery-alert-card">
              <div className="alert-message">
                <AlertTriangle size={15} className="alert-icon" />
                <span>Uncheckpointed changes from previous session detected on disk.</span>
              </div>
              <div className="alert-actions">
                <button 
                  className="recovery-btn keep"
                  onClick={handleKeepChanges}
                  disabled={isProcessingRecovery}
                >
                  Keep Changes
                </button>
                <button 
                  className="recovery-btn discard"
                  onClick={handleDiscardChanges}
                  disabled={isProcessingRecovery}
                >
                  Discard Changes
                </button>
              </div>
            </div>
          )}

          {/* Sync Conflict Banner */}
          {selectedNote && (selectedNote.sync_state === 'CONFLICT' || activeNoteConflict) && (
            <div className="conflict-alert-card">
              <div className="alert-message">
                <AlertTriangle size={15} className="conflict-icon" />
                <span>Sync Conflict: Concurrent independent edits exist. Local AI assistant ready to reconcile.</span>
              </div>
              <button
                className="launch-ai-resolve-btn"
                onClick={() => {
                  if (openConflictModal) {
                    openConflictModal(activeNoteConflict || selectedNote?.id);
                  }
                }}
              >
                <Sparkles size={13} />
                <span>Resolve Conflict in Studio</span>
              </button>
            </div>
          )}

          {/* Breadcrumb Path Bar with Back button & Clickable crumbs */}
          <div className="editor-breadcrumb-row" style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' }}>
            <button
              type="button"
              className="icon-btn-ghost back-nav-btn"
              onClick={() => {
                if (selectedNote?.notebook_id) {
                  window.history.pushState(null, '', `/notes/folder/${selectedNote.notebook_id}`);
                  window.dispatchEvent(new PopStateEvent('popstate'));
                } else {
                  window.history.pushState(null, '', '/notes');
                  window.dispatchEvent(new PopStateEvent('popstate'));
                }
              }}
              title="Back to Notes"
              style={{
                padding: '3px 8px',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                fontSize: '0.78rem',
                fontWeight: 600,
                color: 'var(--text-secondary)',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-subtle)',
                background: 'var(--bg-surface)',
                cursor: 'pointer'
              }}
            >
              <ArrowLeft size={13} />
              <span>Back</span>
            </button>
            <span 
              className="breadcrumb-path-text"
              onClick={() => {
                window.history.pushState(null, '', '/notes');
                window.dispatchEvent(new PopStateEvent('popstate'));
              }}
              style={{ cursor: 'pointer' }}
            >
              Notes
            </span>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>/</span>
            {selectedNote?.notebook_id && (
              <>
                <span
                  className="breadcrumb-path-text"
                  onClick={() => {
                    window.history.pushState(null, '', `/notes/folder/${selectedNote.notebook_id}`);
                    window.dispatchEvent(new PopStateEvent('popstate'));
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  {notebooks.find(nb => nb.id === selectedNote.notebook_id)?.name || 'Folder'}
                </span>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>/</span>
              </>
            )}
            <span className="breadcrumb-path-text" style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
              {editorTitle || 'Untitled Note'}
            </span>
          </div>

          {/* Note Title Input */}
          <input
            type="text"
            className="note-title-hero-input"
            placeholder="Untitled Note..."
            value={editorTitle}
            onChange={handleTitleChange}
          />

          {/* Metadata Subheading */}
          <div className="note-subheading-meta">
            <span className="meta-time">
              <Clock size={11} />
              Updated {formatRelativeTime(selectedNote.updated_at)}
            </span>
            <span className="meta-dot">·</span>
            <span className={`save-status-indicator ${savingStatus.includes('locally') ? 'saved' : 'pending'}`}>
              <span className="pulse-dot" />
              {savingStatus}
            </span>
            <span className="meta-dot">·</span>
            <span className="meta-words">{wordCount} words, {charCount} chars</span>
          </div>

          {/* Editor Textarea or Markdown Preview */}
          <div className="writing-canvas-viewport">
            {viewMode === 'edit' ? (
              <div className="textarea-relative-wrapper">
                <textarea
                  ref={textareaRef}
                  className="markdown-source-textarea"
                  placeholder="Type your notes in Markdown... Type [[ to link to other notes."
                  value={editorContent}
                  onChange={handleContentChange}
                />

                {/* [[ WikiLink Autocomplete Dropdown */}
                {wikiSuggestOpen && (
                  <div className="wikilink-floating-card">
                    <div className="wikilink-card-header">
                      <Link2 size={11} />
                      <span>Link to Note:</span>
                    </div>
                    {allNotes
                      .filter((n) => n.id !== selectedNote.id)
                      .filter((n) => !wikiQuery || (n.title && n.title.toLowerCase().includes(wikiQuery.toLowerCase())))
                      .slice(0, 6)
                      .map((n) => (
                        <div
                          key={n.id}
                          className="wikilink-suggestion-row"
                          onClick={() => handleSelectWikiSuggestion(n.title)}
                        >
                          <FileText size={12} className="sug-icon" />
                          <span className="sug-title">{n.title || 'Untitled Note'}</span>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            ) : (
              <MarkdownRenderer content={editorContent} onWikiLinkClick={onWikiLinkClick} />
            )}
          </div>

          {/* Inline Backlinks Footer */}
          {backlinks.length > 0 && (
            <div className="editor-bottom-backlinks-card">
              <div className="backlinks-header-row">
                <div className="backlinks-title-wrap">
                  <Link2 size={12} className="text-success" />
                  <span>Linked References ({backlinks.length})</span>
                </div>
              </div>
              <div className="backlinks-chips-row">
                {backlinks.map((bl) => (
                  <button
                    key={bl.id}
                    className="backlink-chip-btn"
                    onClick={() => onNavigateToNote && onNavigateToNote(bl.id)}
                    title={`Go to note: ${bl.title}`}
                    type="button"
                  >
                    <ArrowLeft size={11} />
                    <span>{bl.title}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right: Contextual AI & Knowledge Panel */}
        <ContextualAiPanel
          selectedNote={selectedNote}
          allNotes={allNotes}
          notebooks={notebooks}
          onNavigateToNote={onNavigateToNote}
          onOpenConflictModal={openConflictModal}
          activeConflict={activeNoteConflict}
          isOpen={showAiPanel}
          onClose={() => setShowAiPanel(false)}
        />
      </div>

      {/* Monospace System Footer */}
      <footer className="editor-system-footer">
        <div className="footer-left">
          <span className="system-pill">ID: {selectedNote.id}</span>
          {selectedNote.content_hash && (
            <span className="system-pill">
              <Hash size={10} />
              sha256: {selectedNote.content_hash.substring(0, 12)}
            </span>
          )}
          <span className="system-pill active">
            <GitBranch size={10} />
            V{historyList.length > 0 ? historyList.length : 1}
          </span>
        </div>
        <div className="footer-right">
          <span className="system-pill">
            {isDraft ? 'Unsaved draft' : (selectedNote.file_path ? selectedNote.file_path.split(/[\\/]/).pop() : 'note.md')}
          </span>
        </div>
      </footer>

      {/* Modals & Drawers */}
      <CheckpointModal
        isOpen={showCheckpointModal}
        onConfirm={handleCreateCheckpoint}
        onCancel={() => setShowCheckpointModal(false)}
        statusMessage={checkpointStatusMsg}
        isSubmitting={isSubmittingCheckpoint}
      />

      <VersionHistoryDrawer
        isOpen={showHistoryDrawer}
        onClose={() => setShowHistoryDrawer(false)}
        history={historyList}
        currentVersionId={selectedNote?.current_version_id}
        selectedNote={selectedNote}
        allNotes={allNotes}
        onOpenCheckpointModal={() => setShowCheckpointModal(true)}
        onViewChanges={handleViewChanges}
        onViewVersion={handleViewVersion}
        onRestoreVersion={handleRestoreVersion}
      />

      <DiffViewerModal
        isOpen={showDiffModal}
        onClose={() => setShowDiffModal(false)}
        diffData={selectedDiffData}
      />

      <VersionPreviewModal
        isOpen={showPreviewModal}
        onClose={() => setShowPreviewModal(false)}
        versionData={selectedPreviewData}
        isLoading={isLoadingPreview}
        error={previewError}
        onRestore={handleRestoreVersion}
      />

      <SyncModeModal
        isOpen={syncModeModalState.isOpen}
        note={selectedNote}
        targetMode={syncModeModalState.targetMode}
        onClose={() => setSyncModeModalState({ isOpen: false, targetMode: null })}
        onConfirm={handleConfirmSyncMode}
      />
    </main>
  );
}
