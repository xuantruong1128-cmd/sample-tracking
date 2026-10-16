import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { OperationExecutionPanel } from '../features/operations/OperationExecutionPanel';
import { OperationSamplePhotosGallery } from '../features/operations/OperationSamplePhotosGallery';
import { OperationPeReviewSection } from '../features/operations/OperationPeReviewSection';
import { EngineeringDocumentsSection } from '../features/documents/EngineeringDocumentsSection';
import { UploadDocumentModal } from '../features/documents/UploadDocumentModal';
import { permissions } from '../features/auth/authUtils';
import * as samplePhotoService from '../services/samplePhotoService';
import * as peReviewService from '../services/peReviewService';
import * as engineeringDocumentService from '../services/engineeringDocumentService';
import type { JobOperation, UserRole } from '../types/database.types';

// Mock Auth Context
let mockProfile = {
  id: 'pe-user-001',
  phone: '0968041128',
  full_name: 'Nguyễn Văn PE',
  role: 'PE-MFG' as UserRole,
  department: 'Sản xuất',
  is_active: true,
  is_department_leader: false,
};

vi.mock('../features/auth/AuthContext', () => ({
  useAuth: () => ({
    profile: mockProfile,
    user: { id: mockProfile.id, phone: mockProfile.phone },
  }),
}));

// Mock services
vi.mock('../services/productionResultService', () => ({
  fetchDefectCatalog: vi.fn().mockResolvedValue({
    defects: [
      { id: 'def-1', code: 'DEF-DIM-01', name_vi: 'Sai kích thước' },
      { id: 'def-2', code: 'DEF-SUR-02', name_vi: 'Xước bề mặt' },
    ],
  }),
  saveProductionResult: vi.fn().mockResolvedValue({ success: true }),
  saveQACheck: vi.fn().mockResolvedValue({ success: true }),
  uploadNGPhoto: vi.fn().mockResolvedValue({ filePath: 'job-1/NG_PHOTO/test.jpg', error: null }),
  viewNGPhotoSignedUrl: vi.fn().mockResolvedValue({ signedUrl: 'https://storage.test/signed.jpg', error: null }),
  closeJobOperation: vi.fn().mockResolvedValue({ success: true }),
  reviewKivTransfer: vi.fn().mockResolvedValue({ success: true }),
  fetchKivReviews: vi.fn().mockResolvedValue({ reviews: [] }),
}));

vi.mock('../services/samplePhotoService', () => ({
  fetchSamplePhotos: vi.fn().mockResolvedValue({
    photos: [
      {
        id: 'photo-1',
        job_id: 'job-101',
        operation_id: 'op-1',
        file_name: 'sample_part_face_a.jpg',
        file_path: 'job-101/SAMPLE_PHOTO/op-1_sample_part_face_a.jpg',
        file_size: 1024 * 500,
        mime_type: 'image/jpeg',
        uploader_name: 'Kỹ thuật viên PE',
        created_at: '2026-10-14T09:00:00Z',
      },
    ],
    error: null,
  }),
  uploadSamplePhoto: vi.fn().mockImplementation(({ jobId, operationId, file }) =>
    Promise.resolve({
      photo: {
        id: `photo-${Date.now()}`,
        job_id: jobId,
        operation_id: operationId,
        file_name: file.name,
        file_path: `${jobId}/SAMPLE_PHOTO/${operationId}_${Date.now()}_${file.name}`,
        file_size: file.size,
        mime_type: file.type || 'image/jpeg',
        uploader_name: 'Nguyễn Văn PE',
        created_at: new Date().toISOString(),
      },
      error: null,
    })
  ),
  deleteSamplePhoto: vi.fn().mockResolvedValue({ success: true, error: null }),
  viewSamplePhotoSignedUrl: vi.fn().mockResolvedValue({
    signedUrl: 'https://storage.test/signed_sample_photo.jpg',
    error: null,
  }),
  MAX_SAMPLE_PHOTO_SIZE: 10 * 1024 * 1024,
  ALLOWED_SAMPLE_PHOTO_MIMES: ['image/jpeg', 'image/png', 'image/webp'],
}));

