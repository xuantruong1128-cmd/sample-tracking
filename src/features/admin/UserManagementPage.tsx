import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '../auth/AuthContext';
import {
  fetchAllUsers,
  createAdminUser,
  updateAdminUserName,
  updateAdminUserPhone,
  updateAdminUserRole,
  toggleAdminUserStatus,
  resetAdminUserPassword,
  deleteAdminUser,
  setDepartmentLeader,
  revokeAdminUserDevices,
  type AdminUserItem,
} from '../../services/adminUserService';
import { RoleBadge } from '../../components/common/Badge';
import type { UserRole } from '../../types/auth';
import {
  Users,
  UserPlus,
  Search,
  RefreshCw,
  Edit2,
  Shield,
  KeyRound,
  Trash2,
  CheckCircle2,
  AlertCircle,
  X,
  Loader2,
  Lock,
  Unlock,
  AlertTriangle,
  Crown,
  Smartphone,
} from 'lucide-react';

export const UserManagementPage: React.FC = () => {
  const { profile: currentAdmin } = useAuth();

  const [users, setUsers] = useState<AdminUserItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  // Modals state
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editUser, setEditUser] = useState<AdminUserItem | null>(null);
  const [roleModalUser, setRoleModalUser] = useState<AdminUserItem | null>(null);
  const [resetModalUser, setResetModalUser] = useState<AdminUserItem | null>(null);
  const [deleteModalUser, setDeleteModalUser] = useState<AdminUserItem | null>(null);
  const [revokeDevicesUser, setRevokeDevicesUser] = useState<AdminUserItem | null>(null);

  // Load users
  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetchAllUsers();
    if (res.error) {
      setError(res.error);
    } else {
      setUsers(res.data || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  // Flash success message helper
  const notifySuccess = (msg: string) => {
    setActionSuccess(msg);
    setTimeout(() => setActionSuccess(null), 4000);
  };

  // Filtered users list
  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      // Search term (name or phone)
      const term = searchTerm.toLowerCase().trim();
      const matchSearch =
        !term ||
        u.full_name.toLowerCase().includes(term) ||
        u.phone.toLowerCase().includes(term);

      // Role filter
      const matchRole = roleFilter === 'ALL' || u.role === roleFilter;

      // Status filter
      const matchStatus =
        statusFilter === 'ALL' ||
        (statusFilter === 'ACTIVE' && u.is_active) ||
        (statusFilter === 'INACTIVE' && !u.is_active);

      return matchSearch && matchRole && matchStatus;
    });
  }, [users, searchTerm, roleFilter, statusFilter]);

  // Handle status toggle (Enable / Disable)
  const handleToggleStatus = async (user: AdminUserItem) => {
    const nextStatus = !user.is_active;
    const actionLabel = nextStatus ? 'kích hoạt' : 'vô hiệu hóa';
    if (!window.confirm(`Bạn có chắc chắn muốn ${actionLabel} tài khoản "${user.full_name}" (${user.phone})?`)) {
      return;
    }

    const res = await toggleAdminUserStatus(user.id, nextStatus);
    if (!res.success) {
      alert(res.error || `Thao tác ${actionLabel} thất bại.`);
      return;
    }

    notifySuccess(`Đã ${actionLabel} thành công tài khoản "${user.full_name}".`);
    loadUsers();
  };

  // Handle Leader appointment / revocation (Workflow V2)
  const handleToggleLeader = async (user: AdminUserItem) => {
    if (user.role === 'Admin') return;
    const nextIsLeader = !user.is_department_leader;
    const confirmPrompt = nextIsLeader
      ? `Xác nhận bổ nhiệm "${user.full_name}" làm Trưởng nhóm (Leader) bộ phận ${user.role}?\n\nLưu ý: Mỗi phòng ban chỉ có tối đa 1 Trưởng nhóm chính. Nếu đang có Trưởng nhóm khác thuộc ${user.role}, hệ thống sẽ tự động chuyển vị trí đó về nhân viên thường.`
      : `Xác nhận thu hồi quyền Trưởng nhóm (Leader) của "${user.full_name}"?`;

    if (!window.confirm(confirmPrompt)) {
      return;
    }

    const res = await setDepartmentLeader(user.id, nextIsLeader);
    if (!res.success) {
      alert(res.error || 'Thao tác cập nhật Trưởng nhóm thất bại.');
      return;
    }

    notifySuccess(res.message || (nextIsLeader ? `Đã bổ nhiệm "${user.full_name}" làm Trưởng nhóm ${user.role}.` : `Đã thu hồi quyền Trưởng nhóm của "${user.full_name}".`));
    loadUsers();
  };

  return (
    <div className="space-y-5 animate-in fade-in duration-150">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-white p-4 sm:p-5 rounded-xl border border-slate-200/80 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center shadow-xs">
            <Users className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-lg sm:text-xl font-bold text-slate-900 tracking-tight">
              Quản lý Người dùng
            </h1>
            <p className="text-xs text-slate-500">
              Cấp phát tài khoản, phân quyền vai trò và quản lý quyền truy cập hệ thống
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={loadUsers}
            disabled={loading}
            className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg border border-slate-200 transition"
            title="Làm mới danh sách"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => setCreateModalOpen(true)}
            className="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg shadow-xs transition"
          >
            <UserPlus className="w-4 h-4" />
            <span>Tạo User mới</span>
          </button>
        </div>
      </div>

      {/* Global Alerts */}
      {actionSuccess && (
        <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-2 text-xs text-emerald-800 font-medium animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
          <span>{actionSuccess}</span>
        </div>
      )}
      {error && (
        <div className="p-3.5 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-xs text-red-800 font-medium">
          <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Search and Filters */}
      <div className="bg-white p-3.5 sm:p-4 rounded-xl border border-slate-200/80 shadow-xs flex flex-col md:flex-row items-stretch md:items-center gap-3">
        {/* Search Input */}
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Tìm kiếm theo họ tên hoặc số điện thoại..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent placeholder:text-slate-400"
          />
        </div>

        {/* Role Filter */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-500 whitespace-nowrap">Vai trò:</span>
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="px-2.5 py-2 border border-slate-300 rounded-lg text-xs font-medium text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
          >
            <option value="ALL">Tất cả vai trò</option>
            <option value="Admin">Admin</option>
            <option value="Planning">Planning</option>
            <option value="PE-MFG">PE-MFG</option>
            <option value="QA">QA</option>
            <option value="Drawing">Drawing</option>
          </select>
        </div>

        {/* Status Filter */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-500 whitespace-nowrap">Trạng thái:</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-2.5 py-2 border border-slate-300 rounded-lg text-xs font-medium text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
          >
            <option value="ALL">Tất cả</option>
            <option value="ACTIVE">Đang hoạt động</option>
            <option value="INACTIVE">Đã khóa</option>
          </select>
        </div>
      </div>

      {/* Compact User Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-800 text-white font-semibold uppercase tracking-wider text-[11px]">
                <th className="py-3 px-4 w-[28%]">Name</th>
                <th className="py-3 px-3 w-[18%]">Phone</th>
                <th className="py-3 px-3 w-[16%]">Role</th>
                <th className="py-3 px-3 w-[14%]">Status</th>
                <th className="py-3 px-4 text-right w-[24%]">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-slate-400">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-blue-600" />
                    <span>Đang tải danh sách người dùng...</span>
                  </td>
                </tr>
              ) : filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-slate-400">
                    Không tìm thấy người dùng nào phù hợp với điều kiện tìm kiếm.
                  </td>
                </tr>
              ) : (
                filteredUsers.map((user) => (
                  <tr
                    key={user.id}
                    className={`hover:bg-slate-50/80 transition ${
                      !user.is_active ? 'bg-slate-50/50 opacity-75' : ''
                    }`}
                  >
                    {/* 1. Name */}
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2.5">
                        <div
                          className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs uppercase flex-shrink-0 ${
                            user.is_active
                              ? 'bg-blue-100 text-blue-700 border border-blue-200'
                              : 'bg-slate-200 text-slate-500'
                          }`}
                        >
                          {user.full_name?.charAt(0) || 'U'}
                        </div>
                        <div className="truncate">
                          <span className="font-semibold text-slate-900 block truncate">
                            {user.full_name}
                            {user.id === currentAdmin?.id && (
                              <span className="ml-1.5 px-1.5 py-0.2 bg-blue-50 text-blue-700 border border-blue-200 rounded text-[10px] font-bold">
                                Bạn
                              </span>
                            )}
                          </span>
                          <span className="text-[10px] text-slate-400 block truncate">
                            {user.department || 'Chưa gán phòng ban'}
                          </span>
                        </div>
                      </div>
                    </td>

                    {/* 2. Phone */}
                    <td className="py-3 px-3">
                      <span className="font-mono text-slate-700 font-medium">
                        {user.phone}
                      </span>
                    </td>

                    {/* 3. Role */}
                    <td className="py-3 px-3">
                      <div className="flex flex-col gap-1 items-start">
                        <RoleBadge role={user.role} />
                        {user.is_department_leader && user.role !== 'Admin' && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-300">
                            <Crown className="w-3 h-3 text-amber-600" />
                            <span>Leader</span>
                          </span>
                        )}
                      </div>
                    </td>

                    {/* 4. Status */}
                    <td className="py-3 px-3">
                      {user.is_active ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
                          <span className="w-1.5 h-1.5 rounded-full bg-slate-400"></span>
                          Disabled
                        </span>
                      )}
                    </td>

                    {/* 5. Actions */}
                    <td className="py-3 px-4 text-right">
                      <div className="inline-flex items-center gap-1 justify-end">
                        {/* Edit Name & Phone */}
                        <button
                          onClick={() => setEditUser(user)}
                          className="p-1.5 text-slate-500 hover:text-blue-700 hover:bg-blue-50 rounded-md transition"
                          title="Sửa Tên & Số điện thoại"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>

                        {/* Change Role */}
                        <button
                          onClick={() => setRoleModalUser(user)}
                          className="p-1.5 text-slate-500 hover:text-indigo-700 hover:bg-indigo-50 rounded-md transition"
                          title="Đổi vai trò phân quyền"
                        >
                          <Shield className="w-3.5 h-3.5" />
                        </button>

                        {/* Appoint / Revoke Leader */}
                        {user.role !== 'Admin' && (
                          <button
                            onClick={() => handleToggleLeader(user)}
                            className={`p-1.5 rounded-md transition ${
                              user.is_department_leader
                                ? 'text-amber-600 hover:text-amber-800 hover:bg-amber-100/70 bg-amber-50 border border-amber-200'
                                : 'text-slate-400 hover:text-amber-600 hover:bg-amber-50'
                            }`}
                            title={user.is_department_leader ? 'Thu hồi quyền Trưởng nhóm' : 'Bổ nhiệm làm Trưởng nhóm (Leader)'}
                          >
                            <Crown className="w-3.5 h-3.5" />
                          </button>
                        )}

                        {/* Toggle Active / Inactive */}
                        <button
                          onClick={() => handleToggleStatus(user)}
                          className={`p-1.5 rounded-md transition ${
                            user.is_active
                              ? 'text-slate-500 hover:text-amber-700 hover:bg-amber-50'
                              : 'text-slate-400 hover:text-emerald-700 hover:bg-emerald-50'
                          }`}
                          title={user.is_active ? 'Khóa tài khoản (Disable)' : 'Mở khóa tài khoản (Enable)'}
                        >
                          {user.is_active ? (
                            <Lock className="w-3.5 h-3.5" />
                          ) : (
                            <Unlock className="w-3.5 h-3.5" />
                          )}
                        </button>

                        {/* Reset Password */}
                        <button
                          onClick={() => setResetModalUser(user)}
                          className="p-1.5 text-slate-500 hover:text-purple-700 hover:bg-purple-50 rounded-md transition"
                          title="Đặt lại mật khẩu"
                        >
                          <KeyRound className="w-3.5 h-3.5" />
                        </button>

                        {/* Revoke All Active Devices */}
                        <button
                          onClick={() => setRevokeDevicesUser(user)}
                          className="p-1.5 text-slate-400 hover:text-orange-600 hover:bg-orange-50 rounded-md transition"
                          title="Đăng xuất khỏi tất cả thiết bị"
                        >
                          <Smartphone className="w-3.5 h-3.5" />
                        </button>

                        {/* Delete User */}
                        <button
                          onClick={() => setDeleteModalUser(user)}
                          className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md transition"
                          title="Xóa người dùng (Có điều kiện)"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Footer Summary */}
        <div className="px-4 py-2.5 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
          <span>
            Tổng cộng: <strong>{filteredUsers.length}</strong> người dùng (trên tổng số {users.length})
          </span>
          <span className="hidden sm:inline">
            Thao tác chạy qua Supabase Edge Function bảo mật
          </span>
        </div>
      </div>

      {/* ---------------- MODALS ---------------- */}

      {/* 1. Modal Tạo User */}
      {createModalOpen && (
        <CreateUserModal
          onClose={() => setCreateModalOpen(false)}
          onSuccess={(msg) => {
            setCreateModalOpen(false);
            notifySuccess(msg);
            loadUsers();
          }}
        />
      )}

      {/* 2. Modal Sửa Tên & Số Điện Thoại */}
      {editUser && (
        <EditUserModal
          user={editUser}
          onClose={() => setEditUser(null)}
          onSuccess={(msg) => {
            setEditUser(null);
            notifySuccess(msg);
            loadUsers();
          }}
        />
      )}

      {/* 3. Modal Đổi Vai Trò */}
      {roleModalUser && (
        <ChangeRoleModal
          user={roleModalUser}
          onClose={() => setRoleModalUser(null)}
          onSuccess={(msg) => {
            setRoleModalUser(null);
            notifySuccess(msg);
            loadUsers();
          }}
        />
      )}

      {/* 4. Modal Đặt Lại Mật Khẩu */}
      {resetModalUser && (
        <ResetPasswordModal
          user={resetModalUser}
          onClose={() => setResetModalUser(null)}
          onSuccess={(msg) => {
            setResetModalUser(null);
            notifySuccess(msg);
            loadUsers();
          }}
        />
      )}

      {/* 5. Modal Xóa User Có Điều Kiện */}
      {deleteModalUser && (
        <DeleteUserModal
          user={deleteModalUser}
          onClose={() => setDeleteModalUser(null)}
          onSuccess={(msg) => {
            setDeleteModalUser(null);
            notifySuccess(msg);
            loadUsers();
          }}
        />
      )}

      {/* 6. Modal Đăng Xuất Tất Cả Thiết Bị */}
      {revokeDevicesUser && (
        <RevokeDevicesModal
          user={revokeDevicesUser}
          onClose={() => setRevokeDevicesUser(null)}
          onSuccess={(msg) => {
            setRevokeDevicesUser(null);
            notifySuccess(msg);
            loadUsers();
          }}
        />
      )}
    </div>
  );
};

// ============================================================================
// SUB-MODAL 1: CREATE USER
// ============================================================================
const CreateUserModal: React.FC<{
  onClose: () => void;
  onSuccess: (msg: string) => void;
}> = ({ onClose, onSuccess }) => {
  const [phone, setPhone] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<UserRole>('PE-MFG');
  const [department, setDepartment] = useState('Sản xuất');
  const [password, setPassword] = useState('123456');
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!fullName.trim()) return setFormError('Vui lòng nhập họ và tên.');
    if (!phone.trim()) return setFormError('Vui lòng nhập số điện thoại.');

    try {
      setLoading(true);
      const res = await createAdminUser({
        phone: phone.trim(),
        full_name: fullName.trim(),
        role,
        department: department.trim(),
        password: password.trim() || '123456',
      });

      if (!res.success) {
        setFormError(res.error || 'Tạo người dùng thất bại.');
        return;
      }

      onSuccess(`Tạo tài khoản "${fullName}" thành công!`);
    } catch (err: any) {
      setFormError(err.message || 'Lỗi khi tạo tài khoản.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
          <div className="flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-blue-600" />
            <h3 className="text-sm font-bold text-slate-800">Tạo tài khoản người dùng mới</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-3.5 text-xs">
          {formError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{formError}</span>
            </div>
          )}

          <div>
            <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
              Họ và tên <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
              placeholder="Ví dụ: Nguyễn Văn A"
              required
            />
          </div>

          <div>
            <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
              Số điện thoại đăng nhập <span className="text-red-500">*</span>
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono"
              placeholder="Ví dụ: 0912345678"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                Vai trò hệ thống <span className="text-red-500">*</span>
              </label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as UserRole)}
                className="w-full px-2.5 py-2 border border-slate-300 rounded-lg text-xs font-medium"
              >
                <option value="PE-MFG">PE-MFG (Sản xuất)</option>
                <option value="Planning">Planning (Kế hoạch)</option>
                <option value="QA">QA (Chất lượng)</option>
                <option value="Drawing">Drawing (Bản vẽ &amp; Tài liệu kỹ thuật)</option>
                <option value="Admin">Admin (Quản trị)</option>
              </select>
            </div>

            <div>
              <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                Phòng ban
              </label>
              <input
                type="text"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
                placeholder="Ví dụ: Sản xuất"
              />
            </div>
          </div>

          <div>
            <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
              Mật khẩu ban đầu
            </label>
            <input
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono"
              placeholder="Mặc định: 123456"
            />
            <p className="text-[10px] text-slate-400 mt-1">
              Người dùng sẽ được yêu cầu đổi mật khẩu ở lần đăng nhập đầu tiên.
            </p>
          </div>

          <div className="pt-2 flex justify-end gap-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 border border-slate-300 rounded-lg font-semibold text-slate-700 hover:bg-slate-50"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg shadow-xs flex items-center gap-1.5 disabled:opacity-60"
            >
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              <span>Tạo tài khoản</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ============================================================================
// SUB-MODAL 2: EDIT NAME & PHONE
// ============================================================================
const EditUserModal: React.FC<{
  user: AdminUserItem;
  onClose: () => void;
  onSuccess: (msg: string) => void;
}> = ({ user, onClose, onSuccess }) => {
  const [fullName, setFullName] = useState(user.full_name);
  const [phone, setPhone] = useState(user.phone);
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const nameChanged = fullName.trim() !== user.full_name;
    const phoneChanged = phone.trim() !== user.phone;

    if (!nameChanged && !phoneChanged) {
      onClose();
      return;
    }

    try {
      setLoading(true);

      // 1. Update name if changed
      if (nameChanged) {
        const nameRes = await updateAdminUserName(user.id, fullName.trim());
        if (!nameRes.success) throw new Error(nameRes.error || 'Cập nhật họ tên thất bại.');
      }

      // 2. Update phone if changed
      if (phoneChanged) {
        const phoneRes = await updateAdminUserPhone(user.id, phone.trim());
        if (!phoneRes.success) throw new Error(phoneRes.error || 'Đổi số điện thoại thất bại.');
      }

      onSuccess(`Đã cập nhật thông tin tài khoản "${fullName.trim()}" thành công!`);
    } catch (err: any) {
      setFormError(err.message || 'Lỗi khi cập nhật thông tin.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
          <div className="flex items-center gap-2">
            <Edit2 className="w-4 h-4 text-blue-600" />
            <h3 className="text-sm font-bold text-slate-800">Sửa thông tin người dùng</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-3.5 text-xs">
          {formError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{formError}</span>
            </div>
          )}

          <div>
            <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
              Họ và tên <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
              required
            />
          </div>

          <div>
            <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
              Số điện thoại đăng nhập <span className="text-red-500">*</span>
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono"
              required
            />
            <p className="text-[10px] text-amber-600 mt-1 font-medium">
              ⚠️ Lưu ý: Đổi số điện thoại sẽ thay đổi tài khoản đăng nhập của người dùng.
            </p>
          </div>

          <div className="pt-2 flex justify-end gap-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 border border-slate-300 rounded-lg font-semibold text-slate-700 hover:bg-slate-50"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg shadow-xs flex items-center gap-1.5 disabled:opacity-60"
            >
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              <span>Lưu thay đổi</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ============================================================================
// SUB-MODAL 3: CHANGE ROLE
// ============================================================================
const ChangeRoleModal: React.FC<{
  user: AdminUserItem;
  onClose: () => void;
  onSuccess: (msg: string) => void;
}> = ({ user, onClose, onSuccess }) => {
  const [selectedRole, setSelectedRole] = useState<UserRole>(user.role);
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedRole === user.role) {
      onClose();
      return;
    }

    try {
      setLoading(true);
      const res = await updateAdminUserRole(user.id, selectedRole);
      if (!res.success) {
        setFormError(res.error || 'Thay đổi vai trò thất bại.');
        return;
      }

      onSuccess(`Đã thay đổi vai trò của "${user.full_name}" thành [${selectedRole}].`);
    } catch (err: any) {
      setFormError(err.message || 'Lỗi khi cập nhật vai trò.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-sm overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-indigo-600" />
            <h3 className="text-sm font-bold text-slate-800">Đổi vai trò phân quyền</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-3.5 text-xs">
          {formError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{formError}</span>
            </div>
          )}

          <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-100">
            <span className="text-slate-500 block text-[11px]">Người dùng:</span>
            <span className="font-bold text-slate-900 block">{user.full_name}</span>
            <span className="text-slate-500 font-mono text-[11px]">{user.phone}</span>
          </div>

          <div>
            <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1.5">
              Chọn vai trò mới
            </label>
            <div className="space-y-1.5">
              {(['Planning', 'PE-MFG', 'QA', 'Drawing', 'Admin'] as UserRole[]).map((r) => (
                <label
                  key={r}
                  className={`flex items-center justify-between p-2.5 border rounded-lg cursor-pointer transition ${
                    selectedRole === r
                      ? 'border-indigo-600 bg-indigo-50/40 text-indigo-900 font-bold'
                      : 'border-slate-200 hover:bg-slate-50 text-slate-700 font-medium'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="userRole"
                      value={r}
                      checked={selectedRole === r}
                      onChange={() => setSelectedRole(r)}
                      className="text-indigo-600 focus:ring-indigo-500"
                    />
                    <span>{r}</span>
                  </div>
                  <RoleBadge role={r} />
                </label>
              ))}
            </div>
            <p className="text-[10px] text-slate-400 mt-2">
              Quyền hạn mới sẽ được áp dụng trực tiếp tại tầng cơ sở dữ liệu (RLS & RPC).
            </p>
          </div>

          <div className="pt-2 flex justify-end gap-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 border border-slate-300 rounded-lg font-semibold text-slate-700 hover:bg-slate-50"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-lg shadow-xs flex items-center gap-1.5 disabled:opacity-60"
            >
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              <span>Cập nhật vai trò</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ============================================================================
// SUB-MODAL 4: RESET PASSWORD
// ============================================================================
const ResetPasswordModal: React.FC<{
  user: AdminUserItem;
  onClose: () => void;
  onSuccess: (msg: string) => void;
}> = ({ user, onClose, onSuccess }) => {
  const [newPassword, setNewPassword] = useState('123456');
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPassword || newPassword.length < 6) {
      setFormError('Mật khẩu phải có tối thiểu 6 ký tự.');
      return;
    }

    try {
      setLoading(true);
      const res = await resetAdminUserPassword(user.id, newPassword);
      if (!res.success) {
        setFormError(res.error || 'Đặt lại mật khẩu thất bại.');
        return;
      }

      onSuccess(`Đã đặt lại mật khẩu cho "${user.full_name}" thành công!`);
    } catch (err: any) {
      setFormError(err.message || 'Lỗi khi đặt lại mật khẩu.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-sm overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
          <div className="flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-purple-600" />
            <h3 className="text-sm font-bold text-slate-800">Đặt lại mật khẩu người dùng</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-3.5 text-xs">
          {formError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{formError}</span>
            </div>
          )}

          <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-100">
            <span className="text-slate-500 block text-[11px]">Tài khoản:</span>
            <span className="font-bold text-slate-900 block">{user.full_name}</span>
            <span className="text-slate-500 font-mono text-[11px]">{user.phone}</span>
          </div>

          <div>
            <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
              Mật khẩu mới
            </label>
            <input
              type="text"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono"
              placeholder="Mặc định: 123456"
              required
            />
            <p className="text-[10px] text-slate-400 mt-1">
              Hệ thống sẽ tự động kích hoạt lại cờ bắt buộc đổi mật khẩu khi người dùng đăng nhập.
            </p>
          </div>

          <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 text-[11px] leading-relaxed">
            <strong>⚠️ Chú ý bảo mật:</strong> Đặt lại mật khẩu sẽ tự động thu hồi và đăng xuất tất cả thiết bị (Máy tính & Điện thoại) đang sử dụng tài khoản này.
          </div>

          <div className="pt-2 flex justify-end gap-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 border border-slate-300 rounded-lg font-semibold text-slate-700 hover:bg-slate-50"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white font-semibold rounded-lg shadow-xs flex items-center gap-1.5 disabled:opacity-60"
            >
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              <span>Đặt lại mật khẩu</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ============================================================================
// SUB-MODAL 5: CONDITIONAL DELETE USER (DOUBLE CONFIRMATION)
// ============================================================================
const DeleteUserModal: React.FC<{
  user: AdminUserItem;
  onClose: () => void;
  onSuccess: (msg: string) => void;
}> = ({ user, onClose, onSuccess }) => {
  const [confirmText, setConfirmText] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [hasDataRef, setHasDataRef] = useState(false);

  const handleDelete = async (e: React.FormEvent) => {
    e.preventDefault();
    if (confirmText.trim() !== 'XÓA') {
      setErrorMsg('Vui lòng gõ chính xác chữ "XÓA" để xác nhận.');
      return;
    }

    try {
      setLoading(true);
      setErrorMsg(null);
      const res = await deleteAdminUser(user.id);
      if (!res.success) {
        setErrorMsg(res.error || 'Xóa người dùng thất bại.');
        if (res.hasDataReferences) {
          setHasDataRef(true);
        }
        return;
      }

      onSuccess(`Đã xóa tài khoản "${user.full_name}" thành công.`);
    } catch (err: any) {
      setErrorMsg(err.message || 'Lỗi khi xóa người dùng.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl border border-red-200 w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="px-5 py-4 border-b border-red-100 flex items-center justify-between bg-red-50/50">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-red-600" />
            <h3 className="text-sm font-bold text-red-900">Xác nhận xóa tài khoản vĩnh viễn</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleDelete} className="p-5 space-y-3.5 text-xs">
          {errorMsg && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-800 leading-relaxed font-medium">
              {errorMsg}
            </div>
          )}

          <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-slate-700">
            <p className="font-semibold text-slate-900">
              Bạn đang yêu cầu xóa: {user.full_name} ({user.phone})
            </p>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Vai trò: {user.role} | Phòng ban: {user.department || 'Không xác định'}
            </p>
          </div>

          {hasDataRef ? (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-900 text-xs leading-relaxed">
              💡 <strong>Khuyến nghị:</strong> Thay vì xóa vĩnh viễn, bạn hãy đóng modal này và nhấn biểu tượng 🔒 để <strong>Vô hiệu hóa (Disable)</strong> tài khoản. Tài khoản bị khóa sẽ không thể đăng nhập nhưng dữ liệu lịch sử sản xuất vẫn được bảo toàn nguyên vẹn.
            </div>
          ) : (
            <>
              <p className="text-slate-600 leading-relaxed">
                Hành động này sẽ <strong>xóa hoàn toàn</strong> hồ sơ và tài khoản xác thực Auth. Chỉ có thể thực hiện nếu người dùng này chưa từng liên kết với bất kỳ lệnh JOB, kết quả chạy máy hay kiểm tra QA nào.
              </p>

              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Nhập chữ <span className="text-red-600">XÓA</span> để xác nhận bước 2:
                </label>
                <input
                  type="text"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-bold text-red-600 focus:outline-none focus:ring-2 focus:ring-red-600"
                  placeholder="Gõ XÓA"
                  required
                />
              </div>
            </>
          )}

          <div className="pt-2 flex justify-end gap-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 border border-slate-300 rounded-lg font-semibold text-slate-700 hover:bg-slate-50"
            >
              Đóng
            </button>
            {!hasDataRef && (
              <button
                type="submit"
                disabled={loading || confirmText.trim() !== 'XÓA'}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg shadow-xs flex items-center gap-1.5 disabled:opacity-50"
              >
                {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                <span>Xác nhận xóa</span>
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};

// ============================================================================
// SUB-MODAL 6: REVOKE ALL ACTIVE DEVICES
// ============================================================================
const RevokeDevicesModal: React.FC<{
  user: AdminUserItem;
  onClose: () => void;
  onSuccess: (msg: string) => void;
}> = ({ user, onClose, onSuccess }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await revokeAdminUserDevices(user.id);
      if (!res.success) {
        setError(res.error || 'Thu hồi thiết bị thất bại.');
        return;
      }
      onSuccess(`Đã đăng xuất toàn bộ thiết bị của "${user.full_name}" thành công!`);
    } catch (err: any) {
      setError(err.message || 'Lỗi khi đăng xuất thiết bị.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-sm overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-amber-50/70">
          <div className="flex items-center gap-2">
            <Smartphone className="w-4 h-4 text-amber-600" />
            <h3 className="text-sm font-bold text-slate-800">Đăng xuất tất cả thiết bị</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-3.5 text-xs">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-100">
            <span className="text-slate-500 block text-[11px]">Người dùng:</span>
            <span className="font-bold text-slate-900 block">{user.full_name}</span>
            <span className="text-slate-500 font-mono text-[11px]">{user.phone}</span>
          </div>

          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-900 text-xs leading-relaxed space-y-1">
            <p className="font-semibold">Xác nhận thu hồi thiết bị?</p>
            <p className="text-[11px] text-amber-800">
              Hành động này sẽ giải phóng tất cả khe thiết bị (Máy tính & Điện thoại). Mọi phiên làm việc đang mở trên các máy của người dùng sẽ bị đóng ngay lập tức, cho phép người dùng đăng nhập lại từ đầu.
            </p>
          </div>

          <div className="pt-2 flex justify-end gap-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-3.5 py-2 border border-slate-300 rounded-lg font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              Hủy
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={loading}
              className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white font-semibold rounded-lg shadow-xs flex items-center gap-1.5 disabled:opacity-60 cursor-pointer"
            >
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              <span>Đăng xuất tất cả thiết bị</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
