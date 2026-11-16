import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AuthContext } from '../features/auth/AuthContext';
import { DrawingViewer } from '../features/drawingReview/DrawingViewer';
import { DrawingAvatarThumbnail } from '../features/drawingReview/DrawingAvatarThumbnail';
import { DrawingReviewDetailPage } from '../features/drawingReview/DrawingReviewDetailPage';
import { DrawingReviewCompletedPage } from '../features/drawingReview/DrawingReviewCompletedPage';
import { generateDrawingReviewPdf } from '../services/drawingReviewPdfService';
import * as drawingReviewService from '../services/drawingReviewService';
import type { AuthUser, UserRole } from '../types/auth';
import { PDFDocument } from 'pdf-lib';

// Mock drawingReviewService
vi.mock('../services/drawingReviewService', async () => {
  const actual = await vi.importActual<typeof import('../services/drawingReviewService')>(
    '../services/drawingReviewService'
  );
  return {
    ...actual,
    fetchDrawingReviewDetail: vi.fn(),
    uploadDrawingReviewAttachment: vi.fn(),
    deleteDrawingReviewAttachment: vi.fn(),
    uploadItemAvatar: vi.fn(),
    saveDrawingReviewDraft: vi.fn(),
    closeDrawingReviewVersion: vi.fn(),
    createNextDrawingReviewVersion: vi.fn(),
    getDrawingFileSignedUrl: vi.fn().mockImplementation(async (path: string) => ({
      signedUrl: `https://example.com/signed/${path}`,
      error: null,
    })),
  };
});

// Mock window.confirm & alert
vi.spyOn(window, 'confirm').mockImplementation(() => true);
vi.spyOn(window, 'alert').mockImplementation(() => {});

// Mock global.fetch for tests to avoid network hangs
const originalFetch = global.fetch;

beforeEach(async () => {
  vi.clearAllMocks();

  // Create minimal 2-page PDF bytes for fetch mock
  const doc = await PDFDocument.create();
  doc.addPage([100, 100]);
  doc.addPage([100, 100]);
  const pdfBytes = await doc.save();

  global.fetch = vi.fn().mockImplementation(async (url: string) => {
    return {
      ok: true,
      blob: async () => new Blob([pdfBytes], { type: 'application/pdf' }),
      arrayBuffer: async () => pdfBytes.buffer.slice(0),
    };
  }) as any;
});

