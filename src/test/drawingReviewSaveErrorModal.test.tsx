import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { DrawingReviewDetailPage } from '../features/drawingReview/DrawingReviewDetailPage';
import * as drawingReviewService from '../services/drawingReviewService';

// Mock AuthContext
vi.mock('../features/auth/AuthContext', () => ({
  useAuth: () => ({
    profile: {
      id: 'mock-pe-id',
      full_name: 'Tạ Văn Đông',
      role: 'PE-MFG',
      phone: '+84396220448',
    },
  }),
}));

// Mock pdfRenderer
vi.mock('../lib/pdfRenderer', () => ({
  loadPdfDocument: vi.fn().mockResolvedValue({ numPages: 1 }),
  renderPageFromDoc: vi.fn().mockResolvedValue({
    dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    width: 800,
    height: 600,
  }),
  renderPdfPageToImage: vi.fn().mockResolvedValue({
    dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    width: 800,
    height: 600,
  }),
  isCanvasSupported: vi.fn().mockReturnValue(true),
}));

describe('DRAWING REVIEW SAVE ERROR & PROMINENT OUTAGE WARNING SUITE', () => {
  const mockIssue = {
    id: 'issue-test-123',
    issue_no: '261113-N003',
    item_no: 'CM00858368',
    item_name: 'Change into 2 piece',
    customer: 'TTI',
    drawing_file_path: 'drawings/sample.pdf',
    drawing_file_name: 'sample.pdf',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    versions: [
      {
        id: 'ver-test-1',
        issue_id: 'issue-test-123',
        version_number: 1,
        version_name: 'V1',
        status: 'Issued',
        required_material: '',
        material_type: '',
        material_specification: '',
        operations: [],
        attachments: [],
        annotations: [],
      },
    ],
    latest_version: {
      id: 'ver-test-1',
      issue_id: 'issue-test-123',
      version_number: 1,
      version_name: 'V1',
      status: 'Issued',
      required_material: '',
      material_type: '',
      material_specification: '',
      operations: [],
      attachments: [],
      annotations: [],
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(drawingReviewService, 'fetchDrawingReviewDetail').mockResolvedValue({
      data: mockIssue as any,
      error: null,
    });
    vi.spyOn(drawingReviewService, 'getDrawingFileSignedUrl').mockResolvedValue({
      signedUrl: 'https://storage.test/drawing.pdf',
      error: null,
    });
  });

  it('Displays prominent Critical Outage Modal and Sticky Warning Banner when save fails with system error', async () => {
    // Mock saveDrawingReviewDraft failing with PGRST203 system error
    vi.spyOn(drawingReviewService, 'saveDrawingReviewDraft').mockResolvedValue({
      success: false,
      error: 'PGRST203: Could not choose the best candidate function between public.save_drawing_review_draft',
    });

    render(
      <MemoryRouter initialEntries={['/drawing-reviews/issue-test-123']}>
        <Routes>
          <Route path="/drawing-reviews/:id" element={<DrawingReviewDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    // Wait for page to finish loading and Save Draft button to be ready
    const saveBtn = await screen.findByTestId('save-draft-btn');
    expect(saveBtn).toBeInTheDocument();

    // Click "Lưu bản nháp"
    fireEvent.click(saveBtn);

    // 1. Prominent Critical Modal appears
    const modal = await screen.findByTestId('critical-save-error-modal');
    expect(modal).toBeInTheDocument();

    // 2. High-impact warnings inside modal
    const withinModal = within(modal);
    expect(withinModal.getByText(/HỆ THỐNG GẶP SỰ CỐ — CHỈ XEM ĐƯỢC, KHÔNG LƯU ĐƯỢC!/)).toBeInTheDocument();
    expect(withinModal.getByText(/TUYỆT ĐỐI KHÔNG TẮT TAB TRÌNH DUYỆT!/)).toBeInTheDocument();
    expect(withinModal.getByText(/PGRST203/)).toBeInTheDocument();

    // 3. Admin contact numbers are displayed prominently
    expect(withinModal.getByText(/Đỗ Xuân Trường \(Admin\)/)).toBeInTheDocument();
    expect(withinModal.getByText(/0968 041 128/)).toBeInTheDocument();
    expect(withinModal.getByText(/Nguyễn Thu Hương \(Admin\)/)).toBeInTheDocument();
    expect(withinModal.getByText(/0963 238 895/)).toBeInTheDocument();

    // 4. Close modal with "Giữ nguyên tab để đợi Admin"
    const dismissBtn = withinModal.getByText(/Giữ nguyên tab để đợi Admin/);
    fireEvent.click(dismissBtn);

    // Modal closes
    await waitFor(() => {
      expect(screen.queryByTestId('critical-save-error-modal')).not.toBeInTheDocument();
    });

    // 5. Sticky high-priority banner remains at the top of the screen
    const stickyBanner = screen.getByTestId('sticky-system-save-error-banner');
    expect(stickyBanner).toBeInTheDocument();
    expect(stickyBanner).toHaveTextContent(/HỆ THỐNG GẶP SỰ CỐ — CHỈ XEM ĐƯỢC, KHÔNG LƯU ĐƯỢC/);

    // 6. Bottom action bar shows "Lưu thất bại — Chỉ xem được!" badge
    expect(screen.getByText(/Lưu thất bại — Chỉ xem được!/)).toBeInTheDocument();
  });
});
