import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { ENV } from '../../lib/env';
import type { AuthUser, Profile } from '../../types/auth';
import { loginWithPhone, normalizePhone } from './authUtils';

interface AuthContextType {
  user: AuthUser | null;
  profile: Profile | null;
  loading: boolean;
  error: string | null;
  login: (phone: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProfile = useCallback(async (userId: string): Promise<Profile | null> => {
    try {
      const { data, error: profileErr } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (profileErr || !data) {
        return null;
      }

      // Backend access denial on deactivated account (F-12)
      if (!data.is_active) {
        await supabase.auth.signOut();
        return null;
      }

      return data as Profile;
    } catch {
      return null;
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!user) return;
    const profile = await fetchProfile(user.id);
    if (profile) {
      setUser((prev) => (prev ? { ...prev, profile } : null));
    } else {
      setUser(null);
      setError('Tài khoản của bạn đã bị vô hiệu hóa bởi Quản trị viên.');
    }
  }, [user, fetchProfile]);

  useEffect(() => {
    let mounted = true;

    async function initializeAuth() {
      if (!ENV.IS_CONFIGURED) {
        if (mounted) setLoading(false);
        return;
      }

      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user && mounted) {
          const profile = await fetchProfile(session.user.id);
          if (profile) {
            setUser({
              id: session.user.id,
              phone: profile.phone || normalizePhone(session.user.phone || ''),
              email: session.user.email,
              profile,
            });
          } else {
            setUser(null);
          }
        }
      } catch (err: any) {
        console.error('Auth initialization error:', err);
      } finally {
        if (mounted) setLoading(false);
      }
    }

    initializeAuth();

    // Listen to Supabase auth events
    const { data: authListener } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (!mounted) return;

        if (event === 'SIGNED_OUT' || !session?.user) {
          setUser(null);
          setLoading(false);
          return;
        }

        if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
          const profile = await fetchProfile(session.user.id);
          if (profile) {
            setUser({
              id: session.user.id,
              phone: profile.phone || normalizePhone(session.user.phone || ''),
              email: session.user.email,
              profile,
            });
          } else {
            setUser(null);
          }
          setLoading(false);
        }
      }
    );

    // Actively verify account active status on window focus (F-12)
    const handleFocus = () => {
      if (user) {
        refreshProfile();
      }
    };
    window.addEventListener('focus', handleFocus);

    return () => {
      mounted = false;
      authListener?.subscription.unsubscribe();
      window.removeEventListener('focus', handleFocus);
    };
  }, [fetchProfile, user, refreshProfile]);

  const login = async (phone: string, password: string) => {
    setError(null);
    setLoading(true);
    try {
      const { authUser } = await loginWithPhone(phone, password);
      setUser(authUser);
    } catch (err: any) {
      setError(err.message || 'Đăng nhập thất bại.');
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    setLoading(true);
    try {
      await supabase.auth.signOut();
      setUser(null);
      setError(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        profile: user?.profile || null,
        loading,
        error,
        login,
        logout,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
