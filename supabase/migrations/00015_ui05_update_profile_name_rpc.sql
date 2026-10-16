-- ============================================================================
-- Migration: 00015_ui05_update_profile_name_rpc.sql
-- Description: Provide dedicated authenticated RPC to update user's display name
-- (full_name) safely in public.profiles.
-- Resolves UI-05 issue where client update of public.profiles previously included
-- updated_at, which violated column-level GRANT UPDATE (full_name, email).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.update_my_profile_name(
    p_full_name TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_uid UUID;
    v_trimmed TEXT;
    v_updated_name TEXT;
BEGIN
    -- 1. Authentication guard
    IF auth.role() = 'service_role' OR (session_user = 'postgres' AND auth.role() IS NULL) THEN
        v_uid := auth.uid();
        -- If called by service role with null uid, cannot determine target profile without explicit ID
        IF v_uid IS NULL THEN
            RAISE EXCEPTION 'Service role must execute in authenticated user context or pass user ID.';
        END IF;
    ELSE
        IF auth.role() != 'authenticated' OR auth.uid() IS NULL THEN
            RAISE EXCEPTION 'Chưa đăng nhập: Yêu cầu đăng nhập để cập nhật hồ sơ cá nhân.';
        END IF;

        IF public.is_user_active() IS NOT TRUE THEN
            RAISE EXCEPTION 'Tài khoản chưa được kích hoạt hoặc đã bị vô hiệu hóa.';
        END IF;

        v_uid := auth.uid();
    END IF;

    -- 2. Validate input
    v_trimmed := trim(p_full_name);
    IF v_trimmed IS NULL OR length(v_trimmed) = 0 THEN
        RAISE EXCEPTION 'Họ và tên không được để trống.';
    END IF;

    IF length(v_trimmed) > 255 THEN
        RAISE EXCEPTION 'Họ và tên không được vượt quá 255 ký tự.';
    END IF;

    -- 3. Update public.profiles
    UPDATE public.profiles
    SET full_name = v_trimmed,
        updated_at = NOW()
    WHERE id = v_uid
    RETURNING full_name INTO v_updated_name;

    IF v_updated_name IS NULL THEN
        RAISE EXCEPTION 'Không tìm thấy hồ sơ người dùng trong hệ thống (ID: %).', v_uid;
    END IF;

    -- 4. Return success payload
    RETURN jsonb_build_object(
        'success', true,
        'id', v_uid,
        'full_name', v_updated_name
    );
END;
$$;

-- Revoke from public & anon, grant to authenticated and service_role
REVOKE ALL ON FUNCTION public.update_my_profile_name(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_my_profile_name(TEXT) TO authenticated, service_role;
