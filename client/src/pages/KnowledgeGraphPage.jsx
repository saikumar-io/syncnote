import React from 'react';
import { useNavigate } from '../utils/router';
import KnowledgeGraph from '../components/KnowledgeGraph';

export default function KnowledgeGraphPage({ notes = [], onCreateNote }) {
  const navigate = useNavigate();

  return (
    <div className="knowledge-graph-page" style={{ width: '100%', height: 'calc(100vh - 48px)', position: 'relative' }}>
      <KnowledgeGraph
        notes={notes}
        onSelectNote={(noteId) => navigate(`/notes/${noteId}`)}
        onCreateNote={onCreateNote}
      />
    </div>
  );
}
