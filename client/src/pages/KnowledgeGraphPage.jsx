import React from 'react';
import { useNavigate } from '../utils/router';
import KnowledgeGraph from '../components/KnowledgeGraph';

export default function KnowledgeGraphPage({ notes = [], onCreateNote }) {
  const navigate = useNavigate();

  return (
    <div className="knowledge-graph-page" style={{ width: '100%', height: '100%', flex: 1, minHeight: 0, position: 'relative' }}>
      <KnowledgeGraph
        notes={notes}
        onSelectNote={(noteId) => navigate(`/notes/${noteId}`)}
        onCreateNote={onCreateNote}
      />
    </div>
  );
}
