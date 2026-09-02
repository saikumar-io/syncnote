import React, { useEffect } from 'react';
import { useParams, useNavigate } from '../utils/router';
import MainContent from '../components/MainContent';

export default function NoteEditorPage({
  notes = [],
  notebooks = [],
  activeNote,
  setActiveNoteId,
  onUpdateNote,
  onToggleFavorite,
  onRequestDeleteNote,
  onCreateNote
}) {
  const { noteId } = useParams();
  const navigate = useNavigate();

  useEffect(() => {
    if (noteId && noteId !== activeNote?.id) {
      setActiveNoteId(noteId);
    }
  }, [noteId, activeNote?.id, setActiveNoteId]);

  const currentNote = notes.find((n) => n.id === noteId) || activeNote;

  return (
    <div className="note-editor-page" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <MainContent
        selectedNote={currentNote}
        allNotes={notes}
        notebooks={notebooks}
        onUpdateNote={onUpdateNote}
        onToggleFavorite={onToggleFavorite}
        onRequestMoveNotebook={() => {}}
        onRequestDeleteNote={onRequestDeleteNote}
        onCreateNote={onCreateNote}
        onOpenGraphView={() => navigate('/graph')}
        onNavigateToNote={(id) => navigate(`/notes/${id}`)}
        onWikiLinkClick={(targetTitle) => {
          const norm = targetTitle.trim().toLowerCase();
          const existing = notes.find((n) => n.title && n.title.trim().toLowerCase() === norm);
          if (existing) {
            navigate(`/notes/${existing.id}`);
          }
        }}
        showBacklinks={true}
        setShowBacklinks={() => {}}
      />
    </div>
  );
}
