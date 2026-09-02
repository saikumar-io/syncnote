import React, { useRef, useEffect } from 'react';
import { History, X, Eye, FileDiff, RotateCcw, CheckCircle2, ChevronLeft, ChevronRight } from 'lucide-react';
import { formatRelativeTime } from '../utils/timeUtils';

export default function VersionHistoryDrawer({
  isOpen,
  onClose,
  history = [],
  currentVersionId,
  selectedNote,
  onViewChanges,
  onViewVersion,
  onRestoreVersion
}) {
  const scrollRef = useRef(null);

  // Enforce scrollLeft = 0 (V1 first) on drawer open or history change
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      if (scrollRef.current) {
        scrollRef.current.scrollLeft = 0;
      }
    } else {
      document.body.style.overflow = '';
    }

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, history?.length, onClose]);

  if (!isOpen) return null;

  // Sort history sequentially V1 -> V2 -> V3 -> V4...
  const sortedHistory = [...(history || [])].sort((a, b) => a.version_number - b.version_number);

  const scrollLeft = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollBy({ left: -260, behavior: 'smooth' });
    }
  };

  const scrollRight = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollBy({ left: 260, behavior: 'smooth' });
    }
  };

  return (
    <div className="version-drawer-backdrop" onClick={onClose}>
      <div className="version-drawer-container horizontal-drawer" onClick={(e) => e.stopPropagation()}>
        {/* Drawer Header */}
        <div className="version-drawer-header">
          <div className="drawer-title-group">
            <History size={16} className="drawer-title-icon" />
            <h3 className="drawer-title-text">
              Version History {selectedNote ? `· ${selectedNote.title}` : ''}
            </h3>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button className="icon-btn-ghost scroll-btn" onClick={scrollLeft} title="Scroll Left (V1)" type="button">
              <ChevronLeft size={15} />
            </button>
            <button className="icon-btn-ghost scroll-btn" onClick={scrollRight} title="Scroll Right (Latest)" type="button">
              <ChevronRight size={15} />
            </button>
            <button className="icon-btn-ghost" onClick={onClose} title="Close Drawer (Esc)" type="button">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Horizontal Linear Map Body */}
        <div className="version-drawer-content horizontal-content">
          {sortedHistory.length === 0 ? (
            <div className="empty-state-box">
              <History size={28} className="empty-icon" />
              <p>No checkpoints created yet.</p>
            </div>
          ) : (
            <div className="horizontal-map-scroll-viewport" ref={scrollRef}>
              <div className="horizontal-timeline-track">
                {sortedHistory.map((ver, idx) => {
                  const isCurrent = ver.id === currentVersionId;
                  const isLast = idx === sortedHistory.length - 1;

                  return (
                    <React.Fragment key={ver.id}>
                      <div className={`horizontal-version-card ${isCurrent ? 'current' : ''}`}>
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

                        <div className="card-actions-hover-row">
                          {onViewChanges && (
                            <button 
                              className="mini-action-btn"
                              onClick={() => onViewChanges(ver)}
                              title="View line diff changes"
                              type="button"
                            >
                              <FileDiff size={11} />
                              <span>Changes</span>
                            </button>
                          )}

                          {onViewVersion && (
                            <button 
                              className="mini-action-btn"
                              onClick={() => onViewVersion(ver)}
                              title="Preview version content"
                              type="button"
                            >
                              <Eye size={11} />
                              <span>View</span>
                            </button>
                          )}

                          {onRestoreVersion && !isCurrent && (
                            <button 
                              className="mini-action-btn restore"
                              onClick={() => onRestoreVersion(ver)}
                              title="Restore version"
                              type="button"
                            >
                              <RotateCcw size={11} />
                              <span>Restore</span>
                            </button>
                          )}
                        </div>
                      </div>

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
    </div>
  );
}
