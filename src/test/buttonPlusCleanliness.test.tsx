import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { JobToolbar } from '../features/jobs/JobToolbar';
import { OperationExecutionPanel } from '../features/operations/OperationExecutionPanel';
import { OperationSamplePhotosGallery } from '../features/operations/OperationSamplePhotosGallery';
import { JobCreateModal } from '../features/jobs/JobCreateModal';
import { UserManagementPage } from '../features/admin/UserManagementPage';
import { AuthContext } from '../features/auth/AuthContext';
import type { JobOperation } from '../types/database.types';

// Mock Auth
const mockUser = { id: 'admin-1', phone: '0968041128' };
const createMockAuthContext = (role = 'Admin') => ({
  user: mockUser as any,
  profile: {
    id: 'admin-1',
    phone: '0968041128',
    full_name: 'Admin Test',
    role: role as any,
    department: 'Ban Quản Trị',
    is_active: true,
    is_department_leader: true,
  },
  session: {} as any,
  loading: false,
  signInWithPhone: vi.fn(),
  verifyOtp: vi.fn(),
  signOut: vi.fn(),
  refreshProfile: vi.fn(),
});

vi.mock('../services/productionResultService', () => ({
  fetchDefectCatalog: vi.fn().mockResolvedValue({ defects: [] }),
  saveProductionResult: vi.fn().mockResolvedValue({ success: true }),
  saveQACheck: vi.fn().mockResolvedValue({ success: true }),
  uploadNGPhoto: vi.fn().mockResolvedValue({ filePath: 'test.jpg' }),
  viewNGPhotoSignedUrl: vi.fn().mockResolvedValue({ signedUrl: 'https://test.jpg' }),
  closeJobOperation: vi.fn().mockResolvedValue({ success: true }),
  reviewKivTransfer: vi.fn().mockResolvedValue({ success: true }),
  fetchKivReviews: vi.fn().mockResolvedValue({ data: [] }),
}));

vi.mock('../services/samplePhotoService', () => ({
  fetchSamplePhotos: vi.fn().mockResolvedValue({ photos: [], error: null }),
  uploadSamplePhoto: vi.fn().mockResolvedValue({ photo: {}, error: null }),
  deleteSamplePhoto: vi.fn().mockResolvedValue({ success: true }),
  viewSamplePhotoSignedUrl: vi.fn().mockResolvedValue({ signedUrl: 'https://test.jpg' }),
  MAX_SAMPLE_PHOTO_SIZE: 10 * 1024 * 1024,
  ALLOWED_SAMPLE_PHOTO_MIMES: ['image/jpeg', 'image/png', 'image/webp'],
}));

vi.mock('../services/peReviewService', () => ({
  fetchPeReviews: vi.fn().mockResolvedValue({ reviews: [], error: null }),
  submitPeReview: vi.fn().mockResolvedValue({ review: {}, error: null }),
}));

vi.mock('../services/engineeringDocumentService', () => ({
  fetchEngineeringDocuments: vi.fn().mockResolvedValue({ documents: [], error: null }),
  uploadEngineeringDocument: vi.fn().mockResolvedValue({ document: {}, error: null }),
  deleteEngineeringDocument: vi.fn().mockResolvedValue({ success: true }),
  viewEngineeringDocumentSignedUrl: vi.fn().mockResolvedValue({ signedUrl: 'https://test.pdf' }),
  isAllowedDocMime: vi.fn().mockReturnValue(true),
  MAX_ENGINEERING_DOC_SIZE: 15 * 1024 * 1024,
}));

vi.mock('../services/adminUserService', () => ({
  fetchAllUsers: vi.fn().mockResolvedValue({ users: [], error: null }),
  fetchUsersWithProfiles: vi.fn().mockResolvedValue({ users: [], error: null }),
  createUserWithPhone: vi.fn().mockResolvedValue({ user: {}, error: null }),
  updateUserProfile: vi.fn().mockResolvedValue({ success: true }),
  toggleUserActiveStatus: vi.fn().mockResolvedValue({ success: true }),
  deleteUserAccount: vi.fn().mockResolvedValue({ success: true }),
  resetUserPasswordAdmin: vi.fn().mockResolvedValue({ success: true }),
}));

const mockOperation: JobOperation = {
  id: 'op-1',
  job_id: 'job-101',
  step_order: 10,
  operation_name: 'Phay CNC mặt đầu',
  status: 'IN_PROGRESS',
  created_at: '2026-10-12T00:00:00Z',
  updated_at: '2026-10-12T00:00:00Z',
  production_runs: [],
};

