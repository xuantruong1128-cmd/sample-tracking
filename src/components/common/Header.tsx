import React, { useState, useRef, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../features/auth/AuthContext';
import { RoleBadge } from './Badge';
import { UserProfileModal } from '../profile/UserProfileModal';
import {
  Factory,
  LogOut,
  User,
  Lock,
  Users,
  ChevronDown,
  Layers,
  FileCheck,
  ScrollText,
} from 'lucide-react';

export const Header: React.FC = () => {
  const { profile, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [menuOpen, setMenuOpen] = useState(false);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [profileModalTab, setProfileModalTab] = useState<'profile' | 'password'>('profile');

  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleLogout = async () => {
    setMenuOpen(false);
    await logout();
    navigate('/login');
  };

  const openProfileTab = (tab: 'profile' | 'password') => {
    setProfileModalTab(tab);
    setProfileModalOpen(true);
    setMenuOpen(false);
  };

  const isAdmin = profile?.role === 'Admin';
  const isJobsActive = location.pathname === '/' || location.pathname.startsWith('/jobs');
  const isDrawingReviewActive = location.pathname.startsWith('/drawing-reviews');
  const isLogsActive = location.pathname.startsWith('/logs');
  const isUsersActive = location.pathname.startsWith('/admin/users');

  return (
    <>
      <header className="sticky top-0 z-30 bg-slate-900 border-b border-slate-800 text-white shadow-md">
        <div className="w-full px-3 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14 sm:h-16">
            {/* Left: Brand Logo & Navigation */}
            <div className="flex items-center gap-6">
              <Link
                to="/"
                className="flex items-center gap-2.5 hover:opacity-90 transition group focus:outline-none"
              >
                <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg bg-blue-600 flex items-center justify-center text-white shadow-sm group-hover:bg-blue-500 transition">
                  <Factory className="w-4 h-4 sm:w-5 sm:h-5" />
                </div>
                <div>
                  <span className="font-bold text-sm sm:text-base tracking-tight text-white block leading-tight">
                    SAMPLE TRACKING
                  </span>
                  <span className="text-[10px] text-slate-400 block tracking-wider uppercase font-medium">
                    Quản lý tiến độ sản xuất mẫu
                  </span>
                </div>
              </Link>

              {/* Navigation Tabs (Jobs, Drawing Review & Admin Users) */}
              <nav className="hidden md:flex items-center gap-1.5 ml-2">
                <Link
                  to="/"
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                    isJobsActive
                      ? 'bg-slate-800 text-white border border-slate-700 shadow-xs'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                  }`}
                  data-testid="nav-jobs"
                >
                  <Layers className="w-3.5 h-3.5" />
                  <span>Lệnh sản xuất (JOBs)</span>
                </Link>

                <Link
                  to="/drawing-reviews"
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                    isDrawingReviewActive
                      ? 'bg-slate-800 text-white border border-slate-700 shadow-xs'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                  }`}
                  data-testid="nav-drawing-review"
                >
                  <FileCheck className="w-3.5 h-3.5" />
                  <span>Đánh giá bản vẽ</span>
                </Link>

                <Link
                  to="/logs"
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                    isLogsActive
                      ? 'bg-slate-800 text-white border border-slate-700 shadow-xs'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                  }`}
                  data-testid="nav-logs"
                >
                  <ScrollText className="w-3.5 h-3.5" />
                  <span>Log</span>
                </Link>

                {isAdmin && (
                  <Link
                    to="/admin/users"
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                      isUsersActive
                        ? 'bg-slate-800 text-white border border-slate-700 shadow-xs'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                    }`}
                  >
                    <Users className="w-3.5 h-3.5" />
                    <span>Quản lý User</span>
                  </Link>
                )}
              </nav>
            </div>

            {/* Right: User Profile Menu & Logout */}
            <div className="flex items-center gap-3">
              {profile && (
                <div className="relative" ref={menuRef}>
                  <button
                    onClick={() => setMenuOpen(!menuOpen)}
                    className="flex items-center gap-2.5 p-1.5 sm:px-3 sm:py-1.5 rounded-xl hover:bg-slate-800/80 transition focus:outline-none border border-transparent hover:border-slate-700"
                    aria-expanded={menuOpen}
                    aria-haspopup="true"
                    title="Menu tài khoản cá nhân"
                    data-testid="user-menu-button"
                  >
                    <div className="w-8 h-8 rounded-lg bg-blue-500/20 text-blue-400 flex items-center justify-center font-bold text-xs border border-blue-500/30">
                      {profile.full_name ? profile.full_name.charAt(0).toUpperCase() : 'U'}
                    </div>

                    <div className="hidden sm:block text-left">
                      <div className="text-xs font-bold text-slate-100 flex items-center gap-1.5 leading-none">
                        <span>{profile.full_name || 'Người dùng'}</span>
                        <RoleBadge role={profile.role} />
                      </div>
                      <span className="text-[10px] text-slate-400 font-mono block mt-1">
                        {profile.phone}
                      </span>
                    </div>

                    <ChevronDown
                      className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-200 ${
                        menuOpen ? 'rotate-180' : ''
                      }`}
                    />
                  </button>

                  {/* Dropdown Menu */}
                  {menuOpen && (
                    <div className="absolute right-0 mt-2 w-64 bg-white rounded-xl shadow-xl border border-slate-200 py-1.5 text-slate-900 z-50 animate-in fade-in slide-in-from-top-2 duration-150">
                      {/* Mobile User Info header */}
                      <div className="px-4 py-2.5 border-b border-slate-100 sm:hidden">
                        <p className="text-xs font-bold text-slate-900">{profile.full_name}</p>
                        <p className="text-[11px] font-mono text-slate-500">{profile.phone}</p>
                        <div className="mt-1.5">
                          <RoleBadge role={profile.role} />
                        </div>
                        {profile.department && (
                          <p className="text-[11px] text-slate-400 mt-1 truncate">
                            {profile.department}
                          </p>
                        )}
                      </div>

                      {/* Navigation for Mobile */}
                      <div className="md:hidden py-1 border-b border-slate-100">
                        <Link
                          to="/"
                          onClick={() => setMenuOpen(false)}
                          className="w-full flex items-center gap-2.5 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition"
                          data-testid="mobile-nav-jobs"
                        >
                          <Layers className="w-4 h-4 text-slate-400" />
                          <span>Lệnh sản xuất (JOBs)</span>
                        </Link>
                        <Link
                          to="/drawing-reviews"
                          onClick={() => setMenuOpen(false)}
                          className="w-full flex items-center gap-2.5 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition"
                          data-testid="mobile-nav-drawing-review"
                        >
                          <FileCheck className="w-4 h-4 text-blue-600" />
                          <span>Đánh giá bản vẽ</span>
                        </Link>
                        <Link
                          to="/logs"
                          onClick={() => setMenuOpen(false)}
                          className="w-full flex items-center gap-2.5 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition"
                          data-testid="mobile-nav-logs"
                        >
                          <ScrollText className="w-4 h-4 text-blue-600" />
                          <span>Log</span>
                        </Link>
                        {isAdmin && (
                          <Link
                            to="/admin/users"
                            onClick={() => setMenuOpen(false)}
                            className="w-full flex items-center gap-2.5 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition"
                          >
                            <Users className="w-4 h-4 text-blue-600" />
                            <span>Quản lý User (Admin)</span>
                          </Link>
                        )}
                      </div>

                      {/* Profile & Password options */}
                      <div className="py-1">
                        <button
                          onClick={() => openProfileTab('profile')}
                          className="w-full flex items-center gap-2.5 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 transition text-left"
                        >
                          <User className="w-4 h-4 text-slate-400" />
                          <span>Hồ sơ cá nhân</span>
                        </button>

                        <button
                          onClick={() => openProfileTab('password')}
                          className="w-full flex items-center gap-2.5 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 transition text-left"
                        >
                          <Lock className="w-4 h-4 text-slate-400" />
                          <span>Đổi mật khẩu</span>
                        </button>

                        {isAdmin && (
                          <button
                            onClick={() => {
                              setMenuOpen(false);
                              navigate('/admin/users');
                            }}
                            className="hidden md:flex w-full items-center gap-2.5 px-4 py-2 text-xs font-medium text-blue-700 hover:bg-blue-50 transition text-left"
                          >
                            <Users className="w-4 h-4 text-blue-600" />
                            <span>Quản lý người dùng</span>
                          </button>
                        )}
                      </div>

                      {/* Logout option */}
                      <div className="border-t border-slate-100 pt-1">
                        <button
                          onClick={handleLogout}
                          className="w-full flex items-center gap-2.5 px-4 py-2 text-xs font-semibold text-red-600 hover:bg-red-50 transition text-left"
                        >
                          <LogOut className="w-4 h-4 text-red-500" />
                          <span>Đăng xuất</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* User Profile Modal */}
      <UserProfileModal
        isOpen={profileModalOpen}
        initialTab={profileModalTab}
        onClose={() => setProfileModalOpen(false)}
      />
    </>
  );
};
