import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Header } from '../components/common/Header';
import { UserProfileModal } from '../components/profile/UserProfileModal';
import { UserManagementPage } from '../features/admin/UserManagementPage';
import { AuthContext } from '../features/auth/AuthContext';
import * as adminService from '../services/adminUserService';
import * as profileService from '../services/profileService';

describe('SAMPLE TRACKING — UI-05: Profile & Admin User Management Test Suite', () => {
  const mockAdminProfile = {
    id: 'admin-uuid-01',
    phone: '0968041128',
    email: '84968041128@sampletracking.local',
    full_name: 'Nguyễn Quản Trị',
    role: 'Admin' as const,
    department: 'Ban Quản Trị',
    is_active: true,
    must_change_password: false,
    can_make_pe_decisions: true,
  };

  const mockAdminAuthContext = {
    user: {
      id: 'admin-uuid-01',
      phone: '0968041128',
      email: '84968041128@sampletracking.local',
      profile: mockAdminProfile,
    },
    profile: mockAdminProfile,
    loading: false,
    error: null,
    login: vi.fn(),
    logout: vi.fn(),
    refreshProfile: vi.fn(),
  };

  const mockUsersList = [
    {
      id: 'admin-uuid-01',
      phone: '0968041128',
      full_name: 'Nguyễn Quản Trị',
      role: 'Admin' as const,
      department: 'Ban Quản Trị',
      is_active: true,
      must_change_password: false,
      can_make_pe_decisions: true,
    },
    {
      id: 'pe-uuid-02',
      phone: '0911000002',
      full_name: 'Trần Kỹ Thuật (PE)',
      role: 'PE-MFG' as const,
      department: 'Kỹ Thuật',
      is_active: true,
      must_change_password: false,
      can_make_pe_decisions: true,
    },
    {
      id: 'qa-uuid-03',
      phone: '0911000003',
      full_name: 'Lê Kiểm Hàng (QA)',
      role: 'QA' as const,
      department: 'QA',
      is_active: false,
      must_change_password: false,
      can_make_pe_decisions: false,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(adminService, 'fetchAllUsers').mockResolvedValue({
      data: mockUsersList,
      error: null,
    });
  });

  // --------------------------------------------------------------------------
  // SECTION A: HỒ SƠ CÁ NHÂN (PERSONAL PROFILE)
  // --------------------------------------------------------------------------
  describe('A. Hồ sơ cá nhân & Header Menu', () => {
    it('displays user full name, role, phone and opens dropdown on click', async () => {
      render(
        <MemoryRouter>
          <AuthContext.Provider value={mockAdminAuthContext}>
            <Header />
          </AuthContext.Provider>
        </MemoryRouter>
      );

      // Verify name is displayed in header
      expect(screen.getByText('Nguyễn Quản Trị')).toBeInTheDocument();
      // Verify phone is displayed
      expect(screen.getByText('0968041128')).toBeInTheDocument();

      // Click on user menu button
      const menuButton = screen.getByTitle('Menu tài khoản cá nhân');
      fireEvent.click(menuButton);

      // Verify dropdown options
      expect(screen.getByText('Hồ sơ cá nhân')).toBeInTheDocument();
      expect(screen.getByText('Đổi mật khẩu')).toBeInTheDocument();
      expect(screen.getByText('Quản lý người dùng')).toBeInTheDocument();
      expect(screen.getByText('Đăng xuất')).toBeInTheDocument();
    });

    it('allows updating full name in UserProfileModal', async () => {
      const updateSpy = vi.spyOn(profileService, 'updateMyName').mockResolvedValue({ success: true });

      render(
        <MemoryRouter>
          <AuthContext.Provider value={mockAdminAuthContext}>
            <UserProfileModal isOpen={true} initialTab="profile" onClose={vi.fn()} />
          </AuthContext.Provider>
        </MemoryRouter>
      );

      // Check current name input
      const input = screen.getByPlaceholderText('Nhập họ và tên đầy đủ');
      expect(input).toHaveValue('Nguyễn Quản Trị');

      // Edit name
      fireEvent.change(input, { target: { value: 'Nguyễn Quản Trị Mới' } });
      const submitBtn = screen.getByText('Lưu thay đổi');
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(updateSpy).toHaveBeenCalledWith('admin-uuid-01', 'Nguyễn Quản Trị Mới');
      });
      expect(screen.getByText('Cập nhật họ và tên thành công!')).toBeInTheDocument();
    });

    it('validates password change in UserProfileModal', async () => {
      const changePassSpy = vi.spyOn(profileService, 'changeMyPassword').mockResolvedValue({ success: true });

      render(
        <MemoryRouter>
          <AuthContext.Provider value={mockAdminAuthContext}>
            <UserProfileModal isOpen={true} initialTab="password" onClose={vi.fn()} />
          </AuthContext.Provider>
        </MemoryRouter>
      );

      const passInput = screen.getByPlaceholderText('Tối thiểu 8 ký tự');
      const confirmInput = screen.getByPlaceholderText('Nhập lại mật khẩu mới');
      const submitBtn = screen.getByText('Lưu mật khẩu mới');

      // Test too short
      fireEvent.change(passInput, { target: { value: 'short' } });
      fireEvent.change(confirmInput, { target: { value: 'short' } });
      fireEvent.click(submitBtn);
      expect(screen.getByText('Mật khẩu mới phải có tối thiểu 8 ký tự.')).toBeInTheDocument();

      // Test mismatched
      fireEvent.change(passInput, { target: { value: 'Password123!' } });
      fireEvent.change(confirmInput, { target: { value: 'PasswordMismatch!' } });
      fireEvent.click(submitBtn);
      expect(screen.getByText('Xác nhận mật khẩu mới không trùng khớp.')).toBeInTheDocument();

      // Test valid match
      fireEvent.change(passInput, { target: { value: 'Password123!' } });
      fireEvent.change(confirmInput, { target: { value: 'Password123!' } });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(changePassSpy).toHaveBeenCalledWith('Password123!');
      });
      expect(screen.getByText('Đổi mật khẩu thành công! Hãy ghi nhớ mật khẩu mới.')).toBeInTheDocument();
    });
  });

  // --------------------------------------------------------------------------
  // SECTION B & C: ADMIN USER MANAGEMENT TABLE & ACTIONS
  // --------------------------------------------------------------------------
  describe('B & C. Admin User Management Page', () => {
    it('renders compact 5-column table: Name | Phone | Role | Status | Actions', async () => {
      render(
        <MemoryRouter>
          <AuthContext.Provider value={mockAdminAuthContext}>
            <UserManagementPage />
          </AuthContext.Provider>
        </MemoryRouter>
      );

      // Table headers
      await waitFor(() => {
        expect(screen.getByText('Name')).toBeInTheDocument();
      });
      expect(screen.getByText('Phone')).toBeInTheDocument();
      expect(screen.getByText('Role')).toBeInTheDocument();
      expect(screen.getByText('Status')).toBeInTheDocument();
      expect(screen.getByText('Actions')).toBeInTheDocument();

      // Check users rendered
      expect(screen.getByText('Nguyễn Quản Trị')).toBeInTheDocument();
      expect(screen.getByText('Trần Kỹ Thuật (PE)')).toBeInTheDocument();
      expect(screen.getByText('Lê Kiểm Hàng (QA)')).toBeInTheDocument();

      // Check statuses
      expect(screen.getAllByText('Active').length).toBeGreaterThanOrEqual(2);
      expect(screen.getByText('Disabled')).toBeInTheDocument();
    });

    it('filters users by search query (Name or Phone)', async () => {
      render(
        <MemoryRouter>
          <AuthContext.Provider value={mockAdminAuthContext}>
            <UserManagementPage />
          </AuthContext.Provider>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('Trần Kỹ Thuật (PE)')).toBeInTheDocument();
      });

      const searchInput = screen.getByPlaceholderText('Tìm kiếm theo họ tên hoặc số điện thoại...');

      // Search by phone '0911000003'
      fireEvent.change(searchInput, { target: { value: '0911000003' } });
      expect(screen.getByText('Lê Kiểm Hàng (QA)')).toBeInTheDocument();
      expect(screen.queryByText('Trần Kỹ Thuật (PE)')).not.toBeInTheDocument();

      // Search by name 'Kỹ Thuật'
      fireEvent.change(searchInput, { target: { value: 'Kỹ Thuật' } });
      expect(screen.getByText('Trần Kỹ Thuật (PE)')).toBeInTheDocument();
      expect(screen.queryByText('Lê Kiểm Hàng (QA)')).not.toBeInTheDocument();
    });

    it('opens Create User modal and submits new user', async () => {
      const createSpy = vi.spyOn(adminService, 'createAdminUser').mockResolvedValue({ success: true });

      render(
        <MemoryRouter>
          <AuthContext.Provider value={mockAdminAuthContext}>
            <UserManagementPage />
          </AuthContext.Provider>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('Tạo User mới')).toBeInTheDocument();
      });

      // Open modal
      fireEvent.click(screen.getByText('Tạo User mới'));
      expect(screen.getByText('Tạo tài khoản người dùng mới')).toBeInTheDocument();

      // Fill form
      fireEvent.change(screen.getByPlaceholderText('Ví dụ: Nguyễn Văn A'), {
        target: { value: 'Đỗ Xuân Trường' },
      });
      fireEvent.change(screen.getByPlaceholderText('Ví dụ: 0912345678'), {
        target: { value: '0981112233' },
      });

      // Submit
      fireEvent.click(screen.getByText('Tạo tài khoản'));

      await waitFor(() => {
        expect(createSpy).toHaveBeenCalledWith({
          phone: '0981112233',
          full_name: 'Đỗ Xuân Trường',
          role: 'PE-MFG',
          department: 'Sản xuất',
          password: '123456',
        });
      });
    });

    it('opens Change Role modal and updates user role', async () => {
      const roleSpy = vi.spyOn(adminService, 'updateAdminUserRole').mockResolvedValue({ success: true });

      render(
        <MemoryRouter>
          <AuthContext.Provider value={mockAdminAuthContext}>
            <UserManagementPage />
          </AuthContext.Provider>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('Trần Kỹ Thuật (PE)')).toBeInTheDocument();
      });

      // Click role button on Trần Kỹ Thuật
      const roleButtons = screen.getAllByTitle('Đổi vai trò phân quyền');
      fireEvent.click(roleButtons[1]); // second row (PE-MFG)

      expect(screen.getByText('Đổi vai trò phân quyền')).toBeInTheDocument();

      // Select QA role
      const qaRadio = screen.getByRole('radio', { name: /qa/i });
      fireEvent.click(qaRadio);

      // Submit
      fireEvent.click(screen.getByText('Cập nhật vai trò'));

      await waitFor(() => {
        expect(roleSpy).toHaveBeenCalledWith('pe-uuid-02', 'QA');
      });
    });

    it('opens Reset Password modal and submits password reset', async () => {
      const resetSpy = vi.spyOn(adminService, 'resetAdminUserPassword').mockResolvedValue({ success: true });

      render(
        <MemoryRouter>
          <AuthContext.Provider value={mockAdminAuthContext}>
            <UserManagementPage />
          </AuthContext.Provider>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('Trần Kỹ Thuật (PE)')).toBeInTheDocument();
      });

      // Click reset password button on second user
      const resetButtons = screen.getAllByTitle('Đặt lại mật khẩu');
      fireEvent.click(resetButtons[1]);

      expect(screen.getByText('Đặt lại mật khẩu người dùng')).toBeInTheDocument();

      // Submit
      fireEvent.click(screen.getByText('Đặt lại mật khẩu'));

      await waitFor(() => {
        expect(resetSpy).toHaveBeenCalledWith('pe-uuid-02', '123456');
      });
    });

    it('opens Delete User modal with double confirmation check', async () => {
      const deleteSpy = vi.spyOn(adminService, 'deleteAdminUser').mockResolvedValue({ success: true });

      render(
        <MemoryRouter>
          <AuthContext.Provider value={mockAdminAuthContext}>
            <UserManagementPage />
          </AuthContext.Provider>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('Trần Kỹ Thuật (PE)')).toBeInTheDocument();
      });

      // Click delete button on second user
      const deleteButtons = screen.getAllByTitle('Xóa người dùng (Có điều kiện)');
      fireEvent.click(deleteButtons[1]);

      expect(screen.getByText('Xác nhận xóa tài khoản vĩnh viễn')).toBeInTheDocument();

      // Button is disabled until typing XÓA
      const confirmInput = screen.getByPlaceholderText('Gõ XÓA');
      const submitBtn = screen.getByRole('button', { name: /xác nhận xóa/i });
      expect(submitBtn).toBeDisabled();

      // Type XÓA
      fireEvent.change(confirmInput, { target: { value: 'XÓA' } });
      expect(submitBtn).not.toBeDisabled();

      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(deleteSpy).toHaveBeenCalledWith('pe-uuid-02');
      });
    });
  });
});
