import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { JobListPage } from '../features/jobs/JobListPage';
import { AuthProvider } from '../features/auth/AuthContext';
import { translateAuthError } from '../features/auth/authUtils';
import { ENV } from '../lib/env';

describe('Production Data Integrity & Error Safety (F-09 & F-11 Remediation)', () => {
  it('F-11: translateAuthError provides uniform error without leaking user existence', () => {
    // Both user-not-found and invalid-password return the exact same user-safe message
    const errUserNotFound = translateAuthError({ message: 'User not found' });
    const errWrongPass = translateAuthError({ message: 'Invalid login credentials' });

    expect(errUserNotFound).toBe('Số điện thoại hoặc mật khẩu không chính xác.');
    expect(errWrongPass).toBe('Số điện thoại hoặc mật khẩu không chính xác.');
    expect(errUserNotFound).toEqual(errWrongPass);
  });

  it('F-11: translateAuthError handles deactivated account cleanly', () => {
    const errDisabled = translateAuthError({ message: 'User is disabled' });
    expect(errDisabled).toContain('Tài khoản của bạn đã bị vô hiệu hóa');
  });

  it('F-09: Displays explicit Demo banner when in development/demo mode', () => {
    const originalDemo = ENV.IS_DEMO_MODE;
    (ENV as any).IS_DEMO_MODE = true;
    try {
      render(
        <MemoryRouter>
          <AuthProvider>
            <JobListPage />
          </AuthProvider>
        </MemoryRouter>
      );

      // In local unconfigured test environment, it explicitly indicates Demo mode
      const demoBadge = screen.getByText(/Chế độ Demo/i);
      expect(demoBadge).toBeInTheDocument();
    } finally {
      (ENV as any).IS_DEMO_MODE = originalDemo;
    }
  });
});