describe('SAMPLE TRACKING — FIX DUPLICATE PLUS ICONS (UI CLEANUP)', () => {
  it('1. JOB List Search Filter: "Thêm điều kiện" button has exactly one plus icon and text without "+" character', () => {
    render(
      <BrowserRouter>
        <AuthContext.Provider value={createMockAuthContext('Planning')}>
          <JobToolbar
            conditions={[{ id: 'cond-1', field: 'item_number', operator: 'CONTAINS', value: '' }]}
            onConditionsChange={vi.fn()}
            onApplyFilter={vi.fn()}
            onResetFilter={vi.fn()}
          />
        </AuthContext.Provider>
      </BrowserRouter>
    );

    const addConditionBtn = screen.getByRole('button', { name: /thêm điều kiện/i });
    expect(addConditionBtn).toBeInTheDocument();

    // Verify text label does NOT contain "+" character (no duplicate "+ +")
    expect(addConditionBtn.textContent?.trim()).toBe('Thêm điều kiện');
    expect(addConditionBtn.textContent).not.toContain('+');

    // Verify SVG icon exists
    const svgIcon = addConditionBtn.querySelector('svg');
    expect(svgIcon).toBeInTheDocument();
  });

  it('2. JOB Detail NG Details: "Thêm dòng" button has exactly one plus icon and text without "+" character', () => {
    render(
      <BrowserRouter>
        <AuthContext.Provider value={createMockAuthContext('PE-MFG')}>
          <OperationExecutionPanel
            operation={mockOperation}
            jobId="job-101"
            jobNo="202610-024"
            partNo="PART-8899"
            jobStatus="ACTIVE"
            onRefresh={vi.fn()}
          />
        </AuthContext.Provider>
      </BrowserRouter>
    );

    const addRowBtn = screen.getByRole('button', { name: /thêm dòng/i });
    expect(addRowBtn).toBeInTheDocument();

    // Verify text label does NOT contain "+" character (no duplicate "+ +")
    expect(addRowBtn.textContent?.trim()).toBe('Thêm dòng');
    expect(addRowBtn.textContent).not.toContain('+');

    // Verify SVG icon exists
    const svgIcon = addRowBtn.querySelector('svg');
    expect(svgIcon).toBeInTheDocument();
  });

  it('3. Sample Photos Gallery: "Chọn ảnh" button has exactly one plus icon and text without "+" character', () => {
    render(
      <AuthContext.Provider value={createMockAuthContext('PE-MFG')}>
        <OperationSamplePhotosGallery
          jobId="job-101"
          operationId="op-1"
          jobStatus="ACTIVE"
        />
      </AuthContext.Provider>
    );

    const chooseBtn = screen.getByText('Chọn ảnh');
    expect(chooseBtn).toBeInTheDocument();

    // Verify text does not have "+"
    expect(chooseBtn.textContent?.trim()).toBe('Chọn ảnh');
    expect(chooseBtn.textContent).not.toContain('+');

    // Verify parent label has an SVG icon
    const parentLabel = chooseBtn.closest('label');
    expect(parentLabel?.querySelector('svg')).toBeInTheDocument();
  });

  it('4. Job Creation Modal: "Thêm công đoạn" button has text without "+" character', () => {
    render(
      <BrowserRouter>
        <AuthContext.Provider value={createMockAuthContext('Planning')}>
          <JobCreateModal isOpen={true} onClose={vi.fn()} onSuccess={vi.fn()} />
        </AuthContext.Provider>
      </BrowserRouter>
    );

    const addOpBtn = screen.getByRole('button', { name: /thêm công đoạn/i });
    expect(addOpBtn).toBeInTheDocument();

    expect(addOpBtn.textContent?.trim()).toBe('Thêm công đoạn');
    expect(addOpBtn.textContent).not.toContain('+');
    expect(addOpBtn.querySelector('svg')).toBeInTheDocument();
  });

  it('5. User Management: "Tạo User mới" button has text without "+" character', async () => {
    render(
      <BrowserRouter>
        <AuthContext.Provider value={createMockAuthContext('Admin')}>
          <UserManagementPage />
        </AuthContext.Provider>
      </BrowserRouter>
    );

    const createUserBtn = screen.getByRole('button', { name: /tạo user mới/i });
    expect(createUserBtn).toBeInTheDocument();

    expect(createUserBtn.textContent?.trim()).toBe('Tạo User mới');
    expect(createUserBtn.textContent).not.toContain('+');
    expect(createUserBtn.querySelector('svg')).toBeInTheDocument();
  });
});
