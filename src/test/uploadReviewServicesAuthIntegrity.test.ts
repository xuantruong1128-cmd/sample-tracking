import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supabase } from '../lib/supabase';
import { uploadEngineeringDocument } from '../services/engineeringDocumentService';
import { uploadQADocument } from '../services/qaDocumentService';
import { uploadSamplePhoto } from '../services/samplePhotoService';
import { submitPeReview } from '../services/peReviewService';

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
    },
    from: vi.fn(),
    storage: {
      from: vi.fn().mockReturnValue({
        upload: vi.fn().mockResolvedValue({ error: null }),
        remove: vi.fn().mockResolvedValue({ error: null }),
      }),
    },
  },
}));

vi.mock('../lib/env', () => ({
  ENV: {
    IS_CONFIGURED: true,
  },
}));

describe('Item 4 Verification — Upload & Review Services Identity & Permission Integrity', () => {
  const mockUserId = 'user-auth-uuid-999';
  let insertSpy: any;
  let singleSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();

    (supabase.auth.getSession as any).mockResolvedValue({
      data: {
        session: {
          user: { id: mockUserId, phone: '0912345678', email: 'pe@company.com' },
        },
      },
    });

    singleSpy = vi.fn().mockResolvedValue({
      data: { id: 'created-record-id' },
      error: null,
    });

    insertSpy = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: singleSpy,
      }),
    });

    (supabase.from as any).mockReturnValue({
      insert: insertSpy,
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { full_name: 'Fallback Name', phone: '0912345678', role: 'PE-MFG' },
            error: null,
          }),
        }),
      }),
    });
  });

  it('1. uploadEngineeringDocument enforces uploaded_by strictly equals session.user.id', async () => {
    const dummyFile = new File(['content'], 'drawing.pdf', { type: 'application/pdf' });

    await uploadEngineeringDocument({
      jobId: 'job-1',
      category: 'Drawing',
      file: dummyFile,
      uploaderName: 'Custom Passed Name',
    });

    expect(insertSpy).toHaveBeenCalledTimes(1);
    const insertPayload = insertSpy.mock.calls[0][0];

    // uploaded_by MUST match authenticated session user id
    expect(insertPayload.uploaded_by).toBe(mockUserId);
    expect(insertPayload.uploader_name).toBe('Custom Passed Name');
  });

  it('2. uploadQADocument enforces uploaded_by strictly equals session.user.id', async () => {
    const dummyFile = new File(['content'], 'qa_report.pdf', { type: 'application/pdf' });

    await uploadQADocument({
      jobId: 'job-1',
      operationId: 'op-1',
      category: 'Inspection Report',
      file: dummyFile,
      uploaderName: 'QA Leader Name',
    });

    expect(insertSpy).toHaveBeenCalledTimes(1);
    const insertPayload = insertSpy.mock.calls[0][0];

    expect(insertPayload.uploaded_by).toBe(mockUserId);
    expect(insertPayload.uploader_name).toBe('QA Leader Name');
  });

  it('3. uploadSamplePhoto enforces uploaded_by strictly equals session.user.id', async () => {
    const dummyFile = new File(['img'], 'photo.jpg', { type: 'image/jpeg' });

    await uploadSamplePhoto({
      jobId: 'job-1',
      operationId: 'op-1',
      file: dummyFile,
      uploaderName: 'Photo Uploader',
    });

    expect(insertSpy).toHaveBeenCalledTimes(1);
    const insertPayload = insertSpy.mock.calls[0][0];

    expect(insertPayload.uploaded_by).toBe(mockUserId);
    expect(insertPayload.uploader_name).toBe('Photo Uploader');
  });

  it('4. submitPeReview enforces reviewed_by strictly equals session.user.id', async () => {
    await submitPeReview({
      jobId: 'job-1',
      operationId: 'op-1',
      reviewResult: 'OK',
      engineeringComment: 'Đạt yêu cầu kỹ thuật',
      reviewerName: 'PE Engineer Name',
      reviewerRole: 'PE-MFG',
    });

    expect(insertSpy).toHaveBeenCalledTimes(1);
    const insertPayload = insertSpy.mock.calls[0][0];

    expect(insertPayload.reviewed_by).toBe(mockUserId);
    expect(insertPayload.reviewer_name).toBe('PE Engineer Name');
    expect(insertPayload.reviewer_role).toBe('PE-MFG');
  });
});
