/**
 * AuthContext for Accounting front-end.
 * Stores user/token, sets axios headers, and provides login/logout helpers.
 */
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';

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
  const navigate = useNavigate();
  const lastActivityRef = useRef<number>(Date.now());

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
      localStorage.setItem('token', token);
    } else {
      delete axios.defaults.headers.common['Authorization'];
      localStorage.removeItem('token');
    }
  }, [token]);

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