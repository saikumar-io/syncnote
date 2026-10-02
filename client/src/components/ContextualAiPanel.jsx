import React, { useState, useEffect, useCallback } from 'react';
import { 
  Sparkles, 
  AlertTriangle, 
  FileText, 
  Link2, 
  ArrowLeft, 
  Tag, 
  Cpu, 
  CheckCircle2, 
  RefreshCw, 
  Layers, 
  ChevronRight,
  ExternalLink,
  Search,
  BookOpen
} from 'lucide-react';
import { apiClient } from '../api/apiClient';

export default function ContextualAiPanel({
  selectedNote,
  allNotes = [],
  notebooks = [],
  onNavigateToNote,
  onOpenConflictModal,
  activeConflict,
  isOpen,
  onClose
}) {
  const [ollamaInfo, setOllamaInfo] = useState({ available: false, model: 'llama3.2:1b', loading: true, host: 'http://127.0.0.1:11434' });
  const [isCheckingOllama, setIsCheckingOllama] = useState(false);
  const [aiSearchQuery, setAiSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('insights'); // 'insights' | 'links' | 'search'

  // Fetch live Ollama AI engine status
  const checkOllamaStatus = useCallback(async () => {
    setIsCheckingOllama(true);
    try {
      const res = await apiClient.get('/api/conflicts/status');
      if (res && res.ollama) {
        setOllamaInfo({
          available: Boolean(res.ollama.available),
          model: res.ollama.configuredModel || 'llama3.2:1b',
          host: res.ollama.host || 'http://127.0.0.1:11434',
          loading: false
        });
      } else {
        setOllamaInfo(prev => ({ ...prev, loading: false }));
      }
    } catch {
      setOllamaInfo(prev => ({ ...prev, loading: false }));
    } finally {
      setIsCheckingOllama(false);
    }
  }, []);

  useEffect(() => {
    checkOllamaStatus();
  }, [checkOllamaStatus]);

  if (!isOpen) return null;

  // Extract Outbound WikiLinks from current note content [[Note Title]]
  const outboundLinks = [];
  if (selectedNote && selectedNote.content) {
    const wikiRegex = /\[\[(.*?)\]\]/g;
    let match;
    const seen = new Set();
    while ((match = wikiRegex.exec(selectedNote.content)) !== null) {
      const linkTitle = match[1].trim();
      if (!seen.has(linkTitle.toLowerCase())) {
        seen.add(linkTitle.toLowerCase());
        const targetNote = allNotes.find(n => n.title && n.title.trim().toLowerCase() === linkTitle.toLowerCase());
        outboundLinks.push({
          title: linkTitle,
          targetId: targetNote ? targetNote.id : null,
          exists: Boolean(targetNote)
        });
      }
    }
  }

  // Extract Inbound Backlinks (other notes that link to this note)
  const inboundBacklinks = [];
  if (selectedNote && selectedNote.title) {
    const noteTitleNorm = selectedNote.title.trim().toLowerCase();
    const pattern = new RegExp(`\\[\\[${selectedNote.title.trim()}\\]\\]`, 'i');

    allNotes.forEach(otherNote => {
      if (otherNote.id === selectedNote.id) return;
      if (otherNote.content && pattern.test(otherNote.content)) {
        // Extract snippet
        const idx = otherNote.content.toLowerCase().indexOf(`[[${noteTitleNorm}]]`);
        const start = Math.max(0, idx - 40);
        const end = Math.min(otherNote.content.length, idx + noteTitleNorm.length + 45);
        const snippet = (start > 0 ? '...' : '') + otherNote.content.substring(start, end).replace(/\n/g, ' ') + (end < otherNote.content.length ? '...' : '');

        inboundBacklinks.push({
          id: otherNote.id,
          title: otherNote.title || 'Untitled Note',
          snippet
        });
      }
    });
  }

  // Extract Suggested Tags (from #hashtags or headings)
  const suggestedTags = [];
  if (selectedNote && selectedNote.content) {
    const tagMatches = selectedNote.content.match(/#([a-zA-Z0-9_\-]+)/g) || [];
    const uniqueTags = Array.from(new Set(tagMatches.map(t => t.replace('#', ''))));
    uniqueTags.forEach(t => suggestedTags.push(t));

    // Also extract headings as key topics if few tags
    if (suggestedTags.length < 3) {
      const headingMatches = selectedNote.content.match(/^#{1,3}\s+(.+)$/gm) || [];
      headingMatches.slice(0, 3).forEach(h => {
        const clean = h.replace(/^#{1,3}\s+/, '').trim();
        if (clean && !suggestedTags.includes(clean)) {
          suggestedTags.push(clean);
        }
      });
    }
  }

  // Automatic Note Summary / Key Insights
  const generateSummary = () => {
    if (!selectedNote || !selectedNote.content) return 'No content to analyze.';
    const lines = selectedNote.content.split('\n').filter(l => l.trim().length > 0 && !l.trim().startsWith('#'));
    if (lines.length > 0) {
      return lines.slice(0, 3).join(' ').substring(0, 240) + (lines.slice(0, 3).join(' ').length > 240 ? '...' : '');
    }
    return 'Short note with headings and structured elements.';
  };

  // Semantic / Keyword Search Results inside AI Panel
  const searchResults = aiSearchQuery.trim()
    ? allNotes.filter(n => {
        const q = aiSearchQuery.toLowerCase();
        return (n.title && n.title.toLowerCase().includes(q)) || (n.content && n.content.toLowerCase().includes(q));
      }).slice(0, 6)
    : [];

  return (
    <aside className="contextual-ai-panel">
      {/* Header */}
      <div className="ai-panel-header">
        <div className="ai-header-left">
          <div className="ai-pulse-icon">
            <Sparkles size={14} className="sparkle-svg" />
          </div>
          <span className="ai-header-title">AI & Knowledge Assistant</span>
        </div>
        <button 
          className="icon-btn-ghost ai-close-btn" 
          onClick={onClose}
          title="Close Context Panel"
        >
          <ChevronRight size={15} />
        </button>
      </div>

      {/* Engine Status Pill */}
      <div className={`ai-status-card ${ollamaInfo.available ? 'is-online' : 'is-offline'}`}>
        <div className="status-row">
          <div className="engine-indicator">
            <span className={`status-dot ${ollamaInfo.available ? 'online' : 'offline'}`} />
            <span className="engine-name">
              {ollamaInfo.available ? `Ollama (${ollamaInfo.model})` : 'Ollama Offline'}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span className="offline-guarantee-tag">Private · Local</span>
            <button
              type="button"
              className="icon-btn-ghost check-ollama-btn"
              onClick={checkOllamaStatus}
              title="Re-check Ollama daemon status"
              disabled={isCheckingOllama}
              style={{ padding: '2px 4px', height: '20px', borderRadius: '4px' }}
            >
              <RefreshCw size={11} className={isCheckingOllama ? 'spin' : ''} />
            </button>
          </div>
        </div>
        <p className="engine-desc">
          {ollamaInfo.available 
            ? `Active on ${ollamaInfo.host}. Local model acceleration enabled for note summaries and semantic merge.`
            : `Ollama Offline. Start Ollama to use local AI features. Local heuristic merge, bidirectional backlinks, and document graph intelligence remain fully operational.`}
        </p>
      </div>

      {/* Active Conflict Banner if note is in CONFLICT */}
      {(selectedNote?.sync_state === 'CONFLICT' || activeConflict) && (
        <div className="ai-conflict-callout">
          <div className="conflict-callout-header">
            <AlertTriangle size={15} className="warning-icon" />
            <span className="callout-title">Sync Conflict Detected</span>
          </div>
          <p className="callout-desc">
            Concurrent independent modifications exist for this note. AI semantic analysis is prepared to evaluate differences.
          </p>
          <button
            type="button"
            className="ai-resolve-launch-btn"
            onClick={() => onOpenConflictModal && onOpenConflictModal(activeConflict || selectedNote)}
          >
            <Sparkles size={13} />
            <span>Launch AI Merge Studio</span>
          </button>
        </div>
      )}

      {/* Tab Navigation */}
      <div className="ai-panel-tabs">
        <button
          className={`ai-tab-btn ${activeTab === 'insights' ? 'active' : ''}`}
          onClick={() => setActiveTab('insights')}
        >
          <Layers size={12} />
          <span>Insights</span>
        </button>
        <button
          className={`ai-tab-btn ${activeTab === 'links' ? 'active' : ''}`}
          onClick={() => setActiveTab('links')}
        >
          <Link2 size={12} />
          <span>Connections ({outboundLinks.length + inboundBacklinks.length})</span>
        </button>
        <button
          className={`ai-tab-btn ${activeTab === 'search' ? 'active' : ''}`}
          onClick={() => setActiveTab('search')}
        >
          <Search size={12} />
          <span>Semantic Search</span>
        </button>
      </div>

      {/* Tab 1: Insights & Summary */}
      {activeTab === 'insights' && (
        <div className="ai-tab-content">
          {/* Note Summary */}
          <div className="ai-section-box">
            <div className="section-box-header">
              <BookOpen size={12} />
              <span>Document Summary</span>
            </div>
            <p className="summary-text">{generateSummary()}</p>
          </div>

          {/* Key Topics & Tags */}
          <div className="ai-section-box">
            <div className="section-box-header">
              <Tag size={12} />
              <span>Extracted Topics & Tags</span>
            </div>
            {suggestedTags.length === 0 ? (
              <p className="empty-subtext">Add #tags or Markdown headings to extract topics.</p>
            ) : (
              <div className="tag-chips-wrap">
                {suggestedTags.map((tag, idx) => (
                  <span key={idx} className="ai-tag-chip">
                    #{tag}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Note Stats */}
          <div className="ai-section-box">
            <div className="section-box-header">
              <Cpu size={12} />
              <span>Note Metrics</span>
            </div>
            <div className="metrics-grid">
              <div className="metric-cell">
                <span className="metric-val">{selectedNote?.content ? selectedNote.content.split(/\s+/).filter(Boolean).length : 0}</span>
                <span className="metric-lbl">Words</span>
              </div>
              <div className="metric-cell">
                <span className="metric-val">{selectedNote?.content ? selectedNote.content.length : 0}</span>
                <span className="metric-lbl">Characters</span>
              </div>
              <div className="metric-cell">
                <span className="metric-val">{outboundLinks.length}</span>
                <span className="metric-lbl">WikiLinks</span>
              </div>
              <div className="metric-cell">
                <span className="metric-val">{inboundBacklinks.length}</span>
                <span className="metric-lbl">Backlinks</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Connections & WikiLinks */}
      {activeTab === 'links' && (
        <div className="ai-tab-content">
          {/* Outbound WikiLinks */}
          <div className="ai-section-box">
            <div className="section-box-header">
              <ExternalLink size={12} />
              <span>Outbound Knowledge Links ({outboundLinks.length})</span>
            </div>
            {outboundLinks.length === 0 ? (
              <p className="empty-subtext">Type [[Note Title]] in the editor to link to another note.</p>
            ) : (
              <div className="links-list">
                {outboundLinks.map((link, idx) => (
                  <div
                    key={idx}
                    className={`knowledge-link-card ${link.exists ? 'interactive' : 'missing'}`}
                    onClick={() => {
                      if (link.targetId && onNavigateToNote) {
                        onNavigateToNote(link.targetId);
                      }
                    }}
                  >
                    <FileText size={13} className="link-file-icon" />
                    <span className="link-title">{link.title}</span>
                    {!link.exists && <span className="missing-pill">Uncreated</span>}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Inbound Backlinks */}
          <div className="ai-section-box">
            <div className="section-box-header">
              <ArrowLeft size={12} />
              <span>Inbound Backlinks ({inboundBacklinks.length})</span>
            </div>
            {inboundBacklinks.length === 0 ? (
              <p className="empty-subtext">No other notes currently link to this note.</p>
            ) : (
              <div className="links-list">
                {inboundBacklinks.map((bl) => (
                  <div
                    key={bl.id}
                    className="backlink-preview-card"
                    onClick={() => onNavigateToNote && onNavigateToNote(bl.id)}
                  >
                    <div className="bl-header">
                      <FileText size={12} />
                      <span className="bl-title">{bl.title}</span>
                    </div>
                    <p className="bl-snippet">"{bl.snippet}"</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 3: Semantic Search */}
      {activeTab === 'search' && (
        <div className="ai-tab-content">
          <div className="ai-search-input-wrap">
            <Search size={13} className="ai-search-icon" />
            <input
              type="text"
              className="ai-search-field"
              placeholder="Search concepts or notes..."
              value={aiSearchQuery}
              onChange={(e) => setAiSearchQuery(e.target.value)}
              autoFocus
            />
          </div>

          {aiSearchQuery.trim() === '' ? (
            <p className="empty-subtext" style={{ textAlign: 'center', marginTop: '16px' }}>
              Type keywords or phrases to search across your local notes knowledge base.
            </p>
          ) : searchResults.length === 0 ? (
            <p className="empty-subtext" style={{ textAlign: 'center', marginTop: '16px' }}>
              No notes match "{aiSearchQuery}".
            </p>
          ) : (
            <div className="search-results-list">
              {searchResults.map((res) => (
                <div
                  key={res.id}
                  className="ai-search-result-card"
                  onClick={() => onNavigateToNote && onNavigateToNote(res.id)}
                >
                  <div className="res-title-row">
                    <FileText size={12} />
                    <span className="res-title">{res.title || 'Untitled Note'}</span>
                  </div>
                  {res.content && (
                    <p className="res-excerpt">
                      {res.content.substring(0, 100).replace(/\n/g, ' ')}...
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
