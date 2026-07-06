import React from 'react';
import { 
  SquaresFour, 
  CalendarCheck, 
  BookOpenText, 
  UserList, 
  SignOut, 
  ChalkboardTeacher,
  Sparkle,
  ShieldCheck,
  Buildings
} from '@phosphor-icons/react';
import { useAuth } from '@/context/AuthContext';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  activeRole: 'teacher' | 'admin';
}

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, setActiveTab, activeRole }) => {
  const { signOut } = useAuth();
  const teacherNavItems = [
    { id: 'overview', label: 'Overview Hub', icon: SquaresFour },
    { id: 'schedule', label: 'Batches & Timetable', icon: CalendarCheck },
    { id: 'assessments', label: 'Test & Grading', icon: BookOpenText },
    { id: 'hr-portal', label: 'HR & Profile Portal', icon: UserList },
  ];

  const adminNavItems = [
    { id: 'admin-overview', label: 'Command Center', icon: Buildings },
    { id: 'admin-faculty', label: 'Faculty & HR Queue', icon: ChalkboardTeacher },
    { id: 'schedule', label: 'Timetable & Studio', icon: CalendarCheck },
    { id: 'assessments', label: 'Global Assessment', icon: BookOpenText },
  ];

  const navItems = activeRole === 'admin' ? adminNavItems : teacherNavItems;

  return (
    <aside className="w-64 bg-navy-800 text-white flex flex-col justify-between shrink-0 shadow-2xl relative z-20 transition-all duration-300">
      {/* Top Logo & Branding */}
      <div>
        <div className="p-6 border-b border-white/10 flex items-center gap-3">
          <div className={`w-10 h-10 rounded-2xl flex items-center justify-center shadow-inner border border-white/20 ${
            activeRole === 'admin' ? 'bg-amber-500 text-slate-900' : 'bg-primary-700 text-primary-100'
          }`}>
            {activeRole === 'admin' ? <ShieldCheck size={24} weight="fill" /> : <ChalkboardTeacher size={24} />}
          </div>
          <div>
            <h1 className="font-bold tracking-tight text-lg leading-tight">EdTech Pro</h1>
            <p className="text-[11px] text-blue-200 tracking-wider uppercase font-mono">
              {activeRole === 'admin' ? '🛡️ Admin OS v2.4' : '👨‍🏫 Faculty OS v2.4'}
            </p>
          </div>
        </div>

        {/* AI Assistant Banner (Micro-interaction) */}
        <div className="mx-4 mt-6 p-3 rounded-2xl bg-gradient-to-r from-primary-700/80 to-primary-900/80 border border-white/10 shadow-lg relative overflow-hidden group cursor-pointer">
          <div className="absolute top-0 right-0 w-16 h-16 bg-white/5 rounded-full blur-xl group-hover:scale-150 transition-transform duration-500" />
          <div className="flex items-center gap-2 mb-1">
            <Sparkle size={16} className="text-amber-300 animate-pulse" />
            <span className="text-xs font-semibold uppercase tracking-wider text-amber-200">
              {activeRole === 'admin' ? 'HR Governance Copilot' : 'AI Grading Copilot'}
            </span>
          </div>
          <p className="text-[12px] text-blue-100 leading-snug">
            {activeRole === 'admin' ? '3 pending leave requests & 1 KYC document ready for review.' : '34 test submissions auto-evaluated & ready for review.'}
          </p>
        </div>

        {/* Navigation Menu */}
        <nav className="mt-8 px-4 space-y-2">
          <p className="px-3 text-[11px] font-mono uppercase tracking-widest text-blue-300/60 mb-2">
            {activeRole === 'admin' ? 'Institute Control Plane' : 'Operational Views'}
          </p>
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl font-medium text-sm transition-all duration-300 ease-spring ${
                  isActive
                    ? activeRole === 'admin' 
                      ? 'bg-amber-500 text-slate-900 shadow-lg shadow-black/20 translate-x-1 font-bold'
                      : 'bg-primary-700 text-white shadow-lg shadow-black/20 translate-x-1 border border-white/15'
                    : 'text-blue-100/70 hover:text-white hover:bg-white/5 hover:translate-x-1'
                }`}
              >
                <Icon size={20} className={isActive ? (activeRole === 'admin' ? 'text-slate-900' : 'text-blue-200') : 'text-blue-300/60'} />
                <span>{item.label}</span>
                {isActive && (
                  <span className={`ml-auto w-1.5 h-5 rounded-full animate-pulse ${activeRole === 'admin' ? 'bg-slate-900' : 'bg-blue-300'}`} />
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Bottom Profile Footer */}
      <div className="p-4 border-t border-white/10 bg-primary-900/40">
        <div className="flex items-center gap-3 p-2 rounded-2xl bg-white/5 border border-white/10">
          <img
            src={activeRole === 'admin' 
              ? "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?auto=format&fit=crop&q=80&w=400"
              : "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=400"
            }
            alt="User Avatar"
            className="w-10 h-10 rounded-full object-cover border-2 border-primary-700 shrink-0"
          />
          <div className="overflow-hidden">
            <p className="text-sm font-semibold truncate leading-tight">
              {activeRole === 'admin' ? 'Prof. R. Mehta' : 'Dr. A. Sharma'}
            </p>
            <p className="text-[11px] text-blue-200/60 truncate font-mono">
              {activeRole === 'admin' ? 'Academic Director' : 'Senior HOD • Physics'}
            </p>
          </div>
          <button 
            title="Sign Out"
            onClick={signOut}
            className="ml-auto w-8 h-8 rounded-xl bg-white/5 hover:bg-red-500/20 hover:text-red-300 flex items-center justify-center transition-colors text-blue-200/60"
          >
            <SignOut size={16} />
          </button>
        </div>
      </div>
    </aside>
  );
};
