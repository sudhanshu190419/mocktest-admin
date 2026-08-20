'use client';

import React, { useState, useEffect } from 'react';
import { 
  Users, 
  VideoCamera, 
  Calendar, 
  ShieldCheck, 
  TrendUp, 
  ChalkboardTeacher, 
  CheckCircle, 
  Clock, 
  Buildings
} from '@phosphor-icons/react';
import { adminService, type AdminOverviewStats } from '@/services/adminService';

interface AdminOverviewViewProps {
  onNavigateTab: (tab: string) => void;
  onLaunchLive: () => void;
}

export const AdminOverviewView: React.FC<AdminOverviewViewProps> = ({ onNavigateTab, onLaunchLive }) => {
  const [stats, setStats] = useState<AdminOverviewStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadStats = async () => {
      setLoading(true);
      const res = await adminService.getAdminOverviewStats();
      setStats(res);
      setLoading(false);
    };
    loadStats();
  }, []);

  return (
    <div className="space-y-8 pb-12 animate-fadeIn">
      {/* Hero Welcome Banner */}
      <div className="bezel-outer bg-gradient-to-r from-[#0a1931] via-[#15325b] to-[#1f4e8c] text-white p-1.5">
        <div className="bg-[#0a1931]/80 p-8 sm:p-10 rounded-[calc(2.5rem-0.5rem)] border border-white/10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6 relative overflow-hidden">
          
          {/* Ambient light effects */}
          <div className="absolute -top-24 -right-24 w-96 h-96 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-24 -left-24 w-96 h-96 bg-blue-500/15 rounded-full blur-3xl pointer-events-none" />

          <div className="space-y-3 relative z-10 max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/10 backdrop-blur-md border border-white/15 text-xs font-mono tracking-widest uppercase text-amber-300">
              <ShieldCheck size={16} weight="fill" className="text-amber-400" />
              <span>Institute Command Center • Domain 10 & 13 Active</span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight font-display leading-tight">
              Academic & HR Governance Console
            </h2>
            <p className="text-sm sm:text-base text-blue-100/80 leading-relaxed">
              Real-time oversight of active faculty members, competitive exam batches, virtual studio allocations, and payroll workflows across Engineering and Medical streams.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto relative z-10 shrink-0">
            <button
              onClick={() => onNavigateTab('admin-faculty')}
              className="btn-primary bg-amber-400 text-slate-900 hover:bg-amber-300 font-bold px-6 py-4 shadow-xl flex items-center justify-center gap-2.5"
            >
              <ChalkboardTeacher size={20} weight="bold" />
              <span>Manage Faculty Roster</span>
            </button>
            <button
              onClick={onLaunchLive}
              className="btn-secondary bg-white/10 text-white hover:bg-white/20 border-white/20 px-6 py-4 flex items-center justify-center gap-2"
            >
              <VideoCamera size={20} className="text-blue-300" />
              <span>Studio Grid Oversight</span>
            </button>
          </div>

        </div>
      </div>

      {loading ? (
        <div className="py-20 text-center text-text-muted font-mono">Loading Dynamic Governance Stats...</div>
      ) : (
        <>
          {/* 4 Bento KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="bezel-outer">
              <div className="bezel-inner !p-6 flex items-center justify-between">
                <div>
                  <p className="text-xs text-text-muted font-medium uppercase tracking-wider">Active Faculty</p>
                  <p className="text-3xl font-extrabold text-text-primary font-mono mt-1">
                    {stats?.activeFaculty ?? 42}{' '}
                    <span className="text-xs text-success-base font-sans font-bold bg-success-light px-2 py-0.5 rounded-full">+3 New</span>
                  </p>
                </div>
                <div className="w-14 h-14 rounded-2xl bg-primary-100 text-primary-800 flex items-center justify-center">
                  <ChalkboardTeacher size={28} />
                </div>
              </div>
            </div>

            <div className="bezel-outer">
              <div className="bezel-inner !p-6 flex items-center justify-between">
                <div>
                  <p className="text-xs text-text-muted font-medium uppercase tracking-wider">Active Batches</p>
                  <p className="text-3xl font-extrabold text-text-primary font-mono mt-1">
                    {stats?.activeBatches ?? 18}{' '}
                    <span className="text-xs text-text-muted font-sans font-normal">PCM/PCB</span>
                  </p>
                </div>
                <div className="w-14 h-14 rounded-2xl bg-blue-50 text-blue-700 flex items-center justify-center">
                  <Calendar size={28} />
                </div>
              </div>
            </div>

            <div className="bezel-outer">
              <div className="bezel-inner !p-6 flex items-center justify-between">
                <div>
                  <p className="text-xs text-text-muted font-medium uppercase tracking-wider">Total Enrolled</p>
                  <p className="text-3xl font-extrabold text-primary-800 font-mono mt-1">
                    {(stats?.totalStudents ?? 1420).toLocaleString()}{' '}
                    <span className="text-xs text-success-base font-sans font-bold bg-success-light px-2 py-0.5 rounded-full">98% Roster</span>
                  </p>
                </div>
                <div className="w-14 h-14 rounded-2xl bg-amber-50 text-amber-700 flex items-center justify-center">
                  <Users size={28} />
                </div>
              </div>
            </div>

            <div className="bezel-outer">
              <div className="bezel-inner !p-6 flex items-center justify-between">
                <div>
                  <p className="text-xs text-text-muted font-medium uppercase tracking-wider">Live Broadcasts</p>
                  <p className="text-3xl font-extrabold text-success-base font-mono mt-1">
                    {stats?.liveNow ?? 4}{' '}
                    <span className="text-xs text-success-base font-sans font-bold bg-success-light px-2 py-0.5 rounded-full animate-pulse">● LIVE NOW</span>
                  </p>
                </div>
                <div className="w-14 h-14 rounded-2xl bg-success-light text-success-base flex items-center justify-center">
                  <VideoCamera size={28} />
                </div>
              </div>
            </div>
          </div>

          {/* Grid: Institute Performance vs Action Queue */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            
            {/* Left Span 7: Institute-Wide Academic Health */}
            <div className="lg:col-span-7 bezel-outer">
              <div className="bezel-inner !p-8 h-full flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-6">
                    <div>
                      <span className="text-xs font-bold font-mono tracking-wider uppercase text-primary-800 bg-primary-100 px-3 py-1 rounded-full">
                        Domain 08 & 13 Analytics
                      </span>
                      <h3 className="text-xl font-bold text-text-primary tracking-tight mt-2">Institute Academic Velocity</h3>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-success-base">
                      <TrendUp size={16} />
                      <span>+3.8% MoM Growth</span>
                    </div>
                  </div>

                  <div className="space-y-6">
                    <div>
                      <div className="flex justify-between text-xs font-bold uppercase text-text-muted mb-2">
                        <span>Overall Syllabus Completion Velocity</span>
                        <span className="font-mono text-text-primary">{stats?.syllabusCompletion ?? 71.8}% Avg</span>
                      </div>
                      <div className="w-full h-3 rounded-full bg-slate-100 overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-primary-800 to-primary-600 rounded-full" style={{ width: `${stats?.syllabusCompletion ?? 71.8}%` }} />
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between text-xs font-bold uppercase text-text-muted mb-2">
                        <span>Virtual Studio Attendance Consistency</span>
                        <span className="font-mono text-success-base">{stats?.attendanceConsistency ?? 92.4}% Avg</span>
                      </div>
                      <div className="w-full h-3 rounded-full bg-slate-100 overflow-hidden">
                        <div className="h-full bg-success-base rounded-full" style={{ width: `${stats?.attendanceConsistency ?? 92.4}%` }} />
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between text-xs font-bold uppercase text-text-muted mb-2">
                        <span>Faculty KYC & Contract Compliance</span>
                        <span className="font-mono text-amber-700">{stats?.kycCompliance ?? 88.0}% Verified</span>
                      </div>
                      <div className="w-full h-3 rounded-full bg-slate-100 overflow-hidden">
                        <div className="h-full bg-amber-500 rounded-full" style={{ width: `${stats?.kycCompliance ?? 88}%` }} />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-8 pt-6 border-t border-border flex flex-wrap items-center justify-between gap-4 text-xs text-text-muted font-mono">
                  <span className="flex items-center gap-1.5">
                    <CheckCircle size={16} className="text-success-base" /> {stats?.activeFaculty ?? 42}/{stats?.activeFaculty ?? 42} Studios Online
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Clock size={16} className="text-primary-800" /> Next Shift Check: 14:00 IST
                  </span>
                </div>
              </div>
            </div>

            {/* Right Span 5: Admin Action Shortcuts */}
            <div className="lg:col-span-5 bezel-outer">
              <div className="bezel-inner !p-8 h-full flex flex-col justify-between bg-slate-50/50">
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Buildings size={22} className="text-primary-800" />
                    <h3 className="text-xl font-bold text-text-primary tracking-tight">Administrative Priorities</h3>
                  </div>
                  <p className="text-xs text-text-muted mb-6">Immediate action items requiring Institute HR & Director review.</p>

                  <div className="space-y-4">
                    <div 
                      onClick={() => onNavigateTab('admin-faculty')}
                      className="p-4 rounded-2xl bg-white border border-border hover:border-primary-700 cursor-pointer transition-all shadow-sm flex items-center justify-between group"
                    >
                      <div className="flex items-center gap-3.5">
                        <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center shrink-0 font-bold font-mono">
                          3
                        </div>
                        <div>
                          <h5 className="text-sm font-bold text-text-primary group-hover:text-primary-800 transition-colors">Leave Approval Queue</h5>
                          <p className="text-xs text-text-muted">Faculty leave requests waiting for decision.</p>
                        </div>
                      </div>
                      <span className="text-xs font-bold text-primary-800 group-hover:translate-x-1 transition-transform">&rarr;</span>
                    </div>

                    <div 
                      onClick={() => onNavigateTab('admin-faculty')}
                      className="p-4 rounded-2xl bg-white border border-border hover:border-primary-700 cursor-pointer transition-all shadow-sm flex items-center justify-between group"
                    >
                      <div className="flex items-center gap-3.5">
                        <div className="w-10 h-10 rounded-xl bg-red-100 text-red-700 flex items-center justify-center shrink-0 font-bold font-mono">
                          1
                        </div>
                        <div>
                          <h5 className="text-sm font-bold text-text-primary group-hover:text-primary-800 transition-colors">Pending KYC Document</h5>
                          <p className="text-xs text-text-muted">Dr. Sneha Kulkarni degree verification pending.</p>
                        </div>
                      </div>
                      <span className="text-xs font-bold text-primary-800 group-hover:translate-x-1 transition-transform">&rarr;</span>
                    </div>

                    <div 
                      onClick={() => onNavigateTab('schedule')}
                      className="p-4 rounded-2xl bg-white border border-border hover:border-primary-700 cursor-pointer transition-all shadow-sm flex items-center justify-between group"
                    >
                      <div className="flex items-center gap-3.5">
                        <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-800 flex items-center justify-center shrink-0 font-bold font-mono">
                          18
                        </div>
                        <div>
                          <h5 className="text-sm font-bold text-text-primary group-hover:text-primary-800 transition-colors">Timetable & Studio Grid</h5>
                          <p className="text-xs text-text-muted">Inspect room allocations across 3 studios.</p>
                        </div>
                      </div>
                      <span className="text-xs font-bold text-primary-800 group-hover:translate-x-1 transition-transform">&rarr;</span>
                    </div>
                  </div>
                </div>

                <div className="pt-6 mt-6 border-t border-border flex items-center justify-between text-xs text-text-muted">
                  <span>System Role: <strong className="text-text-primary">Institute Admin</strong></span>
                </div>
              </div>
            </div>

          </div>
        </>
      )}
    </div>
  );
};
