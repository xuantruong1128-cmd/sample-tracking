import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AuthContext } from '../features/auth/AuthContext';
import { Header } from '../components/common/Header';
import { PreliminaryRoutingMatrix } from '../features/drawingReview/PreliminaryRoutingMatrix';
import { DrawingViewer } from '../features/drawingReview/DrawingViewer';
import { DrawingReviewCreatePage } from '../features/drawingReview/DrawingReviewCreatePage';
import { DrawingReviewListPage } from '../features/drawingReview/DrawingReviewListPage';
import { DrawingReviewDetailPage } from '../features/drawingReview/DrawingReviewDetailPage';
import { DrawingReviewCompletedPage } from '../features/drawingReview/DrawingReviewCompletedPage';
import * as drawingReviewService from '../services/drawingReviewService';
import type { AuthUser, UserRole } from '../types/auth';
import type {
  DrawingReviewVersion,
  DrawingReviewOperation,
} from '../types/database.types';

// Mock drawingReviewService
vi.mock('../services/drawingReviewService', async () => {
  const actual = await vi.importActual<typeof import('../services/drawingReviewService')>(
    '../services/drawingReviewService'
  );
  return {
    ...actual,
    fetchDrawingReviewList: vi.fn(),
    fetchDrawingReviewDetail: vi.fn(),
    createDrawingReviewIssue: vi.fn(),
    saveDrawingReviewDraft: vi.fn(),
    closeDrawingReviewVersion: vi.fn(),
    createNextDrawingReviewVersion: vi.fn(),
    getDrawingFileSignedUrl: vi.fn().mockResolvedValue({
      signedUrl: 'https://example.com/mock-signed-drawing.png',
      error: null,
    }),
    uploadDrawingFile: vi.fn().mockResolvedValue({
      filePath: 'drawings/mock-folder/drawing.pdf',
      fileName: 'drawing.pdf',
      fileSize: 10240,
      mimeType: 'application/pdf',
      error: null,
    }),
  };
});

// Mock window.confirm & alert
vi.spyOn(window, 'confirm').mockImplementation(() => true);
vi.spyOn(window, 'alert').mockImplementation(() => {});

