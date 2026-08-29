import React, { useEffect, useRef } from 'react';
import { Edit2, Star, Trash2, Folder } from 'lucide-react';

export default function NoteContextMenu({
  note,
  isOpen,
  position,
  onClose,
  onRename,
  onFavorite,
  onMoveToNotebook,
  onDelete
}) {
  const menuRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        onClose();
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, onClose]);

  if (!isOpen || !note) return null;

  return (
    <div
      ref={menuRef}
      className="context-menu-popover"
      style={{ top: position.y, left: position.x }}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className="context-menu-item"
        onClick={() => {
          onClose();
          onRename(note);
        }}
      >
        <Edit2 size={13} />
        <span>Rename</span>
      </div>

      <div
        className="context-menu-item"
        onClick={() => {
          onClose();
          onFavorite(note);
        }}
      >
        <Star size={13} style={{ color: note.is_favorite ? 'var(--accent-warning)' : 'inherit' }} />
        <span>{note.is_favorite ? 'Unfavorite' : 'Favorite'}</span>
      </div>

      <div
        className="context-menu-item"
        onClick={() => {
          onClose();
          onMoveToNotebook(note);
        }}
      >
        <Folder size={13} />
        <span>Move to Notebook</span>
      </div>

      <div className="context-menu-divider" />

      <div
        className="context-menu-item danger"
        onClick={() => {
          onClose();
          onDelete(note);
        }}
      >
        <Trash2 size={13} />
        <span>Delete</span>
      </div>
    </div>
  );
}
