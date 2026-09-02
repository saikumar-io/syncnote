import React, { useEffect, useState } from 'react';
import { useParams, Link } from '../utils/router';
import { notesApi } from '../api/notesApi';
import { formatRelativeTime } from '../utils/timeUtils';
import { 
  ArrowLeft, 
  History, 
  GitCommit, 
  Eye, 
  FileText, 
  RotateCcw,
  CheckCircle2
} from 'lucide-react';

export default function NoteHistoryPage({
  notes = [],
  onViewChanges,
  onViewVersion,
  onRestoreVersion
}) {
  const { noteId } = useParams();
  const [history, setHistory] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  const currentNote = notes.find((n) => n.id === noteId);

  useEffect(() => {
    if (!noteId) return;
    let isMounted = true;
    const fetchHistory = async () => {
      setIsLoading(true);
      try {
        const data = await notesApi.getHistory(noteId);
        if (isMounted) setHistory(data || []);
      } catch (err) {
        console.error('Error loading note history:', err);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    fetchHistory();
    return () => { isMounted = false; };
  }, [noteId]);

  return (
    <div className="note-history-page">
      {/* Top Header */}
      <div className="page-header-bar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <Link to={`/notes/${noteId}`} className="back-link-btn">
            <ArrowLeft size={14} />
            <span>Editor</span>
          </Link>
          <div>
            <h1 className="page-heading">
              {currentNote?.title || 'Note'} · Version History
            </h1>
            <p className="page-subheading">Linear version timeline for this note</p>
          </div>
        </div>
      </div>

      {/* Version Timeline */}
      {history.length === 0 ? (
        <div className="empty-state-card">
          <GitCommit size={32} className="empty-icon" />
          <h3>No checkpoints created</h3>
          <p>Create a checkpoint inside the editor to record version history.</p>
          <Link to={`/notes/${noteId}`} className="primary-action-btn" style={{ marginTop: '12px' }}>
            <span>Go to Editor</span>
          </Link>
        </div>
      ) : (
        <div className="single-note-timeline">
          {history.map((ver, idx) => {
            const isLatest = idx === history.length - 1;
            const isLastInList = idx === 0; // Displayed reverse chronological

            return (
              <div key={ver.id} className="timeline-item">
                <div className="timeline-node-col">
                  <div className={`timeline-dot ${isLatest ? 'active' : ''}`}>●</div>
                  <div className="timeline-line" />
                </div>

                <div className={`timeline-content-card ${isLatest ? 'current' : ''}`}>
                  <div className="timeline-card-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span className="version-badge">V{ver.version_number}</span>
                      <h4 className="timeline-version-message">
                        {ver.message || `Checkpoint V${ver.version_number}`}
                      </h4>
                      {isLatest && (
                        <span className="version-current-tag">
                          <CheckCircle2 size={11} /> CURRENT
                        </span>
                      )}
                    </div>
                    <span className="timeline-time">{formatRelativeTime(ver.created_at)}</span>
                  </div>

                  <div className="timeline-actions">
                    <button 
                      className="version-action-btn"
                      onClick={() => onViewChanges(ver)}
                    >
                      <Eye size={12} />
                      <span>Changes</span>
                    </button>

                    <button 
                      className="version-action-btn"
                      onClick={() => onViewVersion(ver)}
                    >
                      <FileText size={12} />
                      <span>View Content</span>
                    </button>

                    {!isLatest && (
                      <button 
                        className="version-action-btn restore"
                        onClick={() => onRestoreVersion(ver)}
                      >
                        <RotateCcw size={12} />
                        <span>Restore as V{history.length + 1}</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
