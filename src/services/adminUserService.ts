import { supabase } from '../lib/supabase';
import type { Profile, UserRole } from '../types/database.types';

export interface AdminUserListItem extends Profile {
  auth_email?: string;
  has_data?: boolean;
}

export type AdminUserItem = AdminUserListItem;

export interface CreateUserInput {
  phone: string;
  full_name: string;
  role: UserRole;
  department?: string;
  password?: string;
}

/**
 * Helper to extract user-friendly error message from Edge Function response
 */
async function extractEdgeFunctionError(error: any): Promise<string> {
  if (!error) return 'Đã xảy ra lỗi không xác định.';
  try {
    if (error.context && typeof error.context.json === 'function') {
      const body = await error.context.json();
      if (body?.error) return body.error;
    }
  } catch (_) {}
  return error.message || 'Lỗi khi gọi Edge Function.';
}

/**
 * Fetch all user profiles for Admin management
 */
export async function fetchAdminUsers(): Promise<{ data: Profile[]; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) return { data: [], error: error.message };
    return { data: (data as Profile[]) || [], error: null };
  } catch (err: any) {
    return { data: [], error: err.message || 'Lỗi kết nối khi tải danh sách người dùng.' };
  }
}

export const fetchAllUsers = fetchAdminUsers;

/**
 * Create a new user via admin-manage-user Edge Function
 */
export async function createAdminUser(input: CreateUserInput): Promise<{ success: boolean; error?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke('admin-manage-user', {
      body: {
        action: 'create',
        phone: input.phone.trim(),
        full_name: input.full_name.trim(),
        role: input.role,
        department: input.department ? input.department.trim() : 'Sản xuất',
        password: input.password ? input.password.trim() : '123456',
      },
    });

    if (error) {
      return { success: false, error: await extractEdgeFunctionError(error) };
    }
    if (data?.error) {
      return { success: false, error: data.error };
    }

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Lỗi kết nối khi tạo tài khoản.' };
  }
}

/**
 * Update user full name via admin-manage-user Edge Function
 */
export async function updateAdminUserName(userId: string, fullName: string): Promise<{ success: boolean; error?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke('admin-manage-user', {
      body: {
        action: 'update_name',
        user_id: userId,
        full_name: fullName.trim(),
      },
    });

    if (error) return { success: false, error: await extractEdgeFunctionError(error) };
    if (data?.error) return { success: false, error: data.error };

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Lỗi khi cập nhật họ tên.' };
  }
}

/**
 * Update user phone number via admin-manage-user Edge Function
 */
export async function updateAdminUserPhone(userId: string, newPhone: string): Promise<{ success: boolean; error?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke('admin-manage-user', {
      body: {
        action: 'update_phone',
        user_id: userId,
        phone: newPhone.trim(),
      },
    });

    if (error) return { success: false, error: await extractEdgeFunctionError(error) };
    if (data?.error) return { success: false, error: data.error };

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Lỗi khi đổi số điện thoại.' };
  }
}

/**
 * Update user role via admin-manage-user Edge Function
 */
export async function updateAdminUserRole(userId: string, newRole: UserRole): Promise<{ success: boolean; error?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke('admin-manage-user', {
      body: {
        action: 'update_role',
        user_id: userId,
        role: newRole,
      },
    });

    if (error) return { success: false, error: await extractEdgeFunctionError(error) };
    if (data?.error) return { success: false, error: data.error };

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Lỗi khi thay đổi vai trò.' };
  }
}

/**
 * Enable or Disable user account via admin-manage-user Edge Function
 */
export async function toggleAdminUserStatus(userId: string, activate: boolean): Promise<{ success: boolean; error?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke('admin-manage-user', {
      body: {
        action: activate ? 'activate' : 'deactivate',
        user_id: userId,
      },
    });

    if (error) return { success: false, error: await extractEdgeFunctionError(error) };
    if (data?.error) return { success: false, error: data.error };

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Lỗi khi thay đổi trạng thái tài khoản.' };
  }
}

/**
 * Reset user password via admin-manage-user Edge Function
 */
export async function resetAdminUserPassword(userId: string, newPassword?: string): Promise<{ success: boolean; error?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke('admin-manage-user', {
      body: {
        action: 'reset_password',
        user_id: userId,
        password: newPassword ? newPassword.trim() : '123456',
      },
    });

    if (error) return { success: false, error: await extractEdgeFunctionError(error) };
    if (data?.error) return { success: false, error: data.error };

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Lỗi khi đặt lại mật khẩu.' };
  }
}

/**
 * Conditionally delete user via admin-manage-user Edge Function
 */
export async function deleteAdminUser(userId: string): Promise<{ success: boolean; error?: string; hasDataReferences?: boolean }> {
  try {
    const { data, error } = await supabase.functions.invoke('admin-manage-user', {
      body: {
        action: 'delete',
        user_id: userId,
      },
    });

    if (error) return { success: false, error: await extractEdgeFunctionError(error) };
    if (data?.error) {
      return {
        success: false,
        error: data.error,
        hasDataReferences: Boolean(data.has_data_references),
      };
    }

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Lỗi khi xóa người dùng.' };
  }
}

/**
 * Appoint or revoke department leader via RPC admin_set_department_leader
 */
export async function setDepartmentLeader(
  userId: string,
  isLeader: boolean
): Promise<{ success: boolean; error?: string; message?: string }> {
  try {
    const { data, error } = await supabase.rpc('admin_set_department_leader', {
      p_user_id: userId,
      p_is_leader: isLeader,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    if (data?.error) {
      return { success: false, error: data.error };
    }

    return { success: true, message: data?.message };
  } catch (err: any) {
    return { success: false, error: err.message || 'Lỗi khi cập nhật chức vụ Trưởng bộ phận.' };
  }
}

/**
 * Revoke all active devices for a user (Emergency Logout / Lost Device)
 */
export async function revokeAdminUserDevices(userId: string): Promise<{ success: boolean; error?: string; revokedCount?: number }> {
  try {
    const { data, error } = await supabase.rpc('admin_revoke_all_user_devices', {
      p_target_user_id: userId,
    });

    if (error) {
      // Fallback via Edge Function
      const { data: edgeData, error: edgeErr } = await supabase.functions.invoke('admin-manage-user', {
        body: {
          action: 'revoke_devices',
          user_id: userId,
        },
      });
      if (edgeErr) return { success: false, error: await extractEdgeFunctionError(edgeErr) };
      if (edgeData?.error) return { success: false, error: edgeData.error };
      return { success: true, revokedCount: edgeData?.revoked_count };
    }

    if (data?.error) return { success: false, error: data.error };
    return { success: true, revokedCount: data?.revoked_count };
  } catch (err: any) {
    return { success: false, error: err.message || 'Lỗi khi thu hồi phiên thiết bị.' };
  }
}

