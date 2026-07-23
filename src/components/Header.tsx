import React, { useState, useEffect } from 'react';
import { 
  MagnifyingGlass, 
  BellRinging, 
  VideoCamera, 
  ArrowUpRight,
  ShieldCheck,
  ChalkboardTeacher
} from '@phosphor-icons/react';
import { useAuth } from '@/context/AuthContext';
import { notificationService } from '@/services/notificationService';
import type { NotificationItem } from '@/services/notificationService';

interface HeaderProps {
  activeTabTitle: string;
  onLaunchLive: () => void;
  activeRole: 'teacher' | 'admin';
  onToggleRole: () => void;
}

const SEARCH_PROMPTS = [
  "Search 380+ Physics PYQs...",
  "Check JEE Target Alpha attendance...",
  "Look up HDFC disbursement date...",
  "Filter student quiz submissions...",
  "Search faculty leave applications..."
];

export const Header: React.FC<HeaderProps> = ({ activeTabTitle, onLaunchLive, activeRole, onToggleRole: _onToggleRole }) => {
  const [promptIndex, setPromptIndex] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const { user, teacherProfile } = useAuth();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);

  const fetchNotifs = async () => {
    if (user?.id) {
      const list = await notificationService.getNotifications(user.id);
      setNotifications(list);
    }
  };

  useEffect(() => {
    fetchNotifs();
    const interval = setInterval(fetchNotifs, 5000);
    return () => clearInterval(interval);
  }, [user?.id]);

  const handleMarkRead = async (recipientId: string) => {
    if (user?.id) {
      await notificationService.markAsRead(recipientId, user.id);
      fetchNotifs();
    }
  };

  const unreadCount = notifications.filter(n => !n.isRead).length;

  useEffect(() => {
    const interval = setInterval(() => {
      setPromptIndex((prev) => (prev + 1) % SEARCH_PROMPTS.length);
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  return (
    <header className="h-20 bg-surface/80 backdrop-blur-md border-b border-border px-8 flex items-center justify-between sticky top-0 z-10">
      {/* Title & Status */}
      <div className="flex items-center gap-4">
        <h2 className="text-xl font-bold tracking-tight text-text-primary">{activeTabTitle}</h2>
        <div className={`hidden sm:flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border ${
          activeRole === 'admin' 
            ? 'bg-amber-100 text-amber-900 border-amber-300' 
            : 'bg-success-light text-success-base border-success-base/20'
        }`}>
          {activeRole === 'admin' ? (
            <>
              <ShieldCheck size={14} weight="fill" className="text-amber-600" />
              <span>Institute Admin Governance • Domain 10</span>
            </>
          ) : (
            <>
              <ChalkboardTeacher size={14} weight="fill" className="text-success-base" />
              <span>Verified Faculty ID • {teacherProfile?.id || 't-8492-phy'}</span>
            </>
          )}
        </div>
      </div>

      {/* AI Command / Search Bar */}
      <div className="hidden lg:flex items-center w-80 bg-background rounded-full px-4 py-2.5 border border-border focus-within:border-primary-700 focus-within:ring-2 focus-within:ring-primary-100 transition-all duration-300">
        <MagnifyingGlass size={18} className="text-text-muted mr-3 shrink-0" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={SEARCH_PROMPTS[promptIndex]}
          className="bg-transparent border-none outline-none text-sm text-text-primary w-full placeholder:text-text-muted/70 font-sans"
        />
        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-200 text-slate-600 ml-2">⌘K</span>
      </div>

      {/* Right Action Controls */}
      <div className="flex items-center gap-3 sm:gap-4">
        {/* 🔒 IMMUTABLE CREDENTIAL ROLE BADGE */}
        <div
          title="Role strictly assigned by authenticated credentials"
          className={`hidden sm:flex items-center gap-2 px-3.5 py-2 rounded-full border text-xs font-bold font-mono shadow-sm ${
            activeRole === 'admin'
              ? 'bg-navy-800 text-white border-navy-700'
              : 'bg-slate-100 text-navy-900 border-slate-300'
          }`}
        >
          <span>{activeRole === 'admin' ? '🛡️ Director Portal' : '👨‍🏫 Faculty Portal'}</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
            activeRole === 'admin' ? 'bg-amber-400 text-slate-900' : 'bg-primary-800 text-white'
          }`}>
            Locked
          </span>
        </div>

        {/* Notifications Dropdown */}
        <div className="relative shrink-0">
          <button 
            onClick={() => setShowDropdown(!showDropdown)}
            className="w-11 h-11 rounded-full bg-background border border-border flex items-center justify-center text-text-primary hover:bg-slate-100 transition-colors relative group shrink-0"
            title="Notifications"
          >
            <BellRinging size={20} className="group-hover:scale-110 transition-transform" />
            {unreadCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-error px-1 text-[9px] font-bold text-white ring-2 ring-surface">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>

          {showDropdown && (
            <div className="absolute right-0 mt-3 w-80 bg-surface border border-border rounded-3xl shadow-xl py-4 z-50 animate-fadeIn max-h-96 flex flex-col">
              <div className="flex items-center justify-between px-6 pb-3 border-b border-border shrink-0">
                <span className="font-bold text-sm text-text-primary font-display">Notifications</span>
                {unreadCount > 0 && (
                  <span className="text-[10px] font-bold px-2 py-0.5 bg-error/10 text-error rounded-full font-mono">
                    {unreadCount} New
                  </span>
                )}
              </div>
              <div className="overflow-y-auto p-2 divide-y divide-border/60">
                {notifications.length === 0 ? (
                  <div className="py-8 text-center text-xs text-text-muted">
                    No notifications yet.
                  </div>
                ) : (
                  notifications.map((n) => (
                    <div 
                      key={n.id} 
                      onClick={() => handleMarkRead(n.id)}
                      className={`p-3 rounded-2xl cursor-pointer hover:bg-slate-50 transition-colors flex gap-2.5 items-start text-left ${
                        !n.isRead ? 'bg-slate-50/50' : ''
                      }`}
                    >
                      <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${!n.isRead ? 'bg-primary-800' : 'bg-transparent'}`} />
                      <div className="space-y-0.5">
                        <p className={`text-xs font-bold text-text-primary ${!n.isRead ? 'font-extrabold' : ''}`}>{n.title}</p>
                        <p className="text-[11px] text-text-muted leading-relaxed">{n.body}</p>
                        <p className="text-[9px] font-mono text-text-muted/80">{new Date(n.receivedAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Launch Live Class Button (Button-in-Button Architecture) */}
        <button 
          onClick={onLaunchLive}
          className="btn-primary pr-2 bg-gradient-to-r from-primary-800 to-primary-700 hover:from-primary-700 hover:to-primary-800 shadow-lg shadow-primary-800/20 hidden sm:flex shrink-0"
        >
          <div className="flex items-center gap-2 pl-2">
            <VideoCamera size={18} className="text-primary-100 animate-pulse" />
            <span className="font-semibold">Launch Studio</span>
          </div>
          <div className="btn-icon-wrapper">
            <ArrowUpRight size={14} className="text-white" />
          </div>
        </button>
      </div>
    </header>
  );
};
