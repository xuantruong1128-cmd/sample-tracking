import { describe, it, expect } from 'vitest';
import { permissions } from '../features/auth/authUtils';

describe('Role-Based Permissions (Section 3 & 4 Requirements)', () => {

  it('canCreateJob: should allow Planning and Admin, but disallow PE-MFG and QA', () => {
    expect(permissions.canCreateJob('Planning')).toBe(true);
    expect(permissions.canCreateJob('Admin')).toBe(true);
    expect(permissions.canCreateJob('PE-MFG')).toBe(false);
    expect(permissions.canCreateJob('QA')).toBe(false);
    expect(permissions.canCreateJob(null)).toBe(false);
  });

  it('canEditPlanning: should allow Planning and Admin', () => {
    expect(permissions.canEditPlanning('Planning')).toBe(true);
    expect(permissions.canEditPlanning('Admin')).toBe(true);
    expect(permissions.canEditPlanning('PE-MFG')).toBe(false);
    expect(permissions.canEditPlanning('QA')).toBe(false);
  });

  it('canEnterProduction: should allow PE-MFG and Admin, but disallow Planning and QA', () => {
    expect(permissions.canEnterProduction('PE-MFG')).toBe(true);
    expect(permissions.canEnterProduction('Admin')).toBe(true);
    expect(permissions.canEnterProduction('Planning')).toBe(false);
    expect(permissions.canEnterProduction('QA')).toBe(false);
  });

  it('canInspectQA: should allow QA and Admin, but disallow Planning and PE-MFG', () => {
    expect(permissions.canInspectQA('QA')).toBe(true);
    expect(permissions.canInspectQA('Admin')).toBe(true);
    expect(permissions.canInspectQA('Planning')).toBe(false);
    expect(permissions.canInspectQA('PE-MFG')).toBe(false);
  });

  it('canCloseJob: should allow PE-MFG Leader and Admin, but disallow Planning, QA, and normal PE-MFG', () => {
    expect(permissions.canCloseJob('Admin')).toBe(true);
    expect(permissions.canCloseJob('PE-MFG', true)).toBe(true);
    expect(permissions.canCloseJob('PE-MFG', false)).toBe(false);
    expect(permissions.canCloseJob('PE-MFG')).toBe(false);
    expect(permissions.canCloseJob('Planning', true)).toBe(false);
    expect(permissions.canCloseJob('Planning')).toBe(false);
    expect(permissions.canCloseJob('QA', true)).toBe(false);
    expect(permissions.canCloseJob('QA')).toBe(false);
  });

  it('isAdmin: should strictly allow only Admin role', () => {
    expect(permissions.isAdmin('Admin')).toBe(true);
    expect(permissions.isAdmin('Planning')).toBe(false);
    expect(permissions.isAdmin('PE-MFG')).toBe(false);
    expect(permissions.isAdmin('QA')).toBe(false);
  });

  it('canDeleteJob: allows Admin, Planning Leader, and Planning Owner; blocks other roles', () => {
    const job = { id: 'job-1', created_by: 'owner-uuid', status: 'ACTIVE', operations: [] };

    const adminProfile = { id: 'admin-uuid', role: 'Admin', is_active: true } as any;
    const planningLeaderProfile = { id: 'leader-uuid', role: 'Planning', is_department_leader: true, is_active: true } as any;
    const planningOwnerProfile = { id: 'owner-uuid', role: 'Planning', is_department_leader: false, is_active: true } as any;
    const planningOtherProfile = { id: 'other-uuid', role: 'Planning', is_department_leader: false, is_active: true } as any;
    const peMfgLeaderProfile = { id: 'pe-uuid', role: 'PE-MFG', is_department_leader: true, is_active: true } as any;
    const qaLeaderProfile = { id: 'qa-uuid', role: 'QA', is_department_leader: true, is_active: true } as any;

    expect(permissions.canDeleteJob(job, adminProfile)).toBe(true);
    expect(permissions.canDeleteJob(job, planningLeaderProfile)).toBe(true);
    expect(permissions.canDeleteJob(job, planningOwnerProfile)).toBe(true);

    expect(permissions.canDeleteJob(job, planningOtherProfile)).toBe(false);
    expect(permissions.canDeleteJob(job, peMfgLeaderProfile)).toBe(false);
    expect(permissions.canDeleteJob(job, qaLeaderProfile)).toBe(false);
  });

  it('isJobLocked: evaluates true when job is CLOSE/PURGED or has any CLOSED operation', () => {
    expect(permissions.isJobLocked({ status: 'ACTIVE', operations: [{ status: 'NOT_STARTED' }, { status: 'IN_PROGRESS' }] })).toBe(false);
    expect(permissions.isJobLocked({ status: 'CLOSE', operations: [] })).toBe(true);
    expect(permissions.isJobLocked({ status: 'PURGED', operations: [] })).toBe(true);
    expect(permissions.isJobLocked({ status: 'ACTIVE', operations: [{ status: 'NOT_STARTED' }, { status: 'CLOSED' }] })).toBe(true);
  });
});
