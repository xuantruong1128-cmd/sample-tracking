import React from 'react';

interface PhaseBadgeProps {
  phase: number;
  label?: string;
}

export const PhaseBadge: React.FC<PhaseBadgeProps> = ({ phase, label }) => {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-100 text-slate-600 border border-slate-300">
      <span className="w-1.5 h-1.5 rounded-full bg-slate-400"></span>
      Phase {phase}{label ? `: ${label}` : ''}
    </span>
  );
};
