import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { DrawingReviewDetailPage } from '../features/drawingReview/DrawingReviewDetailPage';
import { DrawingReviewCompletedPage } from '../features/drawingReview/DrawingReviewCompletedPage';
import { AuthContext } from '../features/auth/AuthContext';
import * as drawingReviewService from '../services/drawingReviewService';
import { generateDrawingReviewPdf } from '../services/drawingReviewPdfService';
import type { AuthUser, UserRole } from '../types/auth';

// Mock drawingReviewService
vi.mock('../services/drawingReviewService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/drawingReviewService')>();
  return {
    ...actual,
    fetchDrawingReviewDetail: vi.fn(),
    fetchWorkcenterMaster: vi.fn().mockResolvedValue([
      { workcenter_code: 'CNC-01', workcenter_name: 'Phay CNC 3 trục' },
      { workcenter_code: 'CYGG', workcenter_name: 'Mài tròn' },
    ]),
    saveDrawingReviewDraft: vi.fn(),
    closeDrawingReviewVersion: vi.fn(),
    createNextDrawingReviewVersion: vi.fn(),
    getDrawingFileSignedUrl: vi.fn().mockResolvedValue({ signedUrl: 'https://mock.blob/drawing.pdf' }),
    uploadItemAvatar: vi.fn(),
    uploadDrawingReviewAttachment: vi.fn(),
    deleteDrawingReviewAttachment: vi.fn(),
    validateSubconOperations: vi.fn().mockReturnValue({ valid: true, missingDescriptions: [] }),
  };
});

function mockAuthContext(role: UserRole = 'PE-MFG'): any {
  const user: AuthUser = {
    id: 'user-pe-01',
    phone: '84988888888',
    email: 'pe@sampletracking.local',
    role,
    department: role === 'BD' ? 'BD' : 'PE-MFG',
    factory: 'Thăng Long',
    is_active: true,
    must_change_password: false,
    created_at: '2026-10-10T00:00:00Z',
    updated_at: '2026-10-10T00:00:00Z',
  };
  return {
    user,
    profile: user,
    session: { access_token: 'mock-token' },
    role,
    loading: false,
    mustChangePassword: false,
    login: vi.fn(),
    logout: vi.fn(),
    changePassword: vi.fn(),
  };
}

