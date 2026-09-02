import React, { useState, useEffect } from 'react';
import { apiClient } from '../api/apiClient';
import { Search, FileText, Check, X } from 'lucide-react';

export default function NotePickerModal({ isOpen, initialSelectedIds = [], onClose, onSave }) {
  const [notes, setNotes] = useState([]);
  const [selectedIds, setSelectedIds] = useState(initialSelectedIds);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setSelectedIds(initialSelectedIds);
      fetchUserNotes();
    }
  }, [isOpen, initialSelectedIds]);

  const fetchUserNotes = async () => {
    setLoading(true);
    try {
      const res = await apiClient.get('/api/notes');
      if (Array.isArray(res)) {
        setNotes(res);
      } else if (res && Array.isArray(res.notes)) {
        setNotes(res.notes);
      }
    } catch (err) {
      console.error('Failed to fetch notes for note picker:', err);
    } finally {
      setLoading(false);
    }
  };

  const toggleSelectNote = (id) => {
    setSelectedIds((prev) => 
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleSelectAll = () => {
    const filtered = filteredNotes.map((n) => n.id);
    setSelectedIds(filtered);
  };

  const handleClearAll = () => {
    setSelectedIds([]);
  };

  const handleSaveSubmit = () => {
    onSave(selectedIds);
    onClose();
  };

  const filteredNotes = notes.filter((n) => 
    (n.title || 'Untitled').toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" onClick={onClose} style={{ zIndex: 1100 }}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '440px', width: '100%', padding: '20px' }}>
        
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '10px' }}>
          <div style={{ fontWeight: 600, fontSize: '0.92rem', color: 'var(--text-primary)' }}>
            Select Notes to Sync over LAN
          </div>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
            <X size={18} />
          </button>
        </div>

        {/* Search Input */}
        <div style={{ position: 'relative', marginBottom: '10px' }}>
          <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            type="text"
            placeholder="Search notes..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ width: '100%', padding: '6px 12px 6px 30px', fontSize: '0.8rem', background: 'var(--bg-input)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', borderRadius: 'var(--radius-sm)' }}
          />
        </div>

        {/* Quick actions */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', fontSize: '0.74rem' }}>
          <span style={{ color: 'var(--text-muted)' }}>
            {selectedIds.length} of {notes.length} notes selected
          </span>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button type="button" onClick={handleSelectAll} style={{ background: 'none', border: 'none', color: 'var(--accent-primary)', cursor: 'pointer' }}>
              Select All
            </button>
            <button type="button" onClick={handleClearAll} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
              Clear
            </button>
          </div>
        </div>

        {/* Notes Checklist Box */}
        <div style={{ maxHeight: '240px', overflowY: 'auto', background: 'var(--bg-app)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', padding: '6px' }}>
          {loading ? (
            <div style={{ padding: '20px', textAlign: 'center', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              Loading notes...
            </div>
          ) : filteredNotes.length === 0 ? (
            <div style={{ padding: '20px', textAlign: 'center', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              No notes found.
            </div>
          ) : (
            filteredNotes.map((note) => {
              const isChecked = selectedIds.includes(note.id);
              return (
                <div
                  key={note.id}
                  onClick={() => toggleSelectNote(note.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 10px',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    background: isChecked ? 'rgba(59, 130, 246, 0.08)' : 'transparent',
                    transition: 'background 0.15s ease'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => {}}
                      style={{ cursor: 'pointer' }}
                    />
                    <FileText size={14} style={{ color: 'var(--text-secondary)' }} />
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-primary)', fontWeight: isChecked ? 600 : 400 }}>
                      {note.title || 'Untitled Note'}
                    </span>
                  </div>

                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                    {note.sync_mode || 'local'}
                  </span>
                </div>
              );
            })
          )}
        </div>

        {/* Footer Actions */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '14px' }}>
          <button type="button" className="btn-secondary" onClick={onClose} style={{ padding: '6px 12px', fontSize: '0.78rem' }}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={handleSaveSubmit} style={{ padding: '6px 16px', fontSize: '0.78rem' }}>
            Save Selection
          </button>
        </div>

      </div>
    </div>
  );
}