const createMockAuth = (role: UserRole) => {
  const user: AuthUser = {
    id: `user-${role.toLowerCase()}`,
    phone: '+84988111222',
    email: `${role.toLowerCase()}@test.com`,
    profile: {
      id: `user-${role.toLowerCase()}`,
      phone: '+84988111222',
      role,
      full_name: `${role} User`,
      is_department_leader: false,
      is_active: true,
      must_change_password: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  };

  return {
    user,
    profile: user.profile,
    loading: false,
    error: null,
    login: vi.fn(),
    logout: vi.fn(),
    refreshProfile: vi.fn(),
  };
};

describe('DRAWING REVIEW PHASE D — MULTIPAGE PDF, AVATAR, ATTACHMENTS & PDF REPORT', () => {
  // =========================================================================
  // 1. DrawingViewer Multipage & Zoom & Avatar Crop Trigger
  // =========================================================================
  describe('1. DrawingViewer Component', () => {
    it('renders image viewer with zoom in, zoom out, and reset controls', async () => {
      render(
        <DrawingViewer
          filePath="drawings/sample-part.png"
          fileName="sample-part.png"
          mimeType="image/png"
          canCropAvatar={true}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('sample-part.png')).toBeInTheDocument();
        expect(screen.getByText('HÌNH ẢNH')).toBeInTheDocument();
      });

      // Zoom controls
      const zoomOutBtn = screen.getByTitle('Thu nhỏ');
      const zoomInBtn = screen.getByTitle('Phóng to');
      const resetBtn = screen.getByTitle('Tỷ lệ 100%');

      expect(zoomOutBtn).toBeInTheDocument();
      expect(zoomInBtn).toBeInTheDocument();
      expect(resetBtn).toBeInTheDocument();

      // Check initial 100%
      expect(screen.getByText('100%')).toBeInTheDocument();

      // Click Zoom In
      fireEvent.click(zoomInBtn);
      expect(screen.getByText('125%')).toBeInTheDocument();

      // Click Reset
      fireEvent.click(resetBtn);
      expect(screen.getByText('100%')).toBeInTheDocument();
    });

    it('renders PDF viewer and displays "Mở tệp gốc" link', async () => {
      render(
        <DrawingViewer
          filePath="drawings/blueprint-v1.pdf"
          fileName="blueprint-v1.pdf"
          mimeType="application/pdf"
          canCropAvatar={true}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('blueprint-v1.pdf')).toBeInTheDocument();
        expect(screen.getByText('PDF')).toBeInTheDocument();
        expect(screen.getByText('Mở tệp gốc')).toBeInTheDocument();
      });
    });

    it('shows crop avatar button when canCropAvatar is true and opens modal or picker', async () => {
      const handleCrop = vi.fn();
      render(
        <DrawingViewer
          filePath="drawings/blueprint-v1.pdf"
          fileName="blueprint-v1.pdf"
          mimeType="application/pdf"
          canCropAvatar={true}
          onAvatarCropped={handleCrop}
        />
      );

      // Wait until loaded (crop button enabled)
      await waitFor(() => {
        const btn = screen.getByTestId('crop-avatar-btn');
        expect(btn).toBeInTheDocument();
        expect(btn).not.toBeDisabled();
      });

      // Clicking crop avatar button on PDF opens the PDF avatar picker modal
      fireEvent.click(screen.getByTestId('crop-avatar-btn'));
      expect(screen.getByText(/Chọn ảnh để cắt Avatar từ bản vẽ PDF/i)).toBeInTheDocument();
      expect(screen.getByTestId('upload-avatar-source-btn')).toBeInTheDocument();
      expect(screen.getByTestId('camera-avatar-source-btn')).toBeInTheDocument();
    });

    it('supports multipage PDF navigation controls', async () => {
      render(
        <DrawingViewer
          filePath="drawings/blueprint-multipage.pdf"
          fileName="blueprint-multipage.pdf"
          mimeType="application/pdf"
          canCropAvatar={false}
        />
      );

      // Wait for pdf-lib to count 2 pages from fetch mock
      await waitFor(() => {
        expect(screen.getByText(/Trang 1 \/ 2/i)).toBeInTheDocument();
      });

      const nextBtn = screen.getByTestId('pdf-next-page-btn');
      const prevBtn = screen.getByTestId('pdf-prev-page-btn');

      expect(prevBtn).toBeDisabled();
      expect(nextBtn).not.toBeDisabled();

      // Go to next page
      fireEvent.click(nextBtn);
      expect(screen.getByText(/Trang 2 \/ 2/i)).toBeInTheDocument();
      expect(nextBtn).toBeDisabled();
      expect(prevBtn).not.toBeDisabled();

      // Go back to previous page
      fireEvent.click(prevBtn);
      expect(screen.getByText(/Trang 1 \/ 2/i)).toBeInTheDocument();
    });
  });

  // =========================================================================
  // 2. DrawingAvatarThumbnail Component
  // =========================================================================
  describe('2. DrawingAvatarThumbnail Component', () => {
    it('renders fallback initials when avatarFilePath is empty or null', () => {
      render(
        <DrawingAvatarThumbnail
          avatarFilePath={null}
          itemNo="BL-SHAFT-01"
          size="md"
        />
      );

      // "BL-SHAFT-01" -> initial "BL"
      expect(screen.getByText('BL')).toBeInTheDocument();
    });

    it('renders image when avatarFilePath is provided and signed URL loads', async () => {
      render(
        <DrawingAvatarThumbnail
          avatarFilePath="avatars/part-001.jpg"
          itemNo="BR-GEAR-99"
          size="lg"
        />
      );

      await waitFor(() => {
        const img = screen.getByAltText('Avatar BR-GEAR-99');
        expect(img).toBeInTheDocument();
        expect(img).toHaveAttribute('src', 'https://example.com/signed/avatars/part-001.jpg');
      });
    });
  });

  // =========================================================================
  // 3. Photo Attachments Gallery in Detail Page & Completed Page
  // =========================================================================
  describe('3. Photo Attachments Gallery & Camera Capture', () => {
    const mockIssueWithAttachments = {
      id: 'issue-att-test',
      issue_no: '261103-N001',
      item_no: 'PART-ATT-01',
      item_name: 'Mặt bích kẹp phôi',
      customer: 'TOSHIBA MACHINE',
      attention: 'Lưu ý độ bóng mặt A',
      created_at: '2026-11-03T08:00:00Z',
      versions: [
        {
          id: 'ver-att-1',
          issue_id: 'issue-att-test',
          version_number: 1,
          version_name: 'V1',
          status: 'Reviewing',
          drawing_file_path: 'drawings/flange.pdf',
          drawing_file_name: 'flange.pdf',
          drawing_mime_type: 'application/pdf',
          required_material: 'SUS304',
          required_tooling: 'Dao phay phi 12',
          special_measuring_equipment: 'Thước cặp Mitutoyo',
          engineering_remarks: 'Cần gá đặt chắc chắn',
          avatar_file_path: 'avatars/flange-thumb.jpg',
          attachments: [
            {
              id: 'att-1',
              version_id: 'ver-att-1',
              file_name: 'photo-setup.jpg',
              file_path: 'attachments/photo-setup.jpg',
              file_size: 40960,
              mime_type: 'image/jpeg',
              caption: 'Hình ảnh đồ gá phay mặt A',
              created_at: '2026-11-03T09:00:00Z',
            },
          ],
          operations: [
            {
              id: 'op-att-1',
              version_id: 'ver-att-1',
              lineage_id: 'lineage-att-1',
              step_order: 10,
              workcenter_code: 'CNC-MILL',
              operation_description: 'Phay thô và tinh mặt A',
              cycle_time_seconds: 180,
              remark: 'Gia công theo bản vẽ',
              is_removed: false,
            },
          ],
        },
      ],
    };

    it('renders photo attachments gallery with caption and upload/camera buttons for PE-MFG', async () => {
      vi.mocked(drawingReviewService.fetchDrawingReviewDetail).mockResolvedValue({
        data: mockIssueWithAttachments as any,
        error: null,
      });

      render(
        <AuthContext.Provider value={createMockAuth('PE-MFG') as any}>
          <MemoryRouter initialEntries={['/drawing-reviews/issue-att-test']}>
            <Routes>
              <Route path="/drawing-reviews/:id" element={<DrawingReviewDetailPage />} />
            </Routes>
          </MemoryRouter>
        </AuthContext.Provider>
      );

      await waitFor(() => {
        expect(screen.getAllByText(/PART-ATT-01/)[0]).toBeInTheDocument();
        expect(screen.getByText(/Hình ảnh đồ gá phay mặt A/i)).toBeInTheDocument();
      });

      // Upload & Camera buttons exist
      expect(screen.getByTestId('upload-photo-att-btn')).toBeInTheDocument();
      expect(screen.getByTestId('camera-photo-att-btn')).toBeInTheDocument();
    });

    it('allows PE-MFG to delete a photo attachment after confirmation', async () => {
      vi.mocked(drawingReviewService.fetchDrawingReviewDetail).mockResolvedValue({
        data: mockIssueWithAttachments as any,
        error: null,
      });
      vi.mocked(drawingReviewService.deleteDrawingReviewAttachment).mockResolvedValue({
        success: true,
      });

      render(
        <AuthContext.Provider value={createMockAuth('PE-MFG') as any}>
          <MemoryRouter initialEntries={['/drawing-reviews/issue-att-test']}>
            <Routes>
              <Route path="/drawing-reviews/:id" element={<DrawingReviewDetailPage />} />
            </Routes>
          </MemoryRouter>
        </AuthContext.Provider>
      );

      await waitFor(() => {
        expect(screen.getByText(/Hình ảnh đồ gá phay mặt A/i)).toBeInTheDocument();
      });

      // Click delete button
      const deleteBtn = screen.getByTitle('Xóa ảnh');
      fireEvent.click(deleteBtn);

      await waitFor(() => {
        expect(drawingReviewService.deleteDrawingReviewAttachment).toHaveBeenCalledWith(
          'att-1',
          'attachments/photo-setup.jpg'
        );
      });
    });

    it('renders read-only photo gallery and download PDF button on completed review summary page', async () => {
      const completedIssue = {
        ...mockIssueWithAttachments,
        versions: [
          {
            ...mockIssueWithAttachments.versions[0],
            status: 'Completed',
          },
        ],
      };

      vi.mocked(drawingReviewService.fetchDrawingReviewDetail).mockResolvedValue({
        data: completedIssue as any,
        error: null,
      });

      render(
        <AuthContext.Provider value={createMockAuth('BD') as any}>
          <MemoryRouter initialEntries={['/drawing-reviews/issue-att-test']}>
            <Routes>
              <Route path="/drawing-reviews/:id" element={<DrawingReviewCompletedPage />} />
            </Routes>
          </MemoryRouter>
        </AuthContext.Provider>
      );

      await waitFor(() => {
        expect(screen.getAllByText(/PART-ATT-01/)[0]).toBeInTheDocument();
        expect(screen.getByTestId('download-pdf-btn')).toBeInTheDocument();
        expect(screen.getByText(/Hình ảnh đồ gá phay mặt A/i)).toBeInTheDocument();
      });

      // BD cannot see delete buttons or upload buttons in completed summary
      expect(screen.queryByTitle('Xóa ảnh')).not.toBeInTheDocument();
      expect(screen.queryByTestId('upload-photo-att-btn')).not.toBeInTheDocument();
    });
  });

  // =========================================================================
  // 4. Drawing Review PDF Report Generation Service
  // =========================================================================
  describe('4. Drawing Review PDF Report Generation Service', () => {
    it('generates a valid, parseable PDF byte array with Vietnamese font embedding', async () => {
      const testIssue = {
        id: 'issue-pdf-1',
        issue_no: '261103-N002',
        item_no: 'SHAFT-CNC-99',
        item_name: 'Trục truyền động chính xác cao',
        customer: 'NIDEC SANKYO VIETNAM',
        attention: 'Kiểm tra độ đảo đồng tâm 0.005mm',
        created_at: '2026-11-03T10:00:00Z',
      };

      const testVersion = {
        id: 'ver-pdf-1',
        issue_id: 'issue-pdf-1',
        version_number: 1,
        version_name: 'V1',
        status: 'Completed',
        drawing_file_path: 'drawings/shaft.pdf',
        drawing_file_name: 'shaft.pdf',
        drawing_mime_type: 'application/pdf',
        required_material: 'SCM440 Nhiệt luyện tôi ram',
        required_tooling: 'Mảnh tiện ren Carmex, dao phay rãnh then',
        special_measuring_equipment: 'Máy đo tọa độ 3D CMM Mitutoyo',
        engineering_remarks: 'Lưu ý lượng dư mài sau khi thấm nitơ',
        avatar_file_path: null,
      };

      const testOperations = [
        {
          id: 'op-1',
          version_id: 'ver-pdf-1',
          lineage_id: 'lineage-1',
          step_order: 10,
          workcenter_code: 'CNC-LATHE',
          operation_description: 'Tiện thô và tiện tinh 2 đầu trục',
          cycle_time_seconds: 240,
          remark: 'Đảm bảo kích thước phi 25g6',
          is_removed: false,
        },
        {
          id: 'op-2',
          version_id: 'ver-pdf-1',
          lineage_id: 'lineage-2',
          step_order: 20,
          workcenter_code: 'SUBCON',
          operation_description: 'Nhiệt luyện tôi chân không đạt độ cứng 52-55 HRC',
          cycle_time_seconds: 0,
          remark: 'Gia công nhiệt luyện tại nhà thầu phụ Nihon Parkerizing',
          is_removed: false,
        },
        {
          id: 'op-3',
          version_id: 'ver-pdf-1',
          lineage_id: 'lineage-3',
          step_order: 30,
          workcenter_code: 'QC',
          operation_description: 'Kiểm tra độ đảo và biên dạng bằng CMM',
          cycle_time_seconds: 60,
          remark: 'Lập báo cáo kiểm tra kích thước FAI',
          is_removed: false,
        },
      ];

      // Generate the PDF passing the expected options object
      const pdfBytes = await generateDrawingReviewPdf({
        issue: testIssue as any,
        version: testVersion as any,
        operations: testOperations as any,
      });

      // Verify that pdfBytes is Uint8Array and non-empty
      expect(pdfBytes).toBeInstanceOf(Uint8Array);
      expect(pdfBytes.length).toBeGreaterThan(1000);

      // Verify the generated PDF loads in pdf-lib cleanly without corruption
      const loadedDoc = await PDFDocument.load(pdfBytes);
      expect(loadedDoc.getPageCount()).toBeGreaterThanOrEqual(1);

      // Verify Title metadata
      expect(loadedDoc.getTitle()).toContain('BÁO CÁO ĐÁNH GIÁ BẢN VẼ');
    });
  });
});
