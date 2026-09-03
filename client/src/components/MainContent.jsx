import React, { useState, useEffect, useRef, useCallback } from 'react';
import MarkdownRenderer from './MarkdownRenderer';
import EditorToolbar from './EditorToolbar';
import CheckpointModal from './CheckpointModal';
import VersionHistoryDrawer from './VersionHistoryDrawer';
import DiffViewerModal from './DiffViewerModal';
import VersionPreviewModal from './VersionPreviewModal';
import ConflictResolverModal from './ConflictResolverModal';
import SyncModeModal from './SyncModeModal';
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
  AlertTriangle
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

  // Interactive Action Drawers & Modals State
  const [showHistoryDrawer, setShowHistoryDrawer] = useState(false);
  const [showSyncDrawer, setShowSyncDrawer] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [copiedToast, setCopiedToast] = useState(false);

  // Version Control States
  const [showCheckpointModal, setShowCheckpointModal] = useState(false);
  const [showDiffModal, setShowDiffModal] = useState(false);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [showConflictModal, setShowConflictModal] = useState(false);

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

  const handleBadgeClick = () => {
    if (!selectedNote) return;
    const nextMode = currentNoteMode === 'local' ? 'cloud' : (currentNoteMode === 'cloud' ? 'lan' : 'local');
    handleDirectModeChange(nextMode);
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

    console.log(`[NoteAutosave] noteId: ${targetNoteId}, contentLength: ${savingContent ? savingContent.length : 0}, contentPreview: ${savingContent ? savingContent.substring(0, 30) : ''}, requestSequence: ${currentReqId}`);
    
    try {
      setSavingStatus('Saving...');
      const updated = await onUpdateNote(targetNoteId, {
        title: savingTitle,
        content: savingContent,
        notebook_id: savingNotebookId
      });
      
      if (currentReqId === latestRequestIdRef.current) {
        // If contentRef has not changed while save was in flight, mark save complete
        if (contentRef.current === savingContent && titleRef.current === savingTitle && notebookIdRef.current === savingNotebookId) {
          pendingSaveRef.current = false;
          setSavingStatus('Saved locally');
        } else {
          // User typed additional characters while save was in flight!
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

  // Handle note switching & unmounting: flush pending changes of previous note
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
      setHistoryList(historyData);
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

  // Helper to insert Markdown syntax at active cursor in textarea
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

  // Checkpoint Action Handlers
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

  // Version History Action Handlers
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
      console.log(`[RestoreStart] requestedVersionId: ${version.id}, versionNumber: V${version.version_number}`);
      
      const res = await notesApi.restoreVersion(selectedNote.id, version.id);
      const payload = res?.data || res;
      const restoredContent = payload?.content;
      const newVersion = payload?.version;

      if (!newVersion || !newVersion.id || restoredContent === undefined) {
        throw new Error('Invalid version payload returned from restore API');
      }

      if (currentReqId !== latestRequestIdRef.current) {
        console.warn(`[Restore] Stale restore response dropped for ${version.id}`);
        return;
      }

      console.log(`[RestoreFinish] requested V${version.version_number} (${version.id}) -> new restored V${newVersion.version_number} (${newVersion.id}) set as CURRENT`);

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
      <main className="editor-pane" style={{ alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
        <div style={{ maxWidth: '320px', color: 'var(--text-muted)' }}>
          <FileText size={32} style={{ margin: '0 auto 12px auto', display: 'block', opacity: 0.3 }} />
          <h3 style={{ fontSize: '0.92rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
            No Note Selected
          </h3>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: '14px' }}>
            Click + New Note to start writing instantly.
          </p>
          <button className="new-note-btn" style={{ width: 'auto', margin: '0 auto' }} onClick={onCreateNote}>
            <span>+ New Note</span>
          </button>
        </div>
      </main>
    );
  }

  const isDraft = selectedNote.id === 'draft';

  return (
    <main className="editor-pane" style={{ position: 'relative' }}>
      {/* Toast Notification Banner */}
      {toastNotification && (
        <div style={{
          position: 'absolute',
          top: '52px',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 220,
          background: 'var(--text-primary)',
          color: 'var(--bg-app)',
          padding: '6px 14px',
          borderRadius: 'var(--radius-sm)',
          fontSize: '0.78rem',
          fontWeight: 600,
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          display: 'flex',
          alignItems: 'center',
          gap: '6px'
        }}>
          <Check size={14} style={{ color: 'var(--accent-emerald)' }} />
          <span>{toastNotification}</span>
        </div>
      )}

      {/* Editor Header Bar */}
      <div className="editor-header-bar">
        {/* Left: Edit | Preview Tabs & Formatting Toolbar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div className="editor-tabs">
            <button 
              className={`editor-tab-btn ${viewMode === 'edit' ? 'active' : ''}`}
              onClick={() => setViewMode('edit')}
            >
              <Edit3 size={13} />
              <span>Edit</span>
            </button>
            <button 
              className={`editor-tab-btn ${viewMode === 'preview' ? 'active' : ''}`}
              onClick={() => setViewMode('preview')}
            >
              <Eye size={13} />
              <span>Preview</span>
            </button>
          </div>

          {/* Minimal Formatting Toolbar (In Edit Mode) */}
          {viewMode === 'edit' && <EditorToolbar onInsertSyntax={handleInsertSyntax} />}
        </div>

        {/* Right: Checkpoint Action, Notebook Selector & Action Drawers */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* Explicit Checkpoint Button */}
          {!isDraft && (
            <button 
              className="toolbar-btn"
              onClick={handleOpenCheckpointModal}
              title="Create Version Checkpoint"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                fontSize: '0.74rem',
                fontWeight: 600,
                padding: '3px 9px',
                background: 'rgba(99, 102, 241, 0.12)',
                border: '1px solid rgba(99, 102, 241, 0.3)',
                color: 'var(--accent-primary)'
              }}
            >
              <GitCommit size={13} />
              <span>Checkpoint</span>
            </button>
          )}

          {/* Notebook Dropdown */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
            <BookOpen size={13} />
            <select
              value={editorNotebookId || ''}
              onChange={handleNotebookChange}
              style={{
                background: 'var(--bg-input)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-subtle)',
                padding: '2px 6px',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.74rem',
                outline: 'none'
              }}
            >
              <option value="">Unassigned</option>
              {notebooks.map((nb) => (
                <option key={nb.id} value={nb.id}>
                  {nb.name}
                </option>
              ))}
            </select>
          </div>

          {/* 1-Click Direct Sync Mode Selector */}
          <div className="sync-mode-segmented-control">
            <button
              type="button"
              className={`sync-mode-segment-btn ${currentNoteMode === 'local' ? 'active' : ''}`}
              onClick={() => handleDirectModeChange('local')}
              title="Store on this device only"
            >
              LOCAL
            </button>
            <button
              type="button"
              className={`sync-mode-segment-btn ${currentNoteMode === 'cloud' ? 'active' : ''}`}
              onClick={() => handleDirectModeChange('cloud')}
              title="Enable Google Drive Cloud Sync"
            >
              CLOUD
            </button>
            <button
              type="button"
              className={`sync-mode-segment-btn ${currentNoteMode === 'lan' ? 'active' : ''}`}
              onClick={() => handleDirectModeChange('lan')}
              title="Enable Encrypted P2P LAN Sync"
            >
              LAN
            </button>
          </div>

          {/* Sync Status Badge & Action */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <NoteSyncBadge note={selectedNote} />
            {currentNoteMode === 'cloud' && (
              <button
                type="button"
                className="toolbar-btn"
                onClick={handleSyncSingleNote}
                disabled={isSyncingSingle || sync?.isSyncing}
                title="Sync this note to Google Drive now"
                style={{ 
                  display: 'inline-flex', 
                  alignItems: 'center', 
                  gap: '4px', 
                  fontSize: '0.68rem', 
                  padding: '2px 7px', 
                  borderRadius: '4px', 
                  background: 'rgba(38, 132, 252, 0.14)', 
                  color: '#2684fc', 
                  border: '1px solid rgba(38, 132, 252, 0.3)', 
                  cursor: (isSyncingSingle || sync?.isSyncing) ? 'wait' : 'pointer',
                  fontWeight: 600
                }}
              >
                <RefreshCw size={11} className={(isSyncingSingle || sync?.isSyncing) ? 'spin' : ''} />
                <span>{(isSyncingSingle || sync?.isSyncing) ? 'Syncing...' : 'Sync Now'}</span>
              </button>
            )}
          </div>

          {/* Backlinks Inspector Toggle */}
          <button 
            className={`toolbar-btn ${showBacklinks ? 'active' : ''}`}
            onClick={() => setShowBacklinks(!showBacklinks)}
            title="Toggle Backlinks Inspector"
            style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.74rem', padding: '3px 7px' }}
          >
            <Link2 size={13} style={{ color: backlinks.length > 0 ? 'var(--accent-emerald)' : 'inherit' }} />
            <span>{backlinks.length}</span>
          </button>

          {/* View Connections in Knowledge Graph */}
          <button 
            className="toolbar-btn"
            onClick={() => onOpenGraphView && onOpenGraphView(selectedNote.id)}
            title="View Connections in Knowledge Graph"
            style={{ color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.74rem', padding: '3px 7px', background: 'rgba(99, 102, 241, 0.08)', border: '1px solid rgba(99, 102, 241, 0.2)' }}
          >
            <Share2 size={13} />
            <span>Graph</span>
          </button>

          {/* Interactive Header Buttons */}
          <button 
            className={`toolbar-btn ${showHistoryDrawer ? 'active' : ''}`} 
            onClick={() => { 
              if (!isDraft) loadHistory(selectedNote.id);
              setShowHistoryDrawer(!showHistoryDrawer); 
              setShowSyncDrawer(false); 
              setShowMoreMenu(false); 
            }}
            title="View Version History Graph"
          >
            <History size={13} />
          </button>

          <button 
            className={`toolbar-btn ${showSyncDrawer ? 'active' : ''}`} 
            onClick={() => { setShowSyncDrawer(!showSyncDrawer); setShowHistoryDrawer(false); setShowMoreMenu(false); }}
            title="Local Disk Sync Status"
          >
            <RefreshCw size={13} />
          </button>

          <button 
            className={`toolbar-btn ${showMoreMenu ? 'active' : ''}`} 
            onClick={() => { setShowMoreMenu(!showMoreMenu); setShowHistoryDrawer(false); setShowSyncDrawer(false); }}
            title="More Options"
          >
            <MoreHorizontal size={13} />
          </button>

          {!isDraft && (
            <button 
              onClick={() => onRequestDeleteNote(selectedNote)}
              style={{ background: 'none', border: 'none', color: 'var(--accent-danger)', cursor: 'pointer', opacity: 0.8 }}
              title="Delete note"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Popover Drawer: Storage Sync Status */}
      {showSyncDrawer && (
        <div className="info-popover-drawer">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
            <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--accent-emerald)' }}>● Local Storage Status</span>
            <button style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }} onClick={() => setShowSyncDrawer(false)}>×</button>
          </div>
          <p style={{ fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
            {isDraft ? 'Unsaved temporary draft' : 'Physical .md file synced to disk. SQLite metadata index & line diffs saved.'}
          </p>
        </div>
      )}

      {/* Popover Drawer: More Options Menu */}
      {showMoreMenu && (
        <div className="info-popover-drawer" style={{ right: '40px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div className="context-menu-item" onClick={() => { copyFilePath(); setShowMoreMenu(false); }}>
              {copiedToast ? <Check size={13} style={{ color: 'var(--accent-emerald)' }} /> : <Copy size={13} />}
              <span>{copiedToast ? 'Copied Path!' : 'Copy Disk File Path'}</span>
            </div>

            <div className="context-menu-item" onClick={() => { onToggleFavorite(selectedNote); setShowMoreMenu(false); }}>
              <Star size={13} style={{ color: selectedNote.is_favorite ? 'var(--accent-warning)' : 'inherit' }} />
              <span>{selectedNote.is_favorite ? 'Unfavorite Note' : 'Favorite Note'}</span>
            </div>

            <div className="context-menu-item" onClick={() => { onRequestMoveNotebook(selectedNote); setShowMoreMenu(false); }}>
              <Folder size={13} />
              <span>Move to Notebook</span>
            </div>
          </div>
        </div>
      )}

      {/* Main Workspace: Editor Canvas + Inline Backlinks + Side Inspector */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Writing Canvas */}
        <div className="editor-workspace">
          {/* Session Recovery Banner */}
          {selectedNote && 
           selectedNote.id !== 'draft' && 
           selectedNote.session_info?.has_uncheckpointed_changes && 
           dismissedRecoveryNoteId !== selectedNote.id &&
           !isRecoveryHandled(selectedNote) && (
            <div className="session-recovery-banner">
              <div className="recovery-message">
                <AlertTriangle size={15} className="recovery-icon" />
                <span>Uncheckpointed changes from previous session</span>
              </div>
              <div className="recovery-actions">
                <button 
                  className="recovery-btn keep-btn"
                  onClick={handleKeepChanges}
                  disabled={isProcessingRecovery}
                >
                  Keep Changes
                </button>
                <button 
                  className="recovery-btn discard-btn"
                  onClick={handleDiscardChanges}
                  disabled={isProcessingRecovery}
                >
                  Discard Changes
                </button>
              </div>
            </div>
          )}

          {/* Conflict Resolution Banner */}
          {selectedNote && selectedNote.sync_state === 'CONFLICT' && (
            <div className="session-recovery-banner" style={{ background: 'rgba(239, 68, 68, 0.12)', borderBottom: '1px solid rgba(239, 68, 68, 0.3)' }}>
              <div className="recovery-message">
                <AlertTriangle size={15} style={{ color: '#ef4444' }} />
                <span style={{ color: '#ef4444', fontWeight: 600 }}>Sync Conflict: Cloud and local changes conflict.</span>
              </div>
              <div className="recovery-actions">
                <button
                  className="btn-recovery btn-checkpoint"
                  style={{ background: '#ef4444', color: '#ffffff' }}
                  onClick={() => setShowConflictModal(true)}
                >
                  Resolve Conflict
                </button>
              </div>
            </div>
          )}

          {/* Derived Primary Path */}
          <div className="editor-top-path-bar">
            <div className="editor-primary-path">
              {getNotePath(selectedNote, notebooks)}
            </div>
          </div>

          {/* Title Input */}
          <input
            type="text"
            className="editor-title-input"
            placeholder="Note Title..."
            value={editorTitle}
            onChange={handleTitleChange}
          />

          {/* Subtitle Metadata */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: '-8px' }}>
            <span>Updated {formatRelativeTime(selectedNote.updated_at)}</span>
            <span>•</span>
            <span style={{ color: isDraft ? 'var(--accent-warning)' : 'var(--accent-emerald)' }}>
              ● {savingStatus}
            </span>
          </div>

          {/* Content View: Textarea or Rendered Markdown */}
          {viewMode === 'edit' ? (
            <div style={{ position: 'relative', flex: 1, display: 'flex', flexDirection: 'column' }}>
              <textarea
                ref={textareaRef}
                className="editor-content-textarea"
                placeholder="Write in Markdown format (# Heading, **bold**, [[Note Link]])..."
                value={editorContent}
                onChange={handleContentChange}
              />

              {/* WikiLink [[ Autocomplete Dropdown */}
              {wikiSuggestOpen && (
                <div className="wikilink-autocomplete-card">
                  <div className="wikilink-card-header">
                    <span>Link to Note:</span>
                  </div>
                  {allNotes
                    .filter((n) => n.id !== selectedNote.id)
                    .filter((n) => !wikiQuery || (n.title && n.title.toLowerCase().includes(wikiQuery.toLowerCase())))
                    .slice(0, 6)
                    .map((n) => (
                      <div
                        key={n.id}
                        className="wikilink-item-option"
                        onClick={() => handleSelectWikiSuggestion(n.title)}
                      >
                        <FileText size={13} className="option-icon" />
                        <span className="option-title">{n.title || 'Untitled Note'}</span>
                      </div>
                    ))}
                </div>
              )}
            </div>
          ) : (
            <MarkdownRenderer content={editorContent} onWikiLinkClick={onWikiLinkClick} />
          )}

          {/* Bottom Backlinks Section */}
          <div className="editor-backlinks-section">
            <div className="backlinks-section-title">Backlinks</div>
            {backlinks.length === 0 ? (
              <div className="no-backlinks-text">No backlinks yet</div>
            ) : (
              <div className="backlinks-list">
                {backlinks.map((bl) => (
                  <button
                    key={bl.id}
                    className="backlink-item-btn"
                    onClick={() => onNavigateToNote && onNavigateToNote(bl.id)}
                    title={`Click to open ${bl.title}`}
                  >
                    <ArrowLeft size={12} />
                    <span>{bl.title}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Backlinks Inspector Drawer (Side Drawer) */}
        {showBacklinks && (
          <div className="backlinks-inspector-pane">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px', paddingBottom: '6px', borderBottom: '1px solid var(--border-subtle)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                <Link2 size={13} style={{ color: 'var(--accent-emerald)' }} />
                <span>Linked References</span>
              </div>
              <span className="badge-count">{backlinks.length}</span>
            </div>

            {backlinks.length === 0 ? (
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                No notes link to <code className="md-inline-code">[[{selectedNote.title}]]</code> yet.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {backlinks.map((bl) => (
                  <div 
                    key={bl.id} 
                    className="backlink-card"
                    onClick={() => onNavigateToNote && onNavigateToNote(bl.id)}
                  >
                    <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '2px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <ArrowLeft size={11} style={{ color: 'var(--accent-primary)' }} />
                      <span>{bl.title}</span>
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                      "...{bl.snippet}..."
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Monospace Metadata Footer */}
      <div className="editor-footer-meta">
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span>ID: {selectedNote.id}</span>
          {selectedNote.content_hash && (
            <>
              <span style={{ opacity: 0.5 }}>·</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <Hash size={11} />
                sha256: {selectedNote.content_hash.substring(0, 10)}...
              </span>
            </>
          )}
          <span style={{ opacity: 0.5 }}>·</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--accent-primary)', fontWeight: 500 }}>
            <GitBranch size={11} />
            V{historyList.length > 0 ? historyList.length : 1}
          </span>
        </div>
        <div>
          {isDraft ? 'Draft (Unsaved)' : (selectedNote.file_path ? selectedNote.file_path.split(/[\\/]/).pop() : 'markdown.md')}
        </div>
      </div>

      {/* Version Control Modals & Drawers */}
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

      <ConflictResolverModal
        isOpen={showConflictModal}
        note={selectedNote}
        onClose={() => setShowConflictModal(false)}
        onResolved={(noteId, choice) => {
          onUpdateNote && onUpdateNote(noteId, { sync_state: 'SYNCED' });
        }}
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
