import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { LoginPage } from '../features/auth/LoginPage';
import { ChangePasswordPage } from '../features/auth/ChangePasswordPage';
import { ProtectedRoute } from '../features/auth/ProtectedRoute';
import { MainLayout } from '../components/layout/MainLayout';
import { JobListPage } from '../features/jobs/JobListPage';
import { JobDetailPage } from '../features/jobs/JobDetailPage';
import { UserManagementPage } from '../features/admin/UserManagementPage';

export const AppRoutes: React.FC = () => {
  return (
    <Routes>
      {/* Public Login Route */}
      <Route path="/login" element={<LoginPage />} />

      {/* Mandatory Change Password Route */}
      <Route
        path="/change-password"
        element={
          <ProtectedRoute allowPasswordChangeRoute={true}>
            <ChangePasswordPage />
          </ProtectedRoute>
        }
      />

      {/* Protected Routes inside MainLayout */}
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <MainLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<JobListPage />} />
        <Route path="jobs/:id" element={<JobDetailPage />} />
        <Route
          path="admin/users"
          element={
            <ProtectedRoute allowedRoles={['Admin']}>
              <UserManagementPage />
            </ProtectedRoute>
          }
        />
      </Route>

      {/* Catch-all redirect to Home */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};