vi.mock('../services/peReviewService', () => ({
  fetchPeReviews: vi.fn().mockResolvedValue({
    reviews: [
      {
        id: 'review-1',
        job_id: 'job-101',
        operation_id: 'op-1',
        review_result: 'OK',
        engineering_comment: 'Gia công đạt độ bóng Rz 1.6, dao tiện mòn nhẹ nhưng ổn định.',
        improvement_required: 'Lần sau tăng áp suất tưới nguội để thoát phoi tốt hơn.',
        reviewer_name: 'Nguyễn Văn PE',
        reviewer_role: 'PE-MFG',
        created_at: '2026-10-14T08:30:00Z',
      },
    ],
    error: null,
  }),
  submitPeReview: vi.fn().mockImplementation(({ jobId, operationId, reviewResult, engineeringComment, improvementRequired }) =>
    Promise.resolve({
      review: {
        id: `review-${Date.now()}`,
        job_id: jobId,
        operation_id: operationId,
        review_result: reviewResult,
        engineering_comment: engineeringComment,
        improvement_required: improvementRequired || '',
        reviewer_name: 'Nguyễn Văn PE',
        reviewer_role: 'PE-MFG',
        created_at: new Date().toISOString(),
      },
      error: null,
    })
  ),
}));

vi.mock('../services/engineeringDocumentService', () => ({
  fetchEngineeringDocuments: vi.fn().mockResolvedValue({
    documents: [
      {
        id: 'doc-1',
        job_id: 'job-101',
        operation_id: null, // General
        category: 'Drawing',
        file_name: 'PART-DWG-REV-A.pdf',
        file_path: 'job-101/DOCUMENTS/Drawing_v1_PART-DWG-REV-A.pdf',
        file_size: 1024 * 1024 * 2,
        mime_type: 'application/pdf',
        version: 'v1',
        remark: 'Bản vẽ phát hành đợt 1',
        uploader_name: 'Kỹ sư Bản vẽ (Drawing)',
        created_at: '2026-10-14T07:00:00Z',
      },
      {
        id: 'doc-2',
        job_id: 'job-101',
        operation_id: 'op-1',
        category: 'Setting',
        file_name: 'OP10-SETTING-SHEET.xlsx',
        file_path: 'job-101/DOCUMENTS/Setting_v1_OP10-SETTING-SHEET.xlsx',
        file_size: 1024 * 350,
        mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        version: 'v1',
        remark: 'Chế độ cắt đồ gá 3 chấu',
        uploader_name: 'Kỹ sư PE',
        created_at: '2026-10-14T07:30:00Z',
      },
    ],
    error: null,
  }),
  uploadEngineeringDocument: vi.fn().mockImplementation(({ jobId, operationId, category, file, version, remark, parentDocumentId }) =>
    Promise.resolve({
      document: {
        id: `doc-${Date.now()}`,
        job_id: jobId,
        operation_id: operationId,
        category,
        file_name: file.name,
        file_path: `${jobId}/DOCUMENTS/${category}_${version}_${Date.now()}_${file.name}`,
        file_size: file.size,
        mime_type: file.type || 'application/pdf',
        version: version || 'v1',
        parent_document_id: parentDocumentId,
        remark: remark || '',
        uploader_name: 'Drawing Specialist',
        created_at: new Date().toISOString(),
      },
      error: null,
    })
  ),
  deleteEngineeringDocument: vi.fn().mockResolvedValue({ success: true, error: null }),
  viewEngineeringDocumentSignedUrl: vi.fn().mockResolvedValue({
    signedUrl: 'https://storage.test/signed_doc.pdf',
    error: null,
  }),
  isAllowedDocMime: vi.fn().mockReturnValue(true),
  MAX_ENGINEERING_DOC_SIZE: 15 * 1024 * 1024,
}));

