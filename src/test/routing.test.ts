import { describe, it, expect } from 'vitest';
import { computeOperationColor, computeLatestQAEvaluation, getRoutingStats } from '../features/routing/routingUtils';
import type { JobOperation } from '../types/database.types';

describe('Routing Status Color Computation (Section 4.B Business Rules)', () => {
  it('should compute GREEN color strictly when operation is COMPLETED by authorized PE', () => {
    const result = computeOperationColor({ status: 'COMPLETED' });
    expect(result.color).toBe('GREEN');
    expect(result.label).toContain('Hoàn tất (PE)');
    expect(result.bgClass).toContain('bg-emerald-600');
  });

  it('should compute YELLOW color when in production (IN_PROGRESS)', () => {
    const result = computeOperationColor({ status: 'IN_PROGRESS' });
    expect(result.color).toBe('YELLOW');
    expect(result.label).toContain('Đang sản xuất (PE)');
    expect(result.bgClass).toContain('bg-amber');
  });

  it('should compute YELLOW color when on HOLD', () => {
    const result = computeOperationColor({ status: 'HOLD' });
    expect(result.color).toBe('YELLOW');
    expect(result.label).toContain('Tạm dừng (HOLD)');
    expect(result.bgClass).toContain('bg-amber');
  });

  it('should compute BLACK color when operation is NOT_STARTED', () => {
    const result = computeOperationColor({ status: 'NOT_STARTED' });
    expect(result.color).toBe('BLACK');
    expect(result.label).toContain('Chưa bắt đầu');
    expect(result.bgClass).toContain('bg-slate-800');
  });

  it('should correctly calculate routing statistics across multiple dynamic steps', () => {
    const mockOps: JobOperation[] = [
      {
        id: '1',
        job_id: 'j1',
        step_order: 1,
        operation_name: 'CNC',
        status: 'COMPLETED',
        created_at: '',
        updated_at: '',
      },
      {
        id: '2',
        job_id: 'j1',
        step_order: 2,
        operation_name: 'CG',
        status: 'WAITING_QA',
        created_at: '',
        updated_at: '',
      },
      {
        id: '3',
        job_id: 'j1',
        step_order: 3,
        operation_name: 'Plating',
        status: 'NOT_STARTED',
        created_at: '',
        updated_at: '',
      },
      {
        id: '4',
        job_id: 'j1',
        step_order: 4,
        operation_name: 'VMI',
        status: 'NOT_STARTED',
        created_at: '',
        updated_at: '',
      },
    ];

    const stats = getRoutingStats(mockOps);
    expect(stats.total).toBe(4);
    expect(stats.completed).toBe(1);
    expect(stats.inProgress).toBe(1);
    expect(stats.notStarted).toBe(2);
    expect(stats.percentage).toBe(25);
  });

  it('should compute independent QA evaluations (NOT_REPORTED, OK, NG, KIV)', () => {
    expect(computeLatestQAEvaluation([]).result).toBe('NOT_REPORTED');
    expect(computeLatestQAEvaluation([{ result: 'OK' }]).result).toBe('OK');
    expect(computeLatestQAEvaluation([{ result: 'NG' }]).result).toBe('NG');
    expect(computeLatestQAEvaluation([{ result: 'KIV' }]).result).toBe('KIV');
  });
});
