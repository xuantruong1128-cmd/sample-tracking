import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { OperationSamplePhotosGallery } from '../features/operations/OperationSamplePhotosGallery';
import { OperationExecutionPanel } from '../features/operations/OperationExecutionPanel';
import { UploadDocumentModal } from '../features/documents/UploadDocumentModal';
import { AuthContext } from '../features/auth/AuthContext';
import * as samplePhotoService from '../services/samplePhotoService';
import * as prodService from '../services/productionResultService';
import * as docService from '../services/engineeringDocumentService';
import type { JobOperation, UserRole } from '../types/database.types';

// Mock services
vi.mock('../services/samplePhotoService', () => ({
  fetchSamplePhotos: vi.fn().mockResolvedValue({ photos: [], error: null }),
  uploadSamplePhoto: vi.fn().mockResolvedValue({
    photo: {
      id: 'photo-1',
      job_id: 'job-123',
      operation_id: 'op-1',
      file_name: 'compressed-sample.jpg',
      file_path: 'sample-documents/job-123/compressed-sample.jpg',
      file_size: 450000,
      mime_type: 'image/jpeg',
      is_avatar: false,
      uploaded_by: 'user-1',
      uploader_name: 'Operator',
      created_at: new Date().toISOString(),
    },
    error: null,
  }),
  deleteSamplePhoto: vi.fn().mockResolvedValue({ success: true, error: null }),
  viewSamplePhotoSignedUrl: vi.fn().mockResolvedValue({ signedUrl: 'https://example.com/sample.jpg', error: null }),
  setPartAvatar: vi.fn().mockResolvedValue({ success: true, error: null }),
}));

vi.mock('../services/productionResultService', () => ({
  fetchDefectCatalog: vi.fn().mockResolvedValue({
    defects: [{ id: '1', code: 'DEF-01', name_vi: 'Lỗi kích thước' }],
    error: null,
  }),
  saveProductionResult: vi.fn().mockResolvedValue({ success: true }),
  saveQACheck: vi.fn().mockResolvedValue({ success: true }),
  uploadNGPhoto: vi.fn().mockResolvedValue({ filePath: 'photos/compressed_ng.jpg', error: null }),
  uploadN1CheckSheet: vi.fn().mockResolvedValue({ filePath: 'checks/compressed_n1.jpg', fileName: 'compressed_n1.jpg', error: null }),
  uploadQaNgPhoto: vi.fn().mockResolvedValue({ filePath: 'photos/compressed_qa_ng.jpg', error: null }),
  viewNGPhotoSignedUrl: vi.fn().mockResolvedValue({ signedUrl: 'https://example.com/photo.jpg', error: null }),
  closeJobOperation: vi.fn().mockResolvedValue({ success: true }),
  reviewKivTransfer: vi.fn().mockResolvedValue({ success: true }),
  fetchKivReviews: vi.fn().mockResolvedValue({ reviews: [], error: null }),
}));

vi.mock('../services/engineeringDocumentService', () => ({
  uploadEngineeringDocument: vi.fn().mockResolvedValue({
    document: { id: 'doc-1', file_name: 'test-drawing.pdf' },
    error: null,
  }),
  isAllowedDocMime: vi.fn().mockReturnValue(true),
  MAX_ENGINEERING_DOC_SIZE: 15 * 1024 * 1024,
}));

function createMockAuthContext(role: UserRole = 'PE-MFG', isLeader = true) {
  return {
    user: { id: 'test-user-id', email: 'test@example.com' } as any,
    profile: {
      id: 'test-user-id',
      username: 'testuser',
      full_name: 'Test Staff',
      role,
      is_department_leader: isLeader,
      is_active: true,
      must_change_password: false,
      created_at: '',
      updated_at: '',
    },
    session: {} as any,
    isLoading: false,
    logout: vi.fn(),
    refreshProfile: vi.fn(),
  };
}

const mockOp: JobOperation = {
  id: 'op-1',
  job_id: 'job-123',
  step_order: 10,
  operation_name: 'Auto Turn',
  workcenter_code: 'A20C',
  description: 'Auto Turn',
  status: 'IN_PROGRESS',
  created_at: '2026-10-15T00:00:00Z',
  updated_at: '2026-10-15T00:00:00Z',
  production_runs: [
    {
      id: 'run-1',
      operation_id: 'op-1',
      machine_id: 'AA08',
      cycle_time_seconds: 45,
      ok_qty: 100,
      ng_qty: 1,
      kiv_qty: 0,
      production_date: '2026-10-15',
      created_at: '2026-10-15T08:00:00Z',
      ng_details: [
        {
          id: 'ng-1',
          run_id: 'run-1',
          ng_qty: 1,
          defect_name: 'Lỗi kích thước',
          photo_urls: [],
          created_at: '',
        },
      ],
    },
  ],
  qa_checks: [
    {
      id: 'qa-1',
      operation_id: 'op-1',
      qa_staff_name: 'QA Inspector',
      n1_result: 'OK',
      n1_check_sheet_urls: [],
      qa_ng_details: [
        {
          id: 'qa-ng-1',
          qa_check_id: 'qa-1',
          ng_qty: 1,
          defect_name: 'Lỗi kích thước',
          photo_urls: [],
          created_at: '',
        },
      ],
      created_at: '',
    },
  ],
};