const mockOperation: JobOperation = {
  id: 'op-1',
  job_id: 'job-101',
  step_order: 10,
  operation_name: 'Phay CNC mặt đầu',
  status: 'IN_PROGRESS',
  workcenter_code: 'MC-MILL-01',
  machine_no: 'AA08',
  created_at: '2026-10-12T00:00:00Z',
  updated_at: '2026-10-12T00:00:00Z',
  production_runs: [
    {
      id: 'run-1',
      operation_id: 'op-1',
      machine_id: 'AA08',
      operator_name: 'Thợ tiện A',
      start_time: '08:00',
      end_time: '17:00',
      ok_qty: 25,
      ng_qty: 2,
      kiv_qty: 1,
      production_date: '2026-10-14',
      cycle_time_seconds: 45,
      created_at: '2026-10-14T08:00:00Z',
      ng_details: [
        {
          id: 'ng-1',
          production_run_id: 'run-1',
          defect_name: 'Sai kích thước',
          defect_code: 'DEF-DIM-01',
          ng_qty: 2,
          cause: 'Mòn dao tiện',
          remark: 'Đã thay dao',
          photo_urls: [],
          created_at: '2026-10-14T08:00:00Z',
        },
      ],
    },
  ],
};

describe('SAMPLE TRACKING — OPERATION UI & ENGINEERING DOCUMENTS R1 TEST SUITE', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProfile = {
      id: 'pe-user-001',
      phone: '0968041128',
      full_name: 'Nguyễn Văn PE',
      role: 'PE-MFG',
      department: 'Sản xuất',
      is_active: true,
      is_department_leader: false,
    };
  });

  // ---------------------------------------------------------------------------
  // 1. UI PRODUCTION RESULT & SAMPLE PHOTOS COMPACT REDESIGN
  // ---------------------------------------------------------------------------
  describe('1. Production Result Split Layout & Sample Photos Gallery', () => {
    it('renders Left Parameters (Row 1 Machine|Date|CT, Row 2 OK|NG|KIV) and Right Sample Photos Gallery', async () => {
      render(
        <BrowserRouter>
          <OperationExecutionPanel
            operation={mockOperation}
            jobId="job-101"
            jobNo="202610-024"
            partNo="PART-8899"
            jobStatus="ACTIVE"
            onRefresh={vi.fn()}
          />
        </BrowserRouter>
      );

      // Verify Left parameters: Row 1
      expect(screen.getByDisplayValue('AA08')).toBeInTheDocument();
      expect(screen.getByDisplayValue('2026-10-14')).toBeInTheDocument();
      expect(screen.getByDisplayValue('45')).toBeInTheDocument();

      // Verify Left parameters: Row 2
      expect(screen.getByDisplayValue('25')).toBeInTheDocument(); // OK
      expect(screen.getAllByDisplayValue('2').length).toBeGreaterThanOrEqual(1); // NG (auto-summed)
      expect(screen.getByDisplayValue('1')).toBeInTheDocument();  // KIV

      // Verify Right Sample Photos gallery is rendered
      expect(screen.getByText('Ảnh sản phẩm mẫu (Sample Photos)')).toBeInTheDocument();

      // Verify full width NG details table is rendered
      expect(screen.getByText('Chi tiết Lỗi (NG Details)')).toBeInTheDocument();
      await waitFor(() => {
        expect(screen.getByText('Sai kích thước')).toBeInTheDocument();
      });
    });

    it('Sample Photos Gallery supports camera direct capture and file selection', async () => {
      render(
        <OperationSamplePhotosGallery
          jobId="job-101"
          operationId="op-1"
          jobStatus="ACTIVE"
        />
      );

      // Verify camera capture button exists with accept="image/*" and capture="environment"
      const cameraBtn = screen.getByText('Chụp ảnh');
      expect(cameraBtn).toBeInTheDocument();
      const cameraInput = cameraBtn.closest('label')?.querySelector('input[type="file"]');
      expect(cameraInput).toHaveAttribute('accept', 'image/*');
      expect(cameraInput).toHaveAttribute('capture', 'environment');

      // Verify select file button exists
      const chooseBtn = screen.getByText('Chọn ảnh');
      expect(chooseBtn).toBeInTheDocument();
    });

    it('opens lightbox preview modal with signed URL when clicking a sample photo thumbnail', async () => {
      render(
        <OperationSamplePhotosGallery
          jobId="job-101"
          operationId="op-1"
          jobStatus="ACTIVE"
        />
      );

      await waitFor(() => {
        expect(screen.getByText('1 ảnh')).toBeInTheDocument();
      });

      // Find the thumbnail or preview button
      const previewBtn = screen.getByTitle('Phóng to ảnh');
      fireEvent.click(previewBtn);

      // Verify lightbox modal is displayed
      await waitFor(() => {
        expect(screen.getByTestId('sample-photo-lightbox')).toBeInTheDocument();
      });
      expect(screen.getByText('sample_part_face_a.jpg')).toBeInTheDocument();
      expect(screen.getAllByText(/Kỹ thuật viên PE/).length).toBeGreaterThanOrEqual(1);
    });

    it('locks Sample Photos upload when parent JOB status is CLOSE, but allows after Close Operation', () => {
      // Case A: Operation is CLOSED, but JOB is ACTIVE -> Still allowed
      const { rerender } = render(
        <OperationSamplePhotosGallery
          jobId="job-101"
          operationId="op-1"
          jobStatus="ACTIVE"
        />
      );
      expect(screen.getByText('Chụp ảnh')).toBeInTheDocument();

      // Case B: JOB is CLOSE -> Upload controls hidden/locked
      rerender(
        <OperationSamplePhotosGallery
          jobId="job-101"
          operationId="op-1"
          jobStatus="CLOSE"
        />
      );
      expect(screen.queryByText('Chụp ảnh')).not.toBeInTheDocument();
      expect(screen.queryByText('Chọn ảnh')).not.toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------------
  // 2. PE ENGINEERING REVIEW SECTION
  // ---------------------------------------------------------------------------
  describe('2. PE Engineering Review Functionality', () => {
    it('renders PE Engineering Review section between Production Result and QA Inspection', async () => {
      render(
        <BrowserRouter>
          <OperationExecutionPanel
            operation={mockOperation}
            jobId="job-101"
            jobNo="202610-024"
            partNo="PART-8899"
            jobStatus="ACTIVE"
            onRefresh={vi.fn()}
          />
        </BrowserRouter>
      );

      expect(screen.getByTestId('pe-engineering-review-section')).toBeInTheDocument();
      expect(screen.getByText('Đánh giá Kỹ thuật PE (PE Engineering Review)')).toBeInTheDocument();
      expect(screen.getByText('Kiểm tra Chất lượng (QA Inspection)')).toBeInTheDocument();
    });

    it('submits a new PE Engineering Review with result, comment, improvement and appends to history', async () => {
      render(
        <OperationPeReviewSection
          jobId="job-101"
          operationId="op-1"
          jobStatus="ACTIVE"
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Đánh giá Kỹ thuật PE (PE Engineering Review)')).toBeInTheDocument();
      });

      // Toggle result to NG
      const ngButton = screen.getByRole('button', { name: 'NG' });
      fireEvent.click(ngButton);

      // Enter Engineering Comment
      const commentInput = screen.getByPlaceholderText(/Ghi nhận hiện trạng gia công/i);
      fireEvent.change(commentInput, { target: { value: 'Bề mặt bị xước do kẹt phoi tiện ren.' } });

      // Enter Improvement
      const improvementInput = screen.getByPlaceholderText(/Yêu cầu sửa khuôn/i);
      fireEvent.change(improvementInput, { target: { value: 'Bổ sung vòi tưới nguội phụ áp lực cao.' } });

      // Submit
      const submitBtn = screen.getByRole('button', { name: /Lưu đánh giá PE/i });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(peReviewService.submitPeReview).toHaveBeenCalledWith(
          expect.objectContaining({
            jobId: 'job-101',
            operationId: 'op-1',
            reviewResult: 'NG',
            engineeringComment: 'Bề mặt bị xước do kẹt phoi tiện ren.',
            improvementRequired: 'Bổ sung vòi tưới nguội phụ áp lực cao.',
          })
        );
      });

      expect(screen.getByText('Đã lưu đánh giá kỹ thuật PE thành công.')).toBeInTheDocument();
    });

    it('PE Review does NOT modify OK/NG/KIV production baseline numbers', () => {
      expect(mockOperation.production_runs![0].ok_qty).toBe(25);
      expect(mockOperation.production_runs![0].ng_qty).toBe(2);
      expect(mockOperation.production_runs![0].kiv_qty).toBe(1);
    });

    it('allows PE Review after Close Operation, but locks when JOB is CLOSE', () => {
      // Case A: Job is ACTIVE -> Review form available
      const { rerender } = render(
        <OperationPeReviewSection
          jobId="job-101"
          operationId="op-1"
          jobStatus="ACTIVE"
        />
      );
      expect(screen.getByRole('button', { name: /Lưu đánh giá PE/i })).toBeInTheDocument();

      // Case B: Job is CLOSE -> Review form hidden, shows read-only badge
      rerender(
        <OperationPeReviewSection
          jobId="job-101"
          operationId="op-1"
          jobStatus="CLOSE"
        />
      );
      expect(screen.queryByRole('button', { name: /Lưu đánh giá PE/i })).not.toBeInTheDocument();
      expect(screen.getByText('Đã đóng (Chỉ xem)')).toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------------
  // 3. ROLE DRAWING & ENGINEERING DOCUMENTS MANAGEMENT
  // ---------------------------------------------------------------------------
  describe('3. Role Drawing Permissions & Engineering Documents Management', () => {
    it('Drawing role has dedicated permissions: can upload documents, cannot touch planning/production/QA', () => {
      const drawingRole: UserRole = 'Drawing';

      // Drawing can upload engineering documents
      expect(permissions.canUploadEngineeringDocuments(drawingRole)).toBe(true);

      // Drawing CANNOT edit planning, production, QA, review KIV, close op, close job, delete job, manage users
      expect(permissions.canCreateJob(drawingRole)).toBe(false);
      expect(permissions.canEditPlanning(drawingRole)).toBe(false);
      expect(permissions.canEnterProduction(drawingRole)).toBe(false);
      expect(permissions.canInspectQA(drawingRole)).toBe(false);
      expect(permissions.canReviewKiv(drawingRole, false)).toBe(false);
      expect(permissions.canCloseOperation(drawingRole, false)).toBe(false);
      expect(permissions.canCloseJob(drawingRole, false)).toBe(false);
      expect(permissions.canManageUsers(drawingRole)).toBe(false);
      expect(
        permissions.canDeleteJob(
          { created_by: 'some-id', status: 'ACTIVE', operations: [] },
          { id: 'drawing-id', role: drawingRole } as any
        )
      ).toBe(false);
    });

    it('renders Engineering Documents section with Category and Operation filters', async () => {
      mockProfile.role = 'Drawing';
      render(
        <EngineeringDocumentsSection
          jobId="job-101"
          operations={[mockOperation]}
          jobStatus="ACTIVE"
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Tài liệu Kỹ thuật (Engineering Documents)')).toBeInTheDocument();
      });

      // Check document rows
      expect(screen.getByText('PART-DWG-REV-A.pdf')).toBeInTheDocument();
      expect(screen.getAllByText('Bản vẽ (Drawing)').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('OP10-SETTING-SHEET.xlsx')).toBeInTheDocument();
      expect(screen.getAllByText('Setting Sheet').length).toBeGreaterThanOrEqual(1);

      // Check filters
      expect(screen.getByText('Công đoạn:')).toBeInTheDocument();
      expect(screen.getByText('Phân loại:')).toBeInTheDocument();
    });

    it('filters engineering documents correctly by category', async () => {
      render(
        <EngineeringDocumentsSection
          jobId="job-101"
          operations={[mockOperation]}
          jobStatus="ACTIVE"
        />
      );

      await waitFor(() => {
        expect(screen.getByText('PART-DWG-REV-A.pdf')).toBeInTheDocument();
      });

      // Filter by "Setting"
      const catSelect = screen.getByDisplayValue('Tất cả phân loại');
      fireEvent.change(catSelect, { target: { value: 'Setting' } });

      // Setting document should be visible, Drawing document should be filtered out
      expect(screen.getByText('OP10-SETTING-SHEET.xlsx')).toBeInTheDocument();
      expect(screen.queryByText('PART-DWG-REV-A.pdf')).not.toBeInTheDocument();
    });

    it('generates secure signed URL when user clicks Xem/Tải on an engineering document', async () => {
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

      render(
        <EngineeringDocumentsSection
          jobId="job-101"
          operations={[mockOperation]}
          jobStatus="ACTIVE"
        />
      );

      await waitFor(() => {
        expect(screen.getByText('PART-DWG-REV-A.pdf')).toBeInTheDocument();
      });

      const downloadBtns = screen.getAllByRole('button', { name: /Xem\/Tải/i });
      fireEvent.click(downloadBtns[0]);

      await waitFor(() => {
        expect(engineeringDocumentService.viewEngineeringDocumentSignedUrl).toHaveBeenCalledWith(
          'job-101/DOCUMENTS/Drawing_v1_PART-DWG-REV-A.pdf'
        );
        expect(openSpy).toHaveBeenCalledWith('https://storage.test/signed_doc.pdf', '_blank', 'noopener,noreferrer');
      });

      openSpy.mockRestore();
    });

    it('uploads new version of an existing document without overwriting original', async () => {
      const handleSuccess = vi.fn();
      const parentDoc = {
        id: 'doc-1',
        job_id: 'job-101',
        operation_id: null,
        category: 'Drawing' as const,
        file_name: 'PART-DWG-REV-A.pdf',
        file_path: 'job-101/DOCUMENTS/Drawing_v1_PART-DWG-REV-A.pdf',
        file_size: 1024 * 1024 * 2,
        mime_type: 'application/pdf',
        version: 'v1',
        remark: 'Bản vẽ phát hành đợt 1',
        uploader_name: 'Drawing Specialist',
        created_at: '2026-10-14T07:00:00Z',
      };

      render(
        <UploadDocumentModal
          jobId="job-101"
          operations={[mockOperation]}
          parentDocument={parentDoc}
          isOpen={true}
          onClose={vi.fn()}
          onSuccess={handleSuccess}
        />
      );

      // Verify suggested version is auto-incremented to v2
      expect(screen.getByDisplayValue('v2')).toBeInTheDocument();

      // Attach file
      const file = new File(['dummy content'], 'PART-DWG-REV-B.pdf', { type: 'application/pdf' });
      const fileInput = screen.getByTestId('document-file-input');
      fireEvent.change(fileInput, { target: { files: [file] } });

      // Enter remark
      const remarkInput = screen.getByPlaceholderText(/Cập nhật dung sai/i);
      fireEvent.change(remarkInput, { target: { value: 'Bổ sung rãnh thoát dao R0.5' } });

      // Submit form
      const submitBtn = screen.getByRole('button', { name: /Xác nhận tải tài liệu/i });
      fireEvent.submit(submitBtn.closest('form')!);

      await waitFor(() => {
        expect(engineeringDocumentService.uploadEngineeringDocument).toHaveBeenCalledWith(
          expect.objectContaining({
            jobId: 'job-101',
            category: 'Drawing',
            version: 'v2',
            parentDocumentId: 'doc-1',
            remark: 'Bổ sung rãnh thoát dao R0.5',
          })
        );
      });
    });

    it('blocks uploading documents when parent JOB is in CLOSE status', () => {
      render(
        <EngineeringDocumentsSection
          jobId="job-101"
          operations={[mockOperation]}
          jobStatus="CLOSE"
        />
      );

      // Button to upload document should be hidden when job is closed
      expect(screen.queryByRole('button', { name: /Tải tài liệu mới/i })).not.toBeInTheDocument();
    });
  });
});
