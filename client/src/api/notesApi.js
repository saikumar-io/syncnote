import { apiClient } from './apiClient';

const API_BASE = '/api/notes';

export const notesApi = {
  async getAll() {
    const data = await apiClient.get(API_BASE);
    return data?.data || [];
  },

  async getById(id) {
    const data = await apiClient.get(`${API_BASE}/${id}`);
    return data?.data;
  },

  async create(notePayload = { title: 'Untitled Note', content: '' }) {
    const data = await apiClient.post(API_BASE, notePayload);
    return data?.data;
  },

  async update(id, notePayload) {
    const data = await apiClient.put(`${API_BASE}/${id}`, notePayload);
    return data?.data;
  },

  async delete(id) {
    return apiClient.delete(`${API_BASE}/${id}`);
  },

  async keepRecovery(id) {
    return apiClient.post(`${API_BASE}/${id}/keep-recovery`, {});
  },

  async discardRecovery(id) {
    const data = await apiClient.post(`${API_BASE}/${id}/discard-recovery`, {});
    return data?.data;
  },

  async getHistory(id) {
    const data = await apiClient.get(`${API_BASE}/${id}/history`);
    return data?.data || [];
  },

  async getVersionContent(id, versionId) {
    const data = await apiClient.get(`${API_BASE}/${id}/versions/${versionId}`);
    return data?.data;
  },

  async getVersionDiff(id, versionId) {
    const data = await apiClient.get(`${API_BASE}/${id}/versions/${versionId}/diff`);
    return data?.data;
  },

  async createCheckpoint(id, message, content) {
    return apiClient.post(`${API_BASE}/${id}/checkpoints`, { message, content });
  },

  async restoreVersion(id, versionId) {
    const data = await apiClient.post(`${API_BASE}/${id}/restore`, { version_id: versionId });
    return data?.data;
  },

  async getGlobalActivity() {
    const data = await apiClient.get(`${API_BASE}/activity`);
    return data?.data || [];
  },

  async getGlobalHistory() {
    const data = await apiClient.get(`${API_BASE}/global-history`);
    return data?.data || [];
  }
};
