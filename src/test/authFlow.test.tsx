import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../features/auth/AuthContext';
import { LoginPage } from '../features/auth/LoginPage';

describe('Authentication Flow & Input Validation', () => {
  it('displays Vietnamese error when submitting empty phone number', async () => {
    render(
      <MemoryRouter>
        <AuthProvider>
          <LoginPage />
        </AuthProvider>
      </MemoryRouter>
    );

    const submitBtn = screen.getByRole('button', { name: /đăng nhập/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText('Vui lòng nhập số điện thoại.')).toBeInTheDocument();
    });
  });

  it('displays Vietnamese error when phone is provided but password is empty', async () => {
    render(
      <MemoryRouter>
        <AuthProvider>
          <LoginPage />
        </AuthProvider>
      </MemoryRouter>
    );

    const phoneInput = screen.getByPlaceholderText(/ví dụ: 0912345678/i);
    fireEvent.change(phoneInput, { target: { value: '0912345678' } });

    const submitBtn = screen.getByRole('button', { name: /đăng nhập/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText('Vui lòng nhập mật khẩu.')).toBeInTheDocument();
    });
  });

  it('ChangePasswordPage validates minimum 8 characters and temporary password (123456)', async () => {
    const { ChangePasswordPage } = await import('../features/auth/ChangePasswordPage');
    render(
      <MemoryRouter>
        <AuthProvider>
          <ChangePasswordPage />
        </AuthProvider>
      </MemoryRouter>
    );

    const newPassInput = screen.getByPlaceholderText('Tối thiểu 8 ký tự');
    const confirmPassInput = screen.getByPlaceholderText('Nhập lại mật khẩu mới');
    const submitBtn = screen.getByRole('button', { name: /lưu mật khẩu mới/i });

    // 1. Test short password (< 8 chars)
    fireEvent.change(newPassInput, { target: { value: '12345' } });
    fireEvent.change(confirmPassInput, { target: { value: '12345' } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText('Mật khẩu mới phải có tối thiểu 8 ký tự.')).toBeInTheDocument();
    });

    // 2. Test temporary password identical to 123456
    fireEvent.change(newPassInput, { target: { value: '123456' } });
    fireEvent.change(confirmPassInput, { target: { value: '123456' } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText('Mật khẩu mới không được trùng với mật khẩu tạm thời ban đầu (123456).')).toBeInTheDocument();
    });

    // 3. Test password mismatch
    fireEvent.change(newPassInput, { target: { value: 'NewSecurePass1!' } });
    fireEvent.change(confirmPassInput, { target: { value: 'DifferentPass2!' } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText('Xác nhận mật khẩu không trùng khớp.')).toBeInTheDocument();
    });
  });
});
