import { supabase } from '../lib/supabase';

/**
 * Update current user's full name in public.profiles and auth user metadata
 */
export async function updateMyName(userId: string, newFullName: string): Promise<{ success: boolean; error?: string }> {
  const trimmed = newFullName.trim();
  if (!trimmed) {
    return { success: false, error: 'Họ và tên không được để trống.' };
  }

  try {
    // 1. Primary approach: Call dedicated SECURITY DEFINER RPC
    const { data: rpcData, error: rpcErr } = await supabase.rpc('update_my_profile_name', {
      p_full_name: trimmed,
    });

    if (!rpcErr && rpcData?.success) {
      // Best-effort sync metadata
      try {
        await supabase.auth.updateUser({
          data: { full_name: trimmed },
        });
      } catch {
        // metadata sync is best-effort
      }
      return { success: true };
    }

    // 2. Fallback approach: Direct table update on public.profiles
    // Note: Do NOT include updated_at because authenticated role only has GRANT UPDATE (full_name, email).
    // Database trigger trg_profiles_timestamp handles updated_at automatically.
    const { error: profErr } = await supabase
      .from('profiles')
      .update({
        full_name: trimmed,
      })
      .eq('id', userId);

    if (profErr) {
      return { success: false, error: profErr.message };
    }

    // Best-effort sync metadata
    try {
      await supabase.auth.updateUser({
        data: { full_name: trimmed },
      });
    } catch {
      // metadata sync is best-effort
    }

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Lỗi khi cập nhật họ tên.' };
  }
}

/**
 * Change current user's password
 */
export async function changeMyPassword(newPassword: string): Promise<{ success: boolean; error?: string }> {
  if (!newPassword || newPassword.length < 8) {
    return { success: false, error: 'Mật khẩu mới phải có tối thiểu 8 ký tự.' };
  }
  if (newPassword === '123456') {
    return { success: false, error: 'Mật khẩu mới không được trùng với mật khẩu tạm thời ban đầu (123456).' };
  }

  try {
    const { error: authErr } = await supabase.auth.updateUser({
      password: newPassword,
    });

    if (authErr) {
      return { success: false, error: authErr.message || 'Lỗi khi cập nhật mật khẩu.' };
    }

    // Mark must_change_password as false if applicable
    await supabase.rpc('complete_first_login_password_change', {
      p_new_password: newPassword,
    });

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Lỗi khi đổi mật khẩu.' };
  }
}
