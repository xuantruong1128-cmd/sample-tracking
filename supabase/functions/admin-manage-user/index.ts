import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Unified Vietnamese Mobile Prefixes (Matching authUtils.ts)
const VALID_VN_MOBILE_PREFIXES = [
  '32', '33', '34', '35', '36', '37', '38', '39', // Viettel
  '52', '55', '56', '58', '59',                   // Vietnamobile, Gmobile, Itelecom
  '70', '76', '77', '78', '79',                   // Mobifone
  '81', '82', '83', '84', '85',                   // Vinaphone
  '86', '87', '88', '89',                         // Viettel, Wintel, Vinaphone, Mobifone
  '90', '91', '92', '93', '94', '96', '97', '98', '99', // Classic prefixes
];

function canonicalizePhone(raw: string): { canonical: string; local: string; email: string } | null {
  if (!raw || typeof raw !== 'string') return null;
  let cleaned = raw.trim().replace(/[\s\-.()]/g, '');
  if (cleaned.startsWith('+')) cleaned = cleaned.substring(1);
  if (!/^\d+$/.test(cleaned)) return null;

  let nineDigits = '';
  if (cleaned.startsWith('84')) {
    if (cleaned.length !== 11) return null;
    nineDigits = cleaned.substring(2);
  } else if (cleaned.startsWith('0')) {
    if (cleaned.length !== 10) return null;
    nineDigits = cleaned.substring(1);
  } else if (cleaned.length === 9) {
    nineDigits = cleaned;
  } else {
    return null;
  }

  const prefix = nineDigits.substring(0, 2);
  if (!VALID_VN_MOBILE_PREFIXES.includes(prefix)) {
    return null;
  }

  return {
    canonical: `+84${nineDigits}`,
    local: `0${nineDigits}`,
    email: `84${nineDigits}@sampletracking.local`,
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Yêu cầu đăng nhập (Thiếu Authorization header)' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    const token = authHeader.replace(/^Bearer\s+/i, '');
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // 1. Authenticate caller using their JWT
    const { data: { user: callerUser }, error: callerError } = await adminClient.auth.getUser(token);
    if (callerError || !callerUser) {
      return new Response(JSON.stringify({ error: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 2. Verify caller has Admin role in public.profiles (Never trust frontend-sent role)
    const { data: callerProfile, error: profileErr } = await adminClient
      .from('profiles')
      .select('id, full_name, role, is_active')
      .eq('id', callerUser.id)
      .single();

    if (profileErr || !callerProfile || callerProfile.role !== 'Admin' || !callerProfile.is_active) {
      return new Response(JSON.stringify({ error: 'Từ chối truy cập: Thao tác này chỉ dành riêng cho Quản trị viên (Admin).' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Helper to count other active Admins to prevent locking out system
    const countOtherActiveAdmins = async (targetUserId: string): Promise<number> => {
      const { count, error } = await adminClient
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('role', 'Admin')
        .eq('is_active', true)
        .neq('id', targetUserId);
      if (error) {
        console.error('Error counting active admins:', error.message);
        return 0;
      }
      return count ?? 0;
    };

    // 3. Process actions
    const body = await req.json();
    const { action, phone, password, full_name, role, department, user_id } = body;

    // --- ACTION: CREATE NEW USER ---
    if (action === 'create') {
      if (!phone || !full_name || !role) {
        return new Response(JSON.stringify({ error: 'Vui lòng điền đầy đủ các thông tin bắt buộc (Số điện thoại, Họ tên, Vai trò).' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const VALID_ROLES = ['Admin', 'Planning', 'PE-MFG', 'QA'];
      if (!VALID_ROLES.includes(role)) {
        return new Response(JSON.stringify({ error: `Vai trò "${role}" không hợp lệ. Chỉ chấp nhận: ${VALID_ROLES.join(', ')}` }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const phoneObj = canonicalizePhone(phone);
      if (!phoneObj) {
        return new Response(JSON.stringify({ error: 'Số điện thoại di động Việt Nam không hợp lệ hoặc sai đầu số nhà mạng.' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Check if profile already exists in PostgreSQL
      const { data: existingProfile } = await adminClient
        .from('profiles')
        .select('id, full_name, phone')
        .eq('phone', phoneObj.canonical)
        .single();

      if (existingProfile) {
        return new Response(JSON.stringify({ error: `Số điện thoại ${phoneObj.local} đã được đăng ký cho người dùng "${existingProfile.full_name}".` }), {
          status: 409,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const initialPassword = password && password.trim().length >= 8 ? password.trim() : '123456';

      const { data: newAuthUser, error: createError } = await adminClient.auth.admin.createUser({
        email: phoneObj.email,
        phone: phoneObj.canonical,
        password: initialPassword,
        email_confirm: true,
        phone_confirm: true,
        user_metadata: {
          phone: phoneObj.canonical,
          local_phone: phoneObj.local,
          full_name: full_name.trim(),
          role,
          department: department || 'Sản xuất',
        },
      });

      if (createError) {
        return new Response(JSON.stringify({ error: createError.message.includes('already registered') ? `Số điện thoại ${phoneObj.local} đã tồn tại trong hệ thống xác thực Auth.` : createError.message }), {
          status: createError.message.includes('already registered') ? 409 : 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const { error: insertProfileErr } = await adminClient.from('profiles').insert({
        id: newAuthUser.user.id,
        phone: phoneObj.canonical,
        email: phoneObj.email,
        full_name: full_name.trim(),
        role,
        department: department || 'Sản xuất',
        is_active: true,
        must_change_password: true,
        can_make_pe_decisions: (role === 'PE-MFG' || role === 'Admin'),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      if (insertProfileErr) {
        await adminClient.auth.admin.deleteUser(newAuthUser.user.id);
        throw insertProfileErr;
      }

      // Record audit log
      await adminClient.from('audit_logs').insert({
        user_id: callerUser.id,
        action: 'ADMIN_PROVISION_USER',
        entity_type: 'profiles',
        entity_id: newAuthUser.user.id,
        new_values: {
          phone: phoneObj.canonical,
          full_name: full_name.trim(),
          role,
          department: department || 'Sản xuất',
          initiated_by: callerUser.id,
        },
        created_at: new Date().toISOString(),
      });

      return new Response(JSON.stringify({ success: true, user: newAuthUser.user }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // --- ACTION: UPDATE NAME ---
    if (action === 'update_name') {
      if (!user_id || !full_name || full_name.trim().length === 0) {
        return new Response(JSON.stringify({ error: 'Vui lòng cung cấp User ID và Họ tên hợp lệ.' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const { data: targetProfile, error: targetErr } = await adminClient
        .from('profiles')
        .select('id, full_name')
        .eq('id', user_id)
        .single();

      if (targetErr || !targetProfile) {
        return new Response(JSON.stringify({ error: 'Không tìm thấy hồ sơ người dùng trong hệ thống.' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const oldName = targetProfile.full_name;
      const newName = full_name.trim();

      const { error: updateProfErr } = await adminClient
        .from('profiles')
        .update({ full_name: newName, updated_at: new Date().toISOString() })
        .eq('id', user_id);

      if (updateProfErr) throw updateProfErr;

      await adminClient.auth.admin.updateUserById(user_id, {
        user_metadata: { full_name: newName },
      });

      await adminClient.from('audit_logs').insert({
        user_id: callerUser.id,
        action: 'ADMIN_UPDATE_USER_NAME',
        entity_type: 'profiles',
        entity_id: user_id,
        old_values: { full_name: oldName },
        new_values: { full_name: newName, initiated_by: callerUser.id },
        created_at: new Date().toISOString(),
      });

      return new Response(JSON.stringify({ success: true, full_name: newName }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // --- ACTION: UPDATE PHONE ---
    if (action === 'update_phone') {
      if (!user_id || !phone) {
        return new Response(JSON.stringify({ error: 'Vui lòng cung cấp User ID và Số điện thoại mới.' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const phoneObj = canonicalizePhone(phone);
      if (!phoneObj) {
        return new Response(JSON.stringify({ error: 'Số điện thoại di động Việt Nam không hợp lệ.' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Check if new phone is used by another user
      const { data: duplicatePhone } = await adminClient
        .from('profiles')
        .select('id, full_name')
        .eq('phone', phoneObj.canonical)
        .neq('id', user_id)
        .single();

      if (duplicatePhone) {
        return new Response(JSON.stringify({ error: `Số điện thoại ${phoneObj.local} đã được sử dụng bởi người dùng "${duplicatePhone.full_name}".` }), {
          status: 409,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const { data: targetProfile } = await adminClient
        .from('profiles')
        .select('phone, email')
        .eq('id', user_id)
        .single();

      const oldPhone = targetProfile?.phone;

      // Update Auth identity (email alias and phone)
      const { error: updateAuthErr } = await adminClient.auth.admin.updateUserById(user_id, {
        email: phoneObj.email,
        phone: phoneObj.canonical,
        user_metadata: {
          phone: phoneObj.canonical,
          local_phone: phoneObj.local,
        },
      });

      if (updateAuthErr) {
        return new Response(JSON.stringify({ error: `Lỗi cập nhật danh tính Auth: ${updateAuthErr.message}` }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Update profiles record
      const { error: updateProfErr } = await adminClient
        .from('profiles')
        .update({
          phone: phoneObj.canonical,
          email: phoneObj.email,
          updated_at: new Date().toISOString(),
        })
        .eq('id', user_id);

      if (updateProfErr) throw updateProfErr;

      await adminClient.from('audit_logs').insert({
        user_id: callerUser.id,
        action: 'ADMIN_UPDATE_USER_PHONE',
        entity_type: 'profiles',
        entity_id: user_id,
        old_values: { phone: oldPhone },
        new_values: { phone: phoneObj.canonical, initiated_by: callerUser.id },
        created_at: new Date().toISOString(),
      });

      return new Response(JSON.stringify({ success: true, phone: phoneObj.canonical, local_phone: phoneObj.local }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // --- ACTION: UPDATE ROLE ---
    if (action === 'update_role') {
      if (!user_id || !role) {
        return new Response(JSON.stringify({ error: 'Vui lòng cung cấp User ID và Vai trò mới.' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const VALID_ROLES = ['Admin', 'Planning', 'PE-MFG', 'QA'];
      if (!VALID_ROLES.includes(role)) {
        return new Response(JSON.stringify({ error: `Vai trò "${role}" không hợp lệ. Chỉ chấp nhận: ${VALID_ROLES.join(', ')}` }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const { data: targetProfile, error: targetErr } = await adminClient
        .from('profiles')
        .select('id, role, is_active')
        .eq('id', user_id)
        .single();

      if (targetErr || !targetProfile) {
        return new Response(JSON.stringify({ error: 'Không tìm thấy hồ sơ người dùng.' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Guard: Do not allow demoting the last active Admin
      if (targetProfile.role === 'Admin' && role !== 'Admin') {
        const otherAdmins = await countOtherActiveAdmins(user_id);
        if (otherAdmins === 0) {
          return new Response(JSON.stringify({ error: 'Không thể thay đổi vai trò: Đây là tài khoản Admin đang hoạt động duy nhất trong hệ thống.' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }

      const oldRole = targetProfile.role;
      const canMakePe = (role === 'PE-MFG' || role === 'Admin');

      const { error: updateProfErr } = await adminClient
        .from('profiles')
        .update({
          role,
          can_make_pe_decisions: canMakePe,
          updated_at: new Date().toISOString(),
        })
        .eq('id', user_id);

      if (updateProfErr) throw updateProfErr;

      await adminClient.auth.admin.updateUserById(user_id, {
        user_metadata: { role },
      });

      await adminClient.from('audit_logs').insert({
        user_id: callerUser.id,
        action: 'ADMIN_UPDATE_USER_ROLE',
        entity_type: 'profiles',
        entity_id: user_id,
        old_values: { role: oldRole },
        new_values: { role, can_make_pe_decisions: canMakePe, initiated_by: callerUser.id },
        created_at: new Date().toISOString(),
      });

      return new Response(JSON.stringify({ success: true, role, can_make_pe_decisions: canMakePe }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // --- ACTION: DEACTIVATE USER ---
    if (action === 'deactivate') {
      if (!user_id) throw new Error('user_id required for deactivate');

      const { data: targetProfile, error: targetProfileErr } = await adminClient
        .from('profiles')
        .select('id, full_name, role, department, is_active')
        .eq('id', user_id)
        .single();

      if (targetProfileErr || !targetProfile) {
        return new Response(JSON.stringify({ error: 'Không tìm thấy hồ sơ người dùng.' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Guard: Do not allow deactivating the last active Admin
      if (targetProfile.role === 'Admin') {
        const otherAdmins = await countOtherActiveAdmins(user_id);
        if (otherAdmins === 0) {
          return new Response(JSON.stringify({ error: 'Không thể vô hiệu hóa: Đây là tài khoản Admin đang hoạt động duy nhất trong hệ thống.' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }

      const previousIsActive = Boolean(targetProfile.is_active);

      // 1. Update database profile
      const { error: deactErr } = await adminClient
        .from('profiles')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('id', user_id);

      if (deactErr) throw deactErr;

      // 2. Revoke refresh tokens and ban user in GoTrue (blocks current active session)
      const { error: banErr } = await adminClient.auth.admin.updateUserById(user_id, {
        ban_duration: '876000h',
      });

      if (banErr) {
        await adminClient
          .from('profiles')
          .update({ is_active: previousIsActive, updated_at: new Date().toISOString() })
          .eq('id', user_id);
        throw new Error(`Lỗi vô hiệu hóa phiên xác thực: ${banErr.message}`);
      }

      // 3. Record audit log
      await adminClient.from('audit_logs').insert({
        user_id: callerUser.id,
        action: 'ADMIN_DEACTIVATE_USER',
        entity_type: 'profiles',
        entity_id: user_id,
        old_values: { is_active: previousIsActive },
        new_values: { is_active: false, ban_duration: '876000h', initiated_by: callerUser.id },
        created_at: new Date().toISOString(),
      });

      return new Response(JSON.stringify({ success: true, is_active: false }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // --- ACTION: ACTIVATE USER ---
    if (action === 'activate') {
      if (!user_id) throw new Error('user_id required for activate');

      const { data: targetProfile, error: targetProfileErr } = await adminClient
        .from('profiles')
        .select('id, full_name, role, department, is_active')
        .eq('id', user_id)
        .single();

      if (targetProfileErr || !targetProfile) {
        return new Response(JSON.stringify({ error: 'Không tìm thấy hồ sơ người dùng.' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const previousIsActive = Boolean(targetProfile.is_active);

      const { error: actErr } = await adminClient
        .from('profiles')
        .update({ is_active: true, updated_at: new Date().toISOString() })
        .eq('id', user_id);

      if (actErr) throw actErr;

      // Lift ban in GoTrue
      const { error: unbanErr } = await adminClient.auth.admin.updateUserById(user_id, {
        ban_duration: 'none',
      });

      if (unbanErr) {
        await adminClient
          .from('profiles')
          .update({ is_active: previousIsActive, updated_at: new Date().toISOString() })
          .eq('id', user_id);
        throw new Error(`Lỗi kích hoạt tài khoản trong Auth: ${unbanErr.message}`);
      }

      await adminClient.from('audit_logs').insert({
        user_id: callerUser.id,
        action: 'ADMIN_ACTIVATE_USER',
        entity_type: 'profiles',
        entity_id: user_id,
        old_values: { is_active: previousIsActive },
        new_values: { is_active: true, ban_duration: 'none', initiated_by: callerUser.id },
        created_at: new Date().toISOString(),
      });

      return new Response(JSON.stringify({ success: true, is_active: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // --- ACTION: RESET PASSWORD ---
    if (action === 'reset_password') {
      if (!user_id) throw new Error('user_id required for reset_password');
      const resetPassword = password && password.trim().length >= 8 ? password.trim() : '123456';

      const { error: resetErr } = await adminClient.auth.admin.updateUserById(user_id, {
        password: resetPassword,
      });
      if (resetErr) throw resetErr;

      const { error: updateProfileErr } = await adminClient
        .from('profiles')
        .update({ must_change_password: true, updated_at: new Date().toISOString() })
        .eq('id', user_id);
      if (updateProfileErr) throw updateProfileErr;

      await adminClient.from('audit_logs').insert({
        user_id: callerUser.id,
        action: 'ADMIN_RESET_PASSWORD',
        entity_type: 'profiles',
        entity_id: user_id,
        new_values: { must_change_password: true, initiated_by: callerUser.id },
        created_at: new Date().toISOString(),
      });

      return new Response(JSON.stringify({ success: true, must_change_password: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // --- ACTION: DELETE USER (Conditional Safe Deletion) ---
    if (action === 'delete') {
      if (!user_id) throw new Error('user_id required for delete');

      const { data: targetProfile, error: targetProfileErr } = await adminClient
        .from('profiles')
        .select('id, full_name, role')
        .eq('id', user_id)
        .single();

      if (targetProfileErr || !targetProfile) {
        return new Response(JSON.stringify({ error: 'Không tìm thấy hồ sơ người dùng để xóa.' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Guard: Do not allow deleting the last Admin
      if (targetProfile.role === 'Admin') {
        const otherAdmins = await countOtherActiveAdmins(user_id);
        if (otherAdmins === 0) {
          return new Response(JSON.stringify({ error: 'Không thể xóa: Đây là tài khoản Admin duy nhất trong hệ thống.' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }

      // Check foreign key dependencies
      const [jobsRes, prodRes, qaRes, attachRes, dispRes] = await Promise.all([
        adminClient.from('jobs').select('id', { count: 'exact', head: true }).eq('created_by', user_id),
        adminClient.from('production_runs').select('id', { count: 'exact', head: true }).eq('operator_id', user_id),
        adminClient.from('qa_checks').select('id', { count: 'exact', head: true }).eq('inspector_id', user_id),
        adminClient.from('attachments').select('id', { count: 'exact', head: true }).eq('uploaded_by', user_id),
        adminClient.from('pe_technical_dispositions').select('id', { count: 'exact', head: true }).eq('decided_by', user_id),
      ]);

      const totalRefs = (jobsRes.count || 0) + (prodRes.count || 0) + (qaRes.count || 0) + (attachRes.count || 0) + (dispRes.count || 0);

      if (totalRefs > 0) {
        return new Response(JSON.stringify({
          error: `Không thể xóa vĩnh viễn: Tài khoản "${targetProfile.full_name}" đã có dữ liệu sản xuất liên kết (${jobsRes.count || 0} lệnh JOB, ${prodRes.count || 0} lượt sản xuất, ${qaRes.count || 0} lượt kiểm tra QA). Để bảo toàn lịch sử và truy xuất nguồn gốc, vui lòng chọn chức năng 'Vô hiệu hóa' (Disable).`,
          has_data_references: true,
          details: {
            jobs: jobsRes.count || 0,
            production_runs: prodRes.count || 0,
            qa_checks: qaRes.count || 0,
            attachments: attachRes.count || 0,
          },
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Record audit log before deletion
      await adminClient.from('audit_logs').insert({
        user_id: callerUser.id,
        action: 'ADMIN_DELETE_USER',
        entity_type: 'profiles',
        entity_id: user_id,
        old_values: { full_name: targetProfile.full_name, role: targetProfile.role },
        new_values: { deleted_at: new Date().toISOString(), initiated_by: callerUser.id },
        created_at: new Date().toISOString(),
      });

      // Delete from profiles and auth
      await adminClient.from('profiles').delete().eq('id', user_id);
      const { error: deleteAuthErr } = await adminClient.auth.admin.deleteUser(user_id);
      if (deleteAuthErr) {
        console.error('Delete Auth user error:', deleteAuthErr.message);
      }

      return new Response(JSON.stringify({ success: true, deleted: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Hành động không hợp lệ (Unknown action).' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message || 'Lỗi hệ thống máy chủ' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
