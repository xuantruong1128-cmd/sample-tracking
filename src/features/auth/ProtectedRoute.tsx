import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import type { UserRole } from '../../types/auth';
import { ShieldAlert } from 'lucide-react';

interface ProtectedRouteProps {
  children?: React.ReactNode;
  allowedRoles?: UserRole[];
  allowPasswordChangeRoute?: boolean;
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  children,
  allowedRoles,
  allowPasswordChangeRoute = false,
}) => {
  const { user, profile, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-slate-500 font-medium">Đang xác thực thông tin...</p>
        </div>
      </div>
    );
  }

  if (!user || !profile) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Mandatory first-login password change trap
  if (profile.must_change_password) {
    if (!allowPasswordChangeRoute) {
      return <Navigate to="/change-password" replace />;
    }
    return <>{children}</>;
  }

  // If already completed password change, cannot re-enter change-password screen
  if (allowPasswordChangeRoute) {
    return <Navigate to="/" replace />;
  }

  if (allowedRoles && !allowedRoles.includes(profile.role)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="bg-white border border-slate-200 rounded-lg p-6 max-w-md w-full shadow-sm text-center">
          <div className="w-12 h-12 bg-amber-50 text-amber-600 rounded-full flex items-center justify-center mx-auto mb-4">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <h2 className="text-lg font-bold text-slate-900 mb-2">Quyền truy cập bị giới hạn</h2>
          <p className="text-sm text-slate-600 mb-6">
            Vai trò của bạn là <strong className="text-blue-600">{profile.role}</strong>. Trang này chỉ dành cho{' '}
            {allowedRoles.join(', ')}.
          </p>
          <a
            href="/"
            className="inline-block px-4 py-2 bg-slate-900 text-white rounded-md text-sm font-medium hover:bg-slate-800 transition"
          >
            Quay về Dashboard
          </a>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};
