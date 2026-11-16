import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { detectDeviceType, getOrCreateDeviceId, registerOrCheckDeviceSession, releaseDeviceSession } from '../lib/deviceUtils';
import { LoginPage } from '../features/auth/LoginPage';
import { UserManagementPage } from '../features/admin/UserManagementPage';
import * as adminUserService from '../services/adminUserService';
import { supabase } from '../lib/supabase';

// Mock AuthContext
const mockLogin = vi.fn();
vi.mock('../features/auth/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'admin-1', phone: '0968041128', profile: { id: 'admin-1', role: 'Admin', full_name: 'Đỗ Xuân Trường' } },
    profile: { id: 'admin-1', role: 'Admin', full_name: 'Đỗ Xuân Trường' },
    loading: false,
    error: null,
    login: mockLogin,
    logout: vi.fn(),
    refreshProfile: vi.fn(),
  }),
}));

describe('2-DEVICE POLICY & ACTIVE SESSION LIMIT SUITE', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  describe('1. Device Identification & Storage', () => {
    it('detects desktop device accurately based on user agent', () => {
      const originalUa = navigator.userAgent;
      Object.defineProperty(navigator, 'userAgent', {
        value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        configurable: true,
      });

      const type = detectDeviceType();
      expect(type).toBe('desktop');

      Object.defineProperty(navigator, 'userAgent', { value: originalUa, configurable: true });
    });

    it('detects mobile phone device accurately based on mobile user agent', () => {
      const originalUa = navigator.userAgent;
      Object.defineProperty(navigator, 'userAgent', {
        value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        configurable: true,
      });

      const type = detectDeviceType();
      expect(type).toBe('mobile');

      Object.defineProperty(navigator, 'userAgent', { value: originalUa, configurable: true });
    });

    it('generates a stable persistent deviceId stored in localStorage', () => {
      const id1 = getOrCreateDeviceId();
      expect(id1).toBeTruthy();
      expect(typeof id1).toBe('string');

      const id2 = getOrCreateDeviceId();
      expect(id2).toBe(id1);
      expect(localStorage.getItem('sample_tracking_device_id')).toBe(id1);
    });
  });

  describe('2. Device Registration RPC & Conflict Handling', () => {
    it('allows registration when device slot is empty', async () => {
      vi.spyOn(supabase, 'rpc').mockResolvedValueOnce({
        data: { allowed: true, reason: 'slot_claimed', device_type: 'desktop' },
        error: null,
      } as any);

      const res = await registerOrCheckDeviceSession();
      expect(res.allowed).toBe(true);
      expect(res.device_type).toBe('desktop');
    });

    it('returns conflict details when second device of same type logs in', async () => {
      vi.spyOn(supabase, 'rpc').mockResolvedValueOnce({
        data: {
          allowed: false,
          reason: 'device_slot_conflict',
          device_type: 'desktop',
          conflicting_device: {
            device_name: 'Chrome trên Windows (Máy xưởng)',
            device_type: 'desktop',
            last_active_at: new Date().toISOString(),
          },
        },
        error: null,
      } as any);

      const res = await registerOrCheckDeviceSession();
      expect(res.allowed).toBe(false);
      expect(res.conflictingDevice?.device_name).toBe('Chrome trên Windows (Máy xưởng)');
    });

    it('calls release_device_session on user logout', async () => {
      const rpcSpy = vi.spyOn(supabase, 'rpc').mockResolvedValueOnce({
        data: { success: true },
        error: null,
      } as any);

      await releaseDeviceSession();
      expect(rpcSpy).toHaveBeenCalledWith('release_device_session', expect.objectContaining({
        p_device_id: expect.any(String),
      }));
    });
  });

  describe('3. Login Page Device Conflict Warning UI', () => {
    it('displays prominent warning modal when login fails due to duplicate device slot', async () => {
      const conflictError: any = new Error(
        'Tài khoản đang đăng nhập trên một Máy tính khác (Chrome trên Windows 11). Quy định hệ thống chỉ cho phép 1 Máy tính và 1 Điện thoại cùng lúc.'
      );
      conflictError.isDeviceConflict = true;
      conflictError.conflictingDevice = {
        device_name: 'Chrome trên Windows 11 (Máy văn phòng)',
        device_type: 'desktop',
        last_active_at: new Date().toISOString(),
      };
      conflictError.deviceType = 'desktop';

      mockLogin.mockRejectedValueOnce(conflictError);

      render(
        <MemoryRouter>
          <LoginPage />
        </MemoryRouter>
      );

      fireEvent.change(screen.getByLabelText(/Số điện thoại/i), { target: { value: '0968041128' } });
      fireEvent.change(screen.getByLabelText(/Mật khẩu/i), { target: { value: '123456' } });
      fireEvent.click(screen.getByRole('button', { name: /Đăng nhập/i }));

      // Expect conflict modal to appear with high-contrast warning
      const modal = await screen.findByTestId('device-conflict-modal');
      expect(modal).toBeInTheDocument();
      expect(screen.getByText(/TÀI KHOẢN ĐANG ĐĂNG NHẬP Ở THIẾT BỊ KHÁC/i)).toBeInTheDocument();
      expect(screen.getAllByText(/Chrome trên Windows 11 \(Máy văn phòng\)/i).length).toBeGreaterThan(0);
      expect(screen.getByText(/0968 041 128/i)).toBeInTheDocument();

      // Dismissing modal closes it
      fireEvent.click(screen.getByRole('button', { name: /Đã hiểu & Quay lại/i }));
      await waitFor(() => {
        expect(screen.queryByTestId('device-conflict-modal')).not.toBeInTheDocument();
      });
    });
  });

  describe('4. Admin User Management Device Revocation', () => {
    it('renders "Đăng xuất khỏi tất cả thiết bị" button and handles revocation', async () => {
      vi.spyOn(adminUserService, 'fetchAllUsers').mockResolvedValueOnce({
        data: [
          {
            id: 'user-pe-1',
            full_name: 'Tạ Văn Đông',
            phone: '0396220448',
            role: 'PE-MFG',
            department: 'Sản xuất',
            is_active: true,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
        error: null,
      });

      const revokeSpy = vi.spyOn(adminUserService, 'revokeAdminUserDevices').mockResolvedValueOnce({
        success: true,
        revokedCount: 2,
      });

      render(
        <MemoryRouter>
          <UserManagementPage />
        </MemoryRouter>
      );

      // Wait for table to load
      await screen.findByText('Tạ Văn Đông');

      // Click Revoke Devices button
      const revokeBtn = screen.getByTitle(/Đăng xuất khỏi tất cả thiết bị/i);
      expect(revokeBtn).toBeInTheDocument();
      fireEvent.click(revokeBtn);

      // Confirm modal opens
      expect(screen.getByText(/Xác nhận thu hồi thiết bị\?/i)).toBeInTheDocument();
      expect(screen.getByText(/Hành động này sẽ giải phóng tất cả khe thiết bị/i)).toBeInTheDocument();

      // Click Confirm Revocation
      const confirmBtn = screen.getByRole('button', { name: /Đăng xuất tất cả thiết bị/i });
      fireEvent.click(confirmBtn);

      await waitFor(() => {
        expect(revokeSpy).toHaveBeenCalledWith('user-pe-1');
      });
    });
  });
});
