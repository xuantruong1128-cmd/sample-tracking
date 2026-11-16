import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { LoginPage } from '../features/auth/LoginPage';
import { ChangePasswordPage } from '../features/auth/ChangePasswordPage';
import { ProtectedRoute } from '../features/auth/ProtectedRoute';
import { MainLayout } from '../components/layout/MainLayout';
import { JobListPage } from '../features/jobs/JobListPage';
import { JobDetailPage } from '../features/jobs/JobDetailPage';
import { UserManagementPage } from '../features/admin/UserManagementPage';
import { DrawingReviewListPage } from '../features/drawingReview/DrawingReviewListPage';
import { DrawingReviewCreatePage } from '../features/drawingReview/DrawingReviewCreatePage';
import { DrawingReviewDetailPage } from '../features/drawingReview/DrawingReviewDetailPage';
import { DrawingReviewCompletedPage } from '../features/drawingReview/DrawingReviewCompletedPage';
import { LogListPage } from '../features/logs/LogListPage';

const HomeRoute: React.FC = () => {
  return <JobListPage />;
};

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
        <Route index element={<HomeRoute />} />
        <Route
          path="jobs/:id"
          element={
            <ProtectedRoute allowedRoles={['Admin', 'PE-MFG', 'Planning', 'QA', 'Drawing', 'Viewer', 'BD']}>
              <JobDetailPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="admin/users"
          element={
            <ProtectedRoute allowedRoles={['Admin']}>
              <UserManagementPage />
            </ProtectedRoute>
          }
        />

        {/* Drawing Review Module Routes */}
        <Route path="drawing-reviews" element={<DrawingReviewListPage />} />
        <Route
          path="drawing-reviews/new"
          element={
            <ProtectedRoute allowedRoles={['BD', 'Admin']}>
              <DrawingReviewCreatePage />
            </ProtectedRoute>
          }
        />
        <Route path="drawing-reviews/:id" element={<DrawingReviewDetailPage />} />
        <Route path="drawing-reviews/:id/report" element={<DrawingReviewCompletedPage />} />

        {/* System Activity Log Route */}
        <Route path="logs" element={<LogListPage />} />
      </Route>

      {/* Catch-all redirect to Home */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};
