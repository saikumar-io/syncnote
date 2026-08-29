import React from 'react';
import { ZoomIn, ZoomOut, Maximize2, RefreshCw, Search } from 'lucide-react';

export default function GraphControls({
  searchQuery,
  setSearchQuery,
  onZoomIn,
  onZoomOut,
  onResetView,
  onFitGraph
}) {
  return (
    <div className="graph-controls-floating">
      {/* Search Input */}
      <div className="graph-search-box">
        <Search size={13} style={{ color: 'var(--text-muted)' }} />
        <input
          type="text"
          className="graph-search-input"
          placeholder="Filter nodes in graph..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      <div style={{ height: '16px', width: '1px', background: 'var(--border-subtle)' }} />

      {/* Zoom + */}
      <button className="graph-ctrl-btn" onClick={onZoomIn} title="Zoom In (+)">
        <ZoomIn size={14} />
      </button>

      {/* Zoom - */}
      <button className="graph-ctrl-btn" onClick={onZoomOut} title="Zoom Out (-)">
        <ZoomOut size={14} />
      </button>

      {/* Fit Graph */}
      <button className="graph-ctrl-btn" onClick={onFitGraph} title="Fit Graph View">
        <Maximize2 size={14} />
      </button>

      {/* Reset */}
      <button className="graph-ctrl-btn" onClick={onResetView} title="Reset Position & Zoom">
        <RefreshCw size={14} />
      </button>
    </div>
  );
}