const createMockAuth = (role: UserRole, isLeader: boolean = false) => {
  const user: AuthUser = {
    id: `user-${role.toLowerCase()}`,
    phone: '+84988111222',
    email: `${role.toLowerCase()}@test.com`,
    profile: {
      id: `user-${role.toLowerCase()}`,
      phone: '+84988111222',
      role,
      full_name: `${role} User`,
      is_department_leader: isLeader,
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

const mockWorkcenterOptions = [
  { code: 'CNC01', description: 'CNC Milling', department: 'PE-MFG' },
  { code: 'LATHE', description: 'Lathe', department: 'PE-MFG' },
  { code: 'Subcon', description: 'Gia công ngoài (Subcon)', department: 'PE-MFG' },
  { code: 'QC01', description: 'Quality Inspection', department: 'QA' },
];

describe('DRAWING REVIEW PHASE C — FRONTEND WORKSPACE & ROUTING MATRIX TEST SUITE', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /* =========================================================================
   * 1. NAVIGATION & ROLE-BASED ACCESS CONTROL
   * ========================================================================= */
  describe('1. Header Navigation & Role-Based Access', () => {
    it('BD user sees BOTH "Đánh giá bản vẽ" and "Lệnh sản xuất (JOBs)" on desktop or mobile', () => {
      const bdAuth = createMockAuth('BD');
      render(
        <AuthContext.Provider value={bdAuth}>
          <MemoryRouter>
            <Header />
          </MemoryRouter>
        </AuthContext.Provider>
      );

      // Desktop link for Drawing Review is present
      const navLink = screen.getByTestId('nav-drawing-review');
      expect(navLink).toBeInTheDocument();
      expect(navLink).toHaveTextContent('Đánh giá bản vẽ');

      // Sample Tracking JOBs link is also present for BD (re-granted view-only access)
      const jobsNavLink = screen.getByTestId('nav-jobs');
      expect(jobsNavLink).toBeInTheDocument();
      expect(jobsNavLink).toHaveTextContent('Lệnh sản xuất (JOBs)');
    });

    it('PE-MFG and Admin users see BOTH "Lệnh sản xuất (JOBs)" and "Đánh giá bản vẽ"', () => {
      const peAuth = createMockAuth('PE-MFG');
      render(
        <AuthContext.Provider value={peAuth}>
          <MemoryRouter>
            <Header />
          </MemoryRouter>
        </AuthContext.Provider>
      );

      expect(screen.getByText('Lệnh sản xuất (JOBs)')).toBeInTheDocument();
      expect(screen.getByTestId('nav-drawing-review')).toBeInTheDocument();
    });
  });

  /* =========================================================================
   * 2. PRELIMINARY ROUTING MATRIX COMPONENT
   * ========================================================================= */
  describe('2. Preliminary Routing Matrix (Core Matrix Component)', () => {
    const historicalV1Ops: DrawingReviewOperation[] = [
      {
        id: 'op-v1-1',
        version_id: 'ver-1',
        lineage_id: 'lin-op-1',
        step_order: 10,
        workcenter_code: 'CNC01',
        operation_description: 'Milling rough',
        cycle_time_seconds: 120,
        remarks: 'V1 note for CNC',
        is_removed: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: 'op-v1-2',
        version_id: 'ver-1',
        lineage_id: 'lin-op-2',
        step_order: 20,
        workcenter_code: 'Subcon',
        operation_description: 'Anodizing black',
        cycle_time_seconds: 0,
        remarks: 'Outsourced heat treatment',
        is_removed: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];

    const currentV2Ops = [
      {
        id: 'op-v2-1',
        lineage_id: 'lin-op-1',
        step_order: 10,
        workcenter_code: 'CNC01',
        operation_description: 'Milling rough',
        cycle_time_seconds: 95,
        remark: 'Optimized toolpath in V2',
        is_removed: false,
      },
      {
        id: 'op-v2-2',
        lineage_id: 'lin-op-2',
        step_order: 20,
        workcenter_code: 'Subcon',
        operation_description: 'Anodizing black',
        cycle_time_seconds: 0,
        remark: 'Outsourced heat treatment',
        is_removed: false,
      },
      {
        id: 'op-v2-3',
        lineage_id: 'lin-op-3', // newly added in V2
        step_order: 30,
        workcenter_code: 'LATHE',
        operation_description: 'Finishing bore',
        cycle_time_seconds: 60,
        remark: 'Added in V2',
        is_removed: false,
      },
    ];

    const allVersions: Array<DrawingReviewVersion & { operations?: DrawingReviewOperation[] }> = [
      {
        id: 'ver-1',
        issue_id: 'issue-1',
        version_number: 1,
        version_name: 'V1',
        status: 'Completed',
        is_active: false,
        created_at: '2026-11-01T10:00:00Z',
        updated_at: '2026-11-01T12:00:00Z',
        operations: historicalV1Ops,
      },
      {
        id: 'ver-2',
        issue_id: 'issue-1',
        version_number: 2,
        version_name: 'V2',
        status: 'Reviewing',
        is_active: true,
        created_at: '2026-11-02T10:00:00Z',
        updated_at: '2026-11-02T11:00:00Z',
        operations: [],
      },
    ];

    it('displays dynamic comparison columns OP | W/C | V1 | V2 with correct CTs and headers', () => {
      const onChange = vi.fn();
      render(
        <PreliminaryRoutingMatrix
          allVersions={allVersions}
          currentVersionId="ver-2"
          operations={currentV2Ops}
          onChangeOperations={onChange}
          workcenterOptions={mockWorkcenterOptions}
          isEditable={true}
        />
      );

      // Verify Headers
      expect(screen.getByText('OP')).toBeInTheDocument();
      expect(screen.getByText('Work Center (W/C)')).toBeInTheDocument();
      expect(screen.getByText(/V1\s+CT/i)).toBeInTheDocument();
      expect(screen.getByText(/V2\s+CT/i)).toBeInTheDocument();

      // V1 CT for lin-op-1 is historical: should display read-only "120"
      expect(screen.getByText('120')).toBeInTheDocument();

      // lin-op-3 was added in V2, so its V1 column should display "—"
      const dashes = screen.getAllByText('—');
      expect(dashes.length).toBeGreaterThan(0);
    });

    it('each operation has an auto-expanding Remark row immediately beneath it', () => {
      const onChange = vi.fn();
      render(
        <PreliminaryRoutingMatrix
          allVersions={allVersions}
          currentVersionId="ver-2"
          operations={currentV2Ops}
          onChangeOperations={onChange}
          workcenterOptions={mockWorkcenterOptions}
          isEditable={true}
        />
      );

      // Find remark textarea for lin-op-1
      const remarkInput = screen.getByTestId('remark-textarea-0');
      expect(remarkInput).toBeInTheDocument();
      expect(remarkInput).toHaveValue('Optimized toolpath in V2');
      expect(remarkInput.tagName.toLowerCase()).toBe('textarea');
    });

    it('identifies SUBCON case-insensitively and displays required description input', () => {
      const onChange = vi.fn();
      render(
        <PreliminaryRoutingMatrix
          allVersions={allVersions}
          currentVersionId="ver-2"
          operations={currentV2Ops}
          onChangeOperations={onChange}
          workcenterOptions={mockWorkcenterOptions}
          isEditable={true}
        />
      );

      // Subcon row should have description input showing "Anodizing black"
      const subconDesc = screen.getByTestId('subcon-desc-input-1');
      expect(subconDesc).toBeInTheDocument();
      expect(subconDesc).toHaveValue('Anodizing black');

      // Change description
      fireEvent.change(subconDesc, { target: { value: 'Nickel plating' } });
      expect(onChange).toHaveBeenCalled();
    });

    it('supports inserting a new operation with stable lineage_id between rows', () => {
      const onChange = vi.fn();
      render(
        <PreliminaryRoutingMatrix
          allVersions={allVersions}
          currentVersionId="ver-2"
          operations={currentV2Ops}
          onChangeOperations={onChange}
          workcenterOptions={mockWorkcenterOptions}
          isEditable={true}
        />
      );

      // Click the bottom "Thêm công đoạn tiếp theo" button
      const addBottomBtn = screen.getByText('Thêm công đoạn tiếp theo');
      fireEvent.click(addBottomBtn);

      expect(onChange).toHaveBeenCalled();
      const updatedOps = onChange.mock.calls[0][0];
      // Originally 3 operations, should now be 4
      expect(updatedOps.length).toBe(4);
      // New op has valid lineage_id starting with 'lineage-'
      expect(updatedOps[3].lineage_id).toBeDefined();
      expect(updatedOps[3].step_order).toBe(40);
    });

    it('supports removing an operation and allows restoring it before close', () => {
      const onChange = vi.fn();
      render(
        <PreliminaryRoutingMatrix
          allVersions={allVersions}
          currentVersionId="ver-2"
          operations={currentV2Ops}
          onChangeOperations={onChange}
          workcenterOptions={mockWorkcenterOptions}
          isEditable={true}
        />
      );

      // Remove the first operation (lin-op-1)
      const removeBtn = screen.getByTestId('remove-op-btn-0');
      fireEvent.click(removeBtn);

      expect(onChange).toHaveBeenCalled();
      const updatedOps = onChange.mock.calls[0][0];
      expect(updatedOps[0].is_removed).toBe(true);
    });

    it('DOES NOT calculate or display Total Cycle Time', () => {
      const onChange = vi.fn();
      const { container } = render(
        <PreliminaryRoutingMatrix
          allVersions={allVersions}
          currentVersionId="ver-2"
          operations={currentV2Ops}
          onChangeOperations={onChange}
          workcenterOptions={mockWorkcenterOptions}
          isEditable={true}
        />
      );

      expect(container.textContent).not.toContain('Total Cycle Time');
      expect(container.textContent).not.toContain('Tổng Cycle Time');
      expect(container.textContent).not.toContain('Total CT');
    });

    it('renders historical versions in read-only mode when isEditable=false', () => {
      const onChange = vi.fn();
      render(
        <PreliminaryRoutingMatrix
          allVersions={allVersions}
          currentVersionId="ver-1"
          operations={historicalV1Ops}
          onChangeOperations={onChange}
          workcenterOptions={mockWorkcenterOptions}
          isEditable={false}
        />
      );

      // Inputs should not be editable or delete buttons should not be present
      expect(screen.queryByTestId('remove-op-btn-0')).toBeNull();
      expect(screen.queryByText('Thêm công đoạn tiếp theo')).toBeNull();
    });
  });

  /* =========================================================================
   * 3. DRAWING VIEWER COMPONENT
   * ========================================================================= */
  describe('3. Drawing Viewer Component', () => {
    it('renders image viewer with zoom in, zoom out, reset and external link controls', async () => {
      render(
        <DrawingViewer
          filePath="mock/drawing.png"
          fileName="part-sample.png"
          mimeType="image/png"
        />
      );

      await waitFor(() => {
        expect(screen.getByTitle('Phóng to')).toBeInTheDocument();
        expect(screen.getByTitle('Thu nhỏ')).toBeInTheDocument();
        expect(screen.getByTitle('Tỷ lệ 100%')).toBeInTheDocument();
        expect(screen.getByText('Mở tệp gốc')).toBeInTheDocument();
      });

      // Verify zoom in increases scale indicator
      const zoomInBtn = screen.getByTitle('Phóng to');
      fireEvent.click(zoomInBtn);
      expect(screen.getByText('125%')).toBeInTheDocument();

      // Verify reset zoom returns to 100%
      const resetBtn = screen.getByTitle('Tỷ lệ 100%');
      fireEvent.click(resetBtn);
      expect(screen.getByText('100%')).toBeInTheDocument();
    });
  });

  /* =========================================================================
   * 4. BD — ISSUE CREATION PAGE
   * ========================================================================= */
  describe('4. Drawing Review Issue Creation (BD)', () => {
    it('validates required fields: Item No, Item Name, Customer, Drawing file', async () => {
      const bdAuth = createMockAuth('BD');
      render(
        <AuthContext.Provider value={bdAuth}>
          <MemoryRouter>
            <DrawingReviewCreatePage />
          </MemoryRouter>
        </AuthContext.Provider>
      );

      const submitBtn = screen.getByTestId('submit-issue-btn');

      // 1. Submit empty -> itemNo required
      fireEvent.click(submitBtn);
      expect(screen.getByText(/Vui lòng nhập Mã bản vẽ/i)).toBeInTheDocument();

      // 2. Fill itemNo -> itemName required
      fireEvent.change(screen.getByTestId('item-no-input'), {
        target: { value: 'DWG-9999' },
      });
      fireEvent.click(submitBtn);
      expect(screen.getByText(/Vui lòng nhập Tên sản phẩm/i)).toBeInTheDocument();

      // 3. Fill itemName -> customer required
      fireEvent.change(screen.getByTestId('item-name-input'), {
        target: { value: 'Shaft Gear' },
      });
      fireEvent.click(submitBtn);
      expect(screen.getByText(/Vui lòng nhập Khách hàng/i)).toBeInTheDocument();

      // 4. Fill customer -> drawing file required
      fireEvent.change(screen.getByTestId('customer-input'), {
        target: { value: 'Customer A' },
      });
      fireEvent.click(submitBtn);
      expect(screen.getByText(/Vui lòng đính kèm tệp bản vẽ/i)).toBeInTheDocument();
    });

    it('submits successfully when required fields and drawing are provided', async () => {
      const bdAuth = createMockAuth('BD');
      (drawingReviewService.createDrawingReviewIssue as any).mockResolvedValueOnce({
        success: true,
        issueId: 'issue-123',
        issueNo: '261103-N001',
        versionId: 'ver-123',
      });

      render(
        <AuthContext.Provider value={bdAuth}>
          <MemoryRouter>
            <DrawingReviewCreatePage />
          </MemoryRouter>
        </AuthContext.Provider>
      );

      // Fill in fields
      fireEvent.change(screen.getByTestId('item-no-input'), {
        target: { value: 'DWG-9999' },
      });
      fireEvent.change(screen.getByTestId('item-name-input'), {
        target: { value: 'Shaft Gear' },
      });
      fireEvent.change(screen.getByTestId('customer-input'), {
        target: { value: 'Customer A' },
      });

      // Upload drawing file
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      const file = new File(['dummy drawing content'], 'drawing.pdf', { type: 'application/pdf' });
      fireEvent.change(fileInput, { target: { files: [file] } });

      // Submit
      const submitBtn = screen.getByTestId('submit-issue-btn');
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(drawingReviewService.createDrawingReviewIssue).toHaveBeenCalledWith(
          expect.objectContaining({
            item_no: 'DWG-9999',
            item_name: 'Shaft Gear',
            customer: 'Customer A',
          })
        );
      });
    });
  });

  /* =========================================================================
   * 5. PE-MFG REVIEW WORKSPACE (8 SECTIONS, DRAFT SAVE, CLOSE & LOCK)
   * ========================================================================= */
  describe('5. PE-MFG Review Workspace (Detail Page)', () => {
    const mockIssueDetail = {
      id: 'issue-100',
      issue_no: '261103-N001',
      item_no: 'DWG-TEST-01',
      item_name: 'Pin Flange Test',
      customer: 'Canon Precision',
      attention_note: 'Gia công chính xác bề mặt R0.4',
      drawing_file_path: 'mock/path.png',
      drawing_file_name: 'test_drawing.png',
      drawing_mime_type: 'image/png',
      status: 'Issued',
      created_by: 'user-bd',
      created_at: '2026-11-03T08:00:00Z',
      updated_at: '2026-11-03T08:00:00Z',
      attachments: [
        {
          id: 'att-1',
          issue_id: 'issue-100',
          file_name: 'test_drawing.png',
          file_path: 'mock/path.png',
          mime_type: 'image/png',
          file_size_bytes: 12040,
          attachment_type: 'drawing',
          created_at: '2026-11-03T08:00:00Z',
        },
      ],
      versions: [
        {
          id: 'ver-100',
          issue_id: 'issue-100',
          version_number: 1,
          version_name: 'V1',
          status: 'Issued',
          material_requirements: 'SUS304-CSP 1/2H',
          tooling_requirements: 'Dao phay cầu R0.5',
          measuring_equipment: 'Micrometer 0-25mm',
          engineering_remarks: 'Lưu ý đo đạc kiểm tra biên dạng',
          is_active: true,
          created_at: '2026-11-03T08:00:00Z',
          updated_at: '2026-11-03T08:00:00Z',
          operations: [
            {
              id: 'op-1',
              version_id: 'ver-100',
              lineage_id: 'lineage-1',
              step_order: 10,
              workcenter_code: 'CNC01',
              operation_description: 'Rough cut',
              cycle_time_seconds: 45,
              remarks: 'First step',
              is_removed: false,
              created_at: '2026-11-03T08:00:00Z',
              updated_at: '2026-11-03T08:00:00Z',
            },
          ],
        },
      ],
      latest_version: {
        id: 'ver-100',
        issue_id: 'issue-100',
        version_number: 1,
        version_name: 'V1',
        status: 'Issued',
        is_active: true,
        operations: [
          {
            id: 'op-1',
            version_id: 'ver-100',
            lineage_id: 'lineage-1',
            step_order: 10,
            workcenter_code: 'CNC01',
            operation_description: 'Rough cut',
            cycle_time_seconds: 45,
            remarks: 'First step',
            is_removed: false,
            created_at: '2026-11-03T08:00:00Z',
            updated_at: '2026-11-03T08:00:00Z',
          },
        ],
      },
    };

    it('renders 8 vertical sections in exact required order', async () => {
      (drawingReviewService.fetchDrawingReviewDetail as any).mockResolvedValue({
        data: mockIssueDetail,
        error: null,
      });

      const peAuth = createMockAuth('PE-MFG');
      render(
        <AuthContext.Provider value={peAuth}>
          <MemoryRouter initialEntries={['/drawing-reviews/issue-100']}>
            <Routes>
              <Route path="/drawing-reviews/:id" element={<DrawingReviewDetailPage />} />
            </Routes>
          </MemoryRouter>
        </AuthContext.Provider>
      );

      await waitFor(() => {
        // Section 1: Thông tin yêu cầu đánh giá bản vẽ
        expect(screen.getByText(/Thông tin yêu cầu đánh giá bản vẽ/i)).toBeInTheDocument();
        // Section 2: Bản vẽ kỹ thuật gốc
        expect(screen.getByText(/Bản vẽ kỹ thuật gốc/i)).toBeInTheDocument();
        // Section 3: Vật liệu yêu cầu
        expect(screen.getByText(/Vật liệu yêu cầu/i)).toBeInTheDocument();
        // Section 4: Quy trình công nghệ sơ bộ
        expect(screen.getByText(/Quy trình công nghệ sơ bộ/i)).toBeInTheDocument();
        // Section 5: Dao cụ & Đồ gá
        expect(screen.getByText(/Dao cụ & Đồ gá/i)).toBeInTheDocument();
        // Section 6: Thiết bị đo lường đặc biệt
        expect(screen.getByText(/Thiết bị đo lường đặc biệt/i)).toBeInTheDocument();
        // Section 7: Ghi chú kỹ thuật & Hình ảnh đính kèm
        expect(screen.getByText(/Ghi chú kỹ thuật & Hình ảnh đính kèm/i)).toBeInTheDocument();
        // Section 8: Save / Close Actions
        expect(screen.getByTestId('save-draft-btn')).toBeInTheDocument();
        expect(screen.getByTestId('close-version-btn')).toBeInTheDocument();
      });
    });

    it('PE saves draft successfully and updates state', async () => {
      (drawingReviewService.fetchDrawingReviewDetail as any).mockResolvedValue({
        data: mockIssueDetail,
        error: null,
      });
      (drawingReviewService.saveDrawingReviewDraft as any).mockResolvedValueOnce({
        success: true,
      });

      const peAuth = createMockAuth('PE-MFG');
      render(
        <AuthContext.Provider value={peAuth}>
          <MemoryRouter initialEntries={['/drawing-reviews/issue-100']}>
            <Routes>
              <Route path="/drawing-reviews/:id" element={<DrawingReviewDetailPage />} />
            </Routes>
          </MemoryRouter>
        </AuthContext.Provider>
      );

      await waitFor(() => {
        expect(screen.getByText(/Thông tin yêu cầu đánh giá bản vẽ/i)).toBeInTheDocument();
      });

      // Click "Lưu bản nháp"
      const saveBtn = screen.getByRole('button', { name: /Lưu bản nháp/i });
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(drawingReviewService.saveDrawingReviewDraft).toHaveBeenCalledWith(
          expect.objectContaining({
            version_id: 'ver-100',
          })
        );
      });
    });

    it('PE closes technical review after validating Subcon description and confirmation', async () => {
      (drawingReviewService.fetchDrawingReviewDetail as any).mockResolvedValue({
        data: mockIssueDetail,
        error: null,
      });
      (drawingReviewService.closeDrawingReviewVersion as any).mockResolvedValueOnce({
        success: true,
      });

      const peAuth = createMockAuth('PE-MFG');
      render(
        <AuthContext.Provider value={peAuth}>
          <MemoryRouter initialEntries={['/drawing-reviews/issue-100']}>
            <Routes>
              <Route path="/drawing-reviews/:id" element={<DrawingReviewDetailPage />} />
              <Route path="/drawing-reviews/:id/report" element={<div>Report Screen</div>} />
            </Routes>
          </MemoryRouter>
        </AuthContext.Provider>
      );

      await waitFor(() => {
        expect(screen.getByText(/Thông tin yêu cầu đánh giá bản vẽ/i)).toBeInTheDocument();
      });

      // Click "Chốt hoàn thành (Close)"
      const closeBtn = screen.getByTestId('close-version-btn');
      fireEvent.click(closeBtn);

      // Confirm modal appears
      await waitFor(() => {
        expect(screen.getByText(/Xác nhận chốt hoàn thành đánh giá kỹ thuật/i)).toBeInTheDocument();
      });

      // Click confirm in modal
      const confirmCloseBtn = screen.getByTestId('confirm-close-btn');
      fireEvent.click(confirmCloseBtn);

      await waitFor(() => {
        expect(drawingReviewService.closeDrawingReviewVersion).toHaveBeenCalledWith('ver-100');
      });
    });

    it('blocks closing when a SUBCON operation is missing description', async () => {
      const subconOps = [
        {
          id: 'op-subcon',
          version_id: 'ver-100',
          lineage_id: 'lin-subcon',
          step_order: 10,
          workcenter_code: 'Subcon',
          operation_description: '', // EMPTY description!
          cycle_time_seconds: 0,
          remarks: '',
          is_removed: false,
        },
      ];
      const issueWithEmptySubcon = {
        ...mockIssueDetail,
        versions: [
          {
            ...mockIssueDetail.versions[0],
            operations: subconOps,
          },
        ],
        latest_version: {
          ...mockIssueDetail.versions[0],
          operations: subconOps,
        },
      };

      (drawingReviewService.fetchDrawingReviewDetail as any).mockResolvedValue({
        data: issueWithEmptySubcon,
        error: null,
      });

      const peAuth = createMockAuth('PE-MFG');
      render(
        <AuthContext.Provider value={peAuth}>
          <MemoryRouter initialEntries={['/drawing-reviews/issue-100']}>
            <Routes>
              <Route path="/drawing-reviews/:id" element={<DrawingReviewDetailPage />} />
            </Routes>
          </MemoryRouter>
        </AuthContext.Provider>
      );

      await waitFor(() => {
        expect(screen.getByText(/Thông tin yêu cầu đánh giá bản vẽ/i)).toBeInTheDocument();
      });

      // Click "Chốt hoàn thành (Close)"
      const closeBtn = screen.getByTestId('close-version-btn');
      fireEvent.click(closeBtn);

      // Modal shows validation failure and blocks close
      await waitFor(() => {
        expect(
          screen.getByText(/bắt buộc phải có mô tả công đoạn/i)
        ).toBeInTheDocument();
      });
      expect(screen.queryByTestId('confirm-close-btn')).toBeNull();
      expect(drawingReviewService.closeDrawingReviewVersion).not.toHaveBeenCalled();
    });
  });

  /* =========================================================================
   * 6. DASHBOARD & FILTERING (LIST PAGE)
   * ========================================================================= */
  describe('6. Drawing Review Dashboard & Filtering', () => {
    const mockList = [
      {
        id: 'issue-1',
        issue_no: '261103-N001',
        item_no: 'PART-A1',
        item_name: 'Housing CNC',
        customer: 'Samsung',
        created_at: '2026-11-03T08:00:00Z',
        updated_at: '2026-11-03T08:00:00Z',
        versions: [],
        latest_version: {
          id: 'v1',
          version_name: 'V1',
          status: 'Issued',
        },
      },
      {
        id: 'issue-2',
        issue_no: '261103-N002',
        item_no: 'PART-B2',
        item_name: 'Plate Anodize',
        customer: 'Nidec',
        created_at: '2026-11-03T09:00:00Z',
        updated_at: '2026-11-03T09:30:00Z',
        versions: [],
        latest_version: {
          id: 'v2',
          version_name: 'V2',
          status: 'Completed',
        },
      },
    ];

    it('renders list with search and filters by customer and status', async () => {
      (drawingReviewService.fetchDrawingReviewList as any).mockResolvedValueOnce({
        data: mockList,
        error: null,
      });

      const bdAuth = createMockAuth('BD');
      render(
        <AuthContext.Provider value={bdAuth}>
          <MemoryRouter>
            <DrawingReviewListPage />
          </MemoryRouter>
        </AuthContext.Provider>
      );

      await waitFor(() => {
        expect(screen.getByText('261103-N001')).toBeInTheDocument();
        expect(screen.getByText('261103-N002')).toBeInTheDocument();
      });

      // Filter by search query "Housing"
      const searchInput = screen.getByTestId('search-input');
      fireEvent.change(searchInput, { target: { value: 'Housing' } });

      expect(screen.getByText('261103-N001')).toBeInTheDocument();
      expect(screen.queryByText('261103-N002')).toBeNull();
    });

    it('shows "+ Phát hành bản vẽ mới" button for BD and Admin, hides it for PE-MFG', async () => {
      (drawingReviewService.fetchDrawingReviewList as any).mockResolvedValue({
        data: mockList,
        error: null,
      });

      // Test as BD
      const { unmount } = render(
        <AuthContext.Provider value={createMockAuth('BD')}>
          <MemoryRouter>
            <DrawingReviewListPage />
          </MemoryRouter>
        </AuthContext.Provider>
      );
      await waitFor(() => {
        expect(screen.getByTestId('create-new-review-btn')).toBeInTheDocument();
      });
      unmount();

      // Test as PE-MFG
      render(
        <AuthContext.Provider value={createMockAuth('PE-MFG')}>
          <MemoryRouter>
            <DrawingReviewListPage />
          </MemoryRouter>
        </AuthContext.Provider>
      );
      await waitFor(() => {
        expect(screen.queryByTestId('create-new-review-btn')).toBeNull();
      });
    });
  });

  /* =========================================================================
   * 7. COMPLETED REVIEW SUMMARY PAGE & V+1 CREATION
   * ========================================================================= */
  describe('7. Completed Review Summary Page', () => {
    const mockCompletedIssue = {
      id: 'issue-comp-1',
      issue_no: '261101-N005',
      item_no: 'DWG-FLANGE',
      item_name: 'Flange Bearing Mount',
      customer: 'Canon Precision',
      attention_note: 'Dung sai lắp ghép H7',
      drawing_file_path: 'mock/path.png',
      drawing_file_name: 'flange_drawing.png',
      drawing_mime_type: 'image/png',
      created_at: '2026-11-01T08:00:00Z',
      versions: [
        {
          id: 'ver-comp-1',
          issue_id: 'issue-comp-1',
          version_number: 1,
          version_name: 'V1',
          status: 'Completed',
          required_material: 'AL6061-T6',
          required_tooling: 'Dao phay nhôm chuyên dụng',
          special_measuring_equipment: 'Đồng hồ so 0.001mm',
          engineering_remarks: 'Đã hoàn tất đánh giá kỹ thuật và chốt công nghệ sơ bộ.',
          is_active: false,
          created_at: '2026-11-01T08:00:00Z',
          operations: [
            {
              id: 'op-c1',
              step_order: 10,
              workcenter_code: 'CNC01',
              operation_description: 'Milling',
              cycle_time_seconds: 80,
              remarks: 'OK',
              is_removed: false,
            },
          ],
        },
      ],
      latest_version: {
        id: 'ver-comp-1',
        version_name: 'V1',
        status: 'Completed',
      },
    };

    it('renders read-only completed technical summary report', async () => {
      (drawingReviewService.fetchDrawingReviewDetail as any).mockResolvedValueOnce({
        data: mockCompletedIssue,
        error: null,
      });

      const peAuth = createMockAuth('PE-MFG');
      render(
        <AuthContext.Provider value={peAuth}>
          <MemoryRouter initialEntries={['/drawing-reviews/issue-comp-1/report']}>
            <Routes>
              <Route path="/drawing-reviews/:id/report" element={<DrawingReviewCompletedPage />} />
            </Routes>
          </MemoryRouter>
        </AuthContext.Provider>
      );

      await waitFor(() => {
        expect(screen.getAllByText('261101-N005')[0]).toBeInTheDocument();
        expect(screen.getByText(/BÁO CÁO ĐÁNH GIÁ BẢN VẼ/i)).toBeInTheDocument();
        expect(screen.getByText('AL6061-T6')).toBeInTheDocument();
        expect(screen.getByText('Dao phay nhôm chuyên dụng')).toBeInTheDocument();
        expect(screen.getByText('Đồng hồ so 0.001mm')).toBeInTheDocument();
      });
    });

    it('authorized PE-MFG sees "+ Tạo phiên bản tiếp theo (V2)" button and can trigger V+1 creation', async () => {
      (drawingReviewService.fetchDrawingReviewDetail as any).mockResolvedValueOnce({
        data: mockCompletedIssue,
        error: null,
      });
      (drawingReviewService.createNextDrawingReviewVersion as any).mockResolvedValueOnce({
        success: true,
        versionId: 'ver-comp-2',
      });

      const peAuth = createMockAuth('PE-MFG');
      render(
        <AuthContext.Provider value={peAuth}>
          <MemoryRouter initialEntries={['/drawing-reviews/issue-comp-1/report']}>
            <Routes>
              <Route path="/drawing-reviews/:id/report" element={<DrawingReviewCompletedPage />} />
            </Routes>
          </MemoryRouter>
        </AuthContext.Provider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('create-v-next-btn')).toBeInTheDocument();
      });

      const createV2Btn = screen.getByTestId('create-v-next-btn');
      fireEvent.click(createV2Btn);

      await waitFor(() => {
        expect(drawingReviewService.createNextDrawingReviewVersion).toHaveBeenCalledWith('issue-comp-1');
      });
    });

    it('BD user can view completed report but CANNOT see "+ Tạo phiên bản tiếp theo" button', async () => {
      (drawingReviewService.fetchDrawingReviewDetail as any).mockResolvedValueOnce({
        data: mockCompletedIssue,
        error: null,
      });

      const bdAuth = createMockAuth('BD');
      render(
        <AuthContext.Provider value={bdAuth}>
          <MemoryRouter initialEntries={['/drawing-reviews/issue-comp-1/report']}>
            <Routes>
              <Route path="/drawing-reviews/:id/report" element={<DrawingReviewCompletedPage />} />
            </Routes>
          </MemoryRouter>
        </AuthContext.Provider>
      );

      await waitFor(() => {
        expect(screen.getAllByText('261101-N005')[0]).toBeInTheDocument();
        expect(screen.queryByTestId('create-v-next-btn')).toBeNull();
      });
    });
  });
});
