import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../features/auth/AuthContext';
import { LoginPage } from '../features/auth/LoginPage';
import { RoutingProgressBar } from '../features/routing/RoutingProgressBar';
import { JobCard } from '../features/jobs/JobCard';
import type { Job } from '../types/database.types';

describe('UI Shell Components Behavior', () => {
  it('LoginPage renders logo, title, phone and password inputs in Vietnamese', () => {
    render(
      <MemoryRouter>
        <AuthProvider>
          <LoginPage />
        </AuthProvider>
      </MemoryRouter>
    );

    expect(screen.getByText('SAMPLE TRACKING')).toBeInTheDocument();
    expect(screen.getByText('Số điện thoại')).toBeInTheDocument();
    expect(screen.getByText('Mật khẩu')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /đăng nhập/i })).toBeInTheDocument();
  });

  it('RoutingProgressBar renders dynamic operation sequence and legend correctly', () => {
    const mockOps = [
      {
        id: 'op1',
        job_id: 'j1',
        step_order: 1,
        operation_name: 'CNC',
        status: 'COMPLETED' as const,
        created_at: '',
        updated_at: '',
      },
      {
        id: 'op2',
        job_id: 'j1',
        step_order: 2,
        operation_name: 'CG',
        status: 'WAITING_QA' as const,
        created_at: '',
        updated_at: '',
      },
      {
        id: 'op3',
        job_id: 'j1',
        step_order: 3,
        operation_name: 'VMI',
        status: 'NOT_STARTED' as const,
        created_at: '',
        updated_at: '',
      },
    ];

    render(
      <RoutingProgressBar
        operations={mockOps}
        selectedOperationId="op1"
        compact={false}
      />
    );

    expect(screen.getByText('CNC')).toBeInTheDocument();
    expect(screen.getByText('CG')).toBeInTheDocument();
    expect(screen.getByText('VMI')).toBeInTheDocument();
    expect(screen.getAllByText(/Hoàn tất \(PE\)/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Chưa bắt đầu/i).length).toBeGreaterThanOrEqual(1);
  });

  it('JobCard renders compact UI-02 fields: Job ticket, part number, customer, status and link', () => {
    const mockJob: Job = {
      id: 'job-123',
      job_no: 'JOB-2026-999',
      part_no: 'PART-XYZ',
      part_name: 'Shaft Test',
      customer: 'Canon',
      order_qty: 75,
      material: 'SUS303',
      planned_start_date: '2026-10-01',
      planned_finish_date: '2026-10-10',
      status: 'ACTIVE',
      created_at: '',
      updated_at: '',
      operations: [],
    };

    render(
      <MemoryRouter>
        <JobCard job={mockJob} />
      </MemoryRouter>
    );

    expect(screen.getByText('JOB-2026-999')).toBeInTheDocument();
    expect(screen.getByText('PART-XYZ')).toBeInTheDocument();
    expect(screen.getByTitle('Canon')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Chưa thiết lập Routing')).toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveAttribute('href', '/jobs/job-123');
  });
});
