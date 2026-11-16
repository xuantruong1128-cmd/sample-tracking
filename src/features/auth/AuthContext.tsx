import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { ENV } from '../../lib/env';
import type { AuthUser, Profile } from '../../types/auth';
import { loginWithPhone, normalizePhone } from './authUtils';
import { clearSignedUrlCache } from '../../lib/signedUrlCache';
import { releaseDeviceSession, verifyCurrentDeviceSession } from '../../lib/deviceUtils';

interface AuthContextType {
  user: AuthUser | null;
  profile: Profile | null;
  loading: boolean;
  error: string | null;
  login: (phone: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshProfile: (force?: boolean) => Promise<void>;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Ref to track user state without triggering effect re-runs
  const userRef = useRef<AuthUser | null>(null);
  userRef.current = user;

  // Throttle focus-based profile re-checks to at most once per 60 seconds
  const lastProfileCheckRef = useRef<number>(0);

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
        clearSignedUrlCache();
        await supabase.auth.signOut();
        return null;
      }

      return data as Profile;
    } catch {
      return null;
    }
  }, []);

  const refreshProfile = useCallback(async (force = false) => {
    const currentUser = userRef.current;
    if (!currentUser) return;

    const now = Date.now();
    // Throttle checks to once every 60s unless explicitly forced
    if (!force && now - lastProfileCheckRef.current < 60000) {
      return;
    }
    lastProfileCheckRef.current = now;

    const profile = await fetchProfile(currentUser.id);
    if (profile) {
      // Actively verify device slot is still assigned to this device
      const deviceCheck = await verifyCurrentDeviceSession();
      if (!deviceCheck.valid) {
        clearSignedUrlCache();
        await supabase.auth.signOut();
        setUser(null);
        setError('Phiên đăng nhập đã kết thúc do tài khoản đã được đăng nhập trên thiết bị khác hoặc Quản trị viên đã thu hồi thiết bị.');
        return;
      }

      setUser((prev) => {
        if (!prev) return null;
        // Referentially stable if fields haven't changed
        if (
          prev.profile &&
          prev.profile.role === profile.role &&
          prev.profile.is_active === profile.is_active &&
          prev.profile.full_name === profile.full_name &&
          prev.profile.phone === profile.phone
        ) {
          return prev;
        }
        return { ...prev, profile };
      });
    } else {
      setUser(null);
      setError('Tài khoản của bạn đã bị vô hiệu hóa bởi Quản trị viên.');
    }
  }, [fetchProfile]);

  const refreshProfileRef = useRef(refreshProfile);
  refreshProfileRef.current = refreshProfile;

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
          if (profile && mounted) {
            // Verify device slot validity (auto-claims vacant slot for existing logged-in users)
            const deviceCheck = await verifyCurrentDeviceSession();
            if (!deviceCheck.valid && mounted) {
              clearSignedUrlCache();
              await supabase.auth.signOut();
              setUser(null);
              setError('Phiên đăng nhập đã kết thúc do tài khoản đã được đăng nhập trên một thiết bị khác cùng loại.');
              return;
            }

            setUser({
              id: session.user.id,
              phone: profile.phone || normalizePhone(session.user.phone || ''),
              email: session.user.email,
              profile,
            });
            lastProfileCheckRef.current = Date.now();
          } else if (mounted) {
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
          clearSignedUrlCache();
          setUser(null);
          setLoading(false);
          return;
        }

        if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
          // If switching to a different user, clear cached signed URLs from previous session
          const current = userRef.current;
          if (current && session.user && current.id !== session.user.id) {
            clearSignedUrlCache();
          }

          // If user is already loaded and session id matches, avoid duplicate fetch on redundant SIGNED_IN event
          if (event === 'SIGNED_IN' && current && current.id === session.user.id && current.profile) {
            setLoading(false);
            return;
          }

          const profile = await fetchProfile(session.user.id);
          if (profile && mounted) {
            // Verify device slot validity (auto-claims vacant slot for existing logged-in users)
            const deviceCheck = await verifyCurrentDeviceSession();
            if (!deviceCheck.valid && mounted) {
              clearSignedUrlCache();
              await supabase.auth.signOut();
              setUser(null);
              setError('Phiên đăng nhập đã kết thúc do tài khoản đã được đăng nhập trên một thiết bị khác cùng loại.');
              return;
            }

            setUser({
              id: session.user.id,
              phone: profile.phone || normalizePhone(session.user.phone || ''),
              email: session.user.email,
              profile,
            });
            lastProfileCheckRef.current = Date.now();
          } else if (mounted) {
            setUser(null);
          }
          if (mounted) setLoading(false);
        }
      }
    );

    // Actively verify account active status on window focus (F-12)
    const handleFocus = () => {
      if (userRef.current) {
        refreshProfileRef.current(false);
      }
    };
    window.addEventListener('focus', handleFocus);

    return () => {
      mounted = false;
      authListener?.subscription.unsubscribe();
      window.removeEventListener('focus', handleFocus);
    };
  }, [fetchProfile]);

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
      await releaseDeviceSession();
      clearSignedUrlCache();
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
