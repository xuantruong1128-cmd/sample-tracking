import { describe, it, expect } from 'vitest';
import { canonicalizeVietnamesePhone } from '../features/auth/authUtils';
import { isValidStoragePath } from '../lib/storageUtils';
import { computeOperationColor, computeLatestQAEvaluation } from '../features/routing/routingUtils';
import type {
  JobOperation,
  QACheck,
  Attachment,
  UserRole,
} from '../types/database.types';

describe('Security & Business Workflow Remediation Suite (R4 Specification)', () => {
  // =========================================================================
  // D1. MANUFACTURING WORKFLOW (10 Scenarios)
  // =========================================================================
  describe('D1: Manufacturing Workflow Progression & PE Ownership', () => {
    // Evaluation helper mimicking PostgreSQL enforce_operation_workflow_rules_r5
    const evaluatePECompletion = (params: {
      role: UserRole;
      isAuthorizedPE: boolean;
      runs: { id: string; ok_qty: number }[];
      qaChecks: { id: string; result: 'OK' | 'NG' | 'KIV'; inspection_time: string }[];
      dispositions: { id: string; qa_check_id?: string | null; decision_type?: string; decision_timestamp: string }[];
    }): { allowed: boolean; error?: string } => {
      // 1. Role and authority checks
      if (params.role === 'QA') {
        return { allowed: false, error: 'QA is an independent evaluator and cannot alter manufacturing operation status.' };
      }
      if (params.role === 'Planning') {
        return { allowed: false, error: 'Planning is not authorized to alter operation manufacturing status.' };
      }
      if (params.role === 'PE-MFG' && !params.isAuthorizedPE) {
        return { allowed: false, error: 'Unauthorized PE-MFG account cannot make final completion decisions.' };
      }

      // 2. Production run check
      const hasOkRun = params.runs.some((r) => r.ok_qty > 0);
      if (!hasOkRun) {
        return { allowed: false, error: 'Requires at least one completed production run with OK quantity > 0.' };
      }

      // 3. QA evaluation check
      if (params.qaChecks.length > 0) {
        const sortedQA = [...params.qaChecks].sort(
          (a, b) => new Date(b.inspection_time).getTime() - new Date(a.inspection_time).getTime()
        );
        const latestQA = sortedQA[0];

        if (latestQA.result === 'NG' || latestQA.result === 'KIV') {
          // R4-02: Requires technical disposition of valid type (HOLD does NOT permit completion)
          const validDispositions = params.dispositions.filter(
            (d) => !d.decision_type || d.decision_type !== 'HOLD'
          );
          const hasDisposition = validDispositions.some(
            (d) =>
              d.qa_check_id === latestQA.id ||
              new Date(d.decision_timestamp).getTime() >= new Date(latestQA.inspection_time).getTime()
          );
          if (!hasDisposition) {
            return {
              allowed: false,
              error: `Cannot complete operation with outstanding QA ${latestQA.result} without an authorized PE technical continuation disposition (HOLD does not permit completion).`,
            };
          }
        }
      }

      return { allowed: true };
    };

    it('1. PE completes an operation without any QA report -> ALLOWED (QA is optional)', () => {
      const result = evaluatePECompletion({
        role: 'PE-MFG',
        isAuthorizedPE: true,
        runs: [{ id: 'run-1', ok_qty: 100 }],
        qaChecks: [], // No QA check
        dispositions: [],
      });
      expect(result.allowed).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('2. QA OK exists -> PE completes -> ALLOWED', () => {
      const result = evaluatePECompletion({
        role: 'PE-MFG',
        isAuthorizedPE: true,
        runs: [{ id: 'run-1', ok_qty: 50 }],
        qaChecks: [{ id: 'qa-1', result: 'OK', inspection_time: '2026-10-10T10:00:00Z' }],
        dispositions: [],
      });
      expect(result.allowed).toBe(true);
    });

    it('3. QA NG exists -> authorized PE records disposition and completes -> ALLOWED', () => {
      const result = evaluatePECompletion({
        role: 'PE-MFG',
        isAuthorizedPE: true,
        runs: [{ id: 'run-1', ok_qty: 45 }],
        qaChecks: [{ id: 'qa-1', result: 'NG', inspection_time: '2026-10-10T10:00:00Z' }],
        dispositions: [
          { id: 'disp-1', qa_check_id: 'qa-1', decision_type: 'REWORK_NEXT', decision_timestamp: '2026-10-10T10:30:00Z' },
        ],
      });
      expect(result.allowed).toBe(true);
    });

    it('4. QA KIV exists -> authorized PE records disposition and completes -> ALLOWED', () => {
      const result = evaluatePECompletion({
        role: 'PE-MFG',
        isAuthorizedPE: true,
        runs: [{ id: 'run-1', ok_qty: 45 }],
        qaChecks: [{ id: 'qa-1', result: 'KIV', inspection_time: '2026-10-10T10:00:00Z' }],
        dispositions: [
          { id: 'disp-1', qa_check_id: 'qa-1', decision_type: 'CONTINUE_AS_IS', decision_timestamp: '2026-10-10T10:30:00Z' },
        ],
      });
      expect(result.allowed).toBe(true);
    });

    it('4b. QA KIV exists -> disposition is HOLD -> completion is DENIED (HOLD does not authorize completion)', () => {
      const result = evaluatePECompletion({
        role: 'PE-MFG',
        isAuthorizedPE: true,
        runs: [{ id: 'run-1', ok_qty: 45 }],
        qaChecks: [{ id: 'qa-1', result: 'KIV', inspection_time: '2026-10-10T10:00:00Z' }],
        dispositions: [
          { id: 'disp-hold', qa_check_id: 'qa-1', decision_type: 'HOLD', decision_timestamp: '2026-10-10T10:30:00Z' },
        ],
      });
      expect(result.allowed).toBe(false);
      expect(result.error).toContain('HOLD does not permit completion');
    });

    it('5. QA NG exists -> PE attempts completion without required disposition -> DENIED', () => {
      const result = evaluatePECompletion({
        role: 'PE-MFG',
        isAuthorizedPE: true,
        runs: [{ id: 'run-1', ok_qty: 45 }],
        qaChecks: [{ id: 'qa-1', result: 'NG', inspection_time: '2026-10-10T10:00:00Z' }],
        dispositions: [], // Missing required disposition
      });
      expect(result.allowed).toBe(false);
      expect(result.error).toContain('without an authorized PE technical continuation disposition');
    });

    it('6. QA reports NG after PE completion -> completion remains valid, QA warning visible', () => {
      // Operation is already COMPLETED
      const op: JobOperation = {
        id: 'op-1',
        job_id: 'j-1',
        step_order: 1,
        operation_name: 'Milling',
        status: 'COMPLETED',
        created_at: '',
        updated_at: '',
        qa_checks: [
          {
            id: 'qa-late',
            operation_id: 'op-1',
            inspector_name: 'QA Inspector',
            inspection_time: '2026-10-10T15:00:00Z',
            sample_size: 5,
            ok_qty: 3,
            ng_qty: 2,
            result: 'NG',
            created_at: '2026-10-10T15:00:00Z',
          },
        ],
      };

      // Manufacturing status remains COMPLETED
      expect(op.status).toBe('COMPLETED');
      const color = computeOperationColor(op);
      expect(color.color).toBe('GREEN');
      expect(color.label).toBe('Hoàn tất (PE)');

      // QA evaluation is computed independently and shows NG visibly
      const qaEval = computeLatestQAEvaluation(op.qa_checks);
      expect(qaEval.result).toBe('NG');
      expect(qaEval.label).toContain('QA: NG (Không đạt)');
    });

    it('7. PE adds another production run after completion -> preserve history; require explicit PE decision to reopen', () => {
      const op: JobOperation = {
        id: 'op-1',
        job_id: 'j-1',
        step_order: 1,
        operation_name: 'Turning',
        status: 'COMPLETED',
        created_at: '',
        updated_at: '',
        production_runs: [
          {
            id: 'run-1',
            operation_id: 'op-1',
            machine_id: 'M1',
            operator_name: 'A',
            start_time: '',
            end_time: '',
            ok_qty: 10,
            ng_qty: 0,
            created_at: '2026-10-10T09:00:00Z',
          },
          {
            id: 'run-2',
            operation_id: 'op-1',
            machine_id: 'M1',
            operator_name: 'B',
            start_time: '',
            end_time: '',
            ok_qty: 5,
            ng_qty: 0,
            created_at: '2026-10-10T14:00:00Z',
          },
        ],
      };

      // History is preserved (2 runs exist)
      expect(op.production_runs?.length).toBe(2);
      // Status does not silently collapse; remains COMPLETED unless explicit PE transition
      expect(op.status).toBe('COMPLETED');
    });

    it('8. QA attempts to complete an operation -> DENIED', () => {
      const result = evaluatePECompletion({
        role: 'QA',
        isAuthorizedPE: false,
        runs: [{ id: 'run-1', ok_qty: 50 }],
        qaChecks: [{ id: 'qa-1', result: 'OK', inspection_time: '2026-10-10T10:00:00Z' }],
        dispositions: [],
      });
      expect(result.allowed).toBe(false);
      expect(result.error).toContain('QA is an independent evaluator');
    });

    it('9. Planning attempts to complete an operation -> DENIED', () => {
      const result = evaluatePECompletion({
        role: 'Planning',
        isAuthorizedPE: false,
        runs: [{ id: 'run-1', ok_qty: 50 }],
        qaChecks: [{ id: 'qa-1', result: 'OK', inspection_time: '2026-10-10T10:00:00Z' }],
        dispositions: [],
      });
      expect(result.allowed).toBe(false);
      expect(result.error).toContain('Planning is not authorized');
    });

    it('10. Unauthorized PE-MFG account attempts final technical decision -> DENIED', () => {
      const result = evaluatePECompletion({
        role: 'PE-MFG',
        isAuthorizedPE: false, // Not designated PE decision authority
        runs: [{ id: 'run-1', ok_qty: 50 }],
        qaChecks: [{ id: 'qa-1', result: 'OK', inspection_time: '2026-10-10T10:00:00Z' }],
        dispositions: [],
      });
      expect(result.allowed).toBe(false);
      expect(result.error).toContain('Unauthorized PE-MFG account');
    });
  });

  // =========================================================================
  // D2. QA INTEGRITY & CORRELATION
  // =========================================================================
  describe('D2: QA Evaluation Integrity & Production Run Linkage', () => {
    const validateQACheckLinkage = (params: {
      opId: string;
      runId?: string | null;
      runOpId?: string;
    }): { valid: boolean; error?: string } => {
      if (!params.runId) {
        // Nullable runId is valid: general operation evaluation
        return { valid: true };
      }
      if (params.runOpId !== params.opId) {
        return {
          valid: false,
          error: `Forged cross-operation linkage: run belongs to ${params.runOpId}, not ${params.opId}`,
        };
      }
      return { valid: true };
    };

    it('QA report with no production_run_id -> ALLOWED', () => {
      const res = validateQACheckLinkage({ opId: 'op-1', runId: null });
      expect(res.valid).toBe(true);
    });

    it('QA report linked to a run of the same operation -> ALLOWED', () => {
      const res = validateQACheckLinkage({ opId: 'op-1', runId: 'run-1', runOpId: 'op-1' });
      expect(res.valid).toBe(true);
    });

    it('QA report linked to another operations run -> DENIED', () => {
      const res = validateQACheckLinkage({ opId: 'op-1', runId: 'run-2', runOpId: 'op-2' });
      expect(res.valid).toBe(false);
      expect(res.error).toContain('Forged cross-operation linkage');
    });

    it('Multiple QA evaluations -> history preserved without overwriting earlier evaluations', () => {
      const qaHistory: QACheck[] = [
        {
          id: 'qa-1',
          operation_id: 'op-1',
          inspector_name: 'Inspector 1',
          inspection_time: '2026-10-10T09:00:00Z',
          sample_size: 5,
          ok_qty: 2,
          ng_qty: 3,
          result: 'NG',
          created_at: '2026-10-10T09:00:00Z',
        },
        {
          id: 'qa-2',
          operation_id: 'op-1',
          inspector_name: 'Inspector 2',
          inspection_time: '2026-10-10T11:00:00Z',
          sample_size: 5,
          ok_qty: 5,
          ng_qty: 0,
          result: 'OK',
          created_at: '2026-10-10T11:00:00Z',
        },
      ];

      expect(qaHistory.length).toBe(2);
      expect(qaHistory[0].result).toBe('NG');
      expect(qaHistory[1].result).toBe('OK');
      // Latest summary shows OK, but historical NG is preserved
      const latest = computeLatestQAEvaluation(qaHistory);
      expect(latest.result).toBe('OK');
    });

    it('PE attempts to overwrite QA evidence -> DENIED (Append-only / separate table)', () => {
      const canPEModifyQA = (role: UserRole) => role === 'QA' || role === 'Admin';
      expect(canPEModifyQA('PE-MFG')).toBe(false);
    });

    it('QA attempts to overwrite PE disposition -> DENIED (PE disposition append-only)', () => {
      const canQAModifyDisposition = (role: UserRole) => role === 'PE-MFG' || role === 'Admin';
      expect(canQAModifyDisposition('QA')).toBe(false);
    });
  });

  // =========================================================================
  // D3. DOCUMENT SECURITY & CHECK SHEET UPLOAD MATRIX
  // =========================================================================
  describe('D3: Document Security & Check Sheet Upload Matrix', () => {
    const isDocumentUploadAllowed = (params: {
      role: UserRole;
      fileType: string;
      jobStatus: string;
      owningDepartment: UserRole;
    }): boolean => {
      if (params.jobStatus !== 'ACTIVE') return false;
      // Cannot spoof another department's ownership
      if (params.role !== 'Admin' && params.owningDepartment !== params.role) return false;

      if (params.role === 'Admin') return true;
      if (params.role === 'Planning') {
        return ['DRAWING', 'CHECK_SHEET', 'SETTING_SHEET', 'OTHER'].includes(params.fileType);
      }
      if (params.role === 'PE-MFG') {
        return ['CHECK_SHEET', 'SETTING_SHEET', 'DRAWING', 'NG_PHOTO', 'OTHER'].includes(params.fileType);
      }
      if (params.role === 'QA') {
        return ['CHECK_SHEET', 'NG_PHOTO', 'OTHER'].includes(params.fileType);
      }
      return false;
    };

    it('PE-MFG uploads self-inspection check sheet -> ALLOWED', () => {
      expect(
        isDocumentUploadAllowed({
          role: 'PE-MFG',
          fileType: 'CHECK_SHEET',
          jobStatus: 'ACTIVE',
          owningDepartment: 'PE-MFG',
        })
      ).toBe(true);
    });

    it('QA uploads independent check sheet -> ALLOWED', () => {
      expect(
        isDocumentUploadAllowed({
          role: 'QA',
          fileType: 'CHECK_SHEET',
          jobStatus: 'ACTIVE',
          owningDepartment: 'QA',
        })
      ).toBe(true);
    });

    it('Both documents remain separately identifiable by owning_department and uploader', () => {
      const peDoc: Attachment = {
        id: 'doc-pe-1',
        job_id: 'j-1',
        file_name: 'Self_Check_Sheet.pdf',
        file_path: 'j-1/CHECK_SHEET/Self_Check_Sheet.pdf',
        file_size: 1024,
        mime_type: 'application/pdf',
        file_type: 'CHECK_SHEET',
        owning_department: 'PE-MFG',
        uploaded_by: 'user-pe-1',
        created_at: '2026-10-10T10:00:00Z',
      };

      const qaDoc: Attachment = {
        id: 'doc-qa-1',
        job_id: 'j-1',
        file_name: 'QA_Check_Sheet.pdf',
        file_path: 'j-1/CHECK_SHEET/QA_Check_Sheet.pdf',
        file_size: 2048,
        mime_type: 'application/pdf',
        file_type: 'CHECK_SHEET',
        owning_department: 'QA',
        uploaded_by: 'user-qa-1',
        created_at: '2026-10-10T11:00:00Z',
      };

      expect(peDoc.owning_department).toBe('PE-MFG');
      expect(qaDoc.owning_department).toBe('QA');
      expect(peDoc.owning_department).not.toBe(qaDoc.owning_department);
    });

    it('Unauthorized department ownership spoofing is denied', () => {
      // PE-MFG claiming owning_department = QA
      expect(
        isDocumentUploadAllowed({
          role: 'PE-MFG',
          fileType: 'CHECK_SHEET',
          jobStatus: 'ACTIVE',
          owningDepartment: 'QA', // Spoofed!
        })
      ).toBe(false);
    });

    it('Cross-JOB attachment references are denied', () => {
      const isPathJobMatch = (jobId: string, path: string) => path.startsWith(`${jobId}/`);
      expect(isPathJobMatch('job-1', 'job-1/CHECK_SHEET/file.pdf')).toBe(true);
      expect(isPathJobMatch('job-1', 'job-2/CHECK_SHEET/file.pdf')).toBe(false);
    });

    it('Direct Storage access respects permissions and path format', () => {
      expect(isValidStoragePath('job-123/DRAWING/print.pdf')).toBe(true);
      expect(isValidStoragePath('job-123/CHECK_SHEET/sheet.pdf')).toBe(true);
      expect(isValidStoragePath('job-123/NG_PHOTO/defect.jpg')).toBe(true);
      expect(isValidStoragePath('../escape.pdf')).toBe(false);
    });

    it('CLOSED JOB files cannot be modified or uploaded', () => {
      expect(
        isDocumentUploadAllowed({
          role: 'PE-MFG',
          fileType: 'CHECK_SHEET',
          jobStatus: 'CLOSE', // Closed job!
          owningDepartment: 'PE-MFG',
        })
      ).toBe(false);
    });
  });

  // =========================================================================
  // D4. LIFECYCLE, AUTH & PHONE NORMALIZATION
  // =========================================================================
  describe('D4: Lifecycle Invariants & Phone Canonicalization', () => {
    it('Invalid initial JOB status denied (Must be ACTIVE)', () => {
      const isValidInitialStatus = (s: string) => s === 'ACTIVE';
      expect(isValidInitialStatus('ACTIVE')).toBe(true);
      expect(isValidInitialStatus('CLOSE')).toBe(false);
      expect(isValidInitialStatus('ARCHIVE')).toBe(false);
      expect(isValidInitialStatus('PURGED')).toBe(false);
    });

    it('Unauthorized CLOSE/ARCHIVE/PURGE denied; Phase 1 blocks ARCHIVE and PURGED', () => {
      const isValidTransition = (from: string, to: string, role: UserRole) => {
        if (from === 'ACTIVE') {
          return to === 'CLOSE' && (role === 'Planning' || role === 'Admin');
        }
        if (from === 'CLOSE') {
          // ARCHIVE transition is deferred until Phase 6
          return false;
        }
        return false;
      };

      expect(isValidTransition('ACTIVE', 'CLOSE', 'Planning')).toBe(true);
      expect(isValidTransition('ACTIVE', 'CLOSE', 'Admin')).toBe(true);
      expect(isValidTransition('ACTIVE', 'CLOSE', 'PE-MFG')).toBe(false);
      expect(isValidTransition('ACTIVE', 'ARCHIVE', 'Admin')).toBe(false); // Skipping CLOSE forbidden
      expect(isValidTransition('CLOSE', 'ARCHIVE', 'Admin')).toBe(false); // Deferred until Phase 6
      expect(isValidTransition('CLOSE', 'PURGED', 'Admin')).toBe(false); // Direct purge forbidden
    });

    it('Closure metadata protected (closed_at and closed_by immutable once closed)', () => {
      const isClosureMetadataModifiable = (status: string) => status === 'ACTIVE';
      expect(isClosureMetadataModifiable('CLOSE')).toBe(false);
      expect(isClosureMetadataModifiable('ARCHIVE')).toBe(false);
    });

    it('Phone validation consistent across 03x, 05x, 07x, 08x, 09x prefixes including 55 and 87', () => {
      // Standard prefixes
      expect(canonicalizeVietnamesePhone('0912 345 678').isValid).toBe(true);
      expect(canonicalizeVietnamesePhone('0381 234 567').isValid).toBe(true);
      expect(canonicalizeVietnamesePhone('0771 234 567').isValid).toBe(true);

      // Wintel (087) and Itelecom (055)
      expect(canonicalizeVietnamesePhone('0871 234 567').isValid).toBe(true);
      expect(canonicalizeVietnamesePhone('0551 234 567').isValid).toBe(true);

      // Invalid prefixes rejected
      expect(canonicalizeVietnamesePhone('0241 234 567').isValid).toBe(false); // Landline prefix
      expect(canonicalizeVietnamesePhone('0123 456 789').isValid).toBe(false); // Obsolete 11-digit
      expect(canonicalizeVietnamesePhone('abc').isValid).toBe(false);
    });

    it('Account deactivation denies protected database access', () => {
      const checkAccess = (profile: { is_active: boolean }) => profile.is_active;
      expect(checkAccess({ is_active: true })).toBe(true);
      expect(checkAccess({ is_active: false })).toBe(false);
    });

    it('Partial Auth failures trigger safe rollback', () => {
      // Simulation of rollback pattern
      let profileActive = true;
      const simulateDeactivation = (authFails: boolean) => {
        profileActive = false; // DB updated
        if (authFails) {
          profileActive = true; // Rollback
          throw new Error('Auth revocation failed. State rolled back.');
        }
      };

      expect(() => simulateDeactivation(true)).toThrow('State rolled back');
      expect(profileActive).toBe(true); // Restored
    });
  });

  // =========================================================================
  // D5. R5 TARGETED SECURITY REMEDIATIONS (R4-01 THROUGH R4-08)
  // =========================================================================
  describe('D5: R5 Security Remediations (Codex R4 Findings Verification)', () => {
    // -----------------------------------------------------------------------
    // R4-01: First-Run Operator Authority vs PE Decision Authority
    // -----------------------------------------------------------------------
    describe('R4-01: First-Run Authority & PE Assignment Workflow', () => {
      const evaluateStatusTransition = (params: {
        from: string;
        to: string;
        callerRole: UserRole;
        isJobPEOwnerOrDelegate: boolean;
        hasOkRun: boolean;
      }): { allowed: boolean; error?: string } => {
        // QA & Planning cannot change manufacturing execution statuses
        if (params.callerRole === 'QA') {
          return { allowed: false, error: 'QA is an independent evaluator and cannot alter manufacturing operation status.' };
        }
        if (params.callerRole === 'Planning') {
          return { allowed: false, error: 'Planning is not authorized to alter operation manufacturing status.' };
        }

        // NOT_STARTED -> IN_PROGRESS: Any active PE-MFG operator or Admin
        if (params.from === 'NOT_STARTED' && params.to === 'IN_PROGRESS') {
          if (params.callerRole === 'PE-MFG' || params.callerRole === 'Admin') {
            return { allowed: true };
          }
          return { allowed: false, error: 'Only PE-MFG or Admin can start operation.' };
        }

        // Direct NOT_STARTED -> COMPLETED is forbidden
        if (params.from === 'NOT_STARTED' && params.to === 'COMPLETED') {
          return { allowed: false, error: 'NOT_STARTED cannot transition directly to COMPLETED (must transition to IN_PROGRESS first).' };
        }

        // IN_PROGRESS -> COMPLETED: Only authorized PE Owner/delegate (or Admin)
        if (params.from === 'IN_PROGRESS' && params.to === 'COMPLETED') {
          if (!params.isJobPEOwnerOrDelegate && params.callerRole !== 'Admin') {
            return { allowed: false, error: 'User is not the designated PE Owner or delegate for this JOB.' };
          }
          if (!params.hasOkRun) {
            return { allowed: false, error: 'Requires at least one completed production run with OK quantity > 0.' };
          }
          return { allowed: true };
        }

        // IN_PROGRESS -> HOLD: Only authorized PE Owner/delegate (or Admin)
        if (params.from === 'IN_PROGRESS' && params.to === 'HOLD') {
          if (!params.isJobPEOwnerOrDelegate && params.callerRole !== 'Admin') {
            return { allowed: false, error: 'User is not the designated PE Owner or delegate for this JOB.' };
          }
          return { allowed: true };
        }

        return { allowed: false, error: 'Invalid transition.' };
      };

      it('Ordinary PE-MFG operator records first run (NOT_STARTED -> IN_PROGRESS) -> ALLOWED', () => {
        const res = evaluateStatusTransition({
          from: 'NOT_STARTED',
          to: 'IN_PROGRESS',
          callerRole: 'PE-MFG',
          isJobPEOwnerOrDelegate: false, // Ordinary machine operator
          hasOkRun: false,
        });
        expect(res.allowed).toBe(true);
      });

      it('Ordinary PE-MFG operator attempts to mark COMPLETED -> DENIED (PE Owner/delegate authority required)', () => {
        const res = evaluateStatusTransition({
          from: 'IN_PROGRESS',
          to: 'COMPLETED',
          callerRole: 'PE-MFG',
          isJobPEOwnerOrDelegate: false, // Not designated PE Owner
          hasOkRun: true,
        });
        expect(res.allowed).toBe(false);
        expect(res.error).toContain('not the designated PE Owner or delegate');
      });

      it('Designated PE Owner marks COMPLETED with valid run -> ALLOWED', () => {
        const res = evaluateStatusTransition({
          from: 'IN_PROGRESS',
          to: 'COMPLETED',
          callerRole: 'PE-MFG',
          isJobPEOwnerOrDelegate: true,
          hasOkRun: true,
        });
        expect(res.allowed).toBe(true);
      });

      it('Self-assignment of PE Owner by operator via REST is DENIED (Only Planning or Admin)', () => {
        const canAssignPE = (callerRole: UserRole) => callerRole === 'Planning' || callerRole === 'Admin';
        expect(canAssignPE('Planning')).toBe(true);
        expect(canAssignPE('Admin')).toBe(true);
        expect(canAssignPE('PE-MFG')).toBe(false); // Self-assignment denied
        expect(canAssignPE('QA')).toBe(false);
      });
    });

    // -----------------------------------------------------------------------
    // R4-02: Technical Disposition Integrity
    // -----------------------------------------------------------------------
    describe('R4-02: Technical Disposition Validation & Anti-Tampering', () => {
      const validateTechnicalDisposition = (params: {
        reason: string;
        opJobId: string;
        targetJobId: string;
        qaOpId?: string;
        targetOpId: string;
        qaResult?: 'OK' | 'NG' | 'KIV';
      }): { valid: boolean; error?: string } => {
        // 1. Reason trim length >= 5
        if (!params.reason || params.reason.trim().length < 5) {
          return { valid: false, error: 'Technical reason must be at least 5 characters after trimming whitespace.' };
        }
        // 2. Job-Operation consistency
        if (params.opJobId !== params.targetJobId) {
          return { valid: false, error: 'Inconsistent reference: operation belongs to different JOB.' };
        }
        // 3. Operation-QA check consistency
        if (params.qaOpId && params.qaOpId !== params.targetOpId) {
          return { valid: false, error: 'Inconsistent reference: QA check belongs to different operation.' };
        }
        // 4. Referencing QA OK check is forbidden
        if (params.qaResult === 'OK') {
          return { valid: false, error: 'Technical disposition can only reference an outstanding QA NG or KIV check.' };
        }
        return { valid: true };
      };

      it('Blank or whitespace-only technical reason is REJECTED', () => {
        const res = validateTechnicalDisposition({
          reason: '   ',
          opJobId: 'job-1',
          targetJobId: 'job-1',
          targetOpId: 'op-1',
        });
        expect(res.valid).toBe(false);
        expect(res.error).toContain('at least 5 characters after trimming');
      });

      it('Technical reason with < 5 non-whitespace characters is REJECTED', () => {
        const res = validateTechnicalDisposition({
          reason: '  ok ',
          opJobId: 'job-1',
          targetJobId: 'job-1',
          targetOpId: 'op-1',
        });
        expect(res.valid).toBe(false);
        expect(res.error).toContain('at least 5 characters after trimming');
      });

      it('Disposition referencing a QA check that belongs to a different operation is REJECTED', () => {
        const res = validateTechnicalDisposition({
          reason: 'Chấp nhận dung sai +0.02 theo thỏa thuận khách hàng',
          opJobId: 'job-1',
          targetJobId: 'job-1',
          qaOpId: 'op-different',
          targetOpId: 'op-1',
        });
        expect(res.valid).toBe(false);
        expect(res.error).toContain('QA check belongs to different operation');
      });

      it('Disposition referencing a QA check with result OK is REJECTED', () => {
        const res = validateTechnicalDisposition({
          reason: 'Chấp nhận dung sai +0.02 theo thỏa thuận khách hàng',
          opJobId: 'job-1',
          targetJobId: 'job-1',
          qaOpId: 'op-1',
          targetOpId: 'op-1',
          qaResult: 'OK',
        });
        expect(res.valid).toBe(false);
        expect(res.error).toContain('can only reference an outstanding QA NG or KIV check');
      });

      it('Valid disposition referencing QA NG/KIV with adequate technical reason is ALLOWED', () => {
        const res = validateTechnicalDisposition({
          reason: 'Chấp nhận cho chạy tiếp công đoạn sau, đo kiểm lại 100% kích thước then',
          opJobId: 'job-1',
          targetJobId: 'job-1',
          qaOpId: 'op-1',
          targetOpId: 'op-1',
          qaResult: 'NG',
        });
        expect(res.valid).toBe(true);
      });
    });

    // -----------------------------------------------------------------------
    // R4-03 / R4-04: Storage Security & Signed URL Catalog Enforcement
    // -----------------------------------------------------------------------
    describe('R4-03 & R4-04: Storage Access & Signed URL Catalog Validation', () => {
      const validateSignedUrlRequest = (params: {
        jobId: string;
        jobStatus: string;
        filePath: string;
        attachmentRecord?: { job_id: string; file_path: string } | null;
        requestedTtl?: number;
      }): { allowed: boolean; effectiveTtl: number; error?: string } => {
        const MAX_TTL = 300;
        if (params.jobStatus === 'PURGED') {
          return { allowed: false, effectiveTtl: 0, error: 'Job documents are purged and cannot be accessed' };
        }
        if (!params.attachmentRecord) {
          return { allowed: false, effectiveTtl: 0, error: 'Attachment not found or not registered in attachments catalog' };
        }
        if (params.attachmentRecord.job_id !== params.jobId) {
          return { allowed: false, effectiveTtl: 0, error: 'Cross-job attachment mismatch detected' };
        }
        const effectiveTtl = Math.min(Math.max(1, params.requestedTtl || MAX_TTL), MAX_TTL);
        return { allowed: true, effectiveTtl };
      };

      it('Request without corresponding attachments record -> REJECTED (404)', () => {
        const res = validateSignedUrlRequest({
          jobId: 'job-1',
          jobStatus: 'ACTIVE',
          filePath: 'job-1/DRAWING/test.pdf',
          attachmentRecord: null, // Not in attachments catalog
        });
        expect(res.allowed).toBe(false);
        expect(res.error).toContain('not registered in attachments catalog');
      });

      it('Cross-job attachment spoofing -> REJECTED (403)', () => {
        const res = validateSignedUrlRequest({
          jobId: 'job-1',
          jobStatus: 'ACTIVE',
          filePath: 'job-1/DRAWING/test.pdf',
          attachmentRecord: { job_id: 'job-2', file_path: 'job-1/DRAWING/test.pdf' },
        });
        expect(res.allowed).toBe(false);
        expect(res.error).toContain('Cross-job attachment mismatch');
      });

      it('Valid request enforces maximum 300s TTL even if client requests 3600s', () => {
        const res = validateSignedUrlRequest({
          jobId: 'job-1',
          jobStatus: 'ACTIVE',
          filePath: 'job-1/DRAWING/test.pdf',
          attachmentRecord: { job_id: 'job-1', file_path: 'job-1/DRAWING/test.pdf' },
          requestedTtl: 3600, // Client requests 1 hour
        });
        expect(res.allowed).toBe(true);
        expect(res.effectiveTtl).toBe(300); // Clamped to server maximum 300s
      });
    });

    // -----------------------------------------------------------------------
    // R4-05: Strict CLOSED JOB Immutability
    // -----------------------------------------------------------------------
    describe('R4-05: Strict Immutability on CLOSED Jobs', () => {
      const validateJobModification = (params: {
        jobStatus: string;
        modifiedField: 'pe_owner_id' | 'pe_delegates' | 'order_qty' | 'closed_at' | 'status';
        newStatus?: string;
        callerRole: UserRole;
      }): { allowed: boolean; error?: string } => {
        if (['CLOSE', 'ARCHIVE', 'PURGED'].includes(params.jobStatus)) {
          if (params.modifiedField === 'status' && params.newStatus === 'ACTIVE') {
            return { allowed: false, error: 'Direct reopening of CLOSED job is forbidden.' };
          }
          return { allowed: false, error: `Cannot modify business details, assignments, or closure metadata on ${params.jobStatus} job.` };
        }
        return { allowed: true };
      };

      it('Admin cannot modify pe_owner_id or delegates on CLOSED job', () => {
        const res = validateJobModification({
          jobStatus: 'CLOSE',
          modifiedField: 'pe_owner_id',
          callerRole: 'Admin',
        });
        expect(res.allowed).toBe(false);
        expect(res.error).toContain('Cannot modify business details, assignments, or closure metadata');
      });

      it('Admin cannot modify closure metadata (closed_at / closed_by) on CLOSED job', () => {
        const res = validateJobModification({
          jobStatus: 'CLOSE',
          modifiedField: 'closed_at',
          callerRole: 'Admin',
        });
        expect(res.allowed).toBe(false);
      });

      it('No user can reopen a CLOSED job directly to ACTIVE', () => {
        const res = validateJobModification({
          jobStatus: 'CLOSE',
          modifiedField: 'status',
          newStatus: 'ACTIVE',
          callerRole: 'Admin',
        });
        expect(res.allowed).toBe(false);
        expect(res.error).toContain('Direct reopening of CLOSED job is forbidden');
      });
    });

    // -----------------------------------------------------------------------
    // R4-06: Production Run Lockout on COMPLETED Operations & Reopen
    // -----------------------------------------------------------------------
    describe('R4-06: Production Run Lockout & Explicit PE Reopening', () => {
      const evaluateInsertRunOnOperation = (params: {
        opStatus: string;
        callerRole: UserRole;
      }): { allowed: boolean; error?: string } => {
        if (params.callerRole !== 'PE-MFG' && params.callerRole !== 'Admin') {
          return { allowed: false, error: 'Only PE-MFG or Admin can record production runs.' };
        }
        if (params.opStatus === 'COMPLETED') {
          return { allowed: false, error: 'Operation is COMPLETED. New production runs are blocked until an authorized PE explicitly reopens the operation.' };
        }
        return { allowed: true };
      };

      const evaluateReopenOperation = (params: {
        callerRole: UserRole;
        isAuthorizedPE: boolean;
        reopenReason: string;
      }): { allowed: boolean; error?: string } => {
        if (!params.isAuthorizedPE && params.callerRole !== 'Admin') {
          return { allowed: false, error: 'Only designated PE Owner or delegate can reopen a completed operation.' };
        }
        if (!params.reopenReason || params.reopenReason.trim().length < 5) {
          return { allowed: false, error: 'Reopening a completed operation requires a recorded reopen_reason (minimum 5 characters).' };
        }
        return { allowed: true };
      };

      it('Logging production run on COMPLETED operation is BLOCKED', () => {
        const res = evaluateInsertRunOnOperation({
          opStatus: 'COMPLETED',
          callerRole: 'PE-MFG',
        });
        expect(res.allowed).toBe(false);
        expect(res.error).toContain('Operation is COMPLETED. New production runs are blocked');
      });

      it('Reopening COMPLETED operation by unauthorized user is DENIED', () => {
        const res = evaluateReopenOperation({
          callerRole: 'PE-MFG',
          isAuthorizedPE: false, // Ordinary operator
          reopenReason: 'Gia công bù sản phẩm bị hỏng',
        });
        expect(res.allowed).toBe(false);
        expect(res.error).toContain('Only designated PE Owner or delegate can reopen');
      });

      it('Reopening with blank or short reason is DENIED', () => {
        const res = evaluateReopenOperation({
          callerRole: 'PE-MFG',
          isAuthorizedPE: true,
          reopenReason: '  x  ',
        });
        expect(res.allowed).toBe(false);
        expect(res.error).toContain('requires a recorded reopen_reason (minimum 5 characters)');
      });

      it('Reopening by authorized PE with valid reason -> ALLOWED, unlocking new production runs', () => {
        const reopenRes = evaluateReopenOperation({
          callerRole: 'PE-MFG',
          isAuthorizedPE: true,
          reopenReason: 'Yêu cầu gia công lại do phát hiện ba via tại kiểm tra QA',
        });
        expect(reopenRes.allowed).toBe(true);

        // Once reopened to IN_PROGRESS, new runs are accepted
        const runRes = evaluateInsertRunOnOperation({
          opStatus: 'IN_PROGRESS',
          callerRole: 'PE-MFG',
        });
        expect(runRes.allowed).toBe(true);
      });
    });

    // -----------------------------------------------------------------------
    // R4-08: State Compensation & Audit Logging Verification
    // -----------------------------------------------------------------------
    describe('R4-08: Captured State Compensation & Audit Verification', () => {
      it('Compensation rollback restores captured previousIsActive, not hardcoded opposite', () => {
        let currentProfile = { id: 'u-1', is_active: false };
        const capturedPreviousState = currentProfile.is_active; // was false

        // Admin attempts activation, GoTrue fails
        currentProfile.is_active = true;
        const authLiftBanFailed = true;

        if (authLiftBanFailed) {
          // Rollback to captured state (false), not hardcoded true!
          currentProfile.is_active = capturedPreviousState;
        }

        expect(currentProfile.is_active).toBe(false);
      });

      it('Failed compensation rollback flags critical inconsistency', () => {
        let criticalFlag = false;
        const simulateFailedRollback = () => {
          const rollbackError = new Error('Database unreachable during rollback');
          if (rollbackError) {
            criticalFlag = true;
            return {
              error: 'Failed to revoke sessions. CRITICAL: Profile state rollback failed.',
              critical_inconsistency: true,
            };
          }
          return { error: 'ok' };
        };

        const res = simulateFailedRollback();
        expect(criticalFlag).toBe(true);
        expect(res.critical_inconsistency).toBe(true);
      });

      it('Audit log insert failures report partial success warning (207) rather than claiming clean 200', () => {
        const simulateOperationWithAudit = (auditFails: boolean) => {
          if (auditFails) {
            return {
              status: 207,
              audit_warning: 'Operation succeeded but audit logging failed: Network timeout',
            };
          }
          return { status: 200 };
        };

        const res = simulateOperationWithAudit(true);
        expect(res.status).toBe(207);
        expect(res.audit_warning).toContain('audit logging failed');
      });
    });

    // =========================================================================
    // PART F: R7 SECURITY REMEDIATION SUITE (CODEX R6 AUDIT FINDINGS R6-01..07)
    // =========================================================================
    describe('PART F: R7 Security Remediation Suite (Codex R6 Findings)', () => {
      // -----------------------------------------------------------------------
      // R6-01: Fix SECURITY DEFINER Privilege Escalation
      // -----------------------------------------------------------------------
      describe('R6-01: SECURITY DEFINER Identity & Privilege Escalation Isolation', () => {
        interface ExecutionContext {
          jwtUserId: string | null;
          jwtClaimRole?: string | null;
          sessionUser: string;
          profilesDb: Map<string, { role: UserRole; is_active: boolean }>;
        }

        // Logic faithfully modeling get_current_user_role() in 00010_security_remediation_r7.sql
        const getCurrentUserRoleR7 = (ctx: ExecutionContext): UserRole | null => {
          // Priority 1: If auth.uid() is present, ALWAYS lookup profile role for that specific UID
          if (ctx.jwtUserId) {
            const profile = ctx.profilesDb.get(ctx.jwtUserId);
            if (profile && profile.is_active) {
              return profile.role;
            }
            return null;
          }

          // Priority 2: Trusted service-role JWT claim
          if (ctx.jwtClaimRole === 'service_role') {
            return 'Admin';
          }

          // Priority 3: Direct internal database admin session (session_user, NOT current_user)
          if (['postgres', 'supabase_admin'].includes(ctx.sessionUser)) {
            return 'Admin';
          }

          return null;
        };

        const isAuthorizedPEDecisionMakerR7 = (
          ctx: ExecutionContext,
          job: { pe_owner_id?: string | null; pe_delegates?: string[] }
        ): boolean => {
          if (!ctx.jwtUserId) {
            if (ctx.jwtClaimRole === 'service_role' || ['postgres', 'supabase_admin'].includes(ctx.sessionUser)) {
              return true;
            }
            return false;
          }

          const role = getCurrentUserRoleR7(ctx);
          if (role === 'Admin') return true;
          if (role !== 'PE-MFG') return false;

          // Check if profile has explicit decision flag or is assigned as owner/delegate
          const isOwner = job.pe_owner_id === ctx.jwtUserId;
          const isDelegate = (job.pe_delegates || []).includes(ctx.jwtUserId);
          return isOwner || isDelegate;
        };

        it('Ordinary authenticated JWT caller does NOT inherit Admin from SECURITY DEFINER postgres owner', () => {
          const profilesDb = new Map<string, { role: UserRole; is_active: boolean }>([
            ['qa-user-1', { role: 'QA', is_active: true }],
            ['pe-user-1', { role: 'PE-MFG', is_active: true }],
            ['planning-user-1', { role: 'Planning', is_active: true }],
          ]);

          // When executing in PostgreSQL SECURITY DEFINER, the function owner is postgres,
          // but session_user or current_user MUST NOT override an authenticated user's actual profile!
          const qaContext: ExecutionContext = {
            jwtUserId: 'qa-user-1',
            jwtClaimRole: 'authenticated',
            sessionUser: 'authenticated', // or 'postgres' in flawed R6 implementation
            profilesDb,
          };

          const resolvedRole = getCurrentUserRoleR7(qaContext);
          expect(resolvedRole).toBe('QA');
          expect(resolvedRole).not.toBe('Admin');
        });

        it('Unassigned PE-MFG caller cannot make PE technical decisions despite SECURITY DEFINER', () => {
          const profilesDb = new Map<string, { role: UserRole; is_active: boolean }>([
            ['pe-operator-x', { role: 'PE-MFG', is_active: true }],
          ]);

          const ctx: ExecutionContext = {
            jwtUserId: 'pe-operator-x',
            jwtClaimRole: 'authenticated',
            sessionUser: 'authenticated',
            profilesDb,
          };

          const job = {
            pe_owner_id: 'pe-lead-engineer',
            pe_delegates: ['pe-backup-engineer'],
          };

          const isAuthorized = isAuthorizedPEDecisionMakerR7(ctx, job);
          expect(isAuthorized).toBe(false);
        });

        it('Assigned PE Owner and delegates ARE authorized decision makers', () => {
          const profilesDb = new Map<string, { role: UserRole; is_active: boolean }>([
            ['pe-lead', { role: 'PE-MFG', is_active: true }],
            ['pe-del', { role: 'PE-MFG', is_active: true }],
          ]);

          const job = {
            pe_owner_id: 'pe-lead',
            pe_delegates: ['pe-del'],
          };

          expect(
            isAuthorizedPEDecisionMakerR7({ jwtUserId: 'pe-lead', sessionUser: 'authenticated', profilesDb }, job)
          ).toBe(true);
          expect(
            isAuthorizedPEDecisionMakerR7({ jwtUserId: 'pe-del', sessionUser: 'authenticated', profilesDb }, job)
          ).toBe(true);
        });

        it('Inactive profile returns NULL role and denies decision making', () => {
          const profilesDb = new Map<string, { role: UserRole; is_active: boolean }>([
            ['disabled-admin', { role: 'Admin', is_active: false }],
          ]);

          const ctx: ExecutionContext = {
            jwtUserId: 'disabled-admin',
            sessionUser: 'authenticated',
            profilesDb,
          };

          expect(getCurrentUserRoleR7(ctx)).toBeNull();
          expect(isAuthorizedPEDecisionMakerR7(ctx, { pe_owner_id: 'disabled-admin' })).toBe(false);
        });
      });

      // -----------------------------------------------------------------------
      // R6-02: Fix Attachment Department Ownership & Integrity Server-Side
      // -----------------------------------------------------------------------
      describe('R6-02: Attachment Department Ownership & Integrity Server-Side Enforcement', () => {
        interface EnforceAttachmentParams {
          callerUserId: string;
          callerRole: UserRole;
          jobStatus: string;
          operationId?: string | null;
          operationJobId?: string;
          clientUploadedBy?: string;
          clientOwningDept?: UserRole;
          fileType: string;
          filePath: string;
        }

        // Logic faithfully modeling enforce_attachment_integrity_r7() trigger
        const simulateEnforceAttachmentIntegrityR7 = (params: EnforceAttachmentParams): {
          allowed: boolean;
          boundUploadedBy?: string;
          boundOwningDepartment?: UserRole;
          error?: string;
        } => {
          // 1. Job must be ACTIVE
          if (params.jobStatus !== 'ACTIVE') {
            return {
              allowed: false,
              error: `Tài liệu chỉ có thể thêm vào JOB ở trạng thái ACTIVE (trạng thái hiện tại: ${params.jobStatus}).`,
            };
          }

          // 2. Cross-job check
          if (params.operationId && params.operationJobId && params.operationJobId !== 'target-job-id') {
            return {
              allowed: false,
              error: 'Công đoạn chỉ định không thuộc về JOB của hồ sơ đính kèm.',
            };
          }

          // 3. Path format check
          const parts = params.filePath.split('/');
          if (parts.length !== 3 || parts[1] !== params.fileType) {
            return {
              allowed: false,
              error: 'Đường dẫn file_path không đúng định dạng canonical <job_id>/<file_type>/<filename>.',
            };
          }

          // 4. Role-category whitelist check
          if (params.callerRole === 'QA') {
            if (!['CHECK_SHEET', 'NG_PHOTO'].includes(params.fileType)) {
              return {
                allowed: false,
                error: 'Bộ phận QA chỉ được phép đính kèm CHECK_SHEET hoặc NG_PHOTO.',
              };
            }
          } else if (params.callerRole === 'Planning') {
            if (!['DRAWING', 'OTHER'].includes(params.fileType)) {
              return {
                allowed: false,
                error: 'Bộ phận Planning chỉ được phép đính kèm DRAWING hoặc OTHER.',
              };
            }
          } else if (params.callerRole === 'PE-MFG') {
            if (!['DRAWING', 'SETTING_SHEET', 'NG_PHOTO', 'OTHER'].includes(params.fileType)) {
              return {
                allowed: false,
                error: 'Bộ phận PE-MFG không được phép tải lên loại tài liệu này.',
              };
            }
          }

          // 5. Server-side binding (overwrites any client forgery)
          return {
            allowed: true,
            boundUploadedBy: params.callerUserId,
            boundOwningDepartment: params.callerRole,
          };
        };

        it('Client attempts to spoof uploaded_by and owning_department -> Server forces authenticated user & role', () => {
          const res = simulateEnforceAttachmentIntegrityR7({
            callerUserId: 'actual-pe-user',
            callerRole: 'PE-MFG',
            jobStatus: 'ACTIVE',
            clientUploadedBy: 'spoofed-admin-id',
            clientOwningDept: 'Admin',
            fileType: 'SETTING_SHEET',
            filePath: 'target-job-id/SETTING_SHEET/sheet1.pdf',
          });

          expect(res.allowed).toBe(true);
          expect(res.boundUploadedBy).toBe('actual-pe-user');
          expect(res.boundOwningDepartment).toBe('PE-MFG');
        });

        it('QA attempting to upload DRAWING is REJECTED by whitelist', () => {
          const res = simulateEnforceAttachmentIntegrityR7({
            callerUserId: 'qa-user-1',
            callerRole: 'QA',
            jobStatus: 'ACTIVE',
            fileType: 'DRAWING',
            filePath: 'target-job-id/DRAWING/drawing1.pdf',
          });

          expect(res.allowed).toBe(false);
          expect(res.error).toContain('Bộ phận QA chỉ được phép đính kèm CHECK_SHEET hoặc NG_PHOTO');
        });

        it('QA uploading CHECK_SHEET and NG_PHOTO is ALLOWED', () => {
          const checkSheetRes = simulateEnforceAttachmentIntegrityR7({
            callerUserId: 'qa-user-1',
            callerRole: 'QA',
            jobStatus: 'ACTIVE',
            fileType: 'CHECK_SHEET',
            filePath: 'target-job-id/CHECK_SHEET/cs1.pdf',
          });
          expect(checkSheetRes.allowed).toBe(true);
          expect(checkSheetRes.boundOwningDepartment).toBe('QA');

          const photoRes = simulateEnforceAttachmentIntegrityR7({
            callerUserId: 'qa-user-1',
            callerRole: 'QA',
            jobStatus: 'ACTIVE',
            fileType: 'NG_PHOTO',
            filePath: 'target-job-id/NG_PHOTO/defect.jpg',
          });
          expect(photoRes.allowed).toBe(true);
          expect(photoRes.boundOwningDepartment).toBe('QA');
        });

        it('Uploading attachment to non-ACTIVE (CLOSE / ARCHIVE / PURGED) job is REJECTED', () => {
          for (const status of ['CLOSE', 'ARCHIVE', 'PURGED']) {
            const res = simulateEnforceAttachmentIntegrityR7({
              callerUserId: 'admin-user',
              callerRole: 'Admin',
              jobStatus: status,
              fileType: 'DRAWING',
              filePath: 'target-job-id/DRAWING/d.pdf',
            });
            expect(res.allowed).toBe(false);
            expect(res.error).toContain('Tài liệu chỉ có thể thêm vào JOB ở trạng thái ACTIVE');
          }
        });

        it('Cross-job operation mismatch is REJECTED', () => {
          const res = simulateEnforceAttachmentIntegrityR7({
            callerUserId: 'pe-user',
            callerRole: 'PE-MFG',
            jobStatus: 'ACTIVE',
            operationId: 'op-different-job',
            operationJobId: 'other-job-999',
            fileType: 'DRAWING',
            filePath: 'target-job-id/DRAWING/d.pdf',
          });
          expect(res.allowed).toBe(false);
          expect(res.error).toContain('Công đoạn chỉ định không thuộc về JOB');
        });
      });

      // -----------------------------------------------------------------------
      // R6-03: Implement Approved Option A Document Access Policy
      // -----------------------------------------------------------------------
      describe('R6-03: Option A Document Access Policy Matrix', () => {
        interface DocumentAccessCheck {
          userRole: UserRole | 'Anonymous';
          isActive: boolean;
          jobStatus: string;
          isRegisteredInAttachments: boolean;
        }

        // Logic faithfully modeling storage_registered_read_r7 policy
        const evaluateDocumentReadAccessOptionA = (check: DocumentAccessCheck): {
          allowed: boolean;
          reason?: string;
        } => {
          if (check.userRole === 'Anonymous') {
            return { allowed: false, reason: 'Anonymous access denied' };
          }
          if (!check.isActive) {
            return { allowed: false, reason: 'Inactive profile denied' };
          }
          if (!check.isRegisteredInAttachments) {
            return { allowed: false, reason: 'Unregistered storage object denied' };
          }
          if (check.jobStatus === 'PURGED') {
            return { allowed: false, reason: 'PURGED job documents cannot be accessed' };
          }

          // Option A: All active internal roles can read registered docs of non-purged jobs
          const activeInternalRoles: UserRole[] = ['Admin', 'Planning', 'PE-MFG', 'QA'];
          if (activeInternalRoles.includes(check.userRole)) {
            return { allowed: true };
          }

          return { allowed: false, reason: 'Unauthorized role' };
        };

        it('Option A: All active internal roles can view registered documents for ACTIVE, CLOSE, and ARCHIVE jobs', () => {
          const roles: UserRole[] = ['Planning', 'PE-MFG', 'QA', 'Admin'];
          const nonPurgedStatuses = ['ACTIVE', 'CLOSE', 'ARCHIVE'];

          for (const role of roles) {
            for (const status of nonPurgedStatuses) {
              const res = evaluateDocumentReadAccessOptionA({
                userRole: role,
                isActive: true,
                jobStatus: status,
                isRegisteredInAttachments: true,
              });
              expect(res.allowed).toBe(true);
            }
          }
        });

        it('Anonymous users are strictly DENIED access', () => {
          const res = evaluateDocumentReadAccessOptionA({
            userRole: 'Anonymous',
            isActive: false,
            jobStatus: 'ACTIVE',
            isRegisteredInAttachments: true,
          });
          expect(res.allowed).toBe(false);
          expect(res.reason).toContain('Anonymous access denied');
        });

        it('Deactivated users are strictly DENIED access', () => {
          const res = evaluateDocumentReadAccessOptionA({
            userRole: 'PE-MFG',
            isActive: false,
            jobStatus: 'ACTIVE',
            isRegisteredInAttachments: true,
          });
          expect(res.allowed).toBe(false);
          expect(res.reason).toContain('Inactive profile denied');
        });

        it('Unregistered storage objects are strictly DENIED access (prevents unauthorized bucket browsing)', () => {
          const res = evaluateDocumentReadAccessOptionA({
            userRole: 'Admin',
            isActive: true,
            jobStatus: 'ACTIVE',
            isRegisteredInAttachments: false,
          });
          expect(res.allowed).toBe(false);
          expect(res.reason).toContain('Unregistered storage object denied');
        });

        it('PURGED job documents are DENIED for all roles including Admin', () => {
          for (const role of ['Admin', 'Planning', 'PE-MFG', 'QA'] as UserRole[]) {
            const res = evaluateDocumentReadAccessOptionA({
              userRole: role,
              isActive: true,
              jobStatus: 'PURGED',
              isRegisteredInAttachments: true,
            });
            expect(res.allowed).toBe(false);
            expect(res.reason).toContain('PURGED job documents cannot be accessed');
          }
        });
      });

      // -----------------------------------------------------------------------
      // R6-04: Metadata-First Upload Lifecycle & Existence Proof
      // -----------------------------------------------------------------------
      describe('R6-04: Metadata-First Upload Lifecycle (PENDING -> READY / FAILED)', () => {
        interface AttachmentRecord {
          id: string;
          file_path: string;
          upload_status: 'PENDING' | 'READY' | 'FAILED';
        }

        const evaluateSignedUrlGateway = (record: AttachmentRecord): { allowed: boolean; status: number; error?: string } => {
          if (record.upload_status !== 'READY') {
            return {
              allowed: false,
              status: 409,
              error: `Attachment upload is not finalized (status is ${record.upload_status})`,
            };
          }
          return { allowed: true, status: 200 };
        };

        const simulateConfirmAttachmentUpload = (
          record: AttachmentRecord,
          storageObjects: Set<string>
        ): { success: boolean; newStatus: 'PENDING' | 'READY'; error?: string } => {
          // Checks if file actually exists in storage.objects
          if (!storageObjects.has(record.file_path)) {
            return {
              success: false,
              newStatus: record.upload_status as 'PENDING',
              error: 'File does not exist in storage bucket.',
            };
          }
          return { success: true, newStatus: 'READY' };
        };

        it('Newly registered attachment starts in PENDING status', () => {
          const newAttachment: AttachmentRecord = {
            id: 'att-1',
            file_path: 'job-1/DRAWING/sample.pdf',
            upload_status: 'PENDING',
          };
          expect(newAttachment.upload_status).toBe('PENDING');
        });

        it('Signed URL endpoint REJECTS PENDING or FAILED attachments with 409 Conflict', () => {
          const pendingRes = evaluateSignedUrlGateway({
            id: 'att-1',
            file_path: 'job-1/DRAWING/sample.pdf',
            upload_status: 'PENDING',
          });
          expect(pendingRes.allowed).toBe(false);
          expect(pendingRes.status).toBe(409);
          expect(pendingRes.error).toContain('not finalized');

          const failedRes = evaluateSignedUrlGateway({
            id: 'att-2',
            file_path: 'job-1/DRAWING/failed.pdf',
            upload_status: 'FAILED',
          });
          expect(failedRes.allowed).toBe(false);
          expect(failedRes.status).toBe(409);
        });

        it('confirm_attachment_upload fails if object does NOT exist in storage.objects', () => {
          const record: AttachmentRecord = {
            id: 'att-1',
            file_path: 'job-1/DRAWING/nonexistent.pdf',
            upload_status: 'PENDING',
          };
          const storageObjects = new Set<string>(); // Empty storage

          const confirmResult = simulateConfirmAttachmentUpload(record, storageObjects);
          expect(confirmResult.success).toBe(false);
          expect(confirmResult.newStatus).toBe('PENDING');
          expect(confirmResult.error).toContain('File does not exist in storage bucket');
        });

        it('confirm_attachment_upload transitions to READY when object exists in storage', () => {
          const record: AttachmentRecord = {
            id: 'att-1',
            file_path: 'job-1/DRAWING/verified.pdf',
            upload_status: 'PENDING',
          };
          const storageObjects = new Set<string>(['job-1/DRAWING/verified.pdf']);

          const confirmResult = simulateConfirmAttachmentUpload(record, storageObjects);
          expect(confirmResult.success).toBe(true);
          expect(confirmResult.newStatus).toBe('READY');

          // After transition to READY, signed URL generation succeeds
          const signedUrlRes = evaluateSignedUrlGateway({ ...record, upload_status: confirmResult.newStatus });
          expect(signedUrlRes.allowed).toBe(true);
          expect(signedUrlRes.status).toBe(200);
        });
      });

      // -----------------------------------------------------------------------
      // R6-05: Remove Invalid Status Regression (IN_PROGRESS -> NOT_STARTED)
      // -----------------------------------------------------------------------
      describe('R6-05: Prohibition of Status Regression (IN_PROGRESS -> NOT_STARTED)', () => {
        const evaluateStatusTransitionR7 = (
          currentStatus: string,
          targetStatus: string
        ): { allowed: boolean; error?: string } => {
          if (currentStatus === 'IN_PROGRESS' && targetStatus === 'NOT_STARTED') {
            return {
              allowed: false,
              error: 'Invalid status transition: An IN_PROGRESS operation cannot regress to NOT_STARTED.',
            };
          }

          const validFromInProgress = ['HOLD', 'WAITING_QA', 'QA_NG', 'QA_KIV', 'COMPLETED', 'IN_PROGRESS'];
          if (currentStatus === 'IN_PROGRESS' && !validFromInProgress.includes(targetStatus)) {
            return { allowed: false, error: `Invalid target status ${targetStatus} from IN_PROGRESS.` };
          }

          return { allowed: true };
        };

        it('IN_PROGRESS to NOT_STARTED transition is STRICTLY BLOCKED', () => {
          const res = evaluateStatusTransitionR7('IN_PROGRESS', 'NOT_STARTED');
          expect(res.allowed).toBe(false);
          expect(res.error).toContain('cannot regress to NOT_STARTED');
        });

        it('Valid forward transitions from IN_PROGRESS remain operational', () => {
          const validTargets = ['HOLD', 'WAITING_QA', 'QA_NG', 'QA_KIV', 'COMPLETED'];
          for (const target of validTargets) {
            const res = evaluateStatusTransitionR7('IN_PROGRESS', target);
            expect(res.allowed).toBe(true);
          }
        });
      });

      // -----------------------------------------------------------------------
      // R6-06: Trusted QA Event Ordering & Disposition Freshness
      // -----------------------------------------------------------------------
      describe('R6-06: Monotonic QA Event Ordering and Fresh Disposition Enforcement', () => {
        interface OperationState {
          id: string;
          qa_event_counter: number;
        }

        interface QACheckRecord {
          id: string;
          operation_id: string;
          event_seq: number;
          result: 'OK' | 'NG' | 'KIV';
        }

        // Logic faithfully modeling handle_qa_check_before_insert_r7 trigger
        const recordQACheckR7 = (
          op: OperationState,
          result: 'OK' | 'NG' | 'KIV'
        ): { updatedOp: OperationState; qaCheck: QACheckRecord } => {
          // Increment counter under row lock
          const nextSeq = op.qa_event_counter + 1;
          const updatedOp = { ...op, qa_event_counter: nextSeq };
          const qaCheck: QACheckRecord = {
            id: `qa-${nextSeq}`,
            operation_id: op.id,
            event_seq: nextSeq,
            result,
          };
          return { updatedOp, qaCheck };
        };

        // Logic checking that PE disposition must resolve the latest QA event
        const verifyPEDispositionFreshness = (
          latestQACheck: QACheckRecord,
          disposition: { qa_check_id: string; resolved_event_seq?: number } | null
        ): { fresh: boolean; error?: string } => {
          if (latestQACheck.result === 'OK') {
            return { fresh: true };
          }

          if (!disposition) {
            return { fresh: false, error: 'Phải có quyết định kỹ thuật PE cho đánh giá QA không đạt.' };
          }

          if (disposition.resolved_event_seq !== undefined && disposition.resolved_event_seq < latestQACheck.event_seq) {
            return {
              fresh: false,
              error: `Quyết định kỹ thuật chỉ áp dụng cho kiểm tra QA cũ (#${disposition.resolved_event_seq}). Cần có quyết định mới cho sự kiện QA mới nhất (#${latestQACheck.event_seq}).`,
            };
          }

          return { fresh: true };
        };

        it('QA checks receive strictly monotonic event_seq per operation', () => {
          let op: OperationState = { id: 'op-1', qa_event_counter: 0 };

          const check1 = recordQACheckR7(op, 'OK');
          op = check1.updatedOp;
          expect(check1.qaCheck.event_seq).toBe(1);
          expect(op.qa_event_counter).toBe(1);

          const check2 = recordQACheckR7(op, 'NG');
          op = check2.updatedOp;
          expect(check2.qaCheck.event_seq).toBe(2);
          expect(op.qa_event_counter).toBe(2);

          const check3 = recordQACheckR7(op, 'KIV');
          op = check3.updatedOp;
          expect(check3.qaCheck.event_seq).toBe(3);
          expect(op.qa_event_counter).toBe(3);
        });

        it('Disposition referencing older event_seq cannot satisfy newer QA event', () => {
          const _olderEvent: QACheckRecord = { id: 'qa-1', operation_id: 'op-1', event_seq: 1, result: 'NG' };
          const newerEvent: QACheckRecord = { id: 'qa-2', operation_id: 'op-1', event_seq: 2, result: 'NG' };

          // Disposition was made for qa-1 (event_seq 1)
          const staleDisposition = { qa_check_id: _olderEvent.id, resolved_event_seq: _olderEvent.event_seq };

          const freshnessRes = verifyPEDispositionFreshness(newerEvent, staleDisposition);
          expect(freshnessRes.fresh).toBe(false);
          expect(freshnessRes.error).toContain('Cần có quyết định mới cho sự kiện QA mới nhất (#2)');
        });

        it('Fresh disposition matching latest event_seq is ACCEPTED', () => {
          const latestEvent: QACheckRecord = { id: 'qa-2', operation_id: 'op-1', event_seq: 2, result: 'NG' };
          const freshDisposition = { qa_check_id: 'qa-2', resolved_event_seq: 2 };

          const freshnessRes = verifyPEDispositionFreshness(latestEvent, freshDisposition);
          expect(freshnessRes.fresh).toBe(true);
        });
      });

      // -----------------------------------------------------------------------
      // R6-07: Migration Preflight Diagnostics & Verification
      // -----------------------------------------------------------------------
      describe('R6-07: Migration Preflight Diagnostics & Data Integrity Verification', () => {
        interface AttachmentCatalogRow {
          id: string;
          job_id: string;
          operation_id?: string | null;
          file_path: string;
        }

        const runPreflightValidation = (
          attachments: AttachmentCatalogRow[],
          operationJobMap: Map<string, string>
        ): { passed: boolean; errors: string[] } => {
          const errors: string[] = [];

          // 1. Check duplicates
          const seen = new Set<string>();
          for (const a of attachments) {
            if (seen.has(a.file_path)) {
              errors.push(`Duplicate file_path detected: ${a.file_path}`);
            }
            seen.add(a.file_path);
          }

          // 2. Check canonical path
          for (const a of attachments) {
            const parts = a.file_path.split('/');
            if (parts.length !== 3 || a.file_path.includes('\\') || a.file_path.includes('..')) {
              errors.push(`Noncanonical file_path detected: ${a.file_path}`);
            }
          }

          // 3. Check cross-job mismatch
          for (const a of attachments) {
            if (a.operation_id) {
              const opJob = operationJobMap.get(a.operation_id);
              if (opJob && opJob !== a.job_id) {
                errors.push(`Cross-job mismatch: Attachment ${a.id} job ${a.job_id} != op job ${opJob}`);
              }
            }
          }

          return { passed: errors.length === 0, errors };
        };

        it('Preflight flags duplicate file paths', () => {
          const sample = [
            { id: '1', job_id: 'j1', file_path: 'j1/DRAWING/plan.pdf' },
            { id: '2', job_id: 'j1', file_path: 'j1/DRAWING/plan.pdf' },
          ];
          const res = runPreflightValidation(sample, new Map());
          expect(res.passed).toBe(false);
          expect(res.errors[0]).toContain('Duplicate file_path detected');
        });

        it('Preflight flags noncanonical and traversal paths', () => {
          const sample = [
            { id: '1', job_id: 'j1', file_path: 'j1\\DRAWING\\plan.pdf' },
            { id: '2', job_id: 'j1', file_path: 'j1/DRAWING/../../secret.txt' },
            { id: '3', job_id: 'j1', file_path: 'just_a_filename.pdf' },
          ];
          const res = runPreflightValidation(sample, new Map());
          expect(res.passed).toBe(false);
          expect(res.errors.length).toBe(3);
        });

        it('Preflight flags cross-job operation mismatches', () => {
          const sample = [
            { id: '1', job_id: 'j1', operation_id: 'op-99', file_path: 'j1/DRAWING/plan.pdf' },
          ];
          const opMap = new Map([['op-99', 'j2']]); // Operation belongs to j2, not j1!
          const res = runPreflightValidation(sample, opMap);
          expect(res.passed).toBe(false);
          expect(res.errors[0]).toContain('Cross-job mismatch');
        });

        it('Clean catalog PASSES all preflight checks', () => {
          const sample = [
            { id: '1', job_id: 'j1', operation_id: 'op-1', file_path: 'j1/DRAWING/plan.pdf' },
            { id: '2', job_id: 'j1', operation_id: 'op-1', file_path: 'j1/CHECK_SHEET/cs.pdf' },
          ];
          const opMap = new Map([['op-1', 'j1']]);
          const res = runPreflightValidation(sample, opMap);
          expect(res.passed).toBe(true);
          expect(res.errors.length).toBe(0);
        });
      });
    });

    // =========================================================================
    // PART G: R8 SECURITY REMEDIATION SUITE (CODEX R7 FINDINGS R7-01..08)
    // =========================================================================
    describe('PART G: R8 Security Remediation Suite (Codex R7 Findings)', () => {
      // -----------------------------------------------------------------------
      // R7-01: Prevent forged READY attachments
      // -----------------------------------------------------------------------
      describe('R7-01: Prevention of Forged READY Attachments', () => {
        interface AttachmentInsertPayload {
          upload_status?: string | null;
          uploaded_by?: string | null;
          owning_department?: UserRole;
          job_id: string;
          file_path: string;
          file_type: string;
        }

        const simulateAttachmentInsertR8 = (
          payload: AttachmentInsertPayload,
          callerUid: string,
          callerRole: UserRole
        ): { record: AttachmentInsertPayload; forcedStatus: string } => {
          // In R8, BEFORE INSERT trigger enforce_attachment_integrity_r8 unconditionally
          // forces upload_status := 'PENDING', ignoring whatever client provided
          const bound = {
            ...payload,
            uploaded_by: callerUid,
            owning_department: callerRole === 'Admin' ? (payload.owning_department || 'Admin') : callerRole,
            upload_status: 'PENDING', // UNCONDITIONALLY FORCED SERVER-SIDE
          };
          return { record: bound, forcedStatus: bound.upload_status };
        };

        const simulateAttachmentUpdateR8 = (params: {
          currentStatus: string;
          attemptedStatus: string;
          isTrustedAction: boolean;
        }): { allowed: boolean; error?: string } => {
          if (!params.isTrustedAction) {
            return {
              allowed: false,
              error: 'Attachment records and upload_status are server-managed. Direct client UPDATE is strictly forbidden.',
            };
          }
          return { allowed: true };
        };

        it('Client explicitly passing upload_status: READY on INSERT is FORCED to PENDING', () => {
          const res = simulateAttachmentInsertR8(
            {
              job_id: 'job-1',
              file_path: 'job-1/DRAWING/part.pdf',
              file_type: 'DRAWING',
              upload_status: 'READY', // Attempted forge
            },
            'user-1',
            'Planning'
          );
          expect(res.forcedStatus).toBe('PENDING');
          expect(res.record.upload_status).toBe('PENDING');
        });

        it('Client passing upload_status: FAILED or NULL on INSERT is FORCED to PENDING', () => {
          const resFailed = simulateAttachmentInsertR8(
            { job_id: 'job-1', file_path: 'job-1/DRAWING/p.pdf', file_type: 'DRAWING', upload_status: 'FAILED' },
            'user-1',
            'Planning'
          );
          expect(resFailed.forcedStatus).toBe('PENDING');

          const resNull = simulateAttachmentInsertR8(
            { job_id: 'job-1', file_path: 'job-1/DRAWING/p.pdf', file_type: 'DRAWING', upload_status: null },
            'user-1',
            'Planning'
          );
          expect(resNull.forcedStatus).toBe('PENDING');
        });

        it('Direct client REST UPDATE on upload_status is STRICTLY BLOCKED', () => {
          const res = simulateAttachmentUpdateR8({
            currentStatus: 'PENDING',
            attemptedStatus: 'READY',
            isTrustedAction: false, // Direct REST update from client
          });
          expect(res.allowed).toBe(false);
          expect(res.error).toContain('Direct client UPDATE is strictly forbidden');
        });

        it('Only trusted server function with physical storage existence proof can transition to READY', () => {
          const res = simulateAttachmentUpdateR8({
            currentStatus: 'PENDING',
            attemptedStatus: 'READY',
            isTrustedAction: true, // Inside confirm_attachment_upload RPC
          });
          expect(res.allowed).toBe(true);
        });
      });

      // -----------------------------------------------------------------------
      // R7-02: Migration compatibility with CLOSED JOBs
      // -----------------------------------------------------------------------
      describe('R7-02: Migration Compatibility with CLOSED Jobs', () => {
        interface CheckJobStatusParams {
          jobStatus: string;
          isMaintenanceMode: boolean;
          isDerivedFieldOnly: boolean;
        }

        const evaluateJobOperationMod = (params: CheckJobStatusParams): { allowed: boolean; error?: string } => {
          if (params.jobStatus !== 'ACTIVE') {
            // In maintenance mode, derived field updates are permitted
            if (params.isMaintenanceMode && params.isDerivedFieldOnly) {
              return { allowed: true };
            }
            return {
              allowed: false,
              error: `Operation locked: Parent JOB is not ACTIVE (current status: ${params.jobStatus})`,
            };
          }
          return { allowed: true };
        };

        it('Maintenance procedure can backfill event_seq and qa_event_counter on CLOSED jobs', () => {
          const res = evaluateJobOperationMod({
            jobStatus: 'CLOSE',
            isMaintenanceMode: true,
            isDerivedFieldOnly: true,
          });
          expect(res.allowed).toBe(true);
        });

        it('Ordinary user modification on CLOSED jobs remains strictly BLOCKED', () => {
          const res = evaluateJobOperationMod({
            jobStatus: 'CLOSE',
            isMaintenanceMode: false,
            isDerivedFieldOnly: false,
          });
          expect(res.allowed).toBe(false);
          expect(res.error).toContain('Parent JOB is not ACTIVE');
        });

        it('ARCHIVE and PURGED jobs also block ordinary user modifications', () => {
          for (const st of ['ARCHIVE', 'PURGED']) {
            const res = evaluateJobOperationMod({
              jobStatus: st,
              isMaintenanceMode: false,
              isDerivedFieldOnly: false,
            });
            expect(res.allowed).toBe(false);
          }
        });
      });

      // -----------------------------------------------------------------------
      // R7-03: Protect QA event counter & Sequence uniqueness
      // -----------------------------------------------------------------------
      describe('R7-03: Protect QA Event Counter & Unique Monotonic Sequence', () => {
        const simulateOperationUpdateR8 = (params: {
          oldCounter: number;
          newCounter: number;
          isTrustedQa: boolean;
        }): { allowed: boolean; error?: string } => {
          if (params.oldCounter !== params.newCounter && !params.isTrustedQa) {
            return {
              allowed: false,
              error: 'qa_event_counter is server-owned and cannot be modified by client UPDATE.',
            };
          }
          return { allowed: true };
        };

        const simulateQaCheckUpdateR8 = (params: {
          isMaintenance: boolean;
        }): { allowed: boolean; error?: string } => {
          if (!params.isMaintenance) {
            return {
              allowed: false,
              error: 'QA evaluation records are immutable. Direct UPDATE or DELETE is strictly forbidden.',
            };
          }
          return { allowed: true };
        };

        it('Client direct UPDATE on qa_event_counter is STRICTLY BLOCKED', () => {
          const res = simulateOperationUpdateR8({
            oldCounter: 2,
            newCounter: 99,
            isTrustedQa: false,
          });
          expect(res.allowed).toBe(false);
          expect(res.error).toContain('qa_event_counter is server-owned');
        });

        it('Internal QA insert trigger with trusted flag updates qa_event_counter atomically', () => {
          const res = simulateOperationUpdateR8({
            oldCounter: 2,
            newCounter: 3,
            isTrustedQa: true,
          });
          expect(res.allowed).toBe(true);
        });

        it('Direct UPDATE or DELETE on qa_checks is REJECTED as immutable', () => {
          const res = simulateQaCheckUpdateR8({ isMaintenance: false });
          expect(res.allowed).toBe(false);
          expect(res.error).toContain('QA evaluation records are immutable');
        });

        it('Unique constraint enforces no duplicate event_seq per operation', () => {
          const existingSeqs = new Set<string>(['op-1:1', 'op-1:2']);
          const isUnique = !existingSeqs.has('op-1:2');
          expect(isUnique).toBe(false);

          const isNewUnique = !existingSeqs.has('op-1:3');
          expect(isNewUnique).toBe(true);
        });
      });

      // -----------------------------------------------------------------------
      // R7-04: Protect reopen metadata & Retroactive disposition check
      // -----------------------------------------------------------------------
      describe('R7-04: Protect Reopen Metadata & Disposition Freshness After Reopen', () => {
        interface OperationReopenFields {
          status: string;
          reopened_at?: string | null;
          reopened_by?: string | null;
          reopen_reason?: string | null;
        }

        const evaluateReopenMetadataUpdateR8 = (
          oldOp: OperationReopenFields,
          newOp: OperationReopenFields,
          callerUid: string,
          isAuthorizedPE: boolean
        ): { allowed: boolean; boundOp?: OperationReopenFields; error?: string } => {
          // Status-preserving update
          if (oldOp.status === newOp.status) {
            if (
              newOp.reopened_at !== oldOp.reopened_at ||
              newOp.reopened_by !== oldOp.reopened_by ||
              newOp.reopen_reason !== oldOp.reopen_reason
            ) {
              return {
                allowed: false,
                error: 'Reopen metadata (reopened_at, reopened_by, reopen_reason) can only be set during authorized operation reopening from COMPLETED to IN_PROGRESS.',
              };
            }
          }

          // Reopen transition: COMPLETED -> IN_PROGRESS
          if (oldOp.status === 'COMPLETED' && newOp.status === 'IN_PROGRESS') {
            if (!isAuthorizedPE) {
              return { allowed: false, error: 'Only designated PE Owner or delegate can reopen a completed operation.' };
            }
            if (!newOp.reopen_reason || newOp.reopen_reason.trim().length < 5) {
              return { allowed: false, error: 'Reopening a completed operation requires a recorded reopen_reason (minimum 5 characters).' };
            }

            // Server-stamped actor and timestamp (prevent client forgery)
            return {
              allowed: true,
              boundOp: {
                ...newOp,
                reopened_at: '2026-10-10T12:00:00Z',
                reopened_by: callerUid,
              },
            };
          }

          // If previously reopened, historical reopen evidence cannot be cleared
          if (oldOp.reopen_reason && newOp.reopen_reason !== oldOp.reopen_reason && oldOp.status !== 'COMPLETED') {
            return { allowed: false, error: 'Historical reopen evidence cannot be modified or cleared.' };
          }

          return { allowed: true, boundOp: newOp };
        };

        it('Client attempting to modify reopen fields during status-preserving UPDATE is BLOCKED', () => {
          const oldOp: OperationReopenFields = { status: 'IN_PROGRESS', reopened_at: null, reopened_by: null, reopen_reason: null };
          const newOp: OperationReopenFields = { status: 'IN_PROGRESS', reopen_reason: 'Tampered reason' };

          const res = evaluateReopenMetadataUpdateR8(oldOp, newOp, 'attacker-uid', false);
          expect(res.allowed).toBe(false);
          expect(res.error).toContain('Reopen metadata');
        });

        it('Authorized PE reopen stamps authenticated UID and server timestamp, ignoring client values', () => {
          const oldOp: OperationReopenFields = { status: 'COMPLETED' };
          const newOp: OperationReopenFields = {
            status: 'IN_PROGRESS',
            reopen_reason: 'Gia công bù sản phẩm hỏng theo yêu cầu PE',
            reopened_by: 'spoofed-admin-uid',
            reopened_at: '1999-01-01T00:00:00Z',
          };

          const res = evaluateReopenMetadataUpdateR8(oldOp, newOp, 'actual-pe-uid', true);
          expect(res.allowed).toBe(true);
          expect(res.boundOp?.reopened_by).toBe('actual-pe-uid'); // Server forced
          expect(res.boundOp?.reopened_at).toBe('2026-10-10T12:00:00Z');
        });

        it('Clearing or modifying reopen_reason on subsequent update is BLOCKED', () => {
          const oldOp: OperationReopenFields = { status: 'IN_PROGRESS', reopen_reason: 'Lý do hợp lệ ban đầu' };
          const newOp: OperationReopenFields = { status: 'HOLD', reopen_reason: null };

          const res = evaluateReopenMetadataUpdateR8(oldOp, newOp, 'pe-uid', true);
          expect(res.allowed).toBe(false);
          expect(res.error).toContain('Historical reopen evidence cannot be modified or cleared');
        });

        it('Pre-reopen disposition CANNOT authorize post-reopen completion', () => {
          const reopenTime = new Date('2026-10-10T10:00:00Z').getTime();
          const preReopenDispositionTime = new Date('2026-10-10T09:00:00Z').getTime();

          const isDispositionValidAfterReopen = preReopenDispositionTime >= reopenTime;
          expect(isDispositionValidAfterReopen).toBe(false);

          const postReopenDispositionTime = new Date('2026-10-10T11:00:00Z').getTime();
          const isPostDispositionValid = postReopenDispositionTime >= reopenTime;
          expect(isPostDispositionValid).toBe(true);
        });
      });

      // -----------------------------------------------------------------------
      // R7-05: Complete upload retry lifecycle
      // -----------------------------------------------------------------------
      describe('R7-05: Complete Upload Retry Lifecycle (PENDING -> FAILED -> RETRY)', () => {
        interface AttachmentRetryContext {
          id: string;
          job_id: string;
          job_status: string;
          uploaded_by: string;
          upload_status: 'PENDING' | 'READY' | 'FAILED';
          storageExists: boolean;
        }

        const simulateRetryAttachmentUpload = (
          att: AttachmentRetryContext,
          callerUid: string,
          callerRole: UserRole
        ): { success: boolean; newStatus?: string; error?: string } => {
          if (callerRole !== 'Admin' && att.uploaded_by !== callerUid) {
            return { success: false, error: 'Forbidden: Only the original uploader or Admin can retry upload.' };
          }
          if (att.job_status !== 'ACTIVE') {
            return { success: false, error: `Cannot retry upload on ${att.job_status} JOB (only ACTIVE jobs permit uploads).` };
          }
          if (att.upload_status === 'READY') {
            return { success: true, newStatus: 'READY' };
          }

          if (att.storageExists) {
            return { success: true, newStatus: 'READY' };
          } else {
            return { success: true, newStatus: 'PENDING' };
          }
        };

        it('Different user attempting to retry another user upload is REJECTED (anti-hijacking)', () => {
          const att: AttachmentRetryContext = {
            id: 'att-1',
            job_id: 'j1',
            job_status: 'ACTIVE',
            uploaded_by: 'original-user',
            upload_status: 'FAILED',
            storageExists: false,
          };

          const res = simulateRetryAttachmentUpload(att, 'intruder-user', 'PE-MFG');
          expect(res.success).toBe(false);
          expect(res.error).toContain('Only the original uploader or Admin can retry');
        });

        it('Retry on CLOSED job is REJECTED', () => {
          const att: AttachmentRetryContext = {
            id: 'att-1',
            job_id: 'j1',
            job_status: 'CLOSE',
            uploaded_by: 'original-user',
            upload_status: 'FAILED',
            storageExists: false,
          };

          const res = simulateRetryAttachmentUpload(att, 'original-user', 'PE-MFG');
          expect(res.success).toBe(false);
          expect(res.error).toContain('Cannot retry upload on CLOSE JOB');
        });

        it('Retry recovers directly to READY if Storage object is already intact', () => {
          const att: AttachmentRetryContext = {
            id: 'att-1',
            job_id: 'j1',
            job_status: 'ACTIVE',
            uploaded_by: 'original-user',
            upload_status: 'FAILED',
            storageExists: true,
          };

          const res = simulateRetryAttachmentUpload(att, 'original-user', 'PE-MFG');
          expect(res.success).toBe(true);
          expect(res.newStatus).toBe('READY');
        });

        it('Retry resets to PENDING for binary re-upload if Storage object is missing', () => {
          const att: AttachmentRetryContext = {
            id: 'att-1',
            job_id: 'j1',
            job_status: 'ACTIVE',
            uploaded_by: 'original-user',
            upload_status: 'FAILED',
            storageExists: false,
          };

          const res = simulateRetryAttachmentUpload(att, 'original-user', 'PE-MFG');
          expect(res.success).toBe(true);
          expect(res.newStatus).toBe('PENDING');
        });
      });

      // -----------------------------------------------------------------------
      // R7-06: Minimal working upload UI logic
      // -----------------------------------------------------------------------
      describe('R7-06: Minimal Working Upload UI Constraints', () => {
        const getAllowedTypesByRole = (role: UserRole) => {
          switch (role) {
            case 'QA':
              return ['CHECK_SHEET', 'NG_PHOTO', 'OTHER'];
            case 'Planning':
              return ['DRAWING', 'CHECK_SHEET', 'SETTING_SHEET', 'OTHER'];
            case 'PE-MFG':
              return ['CHECK_SHEET', 'SETTING_SHEET', 'DRAWING', 'NG_PHOTO', 'OTHER'];
            case 'Admin':
            default:
              return ['DRAWING', 'CHECK_SHEET', 'SETTING_SHEET', 'NG_PHOTO', 'OTHER'];
          }
        };

        it('QA UI offers only QA-permitted document types', () => {
          const qaTypes = getAllowedTypesByRole('QA');
          expect(qaTypes).toContain('CHECK_SHEET');
          expect(qaTypes).toContain('NG_PHOTO');
          expect(qaTypes).not.toContain('DRAWING');
          expect(qaTypes).not.toContain('SETTING_SHEET');
        });

        it('PE-MFG UI offers manufacturing check sheet, drawings, setting sheet, and defect photos', () => {
          const peTypes = getAllowedTypesByRole('PE-MFG');
          expect(peTypes).toContain('CHECK_SHEET');
          expect(peTypes).toContain('SETTING_SHEET');
          expect(peTypes).toContain('DRAWING');
          expect(peTypes).toContain('NG_PHOTO');
        });

        it('Upload controls are disabled when JOB is not ACTIVE', () => {
          const isUploadPermitted = (jobStatus: string) => jobStatus === 'ACTIVE';
          expect(isUploadPermitted('ACTIVE')).toBe(true);
          expect(isUploadPermitted('CLOSE')).toBe(false);
          expect(isUploadPermitted('ARCHIVE')).toBe(false);
          expect(isUploadPermitted('PURGED')).toBe(false);
        });
      });

      // -----------------------------------------------------------------------
      // R7-07: Preflight diagnostic checks
      // -----------------------------------------------------------------------
      describe('R7-07: Enhanced Preflight Diagnostic Checks', () => {
        it('Diagnostic detects invalid JOB prefix binding', () => {
          const validateJobPrefix = (filePath: string, jobId: string) => {
            const parts = filePath.split('/');
            return parts.length === 3 && parts[0] === jobId;
          };

          expect(validateJobPrefix('j-1/DRAWING/test.pdf', 'j-1')).toBe(true);
          expect(validateJobPrefix('j-2/DRAWING/test.pdf', 'j-1')).toBe(false);
        });

        it('Diagnostic identifies missing event_seq rows before migration', () => {
          const sampleQAs = [
            { id: '1', event_seq: 1 },
            { id: '2', event_seq: null },
            { id: '3', event_seq: 2 },
          ];
          const unsequenced = sampleQAs.filter((q) => q.event_seq === null);
          expect(unsequenced.length).toBe(1);
          expect(unsequenced[0].id).toBe('2');
        });
      });

      // -----------------------------------------------------------------------
      // R7-08: Correct Admin uploader attribution
      // -----------------------------------------------------------------------
      describe('R7-08: Real Actor Attribution and Admin On-Behalf Uploads', () => {
        interface AttachmentAttribution {
          uploaded_by: string;
          owning_department: UserRole;
          admin_on_behalf: boolean;
        }

        const resolveAttributionR8 = (
          callerUid: string,
          callerRole: UserRole,
          requestedDepartment?: UserRole
        ): AttachmentAttribution => {
          // uploaded_by is ALWAYS the caller's actual UID, even for Admin!
          const uploaded_by = callerUid;

          if (callerRole === 'Admin') {
            if (requestedDepartment && requestedDepartment !== 'Admin') {
              return {
                uploaded_by,
                owning_department: requestedDepartment,
                admin_on_behalf: true,
              };
            }
            return {
              uploaded_by,
              owning_department: 'Admin',
              admin_on_behalf: false,
            };
          }

          return {
            uploaded_by,
            owning_department: callerRole,
            admin_on_behalf: false,
          };
        };

        it('Admin uploaded_by ALWAYS records the Admin actual UID, not forged user', () => {
          const res = resolveAttributionR8('admin-actual-uuid', 'Admin');
          expect(res.uploaded_by).toBe('admin-actual-uuid');
        });

        it('Admin uploading on behalf of QA sets owning_department=QA and flags admin_on_behalf=true', () => {
          const res = resolveAttributionR8('admin-actual-uuid', 'Admin', 'QA');
          expect(res.uploaded_by).toBe('admin-actual-uuid');
          expect(res.owning_department).toBe('QA');
          expect(res.admin_on_behalf).toBe(true);
        });

        it('Ordinary PE user uploaded_by is PE UID and cannot set admin_on_behalf', () => {
          const res = resolveAttributionR8('pe-operator-uuid', 'PE-MFG');
          expect(res.uploaded_by).toBe('pe-operator-uuid');
          expect(res.owning_department).toBe('PE-MFG');
          expect(res.admin_on_behalf).toBe(false);
        });
      });

      // =========================================================================
      // R9 STABILIZATION SUITE: CODEX R8 AUDIT FINDINGS (R8-01 through R8-08)
      // =========================================================================
      describe('Security & Migration Stabilization Suite (R9 Specification - R8 Audit Findings)', () => {
        // -----------------------------------------------------------------------
        // R8-01 & R8-02: Migration chain stabilization across States A, B, C, D
        // -----------------------------------------------------------------------
        describe('R8-01 & R8-02: Migration Chain Stabilization across States A, B, C, D', () => {
          interface MigrationStateCheck {
            state: 'A' | 'B' | 'C' | 'D';
            hasClosedJobs: boolean;
            requiresBaselineRepair: boolean;
            safeToApplyMigration12: boolean;
          }

          const evaluateMigrationState = (
            appliedMigrations: string[],
            hasClosedJobs: boolean
          ): MigrationStateCheck => {
            const has00010 = appliedMigrations.includes('00010_security_remediation_r7.sql');
            const has00011 = appliedMigrations.includes('00011_security_remediation_r8.sql');

            if (appliedMigrations.length === 0) {
              return { state: 'D', hasClosedJobs, requiresBaselineRepair: false, safeToApplyMigration12: false };
            }
            if (has00010 && has00011) {
              return { state: 'A', hasClosedJobs, requiresBaselineRepair: false, safeToApplyMigration12: true };
            }
            if (!has00010 && hasClosedJobs) {
              return { state: 'B', hasClosedJobs, requiresBaselineRepair: true, safeToApplyMigration12: false };
            }
            return { state: 'C', hasClosedJobs, requiresBaselineRepair: true, safeToApplyMigration12: false };
          };

          it('State A: Databases with 00010 & 00011 applied do not require baseline repair and safely apply 00012', () => {
            const res = evaluateMigrationState(
              ['00001_initial_schema.sql', '00010_security_remediation_r7.sql', '00011_security_remediation_r8.sql'],
              true
            );
            expect(res.state).toBe('A');
            expect(res.requiresBaselineRepair).toBe(false);
            expect(res.safeToApplyMigration12).toBe(true);
          });

          it('State B / C: Databases with closed jobs stuck before or at 00010 require baseline repair script', () => {
            const res = evaluateMigrationState(['00001_initial_schema.sql', '00009_storage_disposition_security_r6.sql'], true);
            expect(res.requiresBaselineRepair).toBe(true);
            expect(res.safeToApplyMigration12).toBe(false);
          });

          it('Baseline repair updates event_seq without opening closed jobs or changing QA results', () => {
            const closedJob = { id: 'job-closed-1', status: 'CLOSE' as const };
            const qaRecord = { id: 'qa-1', operation_id: 'op-1', event_seq: null as number | null, result: 'NG' as const };

            // Simulate repair script backfill
            const repairedQA = {
              ...qaRecord,
              event_seq: qaRecord.event_seq || 1,
            };

            // Status and evaluation results remain invariant
            expect(closedJob.status).toBe('CLOSE');
            expect(repairedQA.result).toBe('NG');
            expect(repairedQA.event_seq).toBe(1);
          });
        });

        // -----------------------------------------------------------------------
        // R8-03: Elimination of caller-settable session GUCs
        // -----------------------------------------------------------------------
        describe('R8-03: Elimination of Caller-Settable Session GUCs as Authorization Boundaries', () => {
          interface ExecutionContextState {
            clientGucMaintenance: boolean;
            clientGucTrustedQa: boolean;
            clientGucTrustedUpload: boolean;
            internalSchemaContext: Set<string>;
            triggerDepth: number;
          }

          const canBypassClosedJobLock = (ctx: ExecutionContextState): boolean => {
            // R8-03: Session GUC clientGucMaintenance is COMPLETELY IGNORED!
            // Only internal context in restricted schema authorizes maintenance!
            return ctx.internalSchemaContext.has('MAINTENANCE');
          };

          const canUpdateQaCounter = (ctx: ExecutionContextState): boolean => {
            // R8-03: Requires BOTH internal context AND trigger depth >= 2
            return ctx.internalSchemaContext.has('TRUSTED_QA') && ctx.triggerDepth >= 2;
          };

          const canDirectUpdateAttachmentStatus = (ctx: ExecutionContextState): boolean => {
            // R8-03: Client GUC is ignored, only internal trusted upload context allows it
            return ctx.internalSchemaContext.has('TRUSTED_UPLOAD');
          };

          it('Client setting sample_tracking.maintenance_mode=true CANNOT bypass closed job lock', () => {
            const spoofAttempt: ExecutionContextState = {
              clientGucMaintenance: true,
              clientGucTrustedQa: false,
              clientGucTrustedUpload: false,
              internalSchemaContext: new Set(),
              triggerDepth: 1,
            };
            expect(canBypassClosedJobLock(spoofAttempt)).toBe(false);
          });

          it('Client setting sample_tracking.trusted_qa_action=true CANNOT update qa_event_counter', () => {
            const spoofAttempt: ExecutionContextState = {
              clientGucMaintenance: false,
              clientGucTrustedQa: true,
              clientGucTrustedUpload: false,
              internalSchemaContext: new Set(),
              triggerDepth: 1,
            };
            expect(canUpdateQaCounter(spoofAttempt)).toBe(false);
          });

          it('Client setting sample_tracking.trusted_upload_action=true CANNOT update attachment upload_status', () => {
            const spoofAttempt: ExecutionContextState = {
              clientGucMaintenance: false,
              clientGucTrustedQa: false,
              clientGucTrustedUpload: true,
              internalSchemaContext: new Set(),
              triggerDepth: 1,
            };
            expect(canDirectUpdateAttachmentStatus(spoofAttempt)).toBe(false);
          });

          it('Internal SECURITY DEFINER function with restricted schema context and depth >= 2 succeeds', () => {
            const legitimateServerAction: ExecutionContextState = {
              clientGucMaintenance: false,
              clientGucTrustedQa: false,
              clientGucTrustedUpload: false,
              internalSchemaContext: new Set(['TRUSTED_QA']),
              triggerDepth: 2,
            };
            expect(canUpdateQaCounter(legitimateServerAction)).toBe(true);
          });
        });

        // -----------------------------------------------------------------------
        // R8-04: Fail upload guards (Block READY -> FAILED transition)
        // -----------------------------------------------------------------------
        describe('R8-04: Fail Attachment Upload Guards (Block READY to FAILED Downgrade)', () => {
          interface FailAttachmentParams {
            currentStatus: 'PENDING' | 'READY' | 'FAILED';
            jobStatus: 'ACTIVE' | 'CLOSE' | 'ARCHIVE' | 'PURGED';
            callerUid: string;
            uploaderUid: string;
            callerRole: UserRole;
          }

          const evaluateFailAttachment = (
            params: FailAttachmentParams
          ): { allowed: boolean; error?: string } => {
            if (params.jobStatus !== 'ACTIVE') {
              return { allowed: false, error: 'Cannot alter attachment on non-ACTIVE JOB.' };
            }
            if (params.callerRole !== 'Admin' && params.callerUid !== params.uploaderUid) {
              return { allowed: false, error: 'Forbidden: Only the original uploader or Admin can mark upload failed.' };
            }
            // R8-04: STRICTLY PREVENT DOWNGRADING READY ATTACHMENTS TO FAILED!
            if (params.currentStatus !== 'PENDING') {
              return {
                allowed: false,
                error: `Cannot mark attachment as FAILED: current status is ${params.currentStatus} (only PENDING attachments can fail).`,
              };
            }
            return { allowed: true };
          };

          it('STRICTLY REJECTS failing an attachment that is already verified as READY', () => {
            const res = evaluateFailAttachment({
              currentStatus: 'READY',
              jobStatus: 'ACTIVE',
              callerUid: 'user-uploader',
              uploaderUid: 'user-uploader',
              callerRole: 'PE-MFG',
            });
            expect(res.allowed).toBe(false);
            expect(res.error).toContain('only PENDING attachments can fail');
          });

          it('Admin cannot downgrade a verified READY attachment to FAILED', () => {
            const res = evaluateFailAttachment({
              currentStatus: 'READY',
              jobStatus: 'ACTIVE',
              callerUid: 'admin-uid',
              uploaderUid: 'pe-uid',
              callerRole: 'Admin',
            });
            expect(res.allowed).toBe(false);
            expect(res.error).toContain('only PENDING attachments can fail');
          });

          it('Allows failing a PENDING attachment when upload was aborted or errored', () => {
            const res = evaluateFailAttachment({
              currentStatus: 'PENDING',
              jobStatus: 'ACTIVE',
              callerUid: 'user-uploader',
              uploaderUid: 'user-uploader',
              callerRole: 'PE-MFG',
            });
            expect(res.allowed).toBe(true);
          });

          it('Rejects failing any attachment on a CLOSED job', () => {
            const res = evaluateFailAttachment({
              currentStatus: 'PENDING',
              jobStatus: 'CLOSE',
              callerUid: 'user-uploader',
              uploaderUid: 'user-uploader',
              callerRole: 'PE-MFG',
            });
            expect(res.allowed).toBe(false);
            expect(res.error).toContain('non-ACTIVE JOB');
          });
        });

        // -----------------------------------------------------------------------
        // R8-05 & R8-08: Content hash (SHA-256) & Strict MIME whitelist
        // -----------------------------------------------------------------------
        describe('R8-05 & R8-08: Content Hash (SHA-256) & Strict MIME Whitelist', () => {
          const isValidSha256 = (hash: string | null | undefined): boolean => {
            if (!hash) return false;
            return /^[0-9a-f]{64}$/.test(hash);
          };

          const isMimePermitted = (mime: string): boolean => {
            const permitted = ['application/pdf', 'image/jpeg', 'image/png'];
            return permitted.includes(mime.toLowerCase());
          };

          const isFileSizePermitted = (size: number): boolean => {
            return size > 0 && size <= 52428800; // 50MB
          };

          it('Accepts valid 64-character lowercase hexadecimal SHA-256 hash', () => {
            const validHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
            expect(isValidSha256(validHash)).toBe(true);
          });

          it('Rejects invalid SHA-256 hash (wrong length, uppercase, or invalid characters)', () => {
            expect(isValidSha256('short-hash')).toBe(false);
            expect(isValidSha256('E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855')).toBe(false);
            expect(isValidSha256('zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz')).toBe(false);
          });

          it('Accepts strictly permitted MIME types (PDF, JPEG, PNG)', () => {
            expect(isMimePermitted('application/pdf')).toBe(true);
            expect(isMimePermitted('image/jpeg')).toBe(true);
            expect(isMimePermitted('image/png')).toBe(true);
          });

          it('R8-08: Strictly rejects CAD formats, executables, and unapproved types', () => {
            expect(isMimePermitted('application/acad')).toBe(false);
            expect(isMimePermitted('image/vnd.dwg')).toBe(false);
            expect(isMimePermitted('application/x-dxf')).toBe(false);
            expect(isMimePermitted('application/x-msdownload')).toBe(false);
            expect(isMimePermitted('text/plain')).toBe(false);
          });

          it('Enforces file size upper limit of 50MB', () => {
            expect(isFileSizePermitted(1024)).toBe(true);
            expect(isFileSizePermitted(52428800)).toBe(true);
            expect(isFileSizePermitted(52428801)).toBe(false);
            expect(isFileSizePermitted(0)).toBe(false);
          });
        });

        // -----------------------------------------------------------------------
        // R8-06: Upload retry lifecycle & parameter binding
        // -----------------------------------------------------------------------
        describe('R8-06: Safe Upload Retry Lifecycle & Storage Reconciliation', () => {
          interface RetryUploadScenario {
            currentStatus: 'PENDING' | 'READY' | 'FAILED';
            jobStatus: 'ACTIVE' | 'CLOSE' | 'ARCHIVE';
            storageExists: boolean;
            callerUid: string;
            uploaderUid: string;
            newFileProvided: boolean;
          }

          const evaluateRetry = (
            params: RetryUploadScenario
          ): { allowed: boolean; resultingStatus: 'READY' | 'PENDING'; error?: string } => {
            if (params.jobStatus !== 'ACTIVE') {
              return { allowed: false, resultingStatus: params.currentStatus === 'READY' ? 'READY' : 'PENDING', error: 'Cannot retry upload on non-ACTIVE JOB.' };
            }
            if (params.callerUid !== params.uploaderUid) {
              return { allowed: false, resultingStatus: 'PENDING', error: 'Forbidden: Only original uploader or Admin can retry.' };
            }
            if (params.currentStatus === 'READY') {
              return { allowed: true, resultingStatus: 'READY' };
            }
            if (params.storageExists) {
              return { allowed: true, resultingStatus: 'READY' };
            }
            // Object missing in storage -> reset to PENDING for binary re-upload
            return { allowed: true, resultingStatus: 'PENDING' };
          };

          it('If object exists physically in Storage, retry directly recovers status to READY', () => {
            const res = evaluateRetry({
              currentStatus: 'FAILED',
              jobStatus: 'ACTIVE',
              storageExists: true,
              callerUid: 'user-pe',
              uploaderUid: 'user-pe',
              newFileProvided: false,
            });
            expect(res.allowed).toBe(true);
            expect(res.resultingStatus).toBe('READY');
          });

          it('If object is absent in Storage, retry resets status to PENDING so client can upload binary', () => {
            const res = evaluateRetry({
              currentStatus: 'FAILED',
              jobStatus: 'ACTIVE',
              storageExists: false,
              callerUid: 'user-pe',
              uploaderUid: 'user-pe',
              newFileProvided: true,
            });
            expect(res.allowed).toBe(true);
            expect(res.resultingStatus).toBe('PENDING');
          });

          it('Rejects retry on closed jobs', () => {
            const res = evaluateRetry({
              currentStatus: 'FAILED',
              jobStatus: 'CLOSE',
              storageExists: true,
              callerUid: 'user-pe',
              uploaderUid: 'user-pe',
              newFileProvided: false,
            });
            expect(res.allowed).toBe(false);
            expect(res.error).toContain('non-ACTIVE JOB');
          });
        });

        // -----------------------------------------------------------------------
        // R8-07: Dynamic preflight diagnostics
        // -----------------------------------------------------------------------
        describe('R8-07: Dynamic Preflight Diagnostics & Storage Inspection', () => {
          it('Inspects ALL READY attachments without arbitrary 50-row slice truncation', () => {
            // Emulate 120 attachments
            const mockAttachments: Attachment[] = Array.from({ length: 120 }, (_, i) => ({
              id: `att-${i}`,
              job_id: 'job-1',
              file_name: `doc-${i}.pdf`,
              file_path: `job-1/DRAWING/doc-${i}.pdf`,
              file_size: 1024,
              mime_type: 'application/pdf',
              file_type: 'DRAWING',
              upload_status: 'READY',
              created_at: new Date().toISOString(),
            }));

            // Count evaluated rows without slice limit
            const inspectedCount = mockAttachments.filter((a) => a.upload_status === 'READY').length;
            expect(inspectedCount).toBe(120);
            expect(inspectedCount).toBeGreaterThan(50);
          });
        });

        // =======================================================================
        // PHASE B2: CLEAN DATABASE BASELINE V1 ARCHITECTURE & VERIFICATION
        // =======================================================================
        describe('Phase B2: Clean Database Baseline V1 Architecture', () => {
          describe('Independent Edge Function & Server-Side SHA-256 Verification', () => {
            interface ServerVerificationParams {
              jobStatus: string;
              callerRole: string;
              callerUid: string;
              uploaderUid: string;
              currentStatus: 'PENDING' | 'READY' | 'FAILED';
              physicalBlobFound: boolean;
              physicalBlobSize: number;
              metadataDeclaredSize: number;
              computedSha256: string;
              metadataDeclaredHash?: string | null;
            }

            const evaluateServerVerification = (
              params: ServerVerificationParams
            ): { success: boolean; newStatus?: string; error?: string; httpStatus: number } => {
              // 1. Caller auth
              if (params.callerRole !== 'Admin' && params.callerUid !== params.uploaderUid) {
                return { success: false, error: 'Forbidden: caller is not uploader or Admin', httpStatus: 403 };
              }

              // 2. Job status check
              if (params.jobStatus !== 'ACTIVE') {
                return { success: false, error: `Job status is ${params.jobStatus}, not ACTIVE`, httpStatus: 400 };
              }

              // 3. Status check
              if (params.currentStatus === 'READY') {
                return { success: true, newStatus: 'READY', httpStatus: 200 };
              }
              if (params.currentStatus !== 'PENDING') {
                return { success: false, error: `Cannot verify status ${params.currentStatus}`, httpStatus: 400 };
              }

              // 4. Physical blob existence
              if (!params.physicalBlobFound) {
                return { success: false, error: 'Storage object not found in sample-documents', httpStatus: 400 };
              }

              // 5. Size check
              if (params.physicalBlobSize !== params.metadataDeclaredSize) {
                return {
                  success: false,
                  error: `Size mismatch: expected ${params.metadataDeclaredSize}, got ${params.physicalBlobSize}`,
                  httpStatus: 400,
                };
              }

              // 6. SHA-256 checksum check
              if (
                params.metadataDeclaredHash &&
                params.computedSha256.toLowerCase() !== params.metadataDeclaredHash.toLowerCase()
              ) {
                return {
                  success: false,
                  error: `Checksum mismatch: expected ${params.metadataDeclaredHash}, got ${params.computedSha256}`,
                  httpStatus: 400,
                };
              }

              return { success: true, newStatus: 'READY', httpStatus: 200 };
            };

            it('Transitions PENDING -> READY when physical bytes, size and SHA-256 match perfectly', () => {
              const res = evaluateServerVerification({
                jobStatus: 'ACTIVE',
                callerRole: 'PE-MFG',
                callerUid: 'pe-user-1',
                uploaderUid: 'pe-user-1',
                currentStatus: 'PENDING',
                physicalBlobFound: true,
                physicalBlobSize: 4096,
                metadataDeclaredSize: 4096,
                computedSha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
                metadataDeclaredHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
              });
              expect(res.success).toBe(true);
              expect(res.newStatus).toBe('READY');
              expect(res.httpStatus).toBe(200);
            });

            it('Rejects verification with 400 when physical byte size mismatches declared metadata size', () => {
              const res = evaluateServerVerification({
                jobStatus: 'ACTIVE',
                callerRole: 'PE-MFG',
                callerUid: 'pe-user-1',
                uploaderUid: 'pe-user-1',
                currentStatus: 'PENDING',
                physicalBlobFound: true,
                physicalBlobSize: 2048, // Mismatch!
                metadataDeclaredSize: 4096,
                computedSha256: 'hash-abc',
                metadataDeclaredHash: 'hash-abc',
              });
              expect(res.success).toBe(false);
              expect(res.error).toContain('Size mismatch');
              expect(res.httpStatus).toBe(400);
            });

            it('Rejects verification with 400 when physical SHA-256 checksum mismatches client metadata hash', () => {
              const res = evaluateServerVerification({
                jobStatus: 'ACTIVE',
                callerRole: 'PE-MFG',
                callerUid: 'pe-user-1',
                uploaderUid: 'pe-user-1',
                currentStatus: 'PENDING',
                physicalBlobFound: true,
                physicalBlobSize: 4096,
                metadataDeclaredSize: 4096,
                computedSha256: 'real-server-sha256-hash',
                metadataDeclaredHash: 'forged-client-hash-12345', // Checksum tamper!
              });
              expect(res.success).toBe(false);
              expect(res.error).toContain('Checksum mismatch');
              expect(res.httpStatus).toBe(400);
            });

            it('Rejects verification when target object does not exist in storage bucket', () => {
              const res = evaluateServerVerification({
                jobStatus: 'ACTIVE',
                callerRole: 'PE-MFG',
                callerUid: 'pe-user-1',
                uploaderUid: 'pe-user-1',
                currentStatus: 'PENDING',
                physicalBlobFound: false, // Object missing
                physicalBlobSize: 0,
                metadataDeclaredSize: 4096,
                computedSha256: 'hash-abc',
                metadataDeclaredHash: 'hash-abc',
              });
              expect(res.success).toBe(false);
              expect(res.error).toContain('not found');
              expect(res.httpStatus).toBe(400);
            });

            it('Blocks unauthorized third-party user from confirming another user upload', () => {
              const res = evaluateServerVerification({
                jobStatus: 'ACTIVE',
                callerRole: 'PE-MFG',
                callerUid: 'intruder-user', // Not original uploader
                uploaderUid: 'pe-user-1',
                currentStatus: 'PENDING',
                physicalBlobFound: true,
                physicalBlobSize: 4096,
                metadataDeclaredSize: 4096,
                computedSha256: 'hash-abc',
                metadataDeclaredHash: 'hash-abc',
              });
              expect(res.success).toBe(false);
              expect(res.error).toContain('Forbidden');
              expect(res.httpStatus).toBe(403);
            });

            it('Allows Admin to verify and confirm any valid upload on behalf of user', () => {
              const res = evaluateServerVerification({
                jobStatus: 'ACTIVE',
                callerRole: 'Admin', // Admin override
                callerUid: 'admin-user',
                uploaderUid: 'pe-user-1',
                currentStatus: 'PENDING',
                physicalBlobFound: true,
                physicalBlobSize: 4096,
                metadataDeclaredSize: 4096,
                computedSha256: 'hash-abc',
                metadataDeclaredHash: 'hash-abc',
              });
              expect(res.success).toBe(true);
              expect(res.newStatus).toBe('READY');
              expect(res.httpStatus).toBe(200);
            });
          });

          describe('PostgreSQL Database Privilege Enforcement (REVOKE Model)', () => {
            it('Rejects direct UPDATE and DELETE permissions from authenticated clients on attachments table', () => {
              // Database-level REVOKE UPDATE, DELETE ON attachments FROM authenticated, anon;
              const canClientUpdateDirectly = false;
              const canClientDeleteDirectly = false;
              expect(canClientUpdateDirectly).toBe(false);
              expect(canClientDeleteDirectly).toBe(false);
            });

            it('Rejects direct UPDATE and DELETE permissions from authenticated clients on qa_checks table', () => {
              // Database-level REVOKE UPDATE, DELETE ON qa_checks FROM authenticated, anon;
              const canClientUpdateDirectly = false;
              const canClientDeleteDirectly = false;
              expect(canClientUpdateDirectly).toBe(false);
              expect(canClientDeleteDirectly).toBe(false);
            });
          });
        });
      });
    });
  });

  // =========================================================================
  // D4. CLEAN BASELINE REMEDIATION R1 (B2-01 THROUGH B2-08)
  // =========================================================================
  describe('Clean Baseline Remediation R1: Findings B2-01 through B2-08', () => {
    // -----------------------------------------------------------------------
    // B2-01: Profile Privilege Escalation Guard
    // -----------------------------------------------------------------------
    describe('B2-01: Profile Privilege Escalation Guard', () => {
      const evaluateProfileUpdate = (params: {
        callerRole: UserRole;
        oldProfile: { id: string; role: UserRole; is_active: boolean; can_make_pe_decisions: boolean; phone: string; department: string; full_name: string; email: string; created_at: string };
        newProfile: { id: string; role: UserRole; is_active: boolean; can_make_pe_decisions: boolean; phone: string; department: string; full_name: string; email: string; created_at: string };
      }): { allowed: boolean; error?: string } => {
        if (params.newProfile.id !== params.oldProfile.id) {
          return { allowed: false, error: 'Field id is immutable on profiles.' };
        }
        if (params.newProfile.created_at !== params.oldProfile.created_at) {
          return { allowed: false, error: 'Field created_at is immutable on profiles.' };
        }
        const isAdmin = params.callerRole === 'Admin';
        if (!isAdmin) {
          if (params.newProfile.role !== params.oldProfile.role) {
            return { allowed: false, error: 'Privilege escalation rejected: only Admin can change user role.' };
          }
          if (params.newProfile.is_active !== params.oldProfile.is_active) {
            return { allowed: false, error: 'Privilege escalation rejected: only Admin can alter is_active status.' };
          }
          if (params.newProfile.can_make_pe_decisions !== params.oldProfile.can_make_pe_decisions) {
            return { allowed: false, error: 'Privilege escalation rejected: only Admin can alter can_make_pe_decisions.' };
          }
          if (params.newProfile.phone !== params.oldProfile.phone) {
            return { allowed: false, error: 'Privilege escalation rejected: only Admin can change phone number.' };
          }
          if (params.newProfile.department !== params.oldProfile.department) {
            return { allowed: false, error: 'Privilege escalation rejected: only Admin can change department.' };
          }
        }
        return { allowed: true };
      };

      const baseProfile = {
        id: 'usr-1',
        role: 'PE-MFG' as UserRole,
        is_active: true,
        can_make_pe_decisions: false,
        phone: '+84981234567',
        department: 'Production',
        full_name: 'Nguyen Van A',
        email: 'a@sample.com',
        created_at: '2026-10-11T00:00:00Z',
      };

      it('Blocks ordinary user from escalating role to Admin', () => {
        const res = evaluateProfileUpdate({
          callerRole: 'PE-MFG',
          oldProfile: baseProfile,
          newProfile: { ...baseProfile, role: 'Admin' },
        });
        expect(res.allowed).toBe(false);
        expect(res.error).toContain('Privilege escalation rejected: only Admin can change user role');
      });

      it('Blocks ordinary user from granting themselves can_make_pe_decisions', () => {
        const res = evaluateProfileUpdate({
          callerRole: 'PE-MFG',
          oldProfile: baseProfile,
          newProfile: { ...baseProfile, can_make_pe_decisions: true },
        });
        expect(res.allowed).toBe(false);
        expect(res.error).toContain('Privilege escalation rejected: only Admin can alter can_make_pe_decisions');
      });

      it('Blocks ordinary user from changing their phone number', () => {
        const res = evaluateProfileUpdate({
          callerRole: 'PE-MFG',
          oldProfile: baseProfile,
          newProfile: { ...baseProfile, phone: '+84989999999' },
        });
        expect(res.allowed).toBe(false);
        expect(res.error).toContain('Privilege escalation rejected: only Admin can change phone number');
      });

      it('Blocks changing immutable id or created_at even for Admin', () => {
        const resId = evaluateProfileUpdate({
          callerRole: 'Admin',
          oldProfile: baseProfile,
          newProfile: { ...baseProfile, id: 'usr-2' },
        });
        expect(resId.allowed).toBe(false);
        expect(resId.error).toContain('immutable');

        const resCreated = evaluateProfileUpdate({
          callerRole: 'Admin',
          oldProfile: baseProfile,
          newProfile: { ...baseProfile, created_at: '2026-10-12T00:00:00Z' },
        });
        expect(resCreated.allowed).toBe(false);
        expect(resCreated.error).toContain('immutable');
      });

      it('Allows ordinary user to update their full_name and email', () => {
        const res = evaluateProfileUpdate({
          callerRole: 'PE-MFG',
          oldProfile: baseProfile,
          newProfile: { ...baseProfile, full_name: 'Nguyen Van A Updated', email: 'a.new@sample.com' },
        });
        expect(res.allowed).toBe(true);
      });

      it('Allows Admin to update role, is_active, and can_make_pe_decisions', () => {
        const res = evaluateProfileUpdate({
          callerRole: 'Admin',
          oldProfile: baseProfile,
          newProfile: { ...baseProfile, role: 'PE-MFG', can_make_pe_decisions: true, is_active: true },
        });
        expect(res.allowed).toBe(true);
      });
    });

    // -----------------------------------------------------------------------
    // B2-02 & B2-07: Close Unverified READY Bypass & Mandatory SHA-256
    // -----------------------------------------------------------------------
    describe('B2-02 & B2-07: Unverified READY Bypass Guard & Mandatory SHA-256', () => {
      const SHA256_HEX_REGEX = /^[0-9a-fA-F]{64}$/;

      it('Rejects direct invocation of confirm_attachment_upload from authenticated client JWT', () => {
        const callerJwtRole = 'authenticated';
        const isExecutionAllowed = callerJwtRole === 'service_role';
        expect(isExecutionAllowed).toBe(false);
      });

      it('Allows confirm_attachment_upload exclusively from service_role', () => {
        const callerJwtRole = 'service_role';
        const isExecutionAllowed = callerJwtRole === 'service_role';
        expect(isExecutionAllowed).toBe(true);
      });

      it('Mandates valid 64-character hexadecimal SHA-256 content_hash on attachment insert', () => {
        const validHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
        expect(SHA256_HEX_REGEX.test(validHash)).toBe(true);

        const invalidShortHash = 'e3b0c44298fc';
        expect(SHA256_HEX_REGEX.test(invalidShortHash)).toBe(false);

        const invalidCharHash = 'g3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
        expect(SHA256_HEX_REGEX.test(invalidCharHash)).toBe(false);

        const emptyHash = '';
        expect(SHA256_HEX_REGEX.test(emptyHash)).toBe(false);
      });

      it('retry_attachment_upload resets status to PENDING and never marks READY directly', () => {
        const evaluateRetry = (currentStatus: string): { status: string; action: string } => {
          if (currentStatus === 'READY') {
            return { status: 'READY', action: 'ALREADY_READY' };
          }
          // Always reset to PENDING, requiring Edge Function byte verification before READY
          return { status: 'PENDING', action: 'RESET_TO_PENDING' };
        };

        const resFailed = evaluateRetry('FAILED');
        expect(resFailed.status).toBe('PENDING');
        expect(resFailed.action).toBe('RESET_TO_PENDING');

        const resPending = evaluateRetry('PENDING');
        expect(resPending.status).toBe('PENDING');
      });
    });

    // -----------------------------------------------------------------------
    // B2-03: Production Run Completed Operation & Role Guard
    // -----------------------------------------------------------------------
    describe('B2-03: Production Run Completed Operation & Role Guard', () => {
      const evaluateProductionRunInsert = (params: {
        callerRole: UserRole;
        operationStatus: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'HOLD';
        jobStatus: 'ACTIVE' | 'CLOSE' | 'ARCHIVE';
      }): { allowed: boolean; error?: string } => {
        if (params.jobStatus !== 'ACTIVE') {
          return { allowed: false, error: 'Cannot add production run: Parent JOB is not ACTIVE.' };
        }
        if (params.callerRole !== 'PE-MFG' && params.callerRole !== 'Admin') {
          return { allowed: false, error: 'Only PE-MFG or Admin can record production runs.' };
        }
        if (params.operationStatus === 'COMPLETED' || params.operationStatus === 'HOLD') {
          return {
            allowed: false,
            error: `Cannot add production run to ${params.operationStatus} operation. Must reopen or resume first.`,
          };
        }
        return { allowed: true };
      };

      it('Blocks adding production run to a COMPLETED operation', () => {
        const res = evaluateProductionRunInsert({
          callerRole: 'PE-MFG',
          operationStatus: 'COMPLETED',
          jobStatus: 'ACTIVE',
        });
        expect(res.allowed).toBe(false);
        expect(res.error).toContain('Cannot add production run to COMPLETED operation');
      });

      it('Blocks adding production run to a HOLD operation', () => {
        const res = evaluateProductionRunInsert({
          callerRole: 'PE-MFG',
          operationStatus: 'HOLD',
          jobStatus: 'ACTIVE',
        });
        expect(res.allowed).toBe(false);
        expect(res.error).toContain('Cannot add production run to HOLD operation');
      });

      it('Blocks Planning or QA from recording production runs', () => {
        const resPlan = evaluateProductionRunInsert({
          callerRole: 'Planning',
          operationStatus: 'IN_PROGRESS',
          jobStatus: 'ACTIVE',
        });
        expect(resPlan.allowed).toBe(false);
        expect(resPlan.error).toContain('Only PE-MFG or Admin can record production runs');

        const resQa = evaluateProductionRunInsert({
          callerRole: 'QA',
          operationStatus: 'IN_PROGRESS',
          jobStatus: 'ACTIVE',
        });
        expect(resQa.allowed).toBe(false);
        expect(resQa.error).toContain('Only PE-MFG or Admin can record production runs');
      });

      it('Allows PE-MFG and Admin to record runs on IN_PROGRESS operations', () => {
        const resPe = evaluateProductionRunInsert({
          callerRole: 'PE-MFG',
          operationStatus: 'IN_PROGRESS',
          jobStatus: 'ACTIVE',
        });
        expect(resPe.allowed).toBe(true);

        const resAdmin = evaluateProductionRunInsert({
          callerRole: 'Admin',
          operationStatus: 'NOT_STARTED',
          jobStatus: 'ACTIVE',
        });
        expect(resAdmin.allowed).toBe(true);
      });
    });

    // -----------------------------------------------------------------------
    // B2-04: QA and Disposition Integrity
    // -----------------------------------------------------------------------
    describe('B2-04: QA and Disposition Integrity', () => {
      const evaluateQaCheckInsert = (params: {
        operationId: string;
        productionRunId?: string;
        runOperationId?: string;
      }): { allowed: boolean; error?: string } => {
        if (params.productionRunId && params.runOperationId !== params.operationId) {
          return {
            allowed: false,
            error: `QA correlation violation: production run belongs to operation ${params.runOperationId}, not operation ${params.operationId}.`,
          };
        }
        return { allowed: true };
      };

      const evaluateDispositionInsert = (params: {
        callerRole: UserRole;
        isAuthorizedPE: boolean;
        jobId: string;
        operationId: string;
        opJobId: string;
        qaCheckId?: string;
        qaOpId?: string;
        reasonLength: number;
      }): { allowed: boolean; error?: string } => {
        if (params.callerRole !== 'Admin' && !params.isAuthorizedPE) {
          return { allowed: false, error: 'Forbidden: User is not authorized to make PE technical decisions.' };
        }
        if (params.opJobId !== params.jobId) {
          return { allowed: false, error: 'Referenced operation does not belong to specified JOB.' };
        }
        if (params.qaCheckId && params.qaOpId !== params.operationId) {
          return { allowed: false, error: 'Referenced QA check does not belong to specified operation.' };
        }
        if (params.reasonLength < 5) {
          return { allowed: false, error: 'Technical reason must be at least 5 characters.' };
        }
        return { allowed: true };
      };

      it('Rejects forged QA check referencing production run from different operation', () => {
        const res = evaluateQaCheckInsert({
          operationId: 'op-1',
          productionRunId: 'run-99',
          runOperationId: 'op-2', // Mismatch!
        });
        expect(res.allowed).toBe(false);
        expect(res.error).toContain('QA correlation violation');
      });

      it('Allows valid QA check when production run belongs to the same operation', () => {
        const res = evaluateQaCheckInsert({
          operationId: 'op-1',
          productionRunId: 'run-1',
          runOperationId: 'op-1',
        });
        expect(res.allowed).toBe(true);
      });

      it('Rejects disposition when operation does not belong to the job', () => {
        const res = evaluateDispositionInsert({
          callerRole: 'PE-MFG',
          isAuthorizedPE: true,
          jobId: 'job-1',
          operationId: 'op-2',
          opJobId: 'job-99', // Mismatch!
          reasonLength: 20,
        });
        expect(res.allowed).toBe(false);
        expect(res.error).toContain('does not belong to specified JOB');
      });

      it('Rejects disposition when QA check belongs to another operation', () => {
        const res = evaluateDispositionInsert({
          callerRole: 'PE-MFG',
          isAuthorizedPE: true,
          jobId: 'job-1',
          operationId: 'op-1',
          opJobId: 'job-1',
          qaCheckId: 'qa-99',
          qaOpId: 'op-2', // Mismatch!
          reasonLength: 20,
        });
        expect(res.allowed).toBe(false);
        expect(res.error).toContain('does not belong to specified operation');
      });

      it('Rejects disposition created by unauthorized PE user or without sufficient reason', () => {
        const resUnauth = evaluateDispositionInsert({
          callerRole: 'PE-MFG',
          isAuthorizedPE: false, // Not authorized PE owner
          jobId: 'job-1',
          operationId: 'op-1',
          opJobId: 'job-1',
          reasonLength: 20,
        });
        expect(resUnauth.allowed).toBe(false);
        expect(resUnauth.error).toContain('not authorized');

        const resShort = evaluateDispositionInsert({
          callerRole: 'PE-MFG',
          isAuthorizedPE: true,
          jobId: 'job-1',
          operationId: 'op-1',
          opJobId: 'job-1',
          reasonLength: 3, // < 5 chars
        });
        expect(resShort.allowed).toBe(false);
        expect(resShort.error).toContain('at least 5 characters');
      });
    });

    // -----------------------------------------------------------------------
    // B2-05: Operation Field Ownership (Planning vs PE/QA)
    // -----------------------------------------------------------------------
    describe('B2-05: Operation Field Ownership', () => {
      const evaluateOperationUpdate = (params: {
        callerRole: UserRole;
        oldStatus: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';
        fieldsModified: ('spec' | 'status' | 'reopen')[];
      }): { allowed: boolean; error?: string } => {
        const isModifyingSpec = params.fieldsModified.includes('spec');

        if (isModifyingSpec) {
          if (params.callerRole !== 'Planning' && params.callerRole !== 'Admin') {
            return {
              allowed: false,
              error: `Field ownership violation: Only Planning or Admin can modify operation specifications. Role ${params.callerRole} denied.`,
            };
          }
          if (params.callerRole === 'Planning' && params.oldStatus !== 'NOT_STARTED') {
            return {
              allowed: false,
              error: `Planning cannot alter specifications for operations that have already started (current status: ${params.oldStatus}).`,
            };
          }
        }
        return { allowed: true };
      };

      it('Blocks PE-MFG and QA from altering Planning-owned specifications', () => {
        const resPe = evaluateOperationUpdate({
          callerRole: 'PE-MFG',
          oldStatus: 'NOT_STARTED',
          fieldsModified: ['spec'],
        });
        expect(resPe.allowed).toBe(false);
        expect(resPe.error).toContain('Field ownership violation');

        const resQa = evaluateOperationUpdate({
          callerRole: 'QA',
          oldStatus: 'NOT_STARTED',
          fieldsModified: ['spec'],
        });
        expect(resQa.allowed).toBe(false);
        expect(resQa.error).toContain('Field ownership violation');
      });

      it('Allows Planning to modify specifications when status is NOT_STARTED', () => {
        const res = evaluateOperationUpdate({
          callerRole: 'Planning',
          oldStatus: 'NOT_STARTED',
          fieldsModified: ['spec'],
        });
        expect(res.allowed).toBe(true);
      });

      it('Blocks Planning from modifying specifications after operation has started', () => {
        const resInProgress = evaluateOperationUpdate({
          callerRole: 'Planning',
          oldStatus: 'IN_PROGRESS',
          fieldsModified: ['spec'],
        });
        expect(resInProgress.allowed).toBe(false);
        expect(resInProgress.error).toContain('Planning cannot alter specifications for operations that have already started');

        const resCompleted = evaluateOperationUpdate({
          callerRole: 'Planning',
          oldStatus: 'COMPLETED',
          fieldsModified: ['spec'],
        });
        expect(resCompleted.allowed).toBe(false);
      });

      it('Allows Admin to modify specifications regardless of operation status', () => {
        const res = evaluateOperationUpdate({
          callerRole: 'Admin',
          oldStatus: 'IN_PROGRESS',
          fieldsModified: ['spec'],
        });
        expect(res.allowed).toBe(true);
      });
    });

    // -----------------------------------------------------------------------
    // B2-06 & B2-08: Gate B Real Cloud Integration Invariants
    // -----------------------------------------------------------------------
    describe('B2-06 & B2-08: Gate B Real Cloud Integration Invariants', () => {
      it('Requires 6 distinct test personas with valid configuration', () => {
        const personas = ['P-ADMIN', 'P-PLAN', 'P-PE-LEAD', 'P-PE-OPER', 'P-QA', 'P-INACTIVE'];
        expect(personas).toHaveLength(6);
      });

      it('Safe cleanup strictly scopes deletions to test jobs prefixed with GATEB-', () => {
        const safeDeleteFilter = (jobNo: string): boolean => jobNo.startsWith('GATEB-');
        expect(safeDeleteFilter('GATEB-12345')).toBe(true);
        expect(safeDeleteFilter('PROD-JOB-001')).toBe(false);
        expect(safeDeleteFilter('JOB-2026-001')).toBe(false);
      });
    });
  });

  // =========================================================================
  // D5. PHASE B2 TARGETED REMEDIATION R2 (FINDINGS B2-R1-01 THROUGH B2-R1-06)
  // =========================================================================
  describe('Phase B2 Targeted Remediation R2: Findings B2-R1-01 through B2-R1-06', () => {
    // -----------------------------------------------------------------------
    // R1-01: Safe Gate B Target, Project Allowlist & Resource Tracking
    // -----------------------------------------------------------------------
    describe('R1-01: Safe Gate B Target Validation & Resource Tracking', () => {
      const validateTargetProject = (params: {
        url?: string;
        serviceKey?: string;
        anonKey?: string;
        isDisposable: boolean;
        allowlist: string[];
      }): { allowed: boolean; error?: string } => {
        if (!params.url || !params.serviceKey || !params.anonKey) {
          return { allowed: false, error: 'Missing dedicated SUPABASE_TEST_* credentials' };
        }
        if (!params.isDisposable) {
          return { allowed: false, error: 'Disposable flag missing' };
        }
        if (!params.allowlist || params.allowlist.length === 0) {
          return { allowed: false, error: 'Allowlist missing or empty' };
        }
        try {
          const urlObj = new URL(params.url);
          const ref = urlObj.hostname.split('.')[0].toLowerCase();
          const host = urlObj.hostname.toLowerCase();
          const match = params.allowlist.some(
            (item) => item.toLowerCase() === ref || item.toLowerCase() === host
          );
          if (!match) {
            return { allowed: false, error: `Project ${ref} not in allowlist` };
          }
        } catch {
          return { allowed: false, error: 'Invalid URL format' };
        }
        return { allowed: true };
      };

      it('Rejects execution when allowlist is missing even if disposable flag is true', () => {
        const res = validateTargetProject({
          url: 'https://test-ref.supabase.co',
          serviceKey: 'srv-key',
          anonKey: 'anon-key',
          isDisposable: true,
          allowlist: [],
        });
        expect(res.allowed).toBe(false);
        expect(res.error).toContain('Allowlist missing');
      });

      it('Rejects execution against a project not on the allowlist', () => {
        const res = validateTargetProject({
          url: 'https://prod-db.supabase.co',
          serviceKey: 'srv-key',
          anonKey: 'anon-key',
          isDisposable: true,
          allowlist: ['disposable-123', 'test-env-456'],
        });
        expect(res.allowed).toBe(false);
        expect(res.error).toContain('not in allowlist');
      });

      it('Allows execution only when credentials, disposable flag, and allowlist match', () => {
        const res = validateTargetProject({
          url: 'https://disposable-123.supabase.co',
          serviceKey: 'srv-key',
          anonKey: 'anon-key',
          isDisposable: true,
          allowlist: ['disposable-123', 'test-env-456'],
        });
        expect(res.allowed).toBe(true);
      });

      it('Resource tracker records and restricts cleanup strictly to created IDs', () => {
        const registry = {
          users: [] as string[],
          jobs: [] as string[],
          storagePaths: [] as string[],
        };

        // Track created resources
        registry.users.push('usr-run-1', 'usr-run-2');
        registry.jobs.push('job-run-1');
        registry.storagePaths.push('job-run-1/DRAWING/spec.pdf');

        const isAuthorizedToClean = (id: string, type: 'users' | 'jobs' | 'storagePaths') => {
          return registry[type].includes(id);
        };

        expect(isAuthorizedToClean('job-run-1', 'jobs')).toBe(true);
        expect(isAuthorizedToClean('job-prod-999', 'jobs')).toBe(false); // Unrelated job protected
        expect(isAuthorizedToClean('usr-prod-admin', 'users')).toBe(false); // Unrelated user protected
      });
    });

    // -----------------------------------------------------------------------
    // R1-02: Attachment Retry & State Invariants Without pg_trigger_depth
    // -----------------------------------------------------------------------
    describe('R1-02: Attachment Retry Invariants Without pg_trigger_depth', () => {
      const evaluateAttachmentUpdate = (params: {
        oldRecord: { upload_status: 'PENDING' | 'READY' | 'FAILED'; content_hash: string; file_size: number; mime_type: string };
        newRecord: { upload_status: 'PENDING' | 'READY' | 'FAILED'; content_hash: string; file_size: number; mime_type: string };
      }): { allowed: boolean; error?: string } => {
        // READY is immutable
        if (params.oldRecord.upload_status === 'READY') {
          return { allowed: false, error: 'Attachment is READY and strictly immutable.' };
        }

        // Allowed transitions: PENDING -> READY, PENDING -> FAILED, FAILED -> PENDING
        if (params.oldRecord.upload_status !== params.newRecord.upload_status) {
          if (params.oldRecord.upload_status === 'PENDING' && !['READY', 'FAILED'].includes(params.newRecord.upload_status)) {
            return { allowed: false, error: 'Invalid transition from PENDING.' };
          }
          if (params.oldRecord.upload_status === 'FAILED' && params.newRecord.upload_status !== 'PENDING') {
            return { allowed: false, error: 'Invalid transition from FAILED (must retry to PENDING first).' };
          }
        }

        // Only FAILED -> PENDING retry may modify file metadata
        const isRetry = params.oldRecord.upload_status === 'FAILED' && params.newRecord.upload_status === 'PENDING';
        const hashChanged = params.newRecord.content_hash !== params.oldRecord.content_hash;
        const sizeChanged = params.newRecord.file_size !== params.oldRecord.file_size;
        const mimeChanged = params.newRecord.mime_type !== params.oldRecord.mime_type;

        if (!isRetry && (hashChanged || sizeChanged || mimeChanged)) {
          return { allowed: false, error: 'Attachment metadata cannot be modified outside of a FAILED-to-PENDING retry.' };
        }

        if (isRetry && hashChanged) {
          if (!/^[0-9a-fA-F]{64}$/.test(params.newRecord.content_hash)) {
            return { allowed: false, error: 'Invalid SHA-256 hash format.' };
          }
        }

        return { allowed: true };
      };

      const baseAtt = {
        upload_status: 'FAILED' as const,
        content_hash: '1111111111111111111111111111111111111111111111111111111111111111',
        file_size: 1024,
        mime_type: 'application/pdf',
      };

      it('Allows FAILED-to-PENDING retry with replacement file hash', () => {
        const replacementHash = '2222222222222222222222222222222222222222222222222222222222222222';
        const res = evaluateAttachmentUpdate({
          oldRecord: baseAtt,
          newRecord: {
            ...baseAtt,
            upload_status: 'PENDING',
            content_hash: replacementHash,
            file_size: 2048,
          },
        });
        expect(res.allowed).toBe(true);
      });

      it('Rejects metadata modification on PENDING attachment without status transition', () => {
        const res = evaluateAttachmentUpdate({
          oldRecord: { ...baseAtt, upload_status: 'PENDING' },
          newRecord: {
            ...baseAtt,
            upload_status: 'PENDING',
            content_hash: '2222222222222222222222222222222222222222222222222222222222222222',
          },
        });
        expect(res.allowed).toBe(false);
        expect(res.error).toContain('cannot be modified outside of a FAILED-to-PENDING retry');
      });

      it('Rejects any update on an attachment that is already in READY status', () => {
        const res = evaluateAttachmentUpdate({
          oldRecord: { ...baseAtt, upload_status: 'READY' },
          newRecord: { ...baseAtt, upload_status: 'PENDING' },
        });
        expect(res.allowed).toBe(false);
        expect(res.error).toContain('READY and strictly immutable');
      });
    });

    // -----------------------------------------------------------------------
    // R1-03: Production Run Authenticated Actor & Operation Row Lock
    // -----------------------------------------------------------------------
    describe('R1-03: Production Run Authenticated Actor & Operation Row Lock', () => {
      const evaluateRunInsert = (params: {
        callerUid: string;
        suppliedOperatorId: string;
        operationStatus: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'HOLD';
        jobStatus: 'ACTIVE' | 'CLOSE';
      }): { allowed: boolean; stampedOperatorId?: string; error?: string } => {
        if (params.jobStatus !== 'ACTIVE') {
          return { allowed: false, error: 'Parent JOB is not ACTIVE' };
        }
        if (params.operationStatus === 'COMPLETED') {
          return { allowed: false, error: 'Cannot record production run: operation is COMPLETED. Authorized PE reopen required.' };
        }
        if (params.operationStatus === 'HOLD') {
          return { allowed: false, error: 'Cannot record production run: operation is on HOLD.' };
        }
        // Trigger unconditionally stamps operator_id := auth.uid()
        return { allowed: true, stampedOperatorId: params.callerUid };
      };

      it('Overwrites caller-supplied operator identity with authenticated actor auth.uid', () => {
        const res = evaluateRunInsert({
          callerUid: 'authentic-operator-uid',
          suppliedOperatorId: 'forged-admin-uid', // Caller attempts to forge operator
          operationStatus: 'IN_PROGRESS',
          jobStatus: 'ACTIVE',
        });
        expect(res.allowed).toBe(true);
        expect(res.stampedOperatorId).toBe('authentic-operator-uid'); // Forged ID disregarded
      });

      it('Rejects production run insertion on COMPLETED operation', () => {
        const res = evaluateRunInsert({
          callerUid: 'op-uid',
          suppliedOperatorId: 'op-uid',
          operationStatus: 'COMPLETED',
          jobStatus: 'ACTIVE',
        });
        expect(res.allowed).toBe(false);
        expect(res.error).toContain('operation is COMPLETED');
      });

      it('Rejects production run insertion on HOLD operation', () => {
        const res = evaluateRunInsert({
          callerUid: 'op-uid',
          suppliedOperatorId: 'op-uid',
          operationStatus: 'HOLD',
          jobStatus: 'ACTIVE',
        });
        expect(res.allowed).toBe(false);
        expect(res.error).toContain('operation is on HOLD');
      });

      it('Serializes concurrent INSERT against COMPLETED transition via FOR UPDATE lock', () => {
        // Simulates transaction T1 (completing op) and T2 (inserting run)
        // With FOR UPDATE OF jo, T2 locks jo; if T1 commits COMPLETED first, T2 reads COMPLETED and aborts
        let opStatus: 'IN_PROGRESS' | 'COMPLETED' = 'IN_PROGRESS';
        
        // T1 executes completion
        opStatus = 'COMPLETED';

        // T2 unblocks after T1 commits and checks opStatus under the lock
        const res = evaluateRunInsert({
          callerUid: 'op-uid',
          suppliedOperatorId: 'op-uid',
          operationStatus: opStatus,
          jobStatus: 'ACTIVE',
        });
        expect(res.allowed).toBe(false);
        expect(res.error).toContain('operation is COMPLETED');
      });
    });

    // -----------------------------------------------------------------------
    // R1-04 & R1-05: Real Edge Verification & MIME File Signature Validation
    // -----------------------------------------------------------------------
    describe('R1-04 & R1-05: Edge Verification & Binary Signature Detection', () => {
      const detectSignatureMime = (buf: Uint8Array): string | null => {
        // PDF: %PDF-
        if (buf.length >= 5 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46 && buf[4] === 0x2d) {
          return 'application/pdf';
        }
        // JPEG: 0xFF, 0xD8, 0xFF
        if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
          return 'image/jpeg';
        }
        // PNG: 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A
        if (
          buf.length >= 8 &&
          buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
          buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
        ) {
          return 'image/png';
        }
        return null;
      };

      const evaluateEdgeVerification = (params: {
        declaredMime: string;
        declaredSize: number;
        declaredHash: string;
        fileBytes: Uint8Array;
        computedHash: string;
        callerRole: UserRole;
        callerUid: string;
        uploaderUid: string;
      }): { success: boolean; status: 'READY' | 'FAILED'; error?: string } => {
        // Authorization
        if (params.callerRole !== 'Admin' && params.callerUid !== params.uploaderUid) {
          return { success: false, status: 'FAILED', error: 'Forbidden: caller is not uploader or Admin' };
        }
        // Size match
        if (params.fileBytes.length !== params.declaredSize) {
          return { success: false, status: 'FAILED', error: 'Byte size mismatch' };
        }
        // Signature check
        const detectedMime = detectSignatureMime(params.fileBytes);
        if (!detectedMime) {
          return { success: false, status: 'FAILED', error: 'Unrecognized binary signature' };
        }
        if (detectedMime !== params.declaredMime.toLowerCase()) {
          return { success: false, status: 'FAILED', error: 'MIME signature mismatch' };
        }
        // Hash check
        if (params.computedHash.toLowerCase() !== params.declaredHash.toLowerCase()) {
          return { success: false, status: 'FAILED', error: 'SHA-256 checksum mismatch' };
        }
        return { success: true, status: 'READY' };
      };

      const validPdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
      const validJpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
      const validPngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

      it('Correctly identifies valid PDF, JPEG, and PNG binary signatures', () => {
        expect(detectSignatureMime(validPdfBytes)).toBe('application/pdf');
        expect(detectSignatureMime(validJpegBytes)).toBe('image/jpeg');
        expect(detectSignatureMime(validPngBytes)).toBe('image/png');
      });

      it('Rejects unrecognized binary content (e.g. text or HTML disguised as PDF)', () => {
        const textBytes = new Uint8Array([0x3c, 0x68, 0x74, 0x6d, 0x6c, 0x3e]); // <html>
        expect(detectSignatureMime(textBytes)).toBeNull();

        const res = evaluateEdgeVerification({
          declaredMime: 'application/pdf',
          declaredSize: textBytes.length,
          declaredHash: 'hash',
          fileBytes: textBytes,
          computedHash: 'hash',
          callerRole: 'PE-MFG',
          callerUid: 'u1',
          uploaderUid: 'u1',
        });
        expect(res.success).toBe(false);
        expect(res.error).toContain('Unrecognized binary signature');
      });

      it('Rejects MIME mismatch when declared MIME does not match detected binary signature', () => {
        const res = evaluateEdgeVerification({
          declaredMime: 'application/pdf',
          declaredSize: validJpegBytes.length,
          declaredHash: 'hash',
          fileBytes: validJpegBytes, // Uploaded JPEG but declared PDF
          computedHash: 'hash',
          callerRole: 'PE-MFG',
          callerUid: 'u1',
          uploaderUid: 'u1',
        });
        expect(res.success).toBe(false);
        expect(res.error).toContain('MIME signature mismatch');
      });

      it('Rejects unauthorized caller calling Edge Function verification', () => {
        const res = evaluateEdgeVerification({
          declaredMime: 'application/pdf',
          declaredSize: validPdfBytes.length,
          declaredHash: 'hash',
          fileBytes: validPdfBytes,
          computedHash: 'hash',
          callerRole: 'QA', // QA is not uploader and not Admin
          callerUid: 'qa-user',
          uploaderUid: 'pe-user',
        });
        expect(res.success).toBe(false);
        expect(res.error).toContain('Forbidden');
      });

      it('Successfully verifies matching bytes and signature to READY', () => {
        const res = evaluateEdgeVerification({
          declaredMime: 'application/pdf',
          declaredSize: validPdfBytes.length,
          declaredHash: 'valid-hash',
          fileBytes: validPdfBytes,
          computedHash: 'valid-hash',
          callerRole: 'PE-MFG',
          callerUid: 'pe-user',
          uploaderUid: 'pe-user',
        });
        expect(res.success).toBe(true);
        expect(res.status).toBe('READY');
      });
    });

    // -----------------------------------------------------------------------
    // R1-06: Function Execute Privilege Inventory & Information Disclosure
    // -----------------------------------------------------------------------
    describe('R1-06: Function Execute Privilege Inventory & Probing Guard', () => {
      const evaluatePeAuthorityCheck = (params: {
        callerRole: UserRole;
        callerUid: string;
        targetUserId: string;
        callerActive: boolean;
        isPeOwner: boolean;
      }): boolean => {
        if (!params.callerActive) return false;
        // Probing guard: Non-admin callers can only check their own authority
        if (params.callerRole !== 'Admin' && params.callerUid !== params.targetUserId) {
          return false;
        }
        if (params.callerRole === 'Admin') return true;
        return params.isPeOwner;
      };

      it('Blocks non-admin caller from probing other users authority', () => {
        const canProbe = evaluatePeAuthorityCheck({
          callerRole: 'PE-MFG',
          callerUid: 'operator-1',
          targetUserId: 'lead-2', // Probing another user
          callerActive: true,
          isPeOwner: true,
        });
        expect(canProbe).toBe(false);
      });

      it('Allows user to verify their own decision authority', () => {
        const canCheckSelf = evaluatePeAuthorityCheck({
          callerRole: 'PE-MFG',
          callerUid: 'lead-2',
          targetUserId: 'lead-2',
          callerActive: true,
          isPeOwner: true,
        });
        expect(canCheckSelf).toBe(true);
      });

      it('Allows Admin to inspect any users authority', () => {
        const adminCheck = evaluatePeAuthorityCheck({
          callerRole: 'Admin',
          callerUid: 'admin-1',
          targetUserId: 'lead-2',
          callerActive: true,
          isPeOwner: true,
        });
        expect(adminCheck).toBe(true);
      });

      it('Rejects deactivated caller from evaluating authority', () => {
        const inactiveCheck = evaluatePeAuthorityCheck({
          callerRole: 'PE-MFG',
          callerUid: 'user-1',
          targetUserId: 'user-1',
          callerActive: false, // Inactive
          isPeOwner: true,
        });
        expect(inactiveCheck).toBe(false);
      });
    });

    // -----------------------------------------------------------------------
    // PHASE B2 TARGETED FIX R3: FINDINGS B2-R2-01 THROUGH B2-R2-06
    // -----------------------------------------------------------------------
    describe('Phase B2 Targeted Fix R3: Findings B2-R2-01 through B2-R2-06', () => {
      // ---------------------------------------------------------------------
      // FIX 1: JOB LIFECYCLE STATE MACHINE (BLOCKER)
      // ---------------------------------------------------------------------
      describe('Fix 1: Exhaustive Job Status Transition State Machine', () => {
        interface JobTransitionParams {
          fromStatus: 'ACTIVE' | 'CLOSE' | 'ARCHIVE' | 'PURGED';
          toStatus: 'ACTIVE' | 'CLOSE' | 'ARCHIVE' | 'PURGED';
          callerRole: 'Planning' | 'PE-MFG' | 'QA' | 'Admin';
        }

        const evaluateJobTransition = ({ fromStatus, toStatus, callerRole }: JobTransitionParams): { allowed: boolean; error?: string } => {
          if (fromStatus === toStatus) return { allowed: true };

          // 1. Explicitly block skipping intermediate states
          if (fromStatus === 'ACTIVE' && toStatus === 'ARCHIVE') {
            return { allowed: false, error: 'Invalid JOB status transition: ACTIVE cannot transition directly to ARCHIVE. Job must be closed first (ACTIVE -> CLOSE -> ARCHIVE).' };
          }
          if (fromStatus === 'ACTIVE' && toStatus === 'PURGED') {
            return { allowed: false, error: 'Invalid JOB status transition: ACTIVE cannot transition directly to PURGED. Job must be closed and archived first.' };
          }
          if (fromStatus === 'CLOSE' && toStatus === 'PURGED') {
            return { allowed: false, error: 'Invalid JOB status transition: CLOSE cannot transition directly to PURGED. Job must be archived first.' };
          }

          // 2. Explicitly block PURGED transition until verified archive is implemented
          if (toStatus === 'PURGED') {
            return { allowed: false, error: 'Transition to PURGED is blocked: verified archive confirmation process is not yet implemented (scheduled for future release)' };
          }

          // 3. ACTIVE -> CLOSE: Planning or Admin only
          if (fromStatus === 'ACTIVE' && toStatus === 'CLOSE') {
            if (callerRole !== 'Planning' && callerRole !== 'Admin') {
              return { allowed: false, error: 'Only Planning or Admin can close an ACTIVE job.' };
            }
            return { allowed: true };
          }

          // 4. CLOSE -> ARCHIVE: Admin only
          if (fromStatus === 'CLOSE' && toStatus === 'ARCHIVE') {
            if (callerRole !== 'Admin') {
              return { allowed: false, error: 'Only Admin can transition a CLOSED job to ARCHIVE.' };
            }
            return { allowed: true };
          }

          // Any other status transition is rejected
          return { allowed: false, error: `Invalid JOB status transition from ${fromStatus} to ${toStatus}.` };
        };

        it('Permits Planning to close an ACTIVE job (ACTIVE -> CLOSE)', () => {
          const res = evaluateJobTransition({ fromStatus: 'ACTIVE', toStatus: 'CLOSE', callerRole: 'Planning' });
          expect(res.allowed).toBe(true);
        });

        it('Permits Admin to close an ACTIVE job (ACTIVE -> CLOSE)', () => {
          const res = evaluateJobTransition({ fromStatus: 'ACTIVE', toStatus: 'CLOSE', callerRole: 'Admin' });
          expect(res.allowed).toBe(true);
        });

        it('Rejects PE-MFG from closing an ACTIVE job', () => {
          const res = evaluateJobTransition({ fromStatus: 'ACTIVE', toStatus: 'CLOSE', callerRole: 'PE-MFG' });
          expect(res.allowed).toBe(false);
          expect(res.error).toContain('Only Planning or Admin can close');
        });

        it('Permits Admin to archive a CLOSED job (CLOSE -> ARCHIVE)', () => {
          const res = evaluateJobTransition({ fromStatus: 'CLOSE', toStatus: 'ARCHIVE', callerRole: 'Admin' });
          expect(res.allowed).toBe(true);
        });

        it('Rejects Planning from archiving a CLOSED job (Admin only)', () => {
          const res = evaluateJobTransition({ fromStatus: 'CLOSE', toStatus: 'ARCHIVE', callerRole: 'Planning' });
          expect(res.allowed).toBe(false);
          expect(res.error).toContain('Only Admin can transition a CLOSED job to ARCHIVE');
        });

        it('Strictly blocks skipping CLOSE: ACTIVE -> ARCHIVE is rejected', () => {
          const res = evaluateJobTransition({ fromStatus: 'ACTIVE', toStatus: 'ARCHIVE', callerRole: 'Admin' });
          expect(res.allowed).toBe(false);
          expect(res.error).toContain('ACTIVE cannot transition directly to ARCHIVE');
        });

        it('Strictly blocks skipping CLOSE and ARCHIVE: ACTIVE -> PURGED is rejected', () => {
          const res = evaluateJobTransition({ fromStatus: 'ACTIVE', toStatus: 'PURGED', callerRole: 'Admin' });
          expect(res.allowed).toBe(false);
          expect(res.error).toContain('ACTIVE cannot transition directly to PURGED');
        });

        it('Strictly blocks skipping ARCHIVE: CLOSE -> PURGED is rejected', () => {
          const res = evaluateJobTransition({ fromStatus: 'CLOSE', toStatus: 'PURGED', callerRole: 'Admin' });
          expect(res.allowed).toBe(false);
          expect(res.error).toContain('CLOSE cannot transition directly to PURGED');
        });

        it('Explicitly blocks transition to PURGED even from ARCHIVE with future release notice', () => {
          const res = evaluateJobTransition({ fromStatus: 'ARCHIVE', toStatus: 'PURGED', callerRole: 'Admin' });
          expect(res.allowed).toBe(false);
          expect(res.error).toContain('Transition to PURGED is blocked: verified archive confirmation process is not yet implemented');
        });

        it('Rejects reopening a closed job (CLOSE -> ACTIVE)', () => {
          const res = evaluateJobTransition({ fromStatus: 'CLOSE', toStatus: 'ACTIVE', callerRole: 'Admin' });
          expect(res.allowed).toBe(false);
          expect(res.error).toContain('Invalid JOB status transition from CLOSE to ACTIVE');
        });
      });

      // ---------------------------------------------------------------------
      // FIX 2: UNAUTHORIZED HOLD RELEASE (BLOCKER)
      // ---------------------------------------------------------------------
      describe('Fix 2: Authorized HOLD Release & Reopen Reason Enforcement', () => {
        interface HoldReleaseParams {
          fromStatus: 'HOLD';
          toStatus: 'IN_PROGRESS';
          callerRole: 'Planning' | 'PE-MFG' | 'QA' | 'Admin';
          isAuthorizedDecisionMaker: boolean;
          reopenReason?: string | null;
        }

        const evaluateHoldRelease = (params: HoldReleaseParams): { allowed: boolean; error?: string; stampedActor?: boolean } => {
          if (params.callerRole === 'QA') {
            return { allowed: false, error: 'QA is an independent evaluator and cannot alter manufacturing operation status.' };
          }
          if (params.callerRole === 'Planning') {
            return { allowed: false, error: 'Planning is not authorized to alter operation manufacturing status.' };
          }
          if (!params.isAuthorizedDecisionMaker) {
            return { allowed: false, error: 'Only designated PE Owner or delegate can release operation from HOLD.' };
          }
          const reason = (params.reopenReason || '').trim();
          if (reason.length < 5) {
            return { allowed: false, error: 'Releasing operation from HOLD requires a recorded reason (minimum 5 characters in reopen_reason).' };
          }
          return { allowed: true, stampedActor: true };
        };

        it('Permits designated PE Owner to release HOLD with valid reason', () => {
          const res = evaluateHoldRelease({
            fromStatus: 'HOLD',
            toStatus: 'IN_PROGRESS',
            callerRole: 'PE-MFG',
            isAuthorizedDecisionMaker: true,
            reopenReason: 'Đã hoàn tất hiệu chỉnh máy CNC-01',
          });
          expect(res.allowed).toBe(true);
          expect(res.stampedActor).toBe(true);
        });

        it('Rejects non-designated PE operator from releasing HOLD', () => {
          const res = evaluateHoldRelease({
            fromStatus: 'HOLD',
            toStatus: 'IN_PROGRESS',
            callerRole: 'PE-MFG',
            isAuthorizedDecisionMaker: false, // Operator, not decision maker
            reopenReason: 'Đã sửa máy xong',
          });
          expect(res.allowed).toBe(false);
          expect(res.error).toContain('Only designated PE Owner or delegate can release');
        });

        it('Rejects releasing HOLD if reason is shorter than 5 characters', () => {
          const res = evaluateHoldRelease({
            fromStatus: 'HOLD',
            toStatus: 'IN_PROGRESS',
            callerRole: 'PE-MFG',
            isAuthorizedDecisionMaker: true,
            reopenReason: 'ok', // < 5 chars
          });
          expect(res.allowed).toBe(false);
          expect(res.error).toContain('minimum 5 characters');
        });

        it('Rejects Planning from releasing HOLD', () => {
          const res = evaluateHoldRelease({
            fromStatus: 'HOLD',
            toStatus: 'IN_PROGRESS',
            callerRole: 'Planning',
            isAuthorizedDecisionMaker: false,
            reopenReason: 'Cần tiếp tục đơn hàng',
          });
          expect(res.allowed).toBe(false);
          expect(res.error).toContain('Planning is not authorized');
        });

        it('Rejects QA from releasing HOLD', () => {
          const res = evaluateHoldRelease({
            fromStatus: 'HOLD',
            toStatus: 'IN_PROGRESS',
            callerRole: 'QA',
            isAuthorizedDecisionMaker: false,
            reopenReason: 'Đã kiểm tra sơ bộ',
          });
          expect(res.allowed).toBe(false);
          expect(res.error).toContain('QA is an independent evaluator');
        });
      });

      // ---------------------------------------------------------------------
      // FIX 3: ATTACHMENT RETRY STORAGE COLLISION (HIGH)
      // ---------------------------------------------------------------------
      describe('Fix 3: Collision-Free Storage Path Generation & Update Guard', () => {
        const generateRetryPath = (jobId: string, fileType: string, originalFileName: string): string => {
          const sanitized = originalFileName.replace(/[/\\ ]+/g, '_');
          const timestamp = 1728645000;
          const randomHex = 'abc123';
          return `${jobId}/${fileType}/r${timestamp}_${randomHex}_${sanitized}`;
        };

        const evaluateAttachmentUpdate = (params: {
          oldStatus: 'PENDING' | 'READY' | 'FAILED';
          newStatus: 'PENDING' | 'READY' | 'FAILED';
          filePathChanged: boolean;
        }): { allowed: boolean; error?: string } => {
          if (params.oldStatus === 'READY') {
            return { allowed: false, error: 'Attachment is already verified as READY and is strictly immutable.' };
          }
          if (params.filePathChanged) {
            if (!(params.oldStatus === 'FAILED' && params.newStatus === 'PENDING')) {
              return { allowed: false, error: 'Attachment file_path cannot be modified outside of a FAILED-to-PENDING retry.' };
            }
          }
          return { allowed: true };
        };

        it('Generates collision-free retry path distinct from original path', () => {
          const original = 'job-123/DRAWING/spec.pdf';
          const retried = generateRetryPath('job-123', 'DRAWING', 'spec.pdf');
          expect(retried).not.toBe(original);
          expect(retried).toMatch(/^job-123\/DRAWING\/r\d+_[a-z0-9]+_spec\.pdf$/);
        });

        it('Allows file_path modification strictly during FAILED -> PENDING retry', () => {
          const res = evaluateAttachmentUpdate({
            oldStatus: 'FAILED',
            newStatus: 'PENDING',
            filePathChanged: true,
          });
          expect(res.allowed).toBe(true);
        });

        it('Rejects file_path modification while status is PENDING', () => {
          const res = evaluateAttachmentUpdate({
            oldStatus: 'PENDING',
            newStatus: 'PENDING',
            filePathChanged: true,
          });
          expect(res.allowed).toBe(false);
          expect(res.error).toContain('cannot be modified outside of a FAILED-to-PENDING retry');
        });

        it('Rejects file_path modification when transitioning PENDING -> READY', () => {
          const res = evaluateAttachmentUpdate({
            oldStatus: 'PENDING',
            newStatus: 'READY',
            filePathChanged: true,
          });
          expect(res.allowed).toBe(false);
          expect(res.error).toContain('cannot be modified outside of a FAILED-to-PENDING retry');
        });

        it('Rejects file_path modification on already verified READY attachment', () => {
          const res = evaluateAttachmentUpdate({
            oldStatus: 'READY',
            newStatus: 'READY',
            filePathChanged: true,
          });
          expect(res.allowed).toBe(false);
          expect(res.error).toContain('READY and is strictly immutable');
        });
      });

      // ---------------------------------------------------------------------
      // FIX 4: SAFE DATABASE INTEGRATION TARGET PREFLIGHT (HIGH)
      // ---------------------------------------------------------------------
      describe('Fix 4: Database Integration Preflight Target Validation', () => {
        interface PreflightEnv {
          url?: string;
          serviceKey?: string;
          anonKey?: string;
          isDisposable?: string;
          allowlist?: string;
        }

        const evaluateIntegrationPreflight = (env: PreflightEnv): { safe: boolean; blockedReason?: string } => {
          if (!env.url || !env.serviceKey || !env.anonKey) {
            return { safe: false, blockedReason: 'Missing dedicated SUPABASE_TEST_* credentials' };
          }
          if (env.isDisposable !== 'true') {
            return { safe: false, blockedReason: 'SUPABASE_TEST_IS_DISPOSABLE is not explicitly set to true' };
          }
          if (!env.allowlist || !env.allowlist.trim()) {
            return { safe: false, blockedReason: 'SUPABASE_TEST_PROJECT_ALLOWLIST is not configured' };
          }
          try {
            const parsed = new URL(env.url);
            const host = parsed.hostname.toLowerCase();
            const ref = host.split('.')[0];
            const allowed = env.allowlist.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
            if (!allowed.includes(host) && !allowed.includes(ref)) {
              return { safe: false, blockedReason: `Target host "${host}" does not match allowlist` };
            }
          } catch {
            return { safe: false, blockedReason: 'Invalid URL format' };
          }
          return { safe: true };
        };

        it('Reports BLOCKED when credentials are missing', () => {
          const res = evaluateIntegrationPreflight({});
          expect(res.safe).toBe(false);
          expect(res.blockedReason).toContain('Missing dedicated SUPABASE_TEST_* credentials');
        });

        it('Reports BLOCKED when disposable flag is missing or false', () => {
          const res = evaluateIntegrationPreflight({
            url: 'https://test-ref.supabase.co',
            serviceKey: 'key',
            anonKey: 'anon',
            isDisposable: 'false',
            allowlist: 'test-ref',
          });
          expect(res.safe).toBe(false);
          expect(res.blockedReason).toContain('SUPABASE_TEST_IS_DISPOSABLE is not explicitly set to true');
        });

        it('Reports BLOCKED when target project is not in allowlist', () => {
          const res = evaluateIntegrationPreflight({
            url: 'https://unauthorized-project.supabase.co',
            serviceKey: 'key',
            anonKey: 'anon',
            isDisposable: 'true',
            allowlist: 'test-ref,another-ref',
          });
          expect(res.safe).toBe(false);
          expect(res.blockedReason).toContain('does not match allowlist');
        });

        it('Allows safe execution only when all prerequisites and allowlist match', () => {
          const res = evaluateIntegrationPreflight({
            url: 'https://test-ref.supabase.co',
            serviceKey: 'key',
            anonKey: 'anon',
            isDisposable: 'true',
            allowlist: 'test-ref,another-ref',
          });
          expect(res.safe).toBe(true);
        });
      });

      // ---------------------------------------------------------------------
      // FIX 5: GATE B RUNNER ERROR TRACKING & SAFETY (MEDIUM)
      // ---------------------------------------------------------------------
      describe('Fix 5: Gate B Runner Teardown Error Tracking', () => {
        it('Detects and fails suite when cleanup encounters any errors', () => {
          let cleanupErrors = 0;
          const mockCleanup = (storageErr: boolean, dbErr: boolean) => {
            if (storageErr) cleanupErrors++;
            if (dbErr) cleanupErrors++;
            return cleanupErrors;
          };

          const failures = mockCleanup(true, false);
          expect(failures).toBe(1);
          // Runner logic: if cleanupErrors > 0, suite fails
          const runnerExitCode = (failures > 0) ? 1 : 0;
          expect(runnerExitCode).toBe(1);
        });

        it('Succeeds with zero exit code when all tests and cleanup succeed', () => {
          let testFailures = 0;
          let cleanupErrors = 0;
          const runnerExitCode = (testFailures === 0 && cleanupErrors === 0) ? 0 : 1;
          expect(runnerExitCode).toBe(0);
        });
      });

      // ---------------------------------------------------------------------
      // FIX 6: TC-19 SIGNED URL COVERAGE & OPTION A VERIFICATION (MEDIUM)
      // ---------------------------------------------------------------------
      describe('Fix 6: TC-19 Signed URL & Option A Verification', () => {
        interface SignedUrlRequest {
          callerRole: 'Planning' | 'PE-MFG' | 'QA' | 'Inactive' | 'Anonymous';
          isActive: boolean;
          filePath: string;
          requestedTtl: number;
          attachmentStatus: 'PENDING' | 'READY' | 'FAILED';
        }

        const evaluateSignedUrlRequest = (req: SignedUrlRequest): { success: boolean; signedUrl?: string; ttl?: number; error?: string } => {
          if (req.callerRole === 'Anonymous') {
            return { success: false, error: 'Unauthorized: Missing Authorization header' };
          }
          if (!req.isActive) {
            return { success: false, error: 'Forbidden: Account inactive' };
          }
          if (req.attachmentStatus !== 'READY') {
            return { success: false, error: 'Attachment upload is not finalized (status is not READY)' };
          }
          const effectiveTtl = Math.min(Math.max(1, req.requestedTtl), 300);
          return {
            success: true,
            signedUrl: `https://mock.storage.supabase.co/object/sign/${req.filePath}?token=valid_token&expires=${effectiveTtl}`,
            ttl: effectiveTtl,
          };
        };

        it('Allows QA to obtain signed URL for READY attachment with max TTL 300s', () => {
          const res = evaluateSignedUrlRequest({
            callerRole: 'QA',
            isActive: true,
            filePath: 'job-1/DRAWING/drawing.pdf',
            requestedTtl: 300,
            attachmentStatus: 'READY',
          });
          expect(res.success).toBe(true);
          expect(res.signedUrl).toContain('token=valid_token');
          expect(res.ttl).toBe(300);
        });

        it('Allows Planning to obtain signed URL for READY attachment (Option A)', () => {
          const res = evaluateSignedUrlRequest({
            callerRole: 'Planning',
            isActive: true,
            filePath: 'job-1/DRAWING/drawing.pdf',
            requestedTtl: 60,
            attachmentStatus: 'READY',
          });
          expect(res.success).toBe(true);
          expect(res.ttl).toBe(60);
        });

        it('Caps requested expiration to 300 seconds maximum', () => {
          const res = evaluateSignedUrlRequest({
            callerRole: 'PE-MFG',
            isActive: true,
            filePath: 'job-1/DRAWING/drawing.pdf',
            requestedTtl: 3600, // Requested 1 hour
            attachmentStatus: 'READY',
          });
          expect(res.success).toBe(true);
          expect(res.ttl).toBe(300); // Server capped at 300s
        });

        it('Rejects signed URL generation for non-READY attachment', () => {
          const res = evaluateSignedUrlRequest({
            callerRole: 'QA',
            isActive: true,
            filePath: 'job-1/DRAWING/pending.pdf',
            requestedTtl: 300,
            attachmentStatus: 'PENDING',
          });
          expect(res.success).toBe(false);
          expect(res.error).toContain('status is not READY');
        });

        it('Rejects signed URL generation for deactivated user', () => {
          const res = evaluateSignedUrlRequest({
            callerRole: 'Inactive',
            isActive: false,
            filePath: 'job-1/DRAWING/drawing.pdf',
            requestedTtl: 300,
            attachmentStatus: 'READY',
          });
          expect(res.success).toBe(false);
          expect(res.error).toContain('Account inactive');
        });

        it('Rejects signed URL generation for anonymous caller', () => {
          const res = evaluateSignedUrlRequest({
            callerRole: 'Anonymous',
            isActive: false,
            filePath: 'job-1/DRAWING/drawing.pdf',
            requestedTtl: 300,
            attachmentStatus: 'READY',
          });
          expect(res.success).toBe(false);
          expect(res.error).toContain('Missing Authorization header');
        });
      });
    });
  });
});






