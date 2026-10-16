import type { Profile, UserRole } from './database.types';

export type { UserRole, Profile };

export interface AuthUser {
  id: string;
  phone: string;
  email?: string | null;
  profile: Profile | null;
}

export interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  error: string | null;
}

export interface LoginCredentials {
  phone: string;
  password: string;
}
