import React from 'react';
import { Outlet } from 'react-router-dom';
import { Header } from '../common/Header';

export const MainLayout: React.FC = () => {
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col text-slate-900">
      <Header />
      <main className="flex-1 max-w-7xl w-full mx-auto p-3 sm:p-6 lg:p-8">
        <Outlet />
      </main>
      <footer className="bg-white border-t border-slate-200 py-3 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-1">
          <span>SAMPLE TRACKING V1.0 — Phục vụ sản xuất hàng mẫu (Planning / PE-MFG / QA / Admin)</span>
          <span className="text-[11px] text-slate-400">Timezone: Asia/Ho_Chi_Minh (+07:00)</span>
        </div>
      </footer>
    </div>
  );
};
