import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from '../features/auth/AuthContext';
import { supabase } from '../lib/supabase';
import { fetchFinalReportStatus } from '../services/finalReportService';

// Mock supabase client
let authListeners: ((event: string, session: any) => void)[] = [];

vi.mock('../lib/supabase', () => {
  const mockSupabase = {
    auth: {
      getSession: vi.fn(),
      onAuthStateChange: vi.fn((callback) => {
        authListeners.push(callback);
        return {
          data: {
            subscription: {
              unsubscribe: vi.fn(() => {
                const idx = authListeners.indexOf(callback);
                if (idx !== -1) authListeners.splice(idx, 1);
              }),
            },
          },
        };
      }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
    from: vi.fn(),
    functions: {
      invoke: vi.fn(),
    },
  };

  return { supabase: mockSupabase };
});

// Mock environment
vi.mock('../lib/env', () => ({
  ENV: {
    IS_CONFIGURED: true,
  },
}));

// Test consumer component
const TestConsumer: React.FC<{ onRender?: () => void }> = ({ onRender }) => {
  const { user, profile, loading, refreshProfile, logout } = useAuth();
  onRender?.();

  return (
    <div>
      <div data-testid="loading-state">{loading ? 'LOADING' : 'READY'}</div>
      <div data-testid="user-phone">{user?.phone || 'ANONYMOUS'}</div>
      <div data-testid="user-role">{profile?.role || 'NONE'}</div>
      <div data-testid="user-active">{profile?.is_active ? 'ACTIVE' : 'INACTIVE'}</div>
      <button data-testid="refresh-btn" onClick={() => refreshProfile(true)}>
        Refresh
      </button>
      <button data-testid="logout-btn" onClick={() => logout()}>
        Logout
      </button>
    </div>
  );
};

describe('M1 Production Egress Hotfix — AuthContext & Polling Verification', () => {
  let selectProfilesSpy: any;
  let singleSpy: any;
  let eqSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });

    singleSpy = vi.fn().mockResolvedValue({
      data: {
        id: 'user-uuid-123',
        phone: '0987654321',
        full_name: 'Nguyễn Văn A',
        role: 'PE-MFG',
        is_active: true,
        created_at: new Date().toISOString(),
      },
      error: null,
    });

    eqSpy = vi.fn().mockReturnValue({ single: singleSpy });
    selectProfilesSpy = vi.fn().mockReturnValue({ eq: eqSpy });

    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'profiles') {
        return { select: selectProfilesSpy };
      }
      return { select: vi.fn() };
    });

    (supabase.auth.getSession as any).mockResolvedValue({
      data: {
        session: {
          user: {
            id: 'user-uuid-123',
            phone: '0987654321',
            email: 'test@example.com',
          },
        },
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('1. Initializes auth and queries profiles table exactly ONCE on initial mount', async () => {
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    // Wait for auth initialization to complete
    await waitFor(() => {
      expect(screen.getByTestId('loading-state').textContent).toBe('READY');
      expect(screen.getByTestId('user-phone').textContent).toBe('0987654321');
      expect(screen.getByTestId('user-role').textContent).toBe('PE-MFG');
    });

    // Profile query count must be EXACTLY 1 (No loop!)
    expect(selectProfilesSpy).toHaveBeenCalledTimes(1);
    expect(eqSpy).toHaveBeenCalledWith('id', 'user-uuid-123');
  });

  it('2. Parent re-renders do NOT trigger duplicate profiles queries', async () => {
    const ParentWrapper = () => {
      const [count, setCount] = useState(0);
      return (
        <AuthProvider>
          <button data-testid="rerender-parent" onClick={() => setCount((c) => c + 1)}>
            Count {count}
          </button>
          <TestConsumer />
        </AuthProvider>
      );
    };

    render(<ParentWrapper />);

    await waitFor(() => {
      expect(screen.getByTestId('loading-state').textContent).toBe('READY');
    });

    expect(selectProfilesSpy).toHaveBeenCalledTimes(1);

    // Trigger 5 rapid re-renders of the parent
    for (let i = 0; i < 5; i++) {
      act(() => {
        screen.getByTestId('rerender-parent').click();
      });
    }

    // Advance time slightly
    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    // Query count MUST REMAIN 1
    expect(selectProfilesSpy).toHaveBeenCalledTimes(1);
  });

  it('3. Window focus events are throttled and do not cause continuous queries', async () => {
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading-state').textContent).toBe('READY');
    });

    expect(selectProfilesSpy).toHaveBeenCalledTimes(1);

    // Fire 10 window focus events rapidly (simulating user alt-tabbing)
    for (let i = 0; i < 10; i++) {
      act(() => {
        window.dispatchEvent(new Event('focus'));
      });
    }

    await act(async () => {
      vi.advanceTimersByTime(5000); // 5 seconds later
    });

    // Still only 1 query because focus checks are throttled to 60s
    expect(selectProfilesSpy).toHaveBeenCalledTimes(1);

    // Advance past the 60s throttle window
    await act(async () => {
      vi.advanceTimersByTime(65000);
    });

    // Now fire focus again
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });

    // Should have checked at most once more
    expect(selectProfilesSpy).toHaveBeenCalledTimes(2);
  });

  it('4. Explicit forced refreshProfile updates role without infinite loop', async () => {
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading-state').textContent).toBe('READY');
    });

    expect(selectProfilesSpy).toHaveBeenCalledTimes(1);

    // Mock role promotion to Admin
    singleSpy.mockResolvedValueOnce({
      data: {
        id: 'user-uuid-123',
        phone: '0987654321',
        full_name: 'Nguyễn Văn A',
        role: 'Admin',
        is_active: true,
      },
      error: null,
    });

    await act(async () => {
      screen.getByTestId('refresh-btn').click();
    });

    await waitFor(() => {
      expect(screen.getByTestId('user-role').textContent).toBe('Admin');
    });

    // Exactly 2 total queries: initial load (1) + forced refresh (1)
    expect(selectProfilesSpy).toHaveBeenCalledTimes(2);
  });

  it('5. fetchFinalReportStatus queries only lightweight columns', async () => {
    const mockMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'report-123',
        generation_status: 'Completed',
        error_message: null,
      },
      error: null,
    });
    const mockEq = vi.fn().mockReturnValue({ maybeSingle: mockMaybeSingle });
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });

    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'sample_final_reports') {
        return { select: mockSelect };
      }
      return { select: vi.fn() };
    });

    const res = await fetchFinalReportStatus('job-999');

    expect(res.status).toBe('Completed');
    expect(res.error).toBeNull();

    // Verify it requested only lightweight columns, NOT '*'
    expect(mockSelect).toHaveBeenCalledWith('id, generation_status, error_message');
    expect(mockEq).toHaveBeenCalledWith('job_id', 'job-999');
  });

  it('6. Logout clears session and calls supabase.auth.signOut', async () => {
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading-state').textContent).toBe('READY');
      expect(screen.getByTestId('user-phone').textContent).toBe('0987654321');
    });

    await act(async () => {
      screen.getByTestId('logout-btn').click();
    });

    await waitFor(() => {
      expect(supabase.auth.signOut).toHaveBeenCalled();
      expect(screen.getByTestId('user-phone').textContent).toBe('ANONYMOUS');
    });
  });

  it('7. Multi-tab sync: SIGNED_OUT event from another tab clears session immediately', async () => {
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading-state').textContent).toBe('READY');
      expect(screen.getByTestId('user-phone').textContent).toBe('0987654321');
    });

    // Simulate SIGNED_OUT event triggered by another tab
    await act(async () => {
      authListeners.forEach((fn) => fn('SIGNED_OUT', null));
    });

    await waitFor(() => {
      expect(screen.getByTestId('user-phone').textContent).toBe('ANONYMOUS');
    });
  });

  it('8. Token refresh and cross-tab role updates synchronize properly', async () => {
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading-state').textContent).toBe('READY');
      expect(screen.getByTestId('user-role').textContent).toBe('PE-MFG');
    });

    // Mock new role returned for subsequent profile query
    singleSpy.mockResolvedValueOnce({
      data: {
        id: 'user-uuid-123',
        phone: '0987654321',
        full_name: 'Nguyễn Văn A',
        role: 'Admin',
        is_active: true,
      },
      error: null,
    });

    // Simulate TOKEN_REFRESHED event from Supabase auth listener
    await act(async () => {
      authListeners.forEach((fn) =>
        fn('TOKEN_REFRESHED', {
          user: { id: 'user-uuid-123', phone: '0987654321', email: 'test@example.com' },
        })
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId('user-role').textContent).toBe('Admin');
    });
  });
});
