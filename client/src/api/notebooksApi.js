// Frontend API helper for SyncNote Notebooks API

const API_BASE = '/api/notebooks';

export const notebooksApi = {
  async getAll() {
    const res = await fetch(API_BASE);
    if (!res.ok) throw new Error(`Error ${res.status}: Failed to fetch notebooks`);
    const data = await res.json();
    return data.data || [];
  },

  async create(name) {
    const res = await fetch(API_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) throw new Error(`Error ${res.status}: Failed to create notebook`);
    const data = await res.json();
    return data.data;
  },

  async rename(id, name) {
    const res = await fetch(`${API_BASE}/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) throw new Error(`Error ${res.status}: Failed to rename notebook`);
    const data = await res.json();
    return data.data;
  },

  async delete(id) {
    const res = await fetch(`${API_BASE}/${id}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error(`Error ${res.status}: Failed to delete notebook`);
    const data = await res.json();
    return data;
  }
};
