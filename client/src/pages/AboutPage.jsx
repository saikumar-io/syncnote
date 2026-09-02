import React from 'react';
import SyncNoteLogo from '../components/SyncNoteLogo';
import { Cpu, Database, HardDrive, GitCommit } from 'lucide-react';

export default function AboutPage() {
  return (
    <div className="about-page-container page-container" style={{ maxWidth: '600px', margin: '0 auto', padding: '32px 16px' }}>
      <div style={{ textAlign: 'center', marginBottom: '24px' }}>
        <div style={{ display: 'inline-flex', marginBottom: '12px' }}>
          <SyncNoteLogo size={32} showText={false} />
        </div>
        <h1 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 6px 0' }}>
          SyncNote
        </h1>
        <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: 0 }}>
          A lightweight, offline-first Markdown knowledge workspace.
        </p>
      </div>

      <div className="about-card" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-medium)', borderRadius: 'var(--radius-md)', padding: '20px', marginBottom: '20px' }}>
        <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: '1.6', margin: 0 }}>
          SyncNote provides distraction-free Markdown writing, [[wikilink]] connections, interactive knowledge graphs, and linear version history saved locally on your machine.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '24px' }}>
        <div className="about-tech-box">
          <Cpu size={14} className="tech-icon" />
          <div>
            <div className="tech-title">Frontend</div>
            <div className="tech-desc">React 18 · Custom Router</div>
          </div>
        </div>

        <div className="about-tech-box">
          <Database size={14} className="tech-icon" />
          <div>
            <div className="tech-title">Backend</div>
            <div className="tech-desc">Express · SQLite</div>
          </div>
        </div>

        <div className="about-tech-box">
          <HardDrive size={14} className="tech-icon" />
          <div>
            <div className="tech-title">Storage</div>
            <div className="tech-desc">Local Markdown Files</div>
          </div>
        </div>

        <div className="about-tech-box">
          <GitCommit size={14} className="tech-icon" />
          <div>
            <div className="tech-title">Version Control</div>
            <div className="tech-desc">Linear Checkpoint Graph</div>
          </div>
        </div>
      </div>

      <div style={{ textAlign: 'center', fontSize: '0.74rem', color: 'var(--text-muted)' }}>
        SyncNote v1.0.0
      </div>
    </div>
  );
}
