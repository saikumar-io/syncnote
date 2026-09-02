/**
 * Offline Session Storage Utility
 * Stores only non-sensitive account metadata needed to identify a previously authenticated device offline.
 * DOES NOT store passwords, password hashes, or raw tokens.
 */

const STORAGE_KEY = 'syncnote_offline_session';

export const offlineSession = {
  save(user, device) {
    if (!user || !user.id) return;
    const sessionData = {
      id: user.id,
      username: user.username,
      email: user.email,
      deviceId: device?.id || null,
      lastAuthenticated: new Date().toISOString(),
      offlineEnabled: true
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sessionData));
    } catch (e) {
      console.warn('Failed to save offline session metadata:', e);
    }
  },

  get() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (data && data.id && data.offlineEnabled) {
        return data;
      }
    } catch (e) {
      console.warn('Failed to parse local offline session:', e);
    }
    return null;
  },

  clear() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {}
  }
};
