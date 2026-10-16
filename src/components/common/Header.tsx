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
  const isUsersActive = location.pathname.startsWith('/admin/users');

  return (
    <>
      <header className="sticky top-0 z-30 bg-slate-900 border-b border-slate-800 text-white shadow-md">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
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

              {/* Navigation Tabs (Jobs & Admin Users) */}
              <nav className="hidden md:flex items-center gap-1.5 ml-2">
                <Link
                  to="/"
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                    isJobsActive
                      ? 'bg-slate-800 text-white border border-slate-700 shadow-xs'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                  }`}
                >
                  <Layers className="w-3.5 h-3.5" />
                  <span>Lệnh sản xuất (JOBs)</span>
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
            <div className="flex items-center gap-2 sm:gap-3" ref={menuRef}>
              {profile && (
                <div className="relative">
                  <button
                    onClick={() => setMenuOpen(!menuOpen)}
                    className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-slate-800 active:bg-slate-800/90 border border-slate-800 hover:border-slate-700 transition focus:outline-none focus:ring-1 focus:ring-blue-500 touch-manipulation group"
                    title="Menu tài khoản cá nhân"
                    aria-expanded={menuOpen}
                  >
                    {/* User Avatar Initials */}
                    <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-blue-600/30 text-blue-400 border border-blue-500/40 flex items-center justify-center font-bold text-xs uppercase flex-shrink-0">
                      {profile.full_name?.charAt(0) || 'U'}
                    </div>

                    {/* Name, Role & Phone */}
                    <div className="flex flex-col text-left">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-semibold text-white group-hover:text-blue-300 transition leading-tight max-w-[130px] sm:max-w-[180px] truncate">
                          {profile.full_name}
                        </span>
                        <div className="hidden xs:inline-block">
                          <RoleBadge role={profile.role} />
                        </div>
                      </div>
                      <span className="text-[11px] text-slate-400 font-mono hidden sm:inline">
                        {profile.phone}
                      </span>
                    </div>

                    <ChevronDown
                      className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-150 ${
                        menuOpen ? 'rotate-180 text-white' : ''
                      }`}
                    />
                  </button>

                  {/* Dropdown Menu */}
                  {menuOpen && (
                    <div className="absolute right-0 mt-2 w-64 bg-white rounded-xl shadow-xl border border-slate-200 py-1.5 text-slate-800 z-50 animate-in fade-in slide-in-from-top-2 duration-150">
                      {/* Identity Card */}
                      <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/60">
                        <p className="text-xs font-bold text-slate-900 truncate">
                          {profile.full_name}
                        </p>
                        <div className="flex items-center justify-between gap-2 mt-1">
                          <span className="text-[11px] text-slate-500 font-mono">
                            {profile.phone}
                          </span>
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
                        >
                          <Layers className="w-4 h-4 text-slate-400" />
                          <span>Lệnh sản xuất (JOBs)</span>
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
