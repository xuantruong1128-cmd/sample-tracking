import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { SampleFinalReportSection } from '../components/reports/SampleFinalReportSection';
import * as finalReportService from '../services/finalReportService';
import { AuthContext } from '../features/auth/AuthContext';

vi.mock('../services/finalReportService', () => ({
  fetchFinalReport: vi.fn(),
  fetchFinalReportStatus: vi.fn(),
  triggerReportGeneration: vi.fn(),
  getReportDownloadUrl: vi.fn(),
}));

const mockAuthContext = {
  user: {
    id: 'user-pe',
    phone: '0987654321',
    profile: {
      id: 'user-pe',
      phone: '0987654321',
      full_name: 'PE Leader',
      role: 'PE-MFG',
      is_active: true,
      created_at: new Date().toISOString(),
    },
  },
  profile: {
    id: 'user-pe',
    phone: '0987654321',
    full_name: 'PE Leader',
    role: 'PE-MFG',
    is_active: true,
    created_at: new Date().toISOString(),
  },
  loading: false,
  error: null,
  login: vi.fn(),
  logout: vi.fn(),
  refreshProfile: vi.fn(),
};

describe('SampleFinalReportSection Polling Egress Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('1. Stops polling when report status becomes Ready and fetches full report once', async () => {
    // Initial fetch returns Pending
    (finalReportService.fetchFinalReport as any).mockResolvedValue({
      data: {
        id: 'rep-01',
        job_id: 'job-100',
        generation_status: 'Pending',
        pdf_file_path: null,
        zip_file_path: null,
      },
      error: null,
    });

    // First status poll returns Generating, second returns Ready
    (finalReportService.fetchFinalReportStatus as any)
      .mockResolvedValueOnce({ status: 'Generating', error: null })
      .mockResolvedValueOnce({ status: 'Ready', error: null });

    render(
      <AuthContext.Provider value={mockAuthContext as any}>
        <SampleFinalReportSection jobId="job-100" jobStatus="CLOSE" />
      </AuthContext.Provider>
    );

    // Initial load
    await waitFor(() => {
      expect(finalReportService.fetchFinalReport).toHaveBeenCalledTimes(1);
    });

    // Advance 3.5s -> 1st poll (Generating)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3500);
    });
    expect(finalReportService.fetchFinalReportStatus).toHaveBeenCalledTimes(1);

    // After 2nd poll becomes Ready, mock fetchFinalReport returning Ready
    (finalReportService.fetchFinalReport as any).mockResolvedValue({
      data: {
        id: 'rep-01',
        job_id: 'job-100',
        generation_status: 'Ready',
        pdf_file_path: 'job-100/report.pdf',
        zip_file_path: 'job-100/report.zip',
      },
      error: null,
    });

    // Advance another 3.5s -> 2nd poll (Ready)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3500);
    });
    expect(finalReportService.fetchFinalReportStatus).toHaveBeenCalledTimes(2);

    // Verify full report was fetched upon completion
    expect(finalReportService.fetchFinalReport).toHaveBeenCalledTimes(2);

    // Advance more time (e.g. 15s) -> No further polls should happen
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });

    // fetchFinalReportStatus should still be exactly 2
    expect(finalReportService.fetchFinalReportStatus).toHaveBeenCalledTimes(2);
  });

  it('2. Stops polling after reaching MAX_POLLS (20 attempts = 70s) timeout and shows status check button', async () => {
    (finalReportService.fetchFinalReport as any).mockResolvedValue({
      data: {
        id: 'rep-01',
        job_id: 'job-100',
        generation_status: 'Generating',
        pdf_file_path: null,
        zip_file_path: null,
      },
      error: null,
    });

    // Always returns Generating (stalled background worker simulation)
    (finalReportService.fetchFinalReportStatus as any).mockResolvedValue({
      status: 'Generating',
      error: null,
    });

    render(
      <AuthContext.Provider value={mockAuthContext as any}>
        <SampleFinalReportSection jobId="job-100" jobStatus="CLOSE" />
      </AuthContext.Provider>
    );

    await waitFor(() => {
      expect(finalReportService.fetchFinalReport).toHaveBeenCalledTimes(1);
    });

    // Advance 75 seconds (more than 20 * 3.5s = 70s)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(75000);
    });

    // Max polls should be capped at 21, not infinite
    const pollCalls = (finalReportService.fetchFinalReportStatus as any).mock.calls.length;
    expect(pollCalls).toBeLessThanOrEqual(21);

    // Advance another 30 seconds
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30000);
    });

    // No additional calls after timeout!
    expect((finalReportService.fetchFinalReportStatus as any).mock.calls.length).toBe(pollCalls);

    // Verify the "Kiểm tra trạng thái" button is rendered and functional
    const checkBtn = screen.getByTestId('poll-check-status-btn');
    expect(checkBtn).toBeDefined();

    // Now mock backend having completed in background
    (finalReportService.fetchFinalReport as any).mockResolvedValue({
      data: {
        id: 'rep-01',
        job_id: 'job-100',
        generation_status: 'Ready',
        pdf_file_path: 'job-100/report.pdf',
        zip_file_path: 'job-100/report.zip',
      },
      error: null,
    });

    await act(async () => {
      checkBtn.click();
    });

    // Successfully fetches the completed report without recreating or retriggering
    expect(finalReportService.fetchFinalReport).toHaveBeenCalledTimes(2);
  });
});
