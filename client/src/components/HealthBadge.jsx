import React from 'react';
import { CheckCircle, XCircle, RefreshCw, Server } from 'lucide-react';

export default function HealthBadge({ apiStatus, loading, onRecheck }) {
  const isOk = apiStatus?.status === 'ok';

  return (
    <div className="connection-card">
      <div className="connection-info">
        <div className={`status-icon-box ${isOk ? 'success' : 'error'}`}>
          <Server size={22} />
        </div>
        <div>
          <div className="connection-title">
            Backend Endpoint: {isOk ? 'Connected (Express API Operational)' : 'Connection Failed'}
          </div>
          <div className="connection-sub">
            GET /api/health → {isOk ? JSON.stringify(apiStatus) : 'Backend server unreachable'}
          </div>
        </div>
      </div>

      <button className="test-btn" onClick={onRecheck} disabled={loading}>
        <RefreshCw size={14} className={loading ? 'spin' : ''} />
        <span>{loading ? 'Testing...' : 'Test /api/health'}</span>
      </button>
    </div>
  );
}
