/**
 * AuthContext for Accounting front-end.
 * Stores user/token, sets axios headers, and provides login/logout helpers.
 */
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import config from '../config';

export type ModulePermission = boolean | Record<string, boolean>;

export interface User {
  id: number;
  username: string;
  isAdmin: boolean;
  role?: 'customer' | 'user' | 'admin';
  name?: string;
  familyName?: string;
  address?: string;
  mobileNumber?: string;
  permissions?: Record<string, ModulePermission>;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  loginWithTokenAndUser: (token: string, user: User) => Promise<void>;
  logout: () => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [bootstrapping, setBootstrapping] = useState<boolean>(false);
  const navigate = useNavigate();
  const lastActivityRef = useRef<number>(Date.now());
  const devAutoLogin = String(import.meta.env.VITE_DEV_AUTO_LOGIN || '').toLowerCase() === 'true';
  const devBootstrapTriggeredRef = useRef<boolean>(false);

  // Initialize from localStorage
  useEffect(() => {
    try {
      const storedToken = localStorage.getItem('token');
      const storedUser = localStorage.getItem('user');
      if (storedToken && storedUser) {
        try {
          const u = JSON.parse(storedUser);
          setUser(u);
          setToken(storedToken);
        } catch {
          // ignore
        }
      }
      lastActivityRef.current = Date.now();
    } catch {
      // ignore
    }
  }, []);

  // Update axios headers
  useEffect(() => {
    if (token) {
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
      try { localStorage.setItem('token', token); } catch {}
    } else {
      delete axios.defaults.headers.common['Authorization'];
      try { localStorage.removeItem('token'); } catch {}
    }
  }, [token]);

  /**
   * Dev-only auto login bootstrap.
   * When devAutoLogin is enabled and there is no token, request OTP to get a debug code
   * and immediately verify it to obtain an access token and user, then store both.
   * This avoids manual login during development and ensures protected API calls include
   * Authorization header. Persian (fa) is respected via Accept-Language when available.
   */
  async function devBootstrapLogin(): Promise<void> {
    if (!devAutoLogin) return;
    if (devBootstrapTriggeredRef.current) return;
    devBootstrapTriggeredRef.current = true;
    // Begin dev bootstrap to avoid initial unauthorized UI requests
    setBootstrapping(true);

    // Skip if a token already exists
    const existingToken = ((): string | null => { try { return localStorage.getItem('token'); } catch { return null; } })();
    if (existingToken) return;

    const mobile = (import.meta.env.VITE_DEV_MOBILE as string) || '09123456789';

    try {
      // Request OTP - backend returns debugCode in dev without SMS provider
      const req = await axios.post(`${config.API_ENDPOINTS.base}/auth/request-otp`, { mobileNumber: mobile }, { headers: { 'Accept-Language': 'fa' } });
      const debugCode: string | undefined = (req.data && req.data.debugCode) || undefined;
      if (!debugCode) {
        // If no debug code, do not proceed; manual login may be required
        return;
      }
      // Verify OTP to obtain token and user
      const ver = await axios.post(`${config.API_ENDPOINTS.base}/auth/verify-otp`, { mobileNumber: mobile, otp: debugCode }, { headers: { 'Accept-Language': 'fa' } });
      const { token: accessToken, user: u } = ver.data || {};
      if (accessToken && u) {
        await loginWithTokenAndUser(accessToken, u);
      }
    } catch {
      // Silent failure in dev bootstrap; user can still use manual login if needed
    } finally {
      // End bootstrap; UI can render now
      setBootstrapping(false);
    }
  }

  // Trigger dev bootstrap once on mount when enabled
  useEffect(() => {
    devBootstrapLogin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Login using token and user object returned from server.
   */
  const loginWithTokenAndUser = async (token: string, user: User) => {
    setToken(token);
    setUser(user);
    try {
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(user));
    } catch {
      // Failed to persist auth data
    }
    // Redirect to home
    navigate('/');
  };

  /**
   * Clear auth state and redirect to login.
   */
  const logout = () => {
    setToken(null);
    setUser(null);
    try {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
    } catch {
      /* noop */
    }
    navigate('/login');
  };

  const value: AuthContextType = {
    user,
    token,
    loginWithTokenAndUser,
    logout,
    isAuthenticated: !!token,
  };

  // During dev bootstrap, hold off rendering children to avoid premature requests
  if (devAutoLogin && bootstrapping && !token) {
  return <AuthContext.Provider value={value}><></></AuthContext.Provider>;
  }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

/**
 * Hook to get Auth context.
 */
export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};