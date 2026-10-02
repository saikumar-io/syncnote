import React, { useState, useEffect, useRef } from 'react';
import { 
  ArrowLeft, 
  History, 
  Eye, 
  RotateCcw, 
  FileText, 
  CheckCircle2, 
  ChevronLeft, 
  ChevronRight,
  GitCommit,
  Hash,
  Laptop,
  FileDiff,
  Clock,
  Sparkles
} from 'lucide-react';
import { Link, useNavigate } from '../utils/router';
import { formatRelativeTime, formatDateSafe } from '../utils/timeUtils';
import { notesApi } from '../api/notesApi';

export default function SingleNoteHistoryPage({ noteId, notes, onViewChanges, onViewVersion, onRestoreVersion }) {
  const [history, setHistory] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeMenuId, setActiveMenuId] = useState(null);
  const [confirmRestoreVersion, setConfirmRestoreVersion] = useState(null);

  const scrollContainerRef = useRef(null);
  const note = notes.find((n) => n.id === noteId) || null;
  const navigate = useNavigate();

  useEffect(() => {
    let isMounted = true;
    const fetchHistory = async () => {
      if (!noteId) return;
      setIsLoading(true);
      try {
        const data = await notesApi.getHistory(noteId);
        if (isMounted) {
          const sorted = [...(data || [])].sort((a, b) => a.version_number - b.version_number);
          setHistory(sorted);
        }
      } catch (err) {
        console.error('Failed to load note history:', err);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    fetchHistory();
    return () => { isMounted = false; };
  }, [noteId]);

  useEffect(() => {
    if (!isLoading && history.length > 0 && scrollContainerRef.current) {
      scrollContainerRef.current.scrollLeft = 0;
    }
  }, [isLoading, history.length]);

  const scrollLeft = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollBy({ left: -280, behavior: 'smooth' });
    }
  };

  const scrollRight = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollBy({ left: 280, behavior: 'smooth' });
    }
  };

  const handleExecuteRestore = (ver) => {
    if (onRestoreVersion) {
      onRestoreVersion(ver);
    }
    setConfirmRestoreVersion(null);
  };

  return (
    <div className="single-note-history-page page-container" onClick={() => setActiveMenuId(null)}>
      {/* Top Breadcrumb Header */}
      <div className="history-top-header">
        <Link to={`/notes/${noteId}`} className="history-back-link">
          <ArrowLeft size={14} />
          <span>Back to Note Editor</span>
        </Link>
        <span className="history-header-divider">/</span>
        <span className="history-header-title">Version History Timeline</span>
      </div>

      {/* Note Hero Section */}
      <div className="history-hero-section">
        <div className="hero-title-row">
          <div className="hero-icon-wrap">
            <GitCommit size={20} />
          </div>
          <div>
            <h2 className="hero-heading">{note ? note.title : 'Note History'}</h2>
            <p className="hero-subtext">
              Linear Git-inspired version control graph for <span className="mono-badge">{note ? `${note.title}.md` : noteId}</span>
            </p>
          </div>
        </div>

        <div className="hero-stats-row">
          <div className="stat-pill">
            <History size={12} />
            <span>{history.length} Checkpoints Recorded</span>
          </div>
          {note?.content_hash && (
            <div className="stat-pill">
              <Hash size={12} />
              <span>sha256: {note.content_hash.substring(0, 10)}...</span>
            </div>
          )}
        </div>
      </div>

      {/* Horizontal Linear Version Graph Viewport */}
      <div className="history-timeline-outer-card">
        <div className="timeline-dock-header">
          <div className="dock-title-group">
            <GitCommit size={14} className="text-primary" />
            <span className="dock-label">Checkpoint Track (Chronological V1 → Latest)</span>
          </div>
          <div className="dock-scroll-controls">
            <button className="icon-btn-ghost dock-btn" onClick={scrollLeft} title="Scroll Left (V1)">
              <ChevronLeft size={16} />
            </button>
            <button className="icon-btn-ghost dock-btn" onClick={scrollRight} title="Scroll Right (Latest)">
              <ChevronRight size={16} />
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="timeline-loading-state">
            <History size={24} className="spin text-muted" />
            <span>Loading version history checkpoints...</span>
          </div>
        ) : history.length === 0 ? (
          <div className="timeline-empty-state">
            <History size={32} className="empty-icon" />
            <h3>No Checkpoints Yet</h3>
            <p>Save checkpoints in the editor to track historical changes and enable rollback.</p>
          </div>
        ) : (
          <div className="timeline-scroll-viewport" ref={scrollContainerRef}>
            <div className="timeline-linear-track">
              {history.map((ver, idx) => {
                const isCurrent = ver.id === note?.current_version_id;
                const isLast = idx === history.length - 1;

                return (
                  <React.Fragment key={ver.id}>
                    {/* Visual Checkpoint Card */}
                    <div className={`timeline-checkpoint-node ${isCurrent ? 'current-active' : ''}`}>
                      <div className="node-top-bar">
                        <span className="node-version-badge">● V{ver.version_number}</span>
                        {isCurrent && (
                          <span className="current-live-badge">
                            <CheckCircle2 size={10} />
                            <span>CURRENT</span>
                          </span>
                        )}
                      </div>

                      <p className="node-message-text" title={ver.message || 'Snapshot'}>
                        {ver.message || 'Snapshot checkpoint'}
                      </p>

                      <div className="node-meta-cluster">
                        <span className="node-time" title={formatDateSafe(ver.created_at)}>
                          <Clock size={10} />
                          {formatRelativeTime(ver.created_at)}
                        </span>
                        {ver.device_id && (
                          <span className="node-device" title={`Device: ${ver.device_id}`}>
                            <Laptop size={10} />
                            {ver.device_id === 'local_device' ? 'Local Machine' : ver.device_id.substring(0, 12)}
                          </span>
                        )}
                      </div>

                      {ver.content_hash && (
                        <div className="node-hash-row">
                          <Hash size={10} />
                          <span>{ver.content_hash.substring(0, 8)}</span>
                        </div>
                      )}

                      {/* Action Buttons */}
                      <div className="node-action-bar">
                        {onViewChanges && (
                          <button
                            type="button"
                            className="node-action-btn"
                            onClick={() => onViewChanges(ver)}
                            title="View line diff changes in this checkpoint"
                          >
                            <FileDiff size={12} />
                            <span>Diff</span>
                          </button>
                        )}

                        {onViewVersion && (
                          <button
                            type="button"
                            className="node-action-btn"
                            onClick={() => onViewVersion(ver)}
                            title="Preview historical version"
                          >
                            <Eye size={12} />
                            <span>Preview</span>
                          </button>
                        )}

                        {onRestoreVersion && !isCurrent && (
                          <button
                            type="button"
                            className="node-action-btn restore"
                            onClick={() => setConfirmRestoreVersion(ver)}
                            title="Rollback note to this version"
                          >
                            <RotateCcw size={12} />
                            <span>Restore</span>
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Connector Arrow */}
                    {!isLast && (
                      <div className="timeline-connector-element">
                        <div className="connector-wire" />
                        <span className="connector-arrowhead">▶</span>
                      </div>
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Rollback Confirmation Modal */}
      {confirmRestoreVersion && (
        <div className="modal-backdrop" onClick={() => setConfirmRestoreVersion(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '440px' }}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <RotateCcw size={16} style={{ color: 'var(--accent-primary)' }} />
                <h3 className="modal-title">Confirm Rollback</h3>
              </div>
            </div>

            <div className="modal-body">
              <p style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}>
                Restore note content to <strong style={{ color: 'var(--text-primary)' }}>Version V{confirmRestoreVersion.version_number}</strong> ({confirmRestoreVersion.message || 'Snapshot'})?
              </p>
              <p style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: '8px' }}>
                A new version checkpoint will be recorded so your history remains complete and non-destructive.
              </p>

              <div className="modal-footer" style={{ marginTop: '16px' }}>
                <button
                  type="button"
                  className="secondary-action-btn"
                  onClick={() => setConfirmRestoreVersion(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="primary-action-btn"
                  onClick={() => handleExecuteRestore(confirmRestoreVersion)}
                >
                  Confirm Restore
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
