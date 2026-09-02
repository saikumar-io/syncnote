import React from 'react';
import { Link } from '../utils/router';

export default function SyncNoteLogo({ className = '', size = 20, showText = true }) {
  return (
    <Link to="/notes" className={`syncnote-brand-logo ${className}`}>
      <svg 
        width={size} 
        height={size} 
        viewBox="0 0 24 24" 
        fill="none" 
        xmlns="http://www.w3.org/2000/svg"
        className="syncnote-logo-svg"
      >
        {/* Document Layer 1 */}
        <rect 
          x="3.5" 
          y="4" 
          width="12" 
          height="15" 
          rx="2" 
          stroke="var(--accent-primary)" 
          strokeWidth="1.8" 
          fill="none"
        />
        {/* Sync / Overlapping Layer 2 */}
        <rect 
          x="8.5" 
          y="7" 
          width="12" 
          height="14" 
          rx="2" 
          stroke="var(--accent-emerald)" 
          strokeWidth="1.8" 
          fill="none" 
          strokeDasharray="22 4"
        />
        {/* Connection Node */}
        <circle 
          cx="14.5" 
          cy="14" 
          r="1.5" 
          fill="var(--accent-primary)" 
        />
      </svg>

      {showText && (
        <span className="syncnote-brand-title">SyncNote</span>
      )}
    </Link>
  );
}
