import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { JobToolbar } from '../features/jobs/JobToolbar';
import { AuthProvider } from '../features/auth/AuthContext';
import { MemoryRouter } from 'react-router-dom';

describe('Job Dashboard Search and Filter Controls', () => {
  it('calls onSearchChange when user types in the search input', () => {
    const handleSearch = vi.fn();
    const handleStatus = vi.fn();

    render(
      <MemoryRouter>
        <AuthProvider>
          <JobToolbar
            searchTerm=""
            onSearchChange={handleSearch}
            statusFilter="ALL"
            onStatusFilterChange={handleStatus}
          />
        </AuthProvider>
      </MemoryRouter>
    );

    const input = screen.getByPlaceholderText(/tìm theo mã job hoặc mã chi tiết/i);
    fireEvent.change(input, { target: { value: 'JOB-2026-001' } });

    expect(handleSearch).toHaveBeenCalledWith('JOB-2026-001');
  });

  it('triggers onStatusFilterChange when filter buttons are clicked', () => {
    const handleSearch = vi.fn();
    const handleStatus = vi.fn();

    render(
      <MemoryRouter>
        <AuthProvider>
          <JobToolbar
            searchTerm=""
            onSearchChange={handleSearch}
            statusFilter="ALL"
            onStatusFilterChange={handleStatus}
          />
        </AuthProvider>
      </MemoryRouter>
    );

    const activeBtn = screen.getByRole('button', { name: 'ACTIVE' });
    fireEvent.click(activeBtn);
    expect(handleStatus).toHaveBeenCalledWith('ACTIVE');

    const closeBtn = screen.getByRole('button', { name: 'CLOSE' });
    fireEvent.click(closeBtn);
    expect(handleStatus).toHaveBeenCalledWith('CLOSE');
  });
});
