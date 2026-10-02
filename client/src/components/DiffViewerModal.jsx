import React, { useEffect } from 'react';
import { FileDiff, X, PlusCircle, MinusCircle, FileText, Check } from 'lucide-react';

export default function DiffViewerModal({ isOpen, onClose, diffData }) {
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
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
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const version = diffData?.version;
  const stats = diffData?.stats || { additions: 0, deletions: 0 };
  const lines = diffData?.lines || [];

  return (
    <div className="modal-backdrop diff-modal-backdrop" onClick={onClose}>
      <div 
        className="modal-card diff-viewer-card" 
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header diff-header">
          <div className="diff-header-left">
            <div className="diff-icon-badge">
              <FileDiff size={17} />
            </div>
            <div>
              <h3 className="modal-title">
                Changes in Version V{version?.version_number}
              </h3>
              <p className="diff-subtitle">
                {version?.message || 'Checkpoint Snapshot'}
              </p>
            </div>
          </div>

          <div className="diff-header-right">
            <div className="diff-stats-cluster">
              <span className="diff-pill additions">
                <PlusCircle size={12} />
                <span>+{stats.additions}</span>
              </span>
              <span className="diff-pill deletions">
                <MinusCircle size={12} />
                <span>-{stats.deletions}</span>
              </span>
            </div>
            <button className="icon-btn-ghost" onClick={onClose} title="Close (Esc)" type="button">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Diff Canvas */}
        <div className="modal-body diff-modal-body">
          <div className="diff-viewport-canvas">
            {lines.length === 0 ? (
              <div className="diff-empty-notice">
                <FileText size={28} className="text-muted" />
                <p>No line changes detected between this checkpoint and its parent.</p>
              </div>
            ) : (
              <div className="diff-lines-flow">
                {lines.map((line, idx) => {
                  let lineClass = 'diff-unchanged';
                  let symbol = ' ';
                  if (line.type === 'added') {
                    lineClass = 'diff-added';
                    symbol = '+';
                  } else if (line.type === 'removed') {
                    lineClass = 'diff-removed';
                    symbol = '-';
                  }

                  const lineNum = line.type === 'removed' ? line.oldLine : line.newLine;

                  return (
                    <div key={idx} className={`diff-line-row ${lineClass}`}>
                      <span className="diff-line-number">{lineNum !== undefined ? lineNum : idx + 1}</span>
                      <span className="diff-symbol">{symbol}</span>
                      <span className="diff-code-text">{line.text || ' '}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="modal-footer" style={{ borderTop: '1px solid var(--border-subtle)', marginTop: '14px', paddingTop: '12px' }}>
            <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
              Showing line-level diff versus previous checkpoint
            </span>
            <button className="secondary-action-btn" onClick={onClose}>
              Close Viewer
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
