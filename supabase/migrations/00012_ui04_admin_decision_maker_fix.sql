-- ============================================================================
-- Migration: 00012_ui04_admin_decision_maker_fix.sql
-- Description: Allow Admin and service_role to have authorized PE decision maker
-- authority when updating operation status to COMPLETED or HOLD.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.is_authorized_pe_decision_maker(p_job_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_role public.user_role;
    v_is_active BOOLEAN;
    v_pe_owner UUID;
    v_delegates UUID[];
    v_caller_role public.user_role;
BEGIN
    -- Admin or service_role always has administrative override authority
    IF auth.role() = 'service_role' OR (session_user = 'postgres' AND auth.role() IS NULL) THEN
        RETURN TRUE;
    END IF;

    v_caller_role := public.get_current_user_role();
    IF v_caller_role = 'Admin' THEN
        RETURN TRUE;
    END IF;

    IF p_user_id IS NULL THEN
        RETURN FALSE;
    END IF;

    -- Information disclosure guard: Caller must be an active internal user
    IF NOT public.is_user_active() THEN
        RETURN FALSE;
    END IF;

    -- Non-admin callers can only check their own decision authority unless called from trigger
    IF v_caller_role != 'Admin' AND auth.uid() IS NOT NULL AND auth.uid() != p_user_id THEN
        RETURN FALSE;
    END IF;

    SELECT role, is_active INTO v_role, v_is_active
    FROM public.profiles
    WHERE id = p_user_id;

    IF v_is_active IS NOT TRUE THEN
        RETURN FALSE;
    END IF;

    -- Admin always has administrative override authority
    IF v_role = 'Admin' THEN
        RETURN TRUE;
    END IF;

    -- Non-PE users cannot make PE decisions
    IF v_role != 'PE-MFG' THEN
        RETURN FALSE;
    END IF;

    SELECT pe_owner_id, pe_delegates INTO v_pe_owner, v_delegates
    FROM public.jobs
    WHERE id = p_job_id;

    -- A. Designated PE Owner for the JOB
    IF v_pe_owner IS NOT NULL AND v_pe_owner = p_user_id THEN
        RETURN TRUE;
    END IF;

    -- B. Explicitly authorized delegate for the JOB
    IF v_delegates IS NOT NULL AND p_user_id = ANY(v_delegates) THEN
        RETURN TRUE;
    END IF;

    RETURN FALSE;
END;
$$;
