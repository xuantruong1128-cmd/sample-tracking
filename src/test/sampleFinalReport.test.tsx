import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { permissions } from '../features/auth/authUtils';
import { SampleFinalReportSection } from '../components/reports/SampleFinalReportSection';
import { ReportPreviewModal } from '../components/reports/ReportPreviewModal';
import type { SampleFinalReport } from '../types/finalReport';

// Mock dependencies
vi.mock('../services/finalReportService', () => ({
  fetchFinalReport: vi.fn(),
  triggerReportGeneration: vi.fn(),
  getReportDownloadUrl: vi.fn(),
}));

describe('Sample Final Report Module Tests (Phase F)', () => {
  describe('RBAC Download Permissions', () => {
    it('canDownloadFinalReport: allows Admin and PE-MFG Leader only (Other roles are View only)', () => {
      // Allowed: Admin has FULL permissions
      expect(permissions.canDownloadFinalReport('Admin')).toBe(true);
      expect(permissions.canDownloadFinalReport('Admin', true)).toBe(true);
      expect(permissions.canDownloadFinalReport('Admin', false)).toBe(true);

      // Allowed: PE-MFG Leader
      expect(permissions.canDownloadFinalReport('PE-MFG', true)).toBe(true);

      // Disallowed (View Only): PE-MFG Non-Leader, Planning, QA, Drawing, Anonymous
      expect(permissions.canDownloadFinalReport('PE-MFG', false)).toBe(false);
      expect(permissions.canDownloadFinalReport('PE-MFG')).toBe(false);
      expect(permissions.canDownloadFinalReport('Planning', true)).toBe(false);
      expect(permissions.canDownloadFinalReport('Planning', false)).toBe(false);
      expect(permissions.canDownloadFinalReport('QA', true)).toBe(false);
      expect(permissions.canDownloadFinalReport('QA', false)).toBe(false);
      expect(permissions.canDownloadFinalReport('Drawing')).toBe(false);
      expect(permissions.canDownloadFinalReport(null)).toBe(false);
    });
  });

  describe('ReportPreviewModal (Restricted Preview for All Roles)', () => {
    const mockReport: SampleFinalReport = {
      id: 'rep-001',
      job_id: 'job-001',
      evaluation_result: 'PASS',
      overall_assessment: 'Đạt toàn bộ dung sai kích thước và yêu cầu bề mặt.',
      improvements_required: null,
      unresolved_issues: null,
      closed_by: 'user-001',
      closed_by_name: 'Nguyễn Văn Leader',
      closed_at: '2026-10-15T12:00:00Z',
      close_warnings: [],
      snapshot_data: {
        job_no: 'JOB-2026-TEST',
        part_no: 'PART-TEST-99',
        part_name: 'Sample Flange',
        customer: 'Customer Corp',
        order_qty: 100,
        delivery_date: '2026-10-20',
        material: 'SUS304',
        treatment: 'Anodized',
        drawing_version: 'v2',
        operations: [
          {
            step_order: 10,
            operation_name: 'Tiện CNC',
            machine_no: 'CNC-01',
            status: 'CLOSED',
            production_run: {
              machine_id: 'CNC-01',
              cycle_time_seconds: 45,
              ok_qty: 98,
              ng_qty: 2,
              kiv_qty: 0,
            },
            ng_details: [
              {
                defect_code: 'NG-DIM',
                defect_name: 'Lệch đường kính ngoài',
                defect_qty: 2,
                cause: 'Mòn dao tiện tinh',
                remark: 'Đã thay dao',
              },
            ],
          },
          {
            step_order: 20,
            operation_name: 'Phay CNC',
            machine_no: 'MC-02',
            status: 'CLOSED',
            production_run: {
              machine_id: 'MC-02',
              cycle_time_seconds: 60,
              ok_qty: 97,
              ng_qty: 1,
              kiv_qty: 0,
            },
            ng_details: [],
          },
        ],
        engineering_documents: [
          {
            category: 'Drawing',
            file_name: 'PART-TEST-99_RevB.pdf',
            version: 'v2',
            uploader_name: 'Drawing Engineer',
          },
        ],
      },
      generation_status: 'Ready',
      pdf_file_name: 'PART-TEST-99 - JOB-2026-TEST.pdf',
      pdf_file_path: 'job-001/final_report/PART-TEST-99 - JOB-2026-TEST.pdf',
      pdf_file_size: 45000,
      pdf_sha256: 'abc123sha256',
      zip_file_name: 'PART-TEST-99 - JOB-2026-TEST.zip',
      zip_file_path: 'job-001/final_report/PART-TEST-99 - JOB-2026-TEST.zip',
      zip_file_size: 150000,
      zip_sha256: 'def456sha256',
      generation_attempts: 1,
      created_at: '2026-10-15T12:00:00Z',
      updated_at: '2026-10-15T12:01:00Z',
    };

    it('renders restricted preview modal with full details without summing OK/NG across operations', () => {
      const handleClose = vi.fn();
      render(<ReportPreviewModal isOpen={true} report={mockReport} onClose={handleClose} />);

      // Title & Job identification
      expect(screen.getByText(/Xem Trước Báo Cáo Tổng Kết Mẫu:/i)).toBeInTheDocument();
      expect(screen.getAllByText('JOB-2026-TEST').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('PART-TEST-99').length).toBeGreaterThanOrEqual(1);

      // Access policy notice
      expect(screen.getByText(/Chế độ xem thu gọn \(Restricted Preview\)/i)).toBeInTheDocument();

      // Evaluation
      expect(screen.getByText('PASS')).toBeInTheDocument();
      expect(screen.getByText('Đạt toàn bộ dung sai kích thước và yêu cầu bề mặt.')).toBeInTheDocument();

      // Operations breakdown table - separate per step
      expect(screen.getAllByText(/OP10/).length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Tiện CNC')).toBeInTheDocument();
      expect(screen.getByText('98')).toBeInTheDocument(); // OP10 OK

      expect(screen.getAllByText(/OP20/).length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Phay CNC')).toBeInTheDocument();
      expect(screen.getByText('97')).toBeInTheDocument(); // OP20 OK

      // Defect details
      expect(screen.getByText(/Lệch đường kính ngoài/i)).toBeInTheDocument();
      expect(screen.getByText(/Mòn dao tiện tinh/i)).toBeInTheDocument();

      // Document index
      expect(screen.getByText('PART-TEST-99_RevB.pdf')).toBeInTheDocument();

      // Close modal
      const closeButton = screen.getByText('Đóng cửa sổ');
      fireEvent.click(closeButton);
      expect(handleClose).toHaveBeenCalledTimes(1);
    });

    it('renders CONDITIONAL evaluation and required improvements', () => {
      const conditionalReport: SampleFinalReport = {
        ...mockReport,
        evaluation_result: 'CONDITIONAL',
        improvements_required: 'Cần làm đồ gá kẹp chuyên dùng để tăng độ đồng tâm.',
        unresolved_issues: 'Nhiệt độ phôi cao sau khi cắt gọt nhanh.',
      };

      render(<ReportPreviewModal isOpen={true} report={conditionalReport} onClose={vi.fn()} />);

      expect(screen.getByText('CONDITIONAL')).toBeInTheDocument();
      expect(screen.getByText('Cần làm đồ gá kẹp chuyên dùng để tăng độ đồng tâm.')).toBeInTheDocument();
      expect(screen.getByText('Nhiệt độ phôi cao sau khi cắt gọt nhanh.')).toBeInTheDocument();
    });
  });

  describe('SampleFinalReportSection Component Rendering', () => {
    it('renders informative fallback when Job is CLOSE but has no report record in database', async () => {
      const { fetchFinalReport } = await import('../services/finalReportService');
      vi.mocked(fetchFinalReport).mockResolvedValueOnce({ data: null, error: null });

      render(
        <SampleFinalReportSection
          jobId="closed-job-without-report"
          jobStatus="CLOSE"
          userRole="Admin"
        />
      );

      // Loading or resolved fallback
      expect(await screen.findByText(/Lệnh sản xuất này chưa có dữ liệu Báo cáo nghiệm thu mẫu/i)).toBeInTheDocument();
      expect(screen.getByText(/JOB này đã được đóng trước thời điểm hệ thống số hóa Báo cáo nghiệm thu mẫu được triển khai/i)).toBeInTheDocument();
    });

    it('returns null when Job is ACTIVE and has no report', () => {
      const { container } = render(
        <SampleFinalReportSection
          jobId="active-job"
          jobStatus="ACTIVE"
          userRole="Admin"
        />
      );

      expect(container.firstChild).toBeNull();
    });
  });
});
