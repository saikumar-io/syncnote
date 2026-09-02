import React, { useState, useEffect, useRef } from 'react';
import { 
  ArrowLeft, 
  History, 
  Eye, 
  RotateCcw, 
  FileText, 
  CheckCircle2, 
  ChevronLeft, 
  ChevronRight
} from 'lucide-react';
import { Link } from '../utils/router';
import { formatRelativeTime } from '../utils/timeUtils';
import { notesApi } from '../api/notesApi';

export default function SingleNoteHistoryPage({ noteId, notes, onViewChanges, onViewVersion, onRestoreVersion }) {
  const [history, setHistory] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeMenuId, setActiveMenuId] = useState(null);

  const scrollContainerRef = useRef(null);
  const note = notes.find((n) => n.id === noteId) || null;

  useEffect(() => {
    let isMounted = true;
    const fetchHistory = async () => {
      if (!noteId) return;
      setIsLoading(true);
      try {
        const data = await notesApi.getHistory(noteId);
        if (isMounted) {
          // Sort version history sequentially V1 -> V2 -> V3 -> V4...
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

  // Enforce scrollLeft = 0 (V1 first) when history finishes loading
  useEffect(() => {
    if (!isLoading && history.length > 0 && scrollContainerRef.current) {
      scrollContainerRef.current.scrollLeft = 0;
    }
  }, [isLoading, history.length]);

  const scrollLeft = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollBy({ left: -260, behavior: 'smooth' });
    }
  };

  const scrollRight = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollBy({ left: 260, behavior: 'smooth' });
    }
  };

  return (
    <div className="single-note-history-page page-container" onClick={() => setActiveMenuId(null)}>
      {/* Top Header Navigation */}
      <div className="page-nav-header">
        <Link to={`/notes/${noteId}`} className="back-link-btn">
          <ArrowLeft size={14} />
          <span>Back to Editor</span>
        </Link>
      </div>

      {/* Note Header Title */}
      <div className="single-history-title-section">
        <div className="title-row">
          <FileText size={18} className="title-icon" />
          <h2 className="page-heading">{note ? note.title : 'Note History'}</h2>
        </div>
        <p className="page-subheading">
          Horizontal linear version map for <span className="mono-tag">{note ? `${note.title}.md` : noteId}</span>
        </p>
      </div>

      {/* HORIZONTAL VERSION MAP CONTAINER */}
      <div className="horizontal-history-wrapper">
        <div className="horizontal-history-header">
          <span className="history-map-label">Linear Version Map</span>
          <div className="scroll-controls">
            <button className="icon-btn-ghost scroll-btn" onClick={scrollLeft} title="Scroll Left (V1)">
              <ChevronLeft size={16} />
            </button>
            <button className="icon-btn-ghost scroll-btn" onClick={scrollRight} title="Scroll Right (Latest)">
              <ChevronRight size={16} />
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="loading-state">
            <span>Loading version map...</span>
          </div>
        ) : history.length === 0 ? (
          <div className="empty-state-box">
            <History size={32} className="empty-icon" />
            <p>No checkpoints created for this note yet.</p>
          </div>
        ) : (
          <div className="horizontal-map-scroll-viewport" ref={scrollContainerRef}>
            <div className="horizontal-timeline-track">
              {history.map((ver, idx) => {
                const isCurrent = ver.id === note?.current_version_id;
                const isLast = idx === history.length - 1;
                const isMenuOpen = activeMenuId === ver.id;

                return (
                  <React.Fragment key={ver.id}>
                    {/* Compact Version Card */}
                    <div 
                      className={`horizontal-version-card ${isCurrent ? 'current' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveMenuId(isMenuOpen ? null : ver.id);
                      }}
                    >
                      <div className="card-top-row">
                        <span className="version-number-tag">● V{ver.version_number}</span>
                        {isCurrent && (
                          <span className="current-badge">
                            <CheckCircle2 size={10} />
                            <span>CURRENT</span>
                          </span>
                        )}
                      </div>

                      <span className="card-version-time">
                        {formatRelativeTime(ver.created_at)}
                      </span>

                      {/* Popover Action Menu */}
                      {isMenuOpen && (
                        <div className="card-action-popover" onClick={(e) => e.stopPropagation()}>
                          {onViewVersion && (
                            <button 
                              className="dropdown-item-btn"
                              onClick={() => {
                                setActiveMenuId(null);
                                onViewVersion(ver);
                              }}
                              type="button"
                            >
                              <Eye size={13} />
                              <span>View Version</span>
                            </button>
                          )}

                          {onViewChanges && (
                            <button 
                              className="dropdown-item-btn"
                              onClick={() => {
                                setActiveMenuId(null);
                                onViewChanges(ver);
                              }}
                              type="button"
                            >
                              <Eye size={13} />
                              <span>View Changes</span>
                            </button>
                          )}

                          {onRestoreVersion && !isCurrent && (
                            <button 
                              className="dropdown-item-btn restore"
                              onClick={() => {
                                setActiveMenuId(null);
                                onRestoreVersion(ver);
                              }}
                              type="button"
                            >
                              <RotateCcw size={13} />
                              <span>Restore Version</span>
                            </button>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Horizontal Connector Arrow */}
                    {!isLast && (
                      <div className="horizontal-connector-arrow">
                        <div className="arrow-line" />
                        <div className="arrow-head">▶</div>
                      </div>
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
