-- Migration 00044: User Active Device Slots (1 Desktop + 1 Mobile per Account)
-- Strict Enterprise Session Policy:
-- 1. Maximum 1 desktop/PC and 1 mobile device active per user account.
-- 2. New login on conflicting device slot is rejected with clear warning.
-- 3. Invariance: does not modify business data, does not invalidate existing logged-in sessions.

CREATE TABLE IF NOT EXISTS public.user_active_devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    device_type VARCHAR(10) NOT NULL CHECK (device_type IN ('desktop', 'mobile')),
    device_id VARCHAR(64) NOT NULL,
    device_name TEXT NOT NULL,
    user_agent TEXT,
    last_active_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_user_device_type UNIQUE (user_id, device_type)
);

CREATE INDEX IF NOT EXISTS idx_user_active_devices_lookup 
ON public.user_active_devices (user_id, device_id);

ALTER TABLE public.user_active_devices ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to view their own active devices
DROP POLICY IF EXISTS user_read_own_devices ON public.user_active_devices;
CREATE POLICY user_read_own_devices ON public.user_active_devices
    FOR SELECT TO authenticated
    USING (user_id = auth.uid());

-- RPC: check_and_register_device_session
CREATE OR REPLACE FUNCTION public.check_and_register_device_session(
    p_device_id TEXT,
    p_device_type TEXT,
    p_device_name TEXT,
    p_user_agent TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_type VARCHAR(10);
    v_existing RECORD;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    v_type := LOWER(TRIM(p_device_type));
    IF v_type NOT IN ('desktop', 'mobile') THEN
        v_type := 'desktop';
    END IF;

    -- Check if slot is occupied
    SELECT * INTO v_existing
    FROM public.user_active_devices
    WHERE user_id = v_user_id AND device_type = v_type;

    IF FOUND THEN
        -- Case A: Same device ID -> Allowed, update last active
        IF v_existing.device_id = p_device_id THEN
            UPDATE public.user_active_devices
            SET last_active_at = now(),
                device_name = COALESCE(NULLIF(p_device_name, ''), v_existing.device_name),
                user_agent = COALESCE(p_user_agent, v_existing.user_agent)
            WHERE id = v_existing.id;

            RETURN jsonb_build_object(
                'allowed', true,
                'reason', 'same_device',
                'device_type', v_type
            );
        ELSE
            -- Case B: Different device on same slot -> Conflict blocked!
            RETURN jsonb_build_object(
                'allowed', false,
                'reason', 'device_slot_conflict',
                'device_type', v_type,
                'conflicting_device', jsonb_build_object(
                    'device_name', v_existing.device_name,
                    'device_type', v_existing.device_type,
                    'last_active_at', v_existing.last_active_at,
                    'created_at', v_existing.created_at
                )
            );
        END IF;
    ELSE
        -- Case C: Slot is empty -> Claim slot
        INSERT INTO public.user_active_devices (
            user_id,
            device_type,
            device_id,
            device_name,
            user_agent,
            last_active_at,
            created_at
        ) VALUES (
            v_user_id,
            v_type,
            p_device_id,
            COALESCE(NULLIF(p_device_name, ''), CASE WHEN v_type = 'desktop' THEN 'Máy tính' ELSE 'Điện thoại' END),
            p_user_agent,
            now(),
            now()
        );

        RETURN jsonb_build_object(
            'allowed', true,
            'reason', 'slot_claimed',
            'device_type', v_type
        );
    END IF;
END;
$$;

-- RPC: verify_current_device_session (Used on focus / reload)
-- Guarantees smooth non-breaking migration for currently logged-in accounts
CREATE OR REPLACE FUNCTION public.verify_current_device_session(
    p_device_id TEXT,
    p_device_type TEXT,
    p_device_name TEXT DEFAULT NULL,
    p_user_agent TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_type VARCHAR(10);
    v_existing RECORD;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('valid', false, 'reason', 'unauthenticated');
    END IF;

    v_type := LOWER(TRIM(p_device_type));
    IF v_type NOT IN ('desktop', 'mobile') THEN
        v_type := 'desktop';
    END IF;

    SELECT * INTO v_existing
    FROM public.user_active_devices
    WHERE user_id = v_user_id AND device_type = v_type;

    IF FOUND THEN
        IF v_existing.device_id = p_device_id THEN
            UPDATE public.user_active_devices
            SET last_active_at = now()
            WHERE id = v_existing.id;
            RETURN jsonb_build_object('valid', true);
        ELSE
            -- Device slot is now held by a different device ID
            RETURN jsonb_build_object('valid', false, 'reason', 'device_replaced');
        END IF;
    ELSE
        -- Vacant slot (e.g. Existing session logged in before migration 00044)
        -- Auto-claim the slot smoothly without kicking out the user!
        INSERT INTO public.user_active_devices (
            user_id,
            device_type,
            device_id,
            device_name,
            user_agent,
            last_active_at,
            created_at
        ) VALUES (
            v_user_id,
            v_type,
            p_device_id,
            COALESCE(NULLIF(p_device_name, ''), CASE WHEN v_type = 'desktop' THEN 'Máy tính' ELSE 'Điện thoại' END),
            p_user_agent,
            now(),
            now()
        );
        RETURN jsonb_build_object('valid', true, 'reason', 'auto_claimed');
    END IF;
END;
$$;

-- RPC: release_device_session (Called on user logout)
CREATE OR REPLACE FUNCTION public.release_device_session(
    p_device_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'reason', 'unauthenticated');
    END IF;

    DELETE FROM public.user_active_devices
    WHERE user_id = v_user_id AND device_id = p_device_id;

    RETURN jsonb_build_object('success', true);
END;
$$;

-- RPC: admin_revoke_all_user_devices (Called by Admin or Edge Function)
CREATE OR REPLACE FUNCTION public.admin_revoke_all_user_devices(
    p_target_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_caller_role TEXT;
    v_count INT;
BEGIN
    v_caller_id := auth.uid();

    -- Allow if called via service_role or Admin caller
    IF v_caller_id IS NOT NULL THEN
        SELECT role INTO v_caller_role FROM public.profiles WHERE id = v_caller_id;
        IF v_caller_role != 'Admin' THEN
            RAISE EXCEPTION 'Chỉ Quản trị viên (Admin) mới có quyền thu hồi phiên thiết bị.';
        END IF;
    END IF;

    DELETE FROM public.user_active_devices
    WHERE user_id = p_target_user_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;

    RETURN jsonb_build_object('success', true, 'revoked_count', v_count);
END;
$$;
