import { getDeviceId, getDeviceName, getDeviceType } from '../utils/deviceId';
import { request, apiClient } from './apiClient';

const API_BASE = '/api/auth';

export const authApi = {
  async register(data) {
    const payload = {
      ...data,
      deviceId: getDeviceId(),
      deviceName: getDeviceName(),
      deviceType: getDeviceType()
    };
    return apiClient.post(`${API_BASE}/register`, payload);
  },

  async login(data) {
    const payload = {
      ...data,
      deviceId: getDeviceId(),
      deviceName: getDeviceName(),
      deviceType: getDeviceType()
    };
    return apiClient.post(`${API_BASE}/login`, payload);
  },

  async logout() {
    try {
      return await apiClient.post(`${API_BASE}/logout`, {});
    } catch (err) {
      // Even if logout fails on network, treat as logged out locally
      return { ok: true };
    }
  },

  async me() {
    try {
      const data = await apiClient.get(`${API_BASE}/me`);
      return data;
    } catch (err) {
      if (err.status === 401) return null;
      throw err;
    }
  },

  async changePassword(data) {
    return apiClient.post(`${API_BASE}/change-password`, data);
  },

  async setPassword(data) {
    return apiClient.post(`${API_BASE}/set-password`, data);
  },

  async forgotPassword(data) {
    return apiClient.post(`${API_BASE}/forgot-password`, data);
  },

  async resetPassword(data) {
    return apiClient.post(`${API_BASE}/reset-password`, data);
  },

  async updateProfile(data) {
    const payload = {
      ...data,
      deviceId: getDeviceId()
    };
    return apiClient.put(`${API_BASE}/profile`, payload);
  }
};