describe('DRAWING REVIEW — MATERIAL TYPE & SPECIFICATION SPLIT TEST SUITE', () => {
  const sampleIssueWithSplitMaterial = {
    id: 'issue-mat-1',
    issue_no: '261104-N001',
    item_no: 'SHAFT-SUS-01',
    item_name: 'Trục Truyền Động Chính SUS316L',
    customer: 'Toyota Tsusho',
    drawing_file_path: 'drawings/issue-mat-1/shaft.pdf',
    drawing_file_name: 'shaft.pdf',
    attention: 'Lưu ý độ đồng tâm sau khi nhiệt luyện',
    created_at: '2026-11-04T08:00:00+07:00',
    versions: [
      {
        id: 'ver-mat-1',
        issue_id: 'issue-mat-1',
        version_number: 1,
        version_name: 'V1',
        status: 'Reviewing',
        material_type: 'SUS316L',
        material_specification: 'Ø19.05 h9 × L3000\nRunout 0.08/400 max\nHardness 22–30 HRC ±0.02',
        required_material: 'SUS316L\nØ19.05 h9 × L3000\nRunout 0.08/400 max\nHardness 22–30 HRC ±0.02',
        required_tooling: 'Dao phay rãnh then 6mm',
        special_measuring_equipment: 'Đồng hồ so 0.001mm',
        engineering_remarks: 'Gia công tinh sau tôi ram',
        operations: [
          {
            id: 'op-1',
            lineage_id: 'lin-1',
            step_order: 1,
            workcenter_code: 'CNC-01',
            operation_description: 'Tiện thô và tinh 2 đầu trục',
            cycle_time_seconds: 120,
            remark: '',
            is_removed: false,
          },
        ],
        attachments: [],
      },
    ],
  };

  const sampleIssueWithLegacyMaterial = {
    id: 'issue-legacy-1',
    issue_no: '261104-N002',
    item_no: 'BUSH-SCM-01',
    item_name: 'Bạc Lót SCM435',
    customer: 'Honda VN',
    drawing_file_path: 'drawings/issue-legacy-1/bush.pdf',
    drawing_file_name: 'bush.pdf',
    created_at: '2026-11-04T08:00:00+07:00',
    versions: [
      {
        id: 'ver-legacy-1',
        issue_id: 'issue-legacy-1',
        version_number: 1,
        version_name: 'V1',
        status: 'Reviewing',
        material_type: null,
        material_specification: null,
        required_material: 'Thép SCM435 phi 45 x 120mm nhiệt luyện 35-40 HRC',
        required_tooling: '',
        special_measuring_equipment: '',
        engineering_remarks: '',
        operations: [],
        attachments: [],
      },
    ],
  };

  const sampleCompletedIssue = {
    id: 'issue-comp-mat-1',
    issue_no: '261104-N003',
    item_no: 'GEAR-S32205',
    item_name: 'Bánh Răng Inox Duplex S32205',
    customer: 'Denso Corp',
    drawing_file_path: 'drawings/issue-comp-mat-1/gear.pdf',
    drawing_file_name: 'gear.pdf',
    created_at: '2026-11-04T08:00:00+07:00',
    versions: [
      {
        id: 'ver-comp-1',
        issue_id: 'issue-comp-mat-1',
        version_number: 1,
        version_name: 'V1',
        status: 'Completed',
        material_type: 'S32205',
        material_specification: 'Ø65 h8 × L1500 (Dung sai phôi ±0.05mm)',
        required_material: 'S32205\nØ65 h8 × L1500 (Dung sai phôi ±0.05mm)',
        required_tooling: 'Dao phay lăn răng m=2.5',
        special_measuring_equipment: 'Máy đo quang học 2D/3D',
        engineering_remarks: 'Kiểm tra vết ăn khớp sau khi nhiệt luyện',
        closed_at: '2026-11-04T09:00:00+07:00',
        operations: [
          {
            id: 'op-c1',
            lineage_id: 'lin-c1',
            step_order: 1,
            workcenter_code: 'CNC-01',
            operation_description: 'Tiện biên dạng và phay răng',
            cycle_time_seconds: 350,
            remark: '',
            is_removed: false,
          },
        ],
        attachments: [],
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // 1. Independent Fields Rendering and Form Initialization
  // =========================================================================
  describe('1. Detail Page — Independent Fields Rendering & Initialization', () => {
    it('renders both Material Type and Material Specification inputs with initial data', async () => {
      (drawingReviewService.fetchDrawingReviewDetail as any).mockResolvedValueOnce({
        data: sampleIssueWithSplitMaterial,
      });

      render(
        <AuthContext.Provider value={mockAuthContext('PE-MFG')}>
          <MemoryRouter initialEntries={['/drawing-reviews/issue-mat-1']}>
            <Routes>
              <Route path="/drawing-reviews/:id" element={<DrawingReviewDetailPage />} />
            </Routes>
          </MemoryRouter>
        </AuthContext.Provider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('material-type-input')).toBeInTheDocument();
        expect(screen.getByTestId('material-specification-textarea')).toBeInTheDocument();
      });

      // Verify Material Type single-line input value
      expect(screen.getByTestId('material-type-input')).toHaveValue('SUS316L');

      // Verify Material Specification textarea multiline value with technical symbols
      const specInput = screen.getByTestId('material-specification-textarea') as HTMLTextAreaElement;
      expect(specInput.value).toContain('Ø19.05 h9 × L3000');
      expect(specInput.value).toContain('Runout 0.08/400 max');
      expect(specInput.value).toContain('Hardness 22–30 HRC ±0.02');
    });

    it('gracefully falls back to legacy required_material when new fields are null', async () => {
      (drawingReviewService.fetchDrawingReviewDetail as any).mockResolvedValueOnce({
        data: sampleIssueWithLegacyMaterial,
      });

      render(
        <AuthContext.Provider value={mockAuthContext('PE-MFG')}>
          <MemoryRouter initialEntries={['/drawing-reviews/issue-legacy-1']}>
            <Routes>
              <Route path="/drawing-reviews/:id" element={<DrawingReviewDetailPage />} />
            </Routes>
          </MemoryRouter>
        </AuthContext.Provider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('material-type-input')).toBeInTheDocument();
        expect(screen.getByTestId('material-specification-textarea')).toBeInTheDocument();
      });

      expect(screen.getByTestId('material-type-input')).toHaveValue('');
      expect(screen.getByTestId('material-specification-textarea')).toHaveValue(
        'Thép SCM435 phi 45 x 120mm nhiệt luyện 35-40 HRC'
      );
    });
  });

  // =========================================================================
  // 2. Independent Editing, Dirty State & Save Draft
  // =========================================================================
  describe('2. Detail Page — Independent Editing, Dirty Checking & Save Draft', () => {
    it('updates Material Type and Material Specification independently, triggers dirty flag, and saves correctly', async () => {
      (drawingReviewService.fetchDrawingReviewDetail as any).mockResolvedValueOnce({
        data: sampleIssueWithSplitMaterial,
      });

      render(
        <AuthContext.Provider value={mockAuthContext('PE-MFG')}>
          <MemoryRouter initialEntries={['/drawing-reviews/issue-mat-1']}>
            <Routes>
              <Route path="/drawing-reviews/:id" element={<DrawingReviewDetailPage />} />
            </Routes>
          </MemoryRouter>
        </AuthContext.Provider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('material-type-input')).toBeInTheDocument();
      });

      // Initially synced
      expect(screen.getByText('Đã đồng bộ')).toBeInTheDocument();

      // Edit Material Type
      fireEvent.change(screen.getByTestId('material-type-input'), {
        target: { value: 'S32205 Duplex' },
      });
      expect(screen.getByText('Có thay đổi chưa lưu')).toBeInTheDocument();

      // Edit Material Specification with Unicode technical symbols
      fireEvent.change(screen.getByTestId('material-specification-textarea'), {
        target: { value: 'Ø32.00 h7 × L2500\nĐộ trụ 0.015 max\nĐộ cứng 32–36 HRC' },
      });

      // Save Draft
      (drawingReviewService.saveDrawingReviewDraft as any).mockResolvedValueOnce({
        success: true,
        status: 'Reviewing',
      });

      fireEvent.click(screen.getByTestId('save-draft-btn'));

      await waitFor(() => {
        expect(drawingReviewService.saveDrawingReviewDraft).toHaveBeenCalledWith(
          expect.objectContaining({
            version_id: 'ver-mat-1',
            material_type: 'S32205 Duplex',
            material_specification: 'Ø32.00 h7 × L2500\nĐộ trụ 0.015 max\nĐộ cứng 32–36 HRC',
            required_material: 'S32205 Duplex\nØ32.00 h7 × L2500\nĐộ trụ 0.015 max\nĐộ cứng 32–36 HRC',
          })
        );
      });
    });
  });

  // =========================================================================
  // 3. Read-Only View Mode (Spectator / Non-PE)
  // =========================================================================
  describe('3. Detail Page — Read-Only Mode for Spectators', () => {
    it('renders view-only elements for Material Type and Specification when canEdit is false', async () => {
      (drawingReviewService.fetchDrawingReviewDetail as any).mockResolvedValueOnce({
        data: sampleIssueWithSplitMaterial,
      });

      render(
        <AuthContext.Provider value={mockAuthContext('BD')}>
          <MemoryRouter initialEntries={['/drawing-reviews/issue-mat-1']}>
            <Routes>
              <Route path="/drawing-reviews/:id" element={<DrawingReviewDetailPage />} />
            </Routes>
          </MemoryRouter>
        </AuthContext.Provider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('view-material-type')).toBeInTheDocument();
        expect(screen.getByTestId('view-material-specification')).toBeInTheDocument();
      });

      expect(screen.getByTestId('view-material-type')).toHaveTextContent('SUS316L');
      expect(screen.getByTestId('view-material-specification')).toHaveTextContent('Ø19.05 h9 × L3000');
    });
  });

  // =========================================================================
  // 4. Completed Page Display
  // =========================================================================
  describe('4. Completed Review Summary Page', () => {
    it('displays separate Material Type and Material Specification cards on completed report', async () => {
      (drawingReviewService.fetchDrawingReviewDetail as any).mockResolvedValueOnce({
        data: sampleCompletedIssue,
      });

      render(
        <AuthContext.Provider value={mockAuthContext('PE-MFG')}>
          <MemoryRouter initialEntries={['/drawing-reviews/issue-comp-mat-1/report']}>
            <Routes>
              <Route path="/drawing-reviews/:id/report" element={<DrawingReviewCompletedPage />} />
            </Routes>
          </MemoryRouter>
        </AuthContext.Provider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('completed-material-type')).toBeInTheDocument();
        expect(screen.getByTestId('completed-material-specification')).toBeInTheDocument();
      });

      expect(screen.getByTestId('completed-material-type')).toHaveTextContent('S32205');
      expect(screen.getByTestId('completed-material-specification')).toHaveTextContent(
        'Ø65 h8 × L1500 (Dung sai phôi ±0.05mm)'
      );
    });
  });

  // =========================================================================
  // 5. PDF Generation with Material Type and Specification
  // =========================================================================
  describe('5. PDF Report Generation', () => {
    it('generates PDF including both Material Type and Material Specification boxes', async () => {
      const issue = sampleCompletedIssue;
      const version = sampleCompletedIssue.versions[0];
      const operations = version.operations as any[];
      const attachments = version.attachments as any[];

      const pdfBytes = await generateDrawingReviewPdf({
        issue: issue as any,
        version: version as any,
        operations,
        attachments,
      });
      expect(pdfBytes).toBeInstanceOf(Uint8Array);
      expect(pdfBytes.length).toBeGreaterThan(0);
    });
  });
});
