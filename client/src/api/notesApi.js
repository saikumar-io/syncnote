// Frontend API helper functions for SyncNote SQLite REST API

const API_BASE = '/api/notes';

export const notesApi = {
  // Fetch all notes from SQLite backend
  async getAll() {
    const res = await fetch(API_BASE);
    if (!res.ok) throw new Error(`Error ${res.status}: Failed to fetch notes`);
    const data = await res.json();
    return data.data || [];
  },

  // Fetch single note by ID
  async getById(id) {
    const res = await fetch(`${API_BASE}/${id}`);
    if (!res.ok) throw new Error(`Error ${res.status}: Failed to fetch note`);
    const data = await res.json();
    return data.data;
  },

  // Create new note
  async create(notePayload = { title: 'Untitled Note', content: '' }) {
    const res = await fetch(API_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(notePayload),
    });
    if (!res.ok) throw new Error(`Error ${res.status}: Failed to create note`);
    const data = await res.json();
    return data.data;
  },

  // Update existing note
  async update(id, notePayload) {
    const res = await fetch(`${API_BASE}/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(notePayload),
    });
    if (!res.ok) throw new Error(`Error ${res.status}: Failed to update note`);
    const data = await res.json();
    return data.data;
  },

  // Delete note by ID
  async delete(id) {
    const res = await fetch(`${API_BASE}/${id}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error(`Error ${res.status}: Failed to delete note`);
    const data = await res.json();
    return data;
  }
};
