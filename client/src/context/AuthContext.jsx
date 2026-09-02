import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { authApi } from '../api/authApi';
import { offlineSession } from '../utils/offlineSession';

const AuthContext = createContext({
  user: null,
  device: null,
  isAuthenticated: false,
  isOffline: false,
  isLoading: true,
  authError: null,
  login: async () => {},
  register: async () => {},
  logout: async () => {},
  refreshUser: async () => {},
  clearAuthError: () => {}
});

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [device, setDevice] = useState(null);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [isLoading, setIsLoading] = useState(true);
  const [authError, setAuthError] = useState(null);

  const checkAuthSession = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await authApi.me();
      if (data && data.user) {
        setUser(data.user);
        setDevice(data.device || null);
        setIsOffline(false);
        offlineSession.save(data.user, data.device);
      } else {
        setUser(null);
        setDevice(null);
        offlineSession.clear();
      }
    } catch (err) {
      if (err.isNetworkError || !navigator.onLine) {
        setIsOffline(true);
        const cachedSession = offlineSession.get();
        if (cachedSession) {
          setUser(cachedSession);
          setDevice({ id: cachedSession.deviceId, device_name: 'Local Device' });
        } else {
          setUser(null);
        }
      } else if (err.status === 401) {
        setUser(null);
        setDevice(null);
        offlineSession.clear();
      } else {
        setUser(null);
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    checkAuthSession();

    const handleOnline = () => {
      setIsOffline(false);
      checkAuthSession();
    };

    const handleOffline = () => {
      setIsOffline(true);
      const cached = offlineSession.get();
      if (cached) {
        setUser(cached);
      }
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [checkAuthSession]);

  const login = async (credentials) => {
    setAuthError(null);
    try {
      const data = await authApi.login(credentials);
      setUser(data.user);
      setDevice(data.device || null);
      setIsOffline(false);
      offlineSession.save(data.user, data.device);
      return data;
    } catch (err) {
      setAuthError(err.message);
      throw err;
    }
  };

  const register = async (userData) => {
    setAuthError(null);
    try {
      const data = await authApi.register(userData);
      setUser(data.user);
      setDevice(data.device || null);
      setIsOffline(false);
      offlineSession.save(data.user, data.device);
      return data;
    } catch (err) {
      setAuthError(err.message);
      throw err;
    }
  };

  const logout = async () => {
    try {
      await authApi.logout();
    } catch (err) {
      console.warn('Logout request warning:', err.message);
    } finally {
      offlineSession.clear();
      setUser(null);
      setDevice(null);
      setAuthError(null);
      setIsOffline(!navigator.onLine);
    }
  };

  const refreshUser = async () => {
    try {
      const data = await authApi.me();
      if (data && data.user) {
        setUser(data.user);
        setDevice(data.device || null);
        offlineSession.save(data.user, data.device);
      }
    } catch (err) {
      console.warn('Refresh user warning:', err.message);
    }
  };

  const clearAuthError = () => setAuthError(null);

  return (
    <AuthContext.Provider
      value={{
        user,
        device,
        isAuthenticated: !!user,
        isOffline,
        isLoading,
        authError,
        login,
        register,
        logout,
        refreshUser,
        clearAuthError
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
