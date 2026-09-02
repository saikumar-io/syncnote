import { apiClient } from './apiClient';

const API_BASE = '/api/notebooks';

export const notebooksApi = {
  async getAll() {
    const data = await apiClient.get(API_BASE);
    return data?.data || [];
  },

  async create(name) {
    const data = await apiClient.post(API_BASE, { name });
    return data?.data;
  },

  async rename(id, name) {
    const data = await apiClient.put(`${API_BASE}/${id}`, { name });
    return data?.data;
  },

  async delete(id) {
    return apiClient.delete(`${API_BASE}/${id}`);
  }
};
