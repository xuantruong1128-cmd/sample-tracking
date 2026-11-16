import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Header } from '../components/common/Header';
import { MainLayout } from '../components/layout/MainLayout';
import { permissions } from '../features/auth/authUtils';
import type { UserRole, Profile } from '../types/auth';

let mockCurrentUserRole: UserRole = 'BD';

vi.mock('../features/auth/AuthContext', () => ({
  useAuth: () => ({
    profile: {
      id: 'bd-user-1',
      role: mockCurrentUserRole,
      full_name: 'BD Specialist',
      phone: '0912345678',
      is_active: true,
      has_completed_password_change: true,
      is_department_leader: false,
    } as Profile,
    user: { id: 'bd-user-1' },
    session: {},
    logout: vi.fn(),
  }),
}));

describe('BD SAMPLE TRACKING VIEW-ONLY ACCESS & FLUID LAYOUT TEST SUITE', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCurrentUserRole = 'BD';
  });

  // 1. Header shows JOBs tab for BD
  it('1. Header displays "Lệnh sản xuất (JOBs)" tab for BD users on desktop and mobile', () => {
    render(
      <MemoryRouter initialEntries={['/drawing-reviews']}>
        <Header />
      </MemoryRouter>
    );

    const desktopJobsNav = screen.getByTestId('nav-jobs');
    expect(desktopJobsNav).toBeInTheDocument();
    expect(desktopJobsNav).toHaveTextContent('Lệnh sản xuất (JOBs)');
    expect(desktopJobsNav.getAttribute('href')).toBe('/');

    const drawingNav = screen.getByTestId('nav-drawing-review');
    expect(drawingNav).toBeInTheDocument();
    expect(drawingNav).toHaveTextContent('Đánh giá bản vẽ');
  });

  // 2. MainLayout is fluid full-width (w-full without max-w-7xl)
  it('2. MainLayout renders fluid full-width layout without max-w-7xl constraint', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/']}>
        <MainLayout />
      </MemoryRouter>
    );

    const mainEl = container.querySelector('main');
    expect(mainEl).toBeInTheDocument();
    expect(mainEl?.className).toContain('w-full');
    expect(mainEl?.className).not.toContain('max-w-7xl');

    const headerContainer = container.querySelector('header > div');
    expect(headerContainer?.className).toContain('w-full');
    expect(headerContainer?.className).not.toContain('max-w-7xl');
  });

  // 3. BD strictly has view-only permissions in Sample Tracking
  it('3. BD user is strictly read-only in Sample Tracking: NO create, edit, delete, close, or upload', () => {
    const bdRole: UserRole = 'BD';
    const bdProfile: Profile = {
      id: 'bd-1',
      role: 'BD',
      phone: '0912345678',
      full_name: 'BD User',
      is_active: true,
      has_completed_password_change: true,
    };

    // Cannot create job
    expect(permissions.canCreateJob(bdRole)).toBe(false);

    // Cannot edit job planning
    expect(permissions.canEditJobPlanning({ status: 'ACTIVE' }, bdRole)).toBe(false);
    expect(permissions.canEditPlanning(bdRole)).toBe(false);

    // Cannot delete job
    expect(permissions.canDeleteJob({ created_by: 'bd-1', status: 'ACTIVE' }, bdProfile)).toBe(false);

    // Cannot enter production
    expect(permissions.canEnterProduction(bdRole)).toBe(false);

    // Cannot inspect QA
    expect(permissions.canInspectQA(bdRole)).toBe(false);

    // Cannot close operation or review KIV
    expect(permissions.canCloseOperation(bdRole, false)).toBe(false);
    expect(permissions.canCloseOperation(bdRole, true)).toBe(false);
    expect(permissions.canReviewKiv(bdRole, false)).toBe(false);

    // Cannot close JOB
    expect(permissions.canCloseJob(bdRole, false)).toBe(false);
    expect(permissions.canCloseJob(bdRole, true)).toBe(false);

    // Cannot upload documents/photos
    expect(permissions.canUploadEngineeringDocuments(bdRole)).toBe(false);
    expect(permissions.canUploadQaDocuments(bdRole)).toBe(false);
    expect(permissions.canUploadSamplePhotos(bdRole)).toBe(false);

    // Cannot download final report, but CAN view final report
    expect(permissions.canDownloadFinalReport(bdRole, false)).toBe(false);
    expect(permissions.canViewFinalReport(bdRole)).toBe(true);
  });
});
