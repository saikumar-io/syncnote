import React, { useEffect } from 'react';
import { FileDiff, X, PlusCircle, MinusCircle } from 'lucide-react';

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
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card diff-modal-card" onClick={(e) => e.stopPropagation()} style={{ width: 'min(92vw, 680px)' }}>
        {/* Header */}
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FileDiff size={18} style={{ color: 'var(--accent-primary)' }} />
            <div>
              <h3 className="modal-title">
                Changes in Version V{version?.version_number}
              </h3>
              <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                {version?.message || 'Checkpoint'}
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.76rem', fontWeight: 600 }}>
              <span style={{ color: '#22c55e', display: 'flex', alignItems: 'center', gap: '3px' }}>
                <PlusCircle size={12} /> +{stats.additions}
              </span>
              <span style={{ color: '#ef4444', display: 'flex', alignItems: 'center', gap: '3px' }}>
                <MinusCircle size={12} /> -{stats.deletions}
              </span>
            </div>
            <button className="icon-btn-ghost" onClick={onClose} title="Close (Esc)" type="button">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Diff Canvas */}
        <div className="modal-body" style={{ padding: '12px 16px' }}>
          <div className="diff-viewer-container" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
            {lines.length === 0 ? (
              <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                No line changes detected in this checkpoint.
              </div>
            ) : (
              <div className="diff-lines-list">
                {lines.map((line, idx) => {
                  let bgClass = 'diff-unchanged';
                  let prefix = ' ';
                  if (line.type === 'added') {
                    bgClass = 'diff-added';
                    prefix = '+';
                  } else if (line.type === 'removed') {
                    bgClass = 'diff-removed';
                    prefix = '-';
                  }

                  return (
                    <div key={idx} className={`diff-line ${bgClass}`}>
                      <span className="diff-line-num">
                        {line.type === 'removed' ? line.oldLine : (line.type === 'added' ? line.newLine : line.newLine)}
                      </span>
                      <span className="diff-prefix">{prefix}</span>
                      <span className="diff-text">{line.text || ' '}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="modal-footer" style={{ borderTop: '1px solid var(--border-subtle)' }}>
            <button className="secondary-action-btn" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
