-- ============================================================================
-- Migration: 00033_drawing_review_module.sql
-- Description: Drawing Review Module V1.0 core schema, tables, triggers,
--              business RPCs, and Row Level Security policies.
-- Constraints:
--   - Does NOT modify existing Sample Tracking tables (jobs, job_operations, etc.).
--   - Does NOT rename or modify workcenter_master.
--   - SUBCON matched case-insensitively (UPPER(workcenter_code) = 'SUBCON').
--   - All business logic executed in Asia/Ho_Chi_Minh timezone.
--   - Immutability of Completed versions strictly enforced at trigger level.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. TRANSACTIONAL TABLES
-- ----------------------------------------------------------------------------

-- 1.1 Atomic Issue Number Sequence Table (format: YYMMDD-N001)
CREATE TABLE IF NOT EXISTS public.drawing_review_issue_sequences (
    date_key VARCHAR(6) PRIMARY KEY, -- 'YYMMDD' in Asia/Ho_Chi_Minh
    last_seq INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('Asia/Ho_Chi_Minh', now())
);

-- 1.2 Master Drawing Review Issues Table
CREATE TABLE IF NOT EXISTS public.drawing_review_issues (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    issue_no VARCHAR(20) NOT NULL UNIQUE, -- e.g. '261103-N001'
    item_no TEXT NOT NULL,
    item_name TEXT NOT NULL,
    customer TEXT NOT NULL,
    drawing_file_path TEXT NOT NULL,
    drawing_file_name TEXT NOT NULL,
    drawing_file_size BIGINT NOT NULL DEFAULT 0,
    drawing_mime_type TEXT NOT NULL,
    attention TEXT,
    created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('Asia/Ho_Chi_Minh', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('Asia/Ho_Chi_Minh', now())
);

CREATE INDEX IF NOT EXISTS idx_drawing_review_issues_no ON public.drawing_review_issues(issue_no);
CREATE INDEX IF NOT EXISTS idx_drawing_review_issues_customer ON public.drawing_review_issues(customer);
CREATE INDEX IF NOT EXISTS idx_drawing_review_issues_item_no ON public.drawing_review_issues(item_no);
CREATE INDEX IF NOT EXISTS idx_drawing_review_issues_created_at ON public.drawing_review_issues(created_at DESC);

-- 1.3 Review Versions Table
CREATE TABLE IF NOT EXISTS public.drawing_review_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    issue_id UUID NOT NULL REFERENCES public.drawing_review_issues(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL DEFAULT 1,
    version_name VARCHAR(10) NOT NULL DEFAULT 'V1',
    parent_version_id UUID REFERENCES public.drawing_review_versions(id) ON DELETE SET NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'Issued' CHECK (status IN ('Issued', 'Reviewing', 'Completed')),
    required_material TEXT,
    required_tooling TEXT,
    special_measuring_equipment TEXT,
    engineering_remarks TEXT,
    avatar_file_path TEXT,
    avatar_crop_box JSONB,
    closed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    closed_at TIMESTAMPTZ,
    created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('Asia/Ho_Chi_Minh', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('Asia/Ho_Chi_Minh', now()),
    CONSTRAINT uq_drawing_review_issue_version UNIQUE (issue_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_drawing_review_versions_issue ON public.drawing_review_versions(issue_id);
CREATE INDEX IF NOT EXISTS idx_drawing_review_versions_status ON public.drawing_review_versions(status);
CREATE INDEX IF NOT EXISTS idx_drawing_review_versions_num ON public.drawing_review_versions(issue_id, version_number);

-- 1.4 Routing Operations Table (with stable Lineage ID across versions)
CREATE TABLE IF NOT EXISTS public.drawing_review_operations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    version_id UUID NOT NULL REFERENCES public.drawing_review_versions(id) ON DELETE CASCADE,
    lineage_id UUID NOT NULL DEFAULT gen_random_uuid(),
    step_order INTEGER NOT NULL, -- 10, 20, 30, 40...
    workcenter_code VARCHAR(10) NOT NULL,
    operation_description TEXT, -- required if UPPER(workcenter_code) = 'SUBCON'
    cycle_time_seconds NUMERIC(10,2), -- sec/pc, must be >= 0 when provided
    remark TEXT,
    is_removed BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('Asia/Ho_Chi_Minh', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('Asia/Ho_Chi_Minh', now()),
    CONSTRAINT chk_drawing_op_ct_nonnegative CHECK (cycle_time_seconds IS NULL OR cycle_time_seconds >= 0)
);

CREATE INDEX IF NOT EXISTS idx_drawing_review_ops_version ON public.drawing_review_operations(version_id);
CREATE INDEX IF NOT EXISTS idx_drawing_review_ops_lineage ON public.drawing_review_operations(lineage_id);
CREATE INDEX IF NOT EXISTS idx_drawing_review_ops_order ON public.drawing_review_operations(version_id, step_order);

-- 1.5 Engineering Review Attachments Table
CREATE TABLE IF NOT EXISTS public.drawing_review_attachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    version_id UUID NOT NULL REFERENCES public.drawing_review_versions(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_size BIGINT NOT NULL DEFAULT 0,
    mime_type TEXT NOT NULL,
    caption TEXT,
    uploaded_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('Asia/Ho_Chi_Minh', now())
);

CREATE INDEX IF NOT EXISTS idx_drawing_review_attachments_ver ON public.drawing_review_attachments(version_id);

-- ----------------------------------------------------------------------------
-- 2. IMMUTABILITY TRIGGER GUARDS
-- ----------------------------------------------------------------------------

-- 2.1 Enforce Version Immutability on Completed Versions
CREATE OR REPLACE FUNCTION public.check_drawing_review_version_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.status = 'Completed' THEN
            RAISE EXCEPTION 'Phiên bản đánh giá kỹ thuật đã hoàn thành (Completed) là bất biến và không thể xóa.';
        END IF;
        RETURN OLD;
    END IF;

    -- Block updates to completed versions
    IF OLD.status = 'Completed' THEN
        RAISE EXCEPTION 'Phiên bản đánh giá kỹ thuật đã hoàn thành (Completed) là bất biến và không thể sửa đổi.';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_drawing_review_version_immutability ON public.drawing_review_versions;
CREATE TRIGGER trg_drawing_review_version_immutability
BEFORE UPDATE OR DELETE ON public.drawing_review_versions
FOR EACH ROW EXECUTE FUNCTION public.check_drawing_review_version_immutability();

-- 2.2 Enforce Operations Immutability when parent version is Completed
CREATE OR REPLACE FUNCTION public.check_drawing_review_operation_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_ver_status VARCHAR(20);
    v_target_version_id UUID;
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_target_version_id := OLD.version_id;
    ELSE
        v_target_version_id := NEW.version_id;
    END IF;

    SELECT status INTO v_ver_status
    FROM public.drawing_review_versions
    WHERE id = v_target_version_id;

    IF v_ver_status = 'Completed' THEN
        RAISE EXCEPTION 'Không thể thêm, sửa đổi hoặc xóa công đoạn của phiên bản đã hoàn thành (Completed).';
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_drawing_review_operation_immutability ON public.drawing_review_operations;
CREATE TRIGGER trg_drawing_review_operation_immutability
BEFORE INSERT OR UPDATE OR DELETE ON public.drawing_review_operations
FOR EACH ROW EXECUTE FUNCTION public.check_drawing_review_operation_immutability();

-- 2.3 Enforce Attachment Immutability when parent version is Completed
CREATE OR REPLACE FUNCTION public.check_drawing_review_attachment_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_ver_status VARCHAR(20);
    v_target_version_id UUID;
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_target_version_id := OLD.version_id;
    ELSE
        v_target_version_id := NEW.version_id;
    END IF;

    SELECT status INTO v_ver_status
    FROM public.drawing_review_versions
    WHERE id = v_target_version_id;

    IF v_ver_status = 'Completed' THEN
        RAISE EXCEPTION 'Không thể thêm hoặc xóa tệp đính kèm của phiên bản đã hoàn thành (Completed).';
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_drawing_review_attachment_immutability ON public.drawing_review_attachments;
CREATE TRIGGER trg_drawing_review_attachment_immutability
BEFORE INSERT OR UPDATE OR DELETE ON public.drawing_review_attachments
FOR EACH ROW EXECUTE FUNCTION public.check_drawing_review_attachment_immutability();

-- ----------------------------------------------------------------------------
-- 3. BUSINESS LOGIC RPCS (SECURITY DEFINER)
-- ----------------------------------------------------------------------------

-- 3.1 Allocate next atomic Issue Number in format YYMMDD-N001
CREATE OR REPLACE FUNCTION public.allocate_next_drawing_review_issue_no(p_target_timestamp TIMESTAMPTZ DEFAULT NOW())
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_role public.user_role;
    v_jwt_role TEXT;
    v_date_str VARCHAR(6);
    v_allocated_seq INTEGER;
    v_candidate_code TEXT;
    v_seq_str TEXT;
BEGIN
    -- Auth check: BD, Admin, or service_role
    v_jwt_role := COALESCE(current_setting('request.jwt.claim.role', true), '');
    IF v_jwt_role != 'service_role' AND session_user NOT IN ('postgres') THEN
        IF auth.uid() IS NULL THEN
            RAISE EXCEPTION 'Chưa đăng nhập: Vui lòng đăng nhập để thực hiện thao tác.';
        END IF;

        IF public.is_user_active() IS NOT TRUE OR public.has_completed_password_change() IS NOT TRUE THEN
            RAISE EXCEPTION 'Tài khoản chưa kích hoạt hoặc chưa đổi mật khẩu lần đầu.';
        END IF;

        v_role := public.get_current_user_role();
        IF v_role NOT IN ('BD', 'Admin') THEN
            RAISE EXCEPTION 'Quyền hạn bị từ chối: Chỉ vai trò BD hoặc Admin mới được tạo mã yêu cầu đánh giá bản vẽ.';
        END IF;
    END IF;

    -- Format YYMMDD in Asia/Ho_Chi_Minh (+07:00)
    v_date_str := to_char(COALESCE(p_target_timestamp, NOW()) AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYMMDD');

    LOOP
        INSERT INTO public.drawing_review_issue_sequences (date_key, last_seq, updated_at)
        VALUES (v_date_str, 1, timezone('Asia/Ho_Chi_Minh', NOW()))
        ON CONFLICT (date_key)
        DO UPDATE SET
            last_seq = public.drawing_review_issue_sequences.last_seq + 1,
            updated_at = timezone('Asia/Ho_Chi_Minh', NOW())
        RETURNING last_seq INTO v_allocated_seq;

        IF v_allocated_seq < 1000 THEN
            v_seq_str := 'N' || LPAD(v_allocated_seq::TEXT, 3, '0');
        ELSE
            v_seq_str := 'N' || v_allocated_seq::TEXT;
        END IF;

        v_candidate_code := v_date_str || '-' || v_seq_str;

        EXIT WHEN NOT EXISTS (
            SELECT 1 FROM public.drawing_review_issues WHERE issue_no = v_candidate_code
        );
    END LOOP;

    RETURN v_candidate_code;
END;
$$;

-- 3.2 Create Drawing Review Issue (BD creates Issue + initial V1 with status Issued)
CREATE OR REPLACE FUNCTION public.create_drawing_review_issue(
    p_item_no TEXT,
    p_item_name TEXT,
    p_customer TEXT,
    p_drawing_file_path TEXT,
    p_drawing_file_name TEXT,
    p_drawing_file_size BIGINT,
    p_drawing_mime_type TEXT,
    p_attention TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_uid UUID;
    v_role public.user_role;
    v_jwt_role TEXT;
    v_issue_no TEXT;
    v_issue_id UUID;
    v_version_id UUID;
BEGIN
    v_uid := auth.uid();
    v_jwt_role := COALESCE(current_setting('request.jwt.claim.role', true), '');
    IF v_jwt_role != 'service_role' AND session_user NOT IN ('postgres') THEN
        IF v_uid IS NULL THEN
            RAISE EXCEPTION 'Chưa đăng nhập: Vui lòng đăng nhập để thực hiện thao tác.';
        END IF;

        IF public.is_user_active() IS NOT TRUE OR public.has_completed_password_change() IS NOT TRUE THEN
            RAISE EXCEPTION 'Tài khoản chưa kích hoạt hoặc chưa đổi mật khẩu lần đầu.';
        END IF;

        v_role := public.get_current_user_role();
        IF v_role NOT IN ('BD', 'Admin') THEN
            RAISE EXCEPTION 'Quyền hạn bị từ chối: Chỉ vai trò BD hoặc Admin mới được tạo yêu cầu đánh giá bản vẽ.';
        END IF;
    END IF;

    -- Mandatory validations
    IF NULLIF(trim(p_item_no), '') IS NULL THEN
        RAISE EXCEPTION 'Mã bản vẽ/sản phẩm (Item No.) là bắt buộc.';
    END IF;
    IF NULLIF(trim(p_item_name), '') IS NULL THEN
        RAISE EXCEPTION 'Tên sản phẩm (Item Name) là bắt buộc.';
    END IF;
    IF NULLIF(trim(p_customer), '') IS NULL THEN
        RAISE EXCEPTION 'Khách hàng (Customer) là bắt buộc.';
    END IF;
    IF NULLIF(trim(p_drawing_file_path), '') IS NULL THEN
        RAISE EXCEPTION 'Tệp bản vẽ là bắt buộc.';
    END IF;

    -- Allocate next Issue No atomically
    v_issue_no := public.allocate_next_drawing_review_issue_no();

    -- Insert Master Issue
    INSERT INTO public.drawing_review_issues (
        issue_no,
        item_no,
        item_name,
        customer,
        drawing_file_path,
        drawing_file_name,
        drawing_file_size,
        drawing_mime_type,
        attention,
        created_by
    ) VALUES (
        v_issue_no,
        trim(p_item_no),
        trim(p_item_name),
        trim(p_customer),
        trim(p_drawing_file_path),
        trim(p_drawing_file_name),
        p_drawing_file_size,
        trim(p_drawing_mime_type),
        NULLIF(trim(p_attention), ''),
        v_uid
    )
    RETURNING id INTO v_issue_id;

    -- Insert Initial V1 Version (status: Issued)
    INSERT INTO public.drawing_review_versions (
        issue_id,
        version_number,
        version_name,
        status,
        created_by
    ) VALUES (
        v_issue_id,
        1,
        'V1',
        'Issued',
        v_uid
    )
    RETURNING id INTO v_version_id;

    RETURN jsonb_build_object(
        'success', true,
        'issue_id', v_issue_id,
        'issue_no', v_issue_no,
        'version_id', v_version_id,
        'version_name', 'V1',
        'status', 'Issued'
    );
END;
$$;

-- 3.3 Save Technical Review Draft (PE-MFG / Admin saves technical review; status -> Reviewing)
CREATE OR REPLACE FUNCTION public.save_drawing_review_draft(
    p_version_id UUID,
    p_required_material TEXT DEFAULT NULL,
    p_required_tooling TEXT DEFAULT NULL,
    p_special_measuring_equipment TEXT DEFAULT NULL,
    p_engineering_remarks TEXT DEFAULT NULL,
    p_avatar_file_path TEXT DEFAULT NULL,
    p_avatar_crop_box JSONB DEFAULT NULL,
    p_operations JSONB DEFAULT '[]'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_uid UUID;
    v_role public.user_role;
    v_jwt_role TEXT;
    v_version RECORD;
    v_op RECORD;
    v_step_order INT;
    v_wc TEXT;
    v_op_desc TEXT;
    v_ct NUMERIC;
    v_remark TEXT;
    v_lineage_id UUID;
    v_is_removed BOOLEAN;
BEGIN
    v_uid := auth.uid();
    v_jwt_role := COALESCE(current_setting('request.jwt.claim.role', true), '');
    IF v_jwt_role != 'service_role' AND session_user NOT IN ('postgres') THEN
        IF v_uid IS NULL THEN
            RAISE EXCEPTION 'Chưa đăng nhập: Vui lòng đăng nhập để thực hiện thao tác.';
        END IF;

        IF public.is_user_active() IS NOT TRUE OR public.has_completed_password_change() IS NOT TRUE THEN
            RAISE EXCEPTION 'Tài khoản chưa kích hoạt hoặc chưa đổi mật khẩu lần đầu.';
        END IF;

        v_role := public.get_current_user_role();
        IF v_role NOT IN ('PE-MFG', 'Admin') THEN
            RAISE EXCEPTION 'Quyền hạn bị từ chối: Chỉ PE-MFG hoặc Admin mới có quyền cập nhật dữ liệu kỹ thuật.';
        END IF;
    END IF;

    -- Lock and inspect version
    SELECT * INTO v_version
    FROM public.drawing_review_versions
    WHERE id = p_version_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Không tìm thấy phiên bản đánh giá kỹ thuật.';
    END IF;

    IF v_version.status = 'Completed' THEN
        RAISE EXCEPTION 'Phiên bản này đã hoàn thành (Completed) và đã bị khóa, không thể chỉnh sửa.';
    END IF;

    -- Update version technical fields and set status to 'Reviewing'
    UPDATE public.drawing_review_versions
    SET
        required_material = p_required_material,
        required_tooling = p_required_tooling,
        special_measuring_equipment = p_special_measuring_equipment,
        engineering_remarks = p_engineering_remarks,
        avatar_file_path = COALESCE(p_avatar_file_path, avatar_file_path),
        avatar_crop_box = COALESCE(p_avatar_crop_box, avatar_crop_box),
        status = 'Reviewing',
        updated_at = timezone('Asia/Ho_Chi_Minh', NOW())
    WHERE id = p_version_id;

    -- Replace operations for this version
    DELETE FROM public.drawing_review_operations
    WHERE version_id = p_version_id;

    -- Insert updated operations
    IF p_operations IS NOT NULL AND jsonb_array_length(p_operations) > 0 THEN
        FOR v_op IN SELECT * FROM jsonb_to_recordset(p_operations) AS x(
            id UUID,
            lineage_id UUID,
            step_order INT,
            workcenter_code TEXT,
            operation_description TEXT,
            cycle_time_seconds NUMERIC,
            remark TEXT,
            is_removed BOOLEAN
        )
        LOOP
            v_wc := trim(COALESCE(v_op.workcenter_code, ''));
            v_op_desc := trim(COALESCE(v_op.operation_description, ''));
            v_lineage_id := COALESCE(v_op.lineage_id, gen_random_uuid());
            v_step_order := COALESCE(v_op.step_order, 10);
            v_is_removed := COALESCE(v_op.is_removed, false);
            v_ct := v_op.cycle_time_seconds;
            v_remark := v_op.remark;

            IF v_ct IS NOT NULL AND v_ct < 0 THEN
                RAISE EXCEPTION 'Thời gian chu kỳ (Cycle Time) không thể là số âm.';
            END IF;

            INSERT INTO public.drawing_review_operations (
                version_id,
                lineage_id,
                step_order,
                workcenter_code,
                operation_description,
                cycle_time_seconds,
                remark,
                is_removed
            ) VALUES (
                p_version_id,
                v_lineage_id,
                v_step_order,
                v_wc,
                NULLIF(v_op_desc, ''),
                v_ct,
                NULLIF(v_remark, ''),
                v_is_removed
            );
        END LOOP;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'version_id', p_version_id,
        'status', 'Reviewing'
    );
END;
$$;

-- 3.4 Close Technical Review Version (Validates data, marks status = Completed, freezes records)
CREATE OR REPLACE FUNCTION public.close_drawing_review_version(
    p_version_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_uid UUID;
    v_role public.user_role;
    v_jwt_role TEXT;
    v_version RECORD;
    v_active_ops_count INT;
    v_invalid_wc_count INT;
    v_invalid_ct_count INT;
    v_missing_subcon_count INT;
BEGIN
    v_uid := auth.uid();
    v_jwt_role := COALESCE(current_setting('request.jwt.claim.role', true), '');
    IF v_jwt_role != 'service_role' AND session_user NOT IN ('postgres') THEN
        IF v_uid IS NULL THEN
            RAISE EXCEPTION 'Chưa đăng nhập: Vui lòng đăng nhập để thực hiện thao tác.';
        END IF;

        IF public.is_user_active() IS NOT TRUE OR public.has_completed_password_change() IS NOT TRUE THEN
            RAISE EXCEPTION 'Tài khoản chưa kích hoạt hoặc chưa đổi mật khẩu lần đầu.';
        END IF;

        v_role := public.get_current_user_role();
        IF v_role NOT IN ('PE-MFG', 'Admin') THEN
            RAISE EXCEPTION 'Quyền hạn bị từ chối: Chỉ PE-MFG hoặc Admin mới có quyền chốt hoàn thành đánh giá kỹ thuật.';
        END IF;
    END IF;

    SELECT * INTO v_version
    FROM public.drawing_review_versions
    WHERE id = p_version_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Không tìm thấy phiên bản đánh giá kỹ thuật.';
    END IF;

    IF v_version.status = 'Completed' THEN
        RAISE EXCEPTION 'Phiên bản này đã hoàn thành trước đó và đã bị khóa.';
    END IF;

    -- Validation 1: Must have at least 1 active routing operation
    SELECT COUNT(*) INTO v_active_ops_count
    FROM public.drawing_review_operations
    WHERE version_id = p_version_id AND is_removed = FALSE;

    IF v_active_ops_count = 0 THEN
        RAISE EXCEPTION 'Yêu cầu có ít nhất 1 công đoạn routing đang hoạt động để hoàn thành đánh giá.';
    END IF;

    -- Validation 2: Every active operation must have a Work Center
    SELECT COUNT(*) INTO v_invalid_wc_count
    FROM public.drawing_review_operations
    WHERE version_id = p_version_id
      AND is_removed = FALSE
      AND (workcenter_code IS NULL OR length(trim(workcenter_code)) = 0);

    IF v_invalid_wc_count > 0 THEN
        RAISE EXCEPTION 'Tất cả các công đoạn phải được chọn Work Center trước khi hoàn thành.';
    END IF;

    -- Validation 3: Every active operation must have valid, finite, non-negative CT (>= 0, zero allowed)
    SELECT COUNT(*) INTO v_invalid_ct_count
    FROM public.drawing_review_operations
    WHERE version_id = p_version_id
      AND is_removed = FALSE
      AND (cycle_time_seconds IS NULL OR cycle_time_seconds < 0);

    IF v_invalid_ct_count > 0 THEN
        RAISE EXCEPTION 'Thời gian chu kỳ (Cycle Time) không được để trống và phải là số không âm (>= 0 sec/pc).';
    END IF;

    -- Validation 4: SUBCON requires non-empty Operation Description (case-insensitive check)
    SELECT COUNT(*) INTO v_missing_subcon_count
    FROM public.drawing_review_operations
    WHERE version_id = p_version_id
      AND is_removed = FALSE
      AND UPPER(trim(workcenter_code)) = 'SUBCON'
      AND (operation_description IS NULL OR length(trim(operation_description)) = 0);

    IF v_missing_subcon_count > 0 THEN
        RAISE EXCEPTION 'Công đoạn gia công ngoài (SUBCON) bắt buộc phải có mô tả công đoạn (Operation Description).';
    END IF;

    -- Commit Close: status = Completed
    UPDATE public.drawing_review_versions
    SET
        status = 'Completed',
        closed_by = v_uid,
        closed_at = timezone('Asia/Ho_Chi_Minh', NOW()),
        updated_at = timezone('Asia/Ho_Chi_Minh', NOW())
    WHERE id = p_version_id;

    RETURN jsonb_build_object(
        'success', true,
        'version_id', p_version_id,
        'status', 'Completed',
        'closed_by', v_uid,
        'closed_at', timezone('Asia/Ho_Chi_Minh', NOW())
    );
END;
$$;

-- 3.5 Create Next Version (Clones latest Completed version into V+1 with status Reviewing)
CREATE OR REPLACE FUNCTION public.create_next_drawing_review_version(
    p_issue_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_uid UUID;
    v_role public.user_role;
    v_jwt_role TEXT;
    v_latest_ver RECORD;
    v_has_open_ver BOOLEAN;
    v_next_num INT;
    v_next_name TEXT;
    v_new_ver_id UUID;
BEGIN
    v_uid := auth.uid();
    v_jwt_role := COALESCE(current_setting('request.jwt.claim.role', true), '');
    IF v_jwt_role != 'service_role' AND session_user NOT IN ('postgres') THEN
        IF v_uid IS NULL THEN
            RAISE EXCEPTION 'Chưa đăng nhập: Vui lòng đăng nhập để thực hiện thao tác.';
        END IF;

        IF public.is_user_active() IS NOT TRUE OR public.has_completed_password_change() IS NOT TRUE THEN
            RAISE EXCEPTION 'Tài khoản chưa kích hoạt hoặc chưa đổi mật khẩu lần đầu.';
        END IF;

        v_role := public.get_current_user_role();
        IF v_role NOT IN ('PE-MFG', 'Admin') THEN
            RAISE EXCEPTION 'Quyền hạn bị từ chối: Chỉ PE-MFG hoặc Admin mới có quyền tạo phiên bản đánh giá mới.';
        END IF;
    END IF;

    -- Concurrency safeguard: lock parent issue
    PERFORM 1 FROM public.drawing_review_issues WHERE id = p_issue_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Không tìm thấy yêu cầu đánh giá bản vẽ.';
    END IF;

    -- Check if an uncompleted version is still open
    SELECT EXISTS (
        SELECT 1 FROM public.drawing_review_versions
        WHERE issue_id = p_issue_id AND status IN ('Issued', 'Reviewing')
    ) INTO v_has_open_ver;

    IF v_has_open_ver THEN
        RAISE EXCEPTION 'Đã có một phiên bản đang chỉnh sửa cho yêu cầu này. Chỉ cho phép duy nhất một phiên bản mở tại một thời điểm.';
    END IF;

    -- Identify latest Completed version
    SELECT * INTO v_latest_ver
    FROM public.drawing_review_versions
    WHERE issue_id = p_issue_id AND status = 'Completed'
    ORDER BY version_number DESC
    LIMIT 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Không tìm thấy phiên bản đã hoàn thành (Completed) để nhân bản.';
    END IF;

    v_next_num := v_latest_ver.version_number + 1;
    v_next_name := 'V' || v_next_num::TEXT;

    -- Create new version with status 'Reviewing'
    INSERT INTO public.drawing_review_versions (
        issue_id,
        version_number,
        version_name,
        parent_version_id,
        status,
        required_material,
        required_tooling,
        special_measuring_equipment,
        engineering_remarks,
        avatar_file_path,
        avatar_crop_box,
        created_by
    ) VALUES (
        p_issue_id,
        v_next_num,
        v_next_name,
        v_latest_ver.id,
        'Reviewing',
        v_latest_ver.required_material,
        v_latest_ver.required_tooling,
        v_latest_ver.special_measuring_equipment,
        v_latest_ver.engineering_remarks,
        v_latest_ver.avatar_file_path,
        v_latest_ver.avatar_crop_box,
        v_uid
    )
    RETURNING id INTO v_new_ver_id;

    -- Clone surviving active operations with stable lineage_id
    INSERT INTO public.drawing_review_operations (
        version_id,
        lineage_id,
        step_order,
        workcenter_code,
        operation_description,
        cycle_time_seconds,
        remark,
        is_removed
    )
    SELECT
        v_new_ver_id,
        lineage_id,
        step_order,
        workcenter_code,
        operation_description,
        cycle_time_seconds,
        remark,
        false
    FROM public.drawing_review_operations
    WHERE version_id = v_latest_ver.id AND is_removed = FALSE
    ORDER BY step_order ASC;

    -- Clone attachment reference metadata
    INSERT INTO public.drawing_review_attachments (
        version_id,
        file_path,
        file_name,
        file_size,
        mime_type,
        caption,
        uploaded_by
    )
    SELECT
        v_new_ver_id,
        file_path,
        file_name,
        file_size,
        mime_type,
        caption,
        v_uid
    FROM public.drawing_review_attachments
    WHERE version_id = v_latest_ver.id;

    RETURN jsonb_build_object(
        'success', true,
        'version_id', v_new_ver_id,
        'version_number', v_next_num,
        'version_name', v_next_name,
        'status', 'Reviewing',
        'parent_version_id', v_latest_ver.id
    );
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. PRIVATE STORAGE BUCKET CONFIGURATION
-- ----------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'drawing-reviews',
    'drawing-reviews',
    FALSE,
    52428800, -- 50 MB
    ARRAY[
        'application/pdf',
        'image/jpeg',
        'image/png',
        'image/webp'
    ]
)
ON CONFLICT (id) DO UPDATE SET
    public = FALSE,
    file_size_limit = 52428800,
    allowed_mime_types = ARRAY[
        'application/pdf',
        'image/jpeg',
        'image/png',
        'image/webp'
    ];

-- ----------------------------------------------------------------------------
-- 5. ROW LEVEL SECURITY (RLS) POLICIES
-- ----------------------------------------------------------------------------

ALTER TABLE public.drawing_review_issue_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drawing_review_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drawing_review_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drawing_review_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drawing_review_attachments ENABLE ROW LEVEL SECURITY;

-- 5.1 Sequences: Read for authenticated users; modifications only via allocate RPC
CREATE POLICY "p_drawing_review_seq_select"
    ON public.drawing_review_issue_sequences FOR SELECT
    TO authenticated
    USING (public.is_user_active() = TRUE);

-- 5.2 Issues:
-- Authenticated active users can view issues
CREATE POLICY "p_drawing_review_issues_select"
    ON public.drawing_review_issues FOR SELECT
    TO authenticated
    USING (public.is_user_active() = TRUE);

-- BD and Admin can insert issues
CREATE POLICY "p_drawing_review_issues_insert"
    ON public.drawing_review_issues FOR INSERT
    TO authenticated
    WITH CHECK (
        public.is_user_active() = TRUE
        AND public.get_current_user_role() IN ('BD', 'Admin')
    );

-- Only Admin can update issues (or via system RPC)
CREATE POLICY "p_drawing_review_issues_update"
    ON public.drawing_review_issues FOR UPDATE
    TO authenticated
    USING (
        public.is_user_active() = TRUE
        AND public.get_current_user_role() = 'Admin'
    );

-- 5.3 Versions:
CREATE POLICY "p_drawing_review_versions_select"
    ON public.drawing_review_versions FOR SELECT
    TO authenticated
    USING (public.is_user_active() = TRUE);

-- Inserts and Updates mediated via RPCs or authorized PE-MFG/Admin (immutability trigger protects Completed)
CREATE POLICY "p_drawing_review_versions_insert"
    ON public.drawing_review_versions FOR INSERT
    TO authenticated
    WITH CHECK (
        public.is_user_active() = TRUE
        AND public.get_current_user_role() IN ('PE-MFG', 'Admin', 'BD')
    );

CREATE POLICY "p_drawing_review_versions_update"
    ON public.drawing_review_versions FOR UPDATE
    TO authenticated
    USING (
        public.is_user_active() = TRUE
        AND public.get_current_user_role() IN ('PE-MFG', 'Admin')
    );

-- 5.4 Operations:
CREATE POLICY "p_drawing_review_operations_select"
    ON public.drawing_review_operations FOR SELECT
    TO authenticated
    USING (public.is_user_active() = TRUE);

CREATE POLICY "p_drawing_review_operations_all"
    ON public.drawing_review_operations FOR ALL
    TO authenticated
    USING (
        public.is_user_active() = TRUE
        AND public.get_current_user_role() IN ('PE-MFG', 'Admin')
    );

-- 5.5 Attachments:
CREATE POLICY "p_drawing_review_attachments_select"
    ON public.drawing_review_attachments FOR SELECT
    TO authenticated
    USING (public.is_user_active() = TRUE);

CREATE POLICY "p_drawing_review_attachments_insert"
    ON public.drawing_review_attachments FOR INSERT
    TO authenticated
    WITH CHECK (
        public.is_user_active() = TRUE
        AND public.get_current_user_role() IN ('PE-MFG', 'Admin', 'BD')
    );

CREATE POLICY "p_drawing_review_attachments_delete"
    ON public.drawing_review_attachments FOR DELETE
    TO authenticated
    USING (
        public.is_user_active() = TRUE
        AND public.get_current_user_role() IN ('PE-MFG', 'Admin')
    );

-- 5.6 Storage Objects RLS for 'drawing-reviews' bucket
CREATE POLICY "p_storage_drawing_reviews_select"
    ON storage.objects FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'drawing-reviews'
        AND public.is_user_active() = TRUE
    );

CREATE POLICY "p_storage_drawing_reviews_insert"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id = 'drawing-reviews'
        AND public.is_user_active() = TRUE
        AND public.get_current_user_role() IN ('BD', 'PE-MFG', 'Admin')
    );
