-- ============================================================================
-- Migration: 00008_ui03_r3_auth_guard_fix.sql
-- Description: Enforce strict auth and role checking for allocate_next_job_code
-- using auth.role(), session_user, and revoking permissions from anon.
-- ============================================================================

-- 1. Redefine allocate_next_job_code with auth.role() aware authorization guard
CREATE OR REPLACE FUNCTION public.allocate_next_job_code(p_target_timestamp TIMESTAMPTZ DEFAULT NOW())
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_role public.user_role;
    v_year_month VARCHAR(6);
    v_allocated_seq INTEGER;
    v_candidate_code TEXT;
    v_seq_str TEXT;
BEGIN
    -- Authorization Guard: Only Planning, Admin, or service_role can allocate JOB codes
    IF auth.role() = 'service_role' OR (session_user = 'postgres' AND auth.role() IS NULL) THEN
        -- Authorized internal backend service_role or direct superuser
    ELSE
        -- Must be an active, authenticated account
        IF auth.role() != 'authenticated' OR auth.uid() IS NULL THEN
            RAISE EXCEPTION 'Chưa đăng nhập: Yêu cầu đăng nhập tài khoản Planning hoặc Admin.';
        END IF;

        IF public.is_user_active() IS NOT TRUE OR public.has_completed_password_change() IS NOT TRUE THEN
            RAISE EXCEPTION 'Tài khoản chưa được kích hoạt hoặc chưa hoàn tất đổi mật khẩu lần đầu.';
        END IF;

        v_role := public.get_current_user_role();
        IF v_role NOT IN ('Planning', 'Admin') THEN
            RAISE EXCEPTION 'Quyền hạn bị từ chối: Chỉ Planning hoặc Admin mới có quyền cấp mã JOB (vai trò hiện tại: %).', COALESCE(v_role::TEXT, 'không xác định');
        END IF;
    END IF;

    -- Determine year_month in Vietnam timezone Asia/Ho_Chi_Minh (+07)
    v_year_month := to_char(COALESCE(p_target_timestamp, NOW()) AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYYMM');

    -- Concurrency-Safe Atomic Upsert with row-lock & monotonic sequence allocation
    LOOP
        INSERT INTO public.job_code_sequences (year_month, last_seq, updated_at)
        VALUES (v_year_month, 1, NOW())
        ON CONFLICT (year_month)
        DO UPDATE SET
            last_seq = public.job_code_sequences.last_seq + 1,
            updated_at = NOW()
        RETURNING last_seq INTO v_allocated_seq;

        -- Format: YYYYMM-NNN (Pads to at least 3 digits when < 1000; for >= 1000 formats as YYYYMM-1000 without capping)
        IF v_allocated_seq < 1000 THEN
            v_seq_str := LPAD(v_allocated_seq::TEXT, 3, '0');
        ELSE
            v_seq_str := v_allocated_seq::TEXT;
        END IF;

        v_candidate_code := v_year_month || '-' || v_seq_str;

        -- Guarantee that allocated code never collides with any existing job (historical or closed)
        EXIT WHEN NOT EXISTS (
            SELECT 1 FROM public.jobs WHERE lower(trim(job_no)) = lower(v_candidate_code)
        );
    END LOOP;

    RETURN v_candidate_code;
END;
$$;

-- 2. Revoke execute on allocate_next_job_code from anon and public; grant only to authenticated and service_role
REVOKE ALL ON FUNCTION public.allocate_next_job_code(TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.allocate_next_job_code(TIMESTAMPTZ) FROM anon;
GRANT EXECUTE ON FUNCTION public.allocate_next_job_code(TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.allocate_next_job_code(TIMESTAMPTZ) TO service_role;

-- 3. Grant preview_next_job_code to authenticated, anon, and service_role (read-only preview calculation)
GRANT EXECUTE ON FUNCTION public.preview_next_job_code(TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.preview_next_job_code(TIMESTAMPTZ) TO anon;
GRANT EXECUTE ON FUNCTION public.preview_next_job_code(TIMESTAMPTZ) TO service_role;
