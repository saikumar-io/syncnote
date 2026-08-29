import React, { useState, useEffect, useRef } from 'react';
import MarkdownRenderer from './MarkdownRenderer';
import EditorToolbar from './EditorToolbar';
import { formatRelativeTime } from '../utils/timeUtils';
import { getBacklinksForNote } from '../utils/backlinksParser';
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
  ArrowLeft
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

  // Interactive Action Drawers State
  const [showHistoryDrawer, setShowHistoryDrawer] = useState(false);
  const [showSyncDrawer, setShowSyncDrawer] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [copiedToast, setCopiedToast] = useState(false);

  const textareaRef = useRef(null);

  useEffect(() => {
    if (selectedNote) {
      setEditorTitle(selectedNote.title || '');
      setEditorContent(selectedNote.content || '');
      setEditorNotebookId(selectedNote.notebook_id || '');
      setSavingStatus(selectedNote.id === 'draft' ? 'Unsaved draft' : 'Saved locally');
    }
  }, [selectedNote]);

  const handleTitleChange = (e) => {
    const newTitle = e.target.value;
    setEditorTitle(newTitle);
    setSavingStatus('Saving...');
    onUpdateNote(selectedNote.id, { title: newTitle, content: editorContent, notebook_id: editorNotebookId });
    setTimeout(() => setSavingStatus('Saved locally'), 400);
  };

  const handleContentChange = (e) => {
    const newContent = e.target.value;
    setEditorContent(newContent);
    setSavingStatus('Saving...');
    onUpdateNote(selectedNote.id, { title: editorTitle, content: newContent, notebook_id: editorNotebookId });
    setTimeout(() => setSavingStatus('Saved locally'), 400);
  };

  const handleNotebookChange = (e) => {
    const newNbId = e.target.value || null;
    setEditorNotebookId(newNbId);
    setSavingStatus('Saving...');
    onUpdateNote(selectedNote.id, { title: editorTitle, content: editorContent, notebook_id: newNbId });
    setTimeout(() => setSavingStatus('Saved locally'), 400);
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
    onUpdateNote(selectedNote.id, { title: editorTitle, content: newContent, notebook_id: editorNotebookId });
    
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

  const backlinks = selectedNote ? getBacklinksForNote(selectedNote, allNotes) : [];

  // If no note selected, render clean empty state
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

        {/* Right: Notebook Selector & Interactive Action Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
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
            onClick={() => { setShowHistoryDrawer(!showHistoryDrawer); setShowSyncDrawer(false); setShowMoreMenu(false); }}
            title="View Note Version Metadata"
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

      {/* Popover Drawer 1: Version History Metadata */}
      {showHistoryDrawer && (
        <div className="info-popover-drawer">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
            <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-primary)' }}>Version & Hash Metadata</span>
            <button style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }} onClick={() => setShowHistoryDrawer(false)}>×</button>
          </div>
          <div style={{ fontSize: '0.72rem', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span>• Version ID: {selectedNote.current_version_id || 'v1_initial'}</span>
            <span>• Content Hash: {selectedNote.content_hash || 'sha256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'}</span>
            <span>• Disk Path: {selectedNote.file_path || 'Unsaved draft'}</span>
          </div>
        </div>
      )}

      {/* Popover Drawer 2: Storage Sync Status */}
      {showSyncDrawer && (
        <div className="info-popover-drawer">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
            <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--accent-emerald)' }}>● Local Storage Status</span>
            <button style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }} onClick={() => setShowSyncDrawer(false)}>×</button>
          </div>
          <p style={{ fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
            {isDraft ? 'Unsaved temporary draft' : 'Physical .md file synced to disk. SQLite metadata index up to date.'}
          </p>
        </div>
      )}

      {/* Popover Drawer 3: More Options Menu */}
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
            <textarea
              ref={textareaRef}
              className="editor-content-textarea"
              placeholder="Write in Markdown format (# Heading, **bold**, [[Note Link]])..."
              value={editorContent}
              onChange={handleContentChange}
            />
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span>ID: {selectedNote.id}</span>
          {selectedNote.content_hash && (
            <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
              <Hash size={11} />
              sha256: {selectedNote.content_hash.substring(0, 10)}...
            </span>
          )}
          {selectedNote.current_version_id && (
            <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
              <GitBranch size={11} />
              {selectedNote.current_version_id.split('_')[0] || 'v1'}
            </span>
          )}
        </div>
        <div>
          {isDraft ? 'Draft (Unsaved)' : (selectedNote.file_path ? selectedNote.file_path.split(/[\\/]/).pop() : 'markdown.md')}
        </div>
      </div>
    </main>
  );
}