describe('SAMPLE TRACKING — MOBILE IMAGE CROP & COMPRESSION INTEGRATION', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.URL.createObjectURL = vi.fn().mockReturnValue('blob:http://localhost/mock-img');
    global.URL.revokeObjectURL = vi.fn();
  });

  describe('1. PE-MFG: Sample Photo Crop & Compression Flow', () => {
    it('opens ImageEditorModal when an image is selected and passes category "sample"', async () => {
      render(
        <MemoryRouter>
          <AuthContext.Provider value={createMockAuthContext('PE-MFG')}>
            <OperationSamplePhotosGallery
              jobId="job-123"
              operationId="op-1"
              jobStatus="ACTIVE"
            />
          </AuthContext.Provider>
        </MemoryRouter>
      );

      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      expect(fileInput).toBeInTheDocument();

      const dummyFile = new File(['mock-15mb-bytes'], 'sample_iphone_raw.jpg', { type: 'image/jpeg' });
      fireEvent.change(fileInput, { target: { files: [dummyFile] } });

      // Modal should open
      await waitFor(() => {
        expect(screen.getByText(/Chỉnh sửa & Tối ưu ảnh/i)).toBeInTheDocument();
        expect(screen.getByText(/Ảnh hàng mẫu \(PE-MFG\)/i)).toBeInTheDocument();
      });
    });
  });

  describe('2. QA: N1 Check Sheet vs Document Selection', () => {
    it('opens ImageEditorModal when image is picked for N1 Check Sheet with category "check_sheet"', async () => {
      render(
        <MemoryRouter>
          <AuthContext.Provider value={createMockAuthContext('QA')}>
            <OperationExecutionPanel
              operation={mockOp}
              jobId="job-123"
              jobNo="202610-001"
              partNo="PART-1"
              jobStatus="ACTIVE"
              onRefresh={vi.fn()}
            />
          </AuthContext.Provider>
        </MemoryRouter>
      );

      const n1Input = screen.getByText('+ Check Sheet / Ảnh').closest('label')?.querySelector('input') as HTMLInputElement;
      expect(n1Input).toBeInTheDocument();

      const imageCheckSheet = new File(['checksheet-photo-data'], 'n1_sheet.jpg', { type: 'image/jpeg' });
      fireEvent.change(n1Input, { target: { files: [imageCheckSheet] } });

      await waitFor(() => {
        expect(screen.getByText(/Chỉnh sửa & Tối ưu ảnh/i)).toBeInTheDocument();
        expect(screen.getByText(/QA Check Sheet/i)).toBeInTheDocument();
      });
    });

    it('bypasses ImageEditorModal and uploads directly when PDF Check Sheet is selected (keep original)', async () => {
      render(
        <MemoryRouter>
          <AuthContext.Provider value={createMockAuthContext('QA')}>
            <OperationExecutionPanel
              operation={mockOp}
              jobId="job-123"
              jobNo="202610-001"
              partNo="PART-1"
              jobStatus="ACTIVE"
              onRefresh={vi.fn()}
            />
          </AuthContext.Provider>
        </MemoryRouter>
      );

      const n1Input = screen.getByText('+ Check Sheet / Ảnh').closest('label')?.querySelector('input') as HTMLInputElement;
      const pdfCheckSheet = new File(['%PDF-1.4...'], 'standard_n1.pdf', { type: 'application/pdf' });
      fireEvent.change(n1Input, { target: { files: [pdfCheckSheet] } });

      // Modal should NOT open
      expect(screen.queryByText(/Chỉnh sửa & Tối ưu ảnh/i)).not.toBeInTheDocument();

      // uploadN1CheckSheet should be called with original PDF directly
      await waitFor(() => {
        expect(prodService.uploadN1CheckSheet).toHaveBeenCalledWith(
          'job-123',
          'op-1',
          pdfCheckSheet
        );
      });
    });
  });

  describe('3. Drawing / Engineering Documents: Safe Optional Optimization', () => {
    it('does NOT force auto-compression on Drawing PDF, keeps original without image editor', async () => {
      render(
        <UploadDocumentModal
          jobId="job-123"
          operations={[mockOp]}
          isOpen={true}
          onClose={vi.fn()}
          onSuccess={vi.fn()}
        />
      );

      const docInput = screen.getByTestId('document-file-input') as HTMLInputElement;
      const pdfDrawing = new File(['%PDF-drawing-data'], 'production_blueprint.pdf', { type: 'application/pdf' });
      fireEvent.change(docInput, { target: { files: [pdfDrawing] } });

      expect(screen.getByText('production_blueprint.pdf')).toBeInTheDocument();
      // Should NOT show image editor option button for PDF
      expect(screen.queryByText(/Cắt & Nén ảnh/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/Chỉnh sửa & Tối ưu ảnh/i)).not.toBeInTheDocument();
    });

    it('provides user-driven "Cắt & Nén ảnh" option when an image is selected for Drawing', async () => {
      render(
        <UploadDocumentModal
          jobId="job-123"
          operations={[mockOp]}
          isOpen={true}
          onClose={vi.fn()}
          onSuccess={vi.fn()}
        />
      );

      const docInput = screen.getByTestId('document-file-input') as HTMLInputElement;
      const imageDrawing = new File(['image-drawing-bytes'], 'gear_blueprint.png', { type: 'image/png' });
      fireEvent.change(docInput, { target: { files: [imageDrawing] } });

      expect(screen.getByText('gear_blueprint.png')).toBeInTheDocument();
      // Shows optional action for images
      expect(screen.getByText(/Cắt & Nén ảnh/i)).toBeInTheDocument();

      // Clicking opens ImageEditorModal with drawing category
      fireEvent.click(screen.getByText(/Cắt & Nén ảnh/i));
      await waitFor(() => {
        expect(screen.getByText(/Chỉnh sửa & Tối ưu ảnh/i)).toBeInTheDocument();
        expect(screen.getByText(/Bản vẽ kỹ thuật/i)).toBeInTheDocument();
        expect(screen.getByText(/Giữ nguyên ảnh gốc/i)).toBeInTheDocument();
      });
    });
  });
});
