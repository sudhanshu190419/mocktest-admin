'use client';

import React, { useState, useEffect } from 'react';
import { 
  MOCK_LIVE_CLASSES, 
  MOCK_ASSESSMENTS,
  MOCK_ANALYTICS
} from '@/data/mockData';
import { 
  Star, 
  VideoCamera, 
  ClockAfternoon, 
  ArrowRight,
  Briefcase,
  ChartLineUp,
  FileText,
  Chalkboard,
  BookOpen
} from '@phosphor-icons/react';
import { useAuth } from '@/context/AuthContext';
import { teacherService } from '@/services/teacherService';

interface OverviewViewProps {
  onNavigateTab: (tab: string) => void;
  onLaunchLive: () => void;
}

export const OverviewView: React.FC<OverviewViewProps> = ({ onNavigateTab, onLaunchLive }) => {
  const { teacherProfile } = useAuth();
  
  // Initial state while data is being fetched from the backend
  const [dashboardData, setDashboardData] = useState(() => ({
    rating: 5.0,
    specialization: '',
    activeBatches: 0,
    totalStudents: 0,
    analytics: {
      totalStudents: 0,
      totalClassesConducted: 0,
      totalClassesScheduled: 0,
      avgAttendanceRate: '0%',
      totalContentUploaded: 0,
      questionsCreated: 0,
      testsCreated: 0,
      avgStudentScore: '0%',
      topChapter: 'None'
    },
    nextClass: null as any,
    activeTest: null as any
  }));

  useEffect(() => {
    const fetchOverviewStats = async () => {
      if (teacherProfile) {
        const res = await teacherService.getTeacherOverviewData(teacherProfile.id);
        if (res) {
          setDashboardData(prev => ({
            rating: res.rating || prev.rating,
            specialization: res.specialization || prev.specialization,
            activeBatches: res.activeBatches !== undefined ? res.activeBatches : prev.activeBatches,
            totalStudents: res.totalStudents !== undefined ? res.totalStudents : prev.totalStudents,
            analytics: res.analytics ? { ...prev.analytics, ...res.analytics } : prev.analytics,
            nextClass: res.nextClass ? { ...prev.nextClass, ...res.nextClass } : prev.nextClass,
            activeTest: res.activeTest ? { ...prev.activeTest, ...res.activeTest } : prev.activeTest
          }));
        }
      }
    };
    fetchOverviewStats();
  }, [teacherProfile]);

  const { rating, specialization, activeBatches, totalStudents, analytics, nextClass, activeTest } = dashboardData;

  return (
    <div className="space-y-8 pb-12 animate-fadeIn">
      {/* Welcome Hero Banner */}
      <div className="bezel-outer bg-gradient-to-br from-primary-800 to-navy-800 text-white p-2">
        <div className="bg-primary-900/60 p-8 sm:p-10 rounded-[calc(2.5rem-0.5rem)] border border-white/10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6 relative overflow-hidden">
          {/* Background glowing orb */}
          <div className="absolute -right-20 -top-20 w-80 h-80 rounded-full bg-blue-500/10 blur-3xl pointer-events-none" />
          
          <div className="space-y-2 max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 text-blue-200 text-xs font-mono tracking-wider uppercase border border-white/15 mb-1">
              <span>Department of {specialization}</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight leading-tight">
              Welcome back, {teacherProfile?.name || 'Faculty Member'} <span className="text-amber-400">👋</span>
            </h1>
            <p className="text-blue-100/80 text-sm sm:text-base leading-relaxed">
              Your academic studio is ready. You have <strong className="text-white font-semibold">{nextClass ? '1' : '0'} upcoming live session</strong>{nextClass ? ' today' : ''} and <strong className="text-white font-semibold">{activeTest ? activeTest.totalStudents - activeTest.submittedCount : 0} pending test submissions</strong> to review today.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 shrink-0">
            <button 
              onClick={onLaunchLive}
              className="px-6 py-3.5 rounded-full bg-amber-400 text-slate-900 font-bold text-sm tracking-wide shadow-xl hover:bg-amber-300 active:scale-95 transition-all flex items-center justify-center gap-2"
            >
              <VideoCamera size={20} className="text-slate-900 animate-pulse" />
              <span>Enter Live Studio</span>
            </button>
            <button 
              onClick={() => onNavigateTab('assessments')}
              className="px-6 py-3.5 rounded-full bg-white/10 hover:bg-white/20 text-white font-semibold text-sm transition-all border border-white/20 flex items-center justify-center gap-2"
            >
              <span>Grade Submissions</span>
              <ArrowRight size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* NEW: Domain 08 Faculty Performance & Analytics Deck */}
      <div className="bezel-outer bg-gradient-to-r from-surface to-slate-50">
        <div className="bezel-inner !p-8">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
            <div>
              <div className="flex items-center gap-2">
                <ChartLineUp size={22} className="text-primary-800" />
                <h3 className="text-xl font-bold text-text-primary tracking-tight">Faculty Analytics & Operational Output</h3>
              </div>
              <p className="text-sm text-text-muted mt-0.5">
                Aggregated nightly via <code className="font-mono bg-slate-200 px-1.5 py-0.5 rounded text-xs">teacher_analytics</code> schema (Domain 08).
              </p>
            </div>
            <span className="text-xs font-mono font-bold bg-primary-100 text-primary-800 px-3 py-1.5 rounded-xl border border-primary-700/20">
              Top Chapter: {analytics.topChapter}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="p-4 rounded-2xl bg-white border border-border shadow-sm">
              <div className="flex items-center gap-2 text-text-muted text-xs mb-1">
                <Chalkboard size={16} className="text-primary-700" />
                <span>Classes Conducted</span>
              </div>
              <p className="text-2xl font-extrabold text-text-primary font-mono">{analytics.totalClassesConducted} <span className="text-xs text-text-muted font-normal">/ {analytics.totalClassesScheduled}</span></p>
              <p className="text-[10px] text-success-base font-semibold mt-1">98.4% Execution Rate</p>
            </div>

            <div className="p-4 rounded-2xl bg-white border border-border shadow-sm">
              <div className="flex items-center gap-2 text-text-muted text-xs mb-1">
                <FileText size={16} className="text-amber-500" />
                <span>Content Uploaded</span>
              </div>
              <p className="text-2xl font-extrabold text-primary-800 font-mono">{analytics.totalContentUploaded}</p>
              <p className="text-[10px] text-text-muted font-semibold mt-1">Lecture Notes & DPPs</p>
            </div>

            <div className="p-4 rounded-2xl bg-white border border-border shadow-sm">
              <div className="flex items-center gap-2 text-text-muted text-xs mb-1">
                <BookOpen size={16} className="text-emerald-500" />
                <span>Questions Created</span>
              </div>
              <p className="text-2xl font-extrabold text-text-primary font-mono">{analytics.questionsCreated}</p>
              <p className="text-[10px] text-emerald-600 font-semibold mt-1">Across {analytics.testsCreated} Tests</p>
            </div>

            <div className="p-4 rounded-2xl bg-white border border-border shadow-sm">
              <div className="flex items-center gap-2 text-text-muted text-xs mb-1">
                <Star size={16} weight="fill" className="text-amber-400" />
                <span>Avg Student Score</span>
              </div>
              <p className="text-2xl font-extrabold text-primary-800 font-mono">{analytics.avgStudentScore}</p>
              <p className="text-[10px] text-success-base font-semibold mt-1">+4.2% vs Institute Avg</p>
            </div>
          </div>
        </div>
      </div>

      {/* Bento Grid Section */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
        {/* Card 1: Today's Next Live Session (Span 8) */}
        <div className="md:col-span-8 bezel-outer">
          <div className="bezel-inner">
            {nextClass ? (
              <>
                <div>
                  <div className="flex items-center justify-between mb-6">
                    <span className="text-xs font-bold uppercase tracking-wider text-primary-700 bg-primary-100 px-3 py-1 rounded-full">
                      • Starting Today at {nextClass.startTime}
                    </span>
                    <span className="text-xs font-mono text-text-muted flex items-center gap-1">
                      <ClockAfternoon size={16} /> {nextClass.durationMinutes} Min Session
                    </span>
                  </div>

                  <h3 className="text-2xl font-bold text-text-primary tracking-tight mb-2">
                    {nextClass.title}
                  </h3>
                  <p className="text-sm font-semibold text-navy-800 mb-6">
                    Batch: {nextClass.batchName} ({nextClass.totalStudents} Students Assigned)
                  </p>
                </div>

                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mt-6">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-primary-800 text-white flex items-center justify-center font-bold font-mono">
                      {nextClass.totalStudents}
                    </div>
                    <div>
                      <p className="text-xs text-text-muted font-medium">Expected Roster</p>
                      <p className="text-sm font-bold text-text-primary">{nextClass.batchName}</p>
                    </div>
                  </div>
                  <button 
                    onClick={onLaunchLive}
                    className="btn-primary w-full sm:w-auto pr-2 bg-primary-800"
                  >
                    <span className="pl-2 font-semibold">Start Broadcast Now</span>
                    <div className="btn-icon-wrapper">
                      <ArrowRight size={14} className="text-white" />
                    </div>
                  </button>
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <VideoCamera size={48} className="text-slate-300 mb-3" />
                <h4 className="font-bold text-base text-text-primary">No Scheduled Live Classes</h4>
                <p className="text-xs text-text-muted mt-1 max-w-sm">You have conducted all scheduled slots for today. Go to timetable to schedule upcoming shifts.</p>
                <button 
                  onClick={() => onNavigateTab('schedule')}
                  className="mt-4 px-4 py-2 bg-primary-800 text-white font-semibold rounded-xl text-xs flex items-center gap-1.5 hover:bg-primary-900 transition-colors"
                >
                  <span>Open Batches Timetable</span>
                  <ArrowRight size={14} />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Card 2: Faculty Key Metrics (Span 4) */}
        <div className="md:col-span-4 bezel-outer">
          <div className="bezel-inner bg-gradient-to-b from-surface to-slate-50/50">
            <div>
              <h4 className="text-sm font-bold text-text-muted uppercase tracking-wider mb-6">
                Faculty Performance Score
              </h4>
              <div className="flex items-baseline gap-3 mb-6">
                <span className="text-5xl font-extrabold text-primary-800 font-mono tracking-tight">
                  {rating}
                </span>
                <div className="flex text-amber-400 gap-1">
                  {[...Array(5)].map((_, i) => (
                    <Star key={i} size={18} weight="fill" />
                  ))}
                </div>
              </div>
              <p className="text-xs text-text-muted leading-relaxed mb-6">
                Rated across {totalStudents} active students in your {specialization} and Foundation streams. Top 2% faculty rating institute-wide.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-4 border-t border-border">
              <div className="p-3 rounded-xl bg-white border border-border/80">
                <p className="text-[11px] text-text-muted font-medium">Active Students</p>
                <p className="text-xl font-bold text-text-primary font-mono mt-0.5">{totalStudents}</p>
              </div>
              <div className="p-3 rounded-xl bg-white border border-border/80">
                <p className="text-[11px] text-text-muted font-medium">Assigned Batches</p>
                <p className="text-xl font-bold text-text-primary font-mono mt-0.5">{activeBatches}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Card 3: Active Assessment Snapshot (Span 6) */}
        <div className="md:col-span-6 bezel-outer">
          <div className="bezel-inner flex flex-col justify-between">
            {activeTest ? (
              <div>
                <div className="flex items-center justify-between mb-4">
                  <span className="text-xs font-bold uppercase tracking-wider text-amber-700 bg-amber-50 px-3 py-1 rounded-full border border-amber-200">
                    Assessment In Review
                  </span>
                  <span className="text-xs font-mono text-text-muted">ID: {activeTest.id.slice(0, 8)}</span>
                </div>
                <h4 className="text-lg font-bold text-text-primary mb-1">{activeTest.title}</h4>
                <p className="text-xs text-text-muted mb-6">{activeTest.batchName} • {activeTest.totalQuestions} Questions</p>
                
                <div className="space-y-3 mb-6">
                  <div className="flex justify-between text-sm">
                    <span className="text-text-muted">Submission Progress</span>
                    <span className="font-mono font-bold text-text-primary">{activeTest.submittedCount} / {activeTest.totalStudents} ({activeTest.avgScore} Avg)</span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-slate-200 overflow-hidden">
                    <div className="h-full bg-primary-700 rounded-full" style={{ width: activeTest.totalStudents > 0 ? `${(activeTest.submittedCount / activeTest.totalStudents) * 100}%` : '0%' }} />
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-6 text-center h-[178px] justify-self-center">
                <FileText size={40} className="text-slate-300 mb-2" />
                <h4 className="font-bold text-sm text-text-primary">No Active Quizzes</h4>
                <p className="text-[11px] text-text-muted mt-0.5 max-w-xs">You have no assessments currently in progress or waiting to be graded.</p>
              </div>
            )}

            <button 
              onClick={() => onNavigateTab('assessments')}
              className="w-full py-3 rounded-xl bg-slate-100 hover:bg-primary-100 hover:text-primary-800 text-text-primary font-semibold text-sm transition-colors flex items-center justify-center gap-2 mt-4"
            >
              <span>View Grading Queue</span>
              <ArrowRight size={16} />
            </button>
          </div>
        </div>

        {/* Card 4: HR & Contract Status (Span 6) */}
        <div className="md:col-span-6 bezel-outer">
          <div className="bezel-inner">
            <div>
              <div className="flex items-center justify-between mb-4">
                <span className="text-xs font-bold uppercase tracking-wider text-success-base bg-success-light px-3 py-1 rounded-full border border-success-base/20">
                  • Contract Active & KYC Verified
                </span>
                <span className="text-xs font-mono text-text-muted">Domain 13 HR</span>
              </div>
              <h4 className="text-lg font-bold text-text-primary mb-1">Senior Faculty Compensation Model</h4>
              <p className="text-xs text-text-muted mb-6">Fixed Monthly Basis • Disbursement via {teacherProfile?.bankDetails?.bankName || 'N/A'} ({teacherProfile?.bankDetails?.accountNumberMasked || '••••'})</p>
              
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="p-3.5 rounded-xl bg-slate-50 border border-border">
                  <p className="text-[11px] text-text-muted uppercase">Base Compensation</p>
                  <p className="text-lg font-bold text-primary-800 font-mono mt-0.5">{teacherProfile?.employment?.baseCompensation || 'N/A'}</p>
                </div>
                <div className="p-3.5 rounded-xl bg-slate-50 border border-border">
                  <p className="text-[11px] text-text-muted uppercase">Leave Balance</p>
                  <p className="text-lg font-bold text-text-primary font-mono mt-0.5">14 Days Avail.</p>
                </div>
              </div>
            </div>

            <button 
              onClick={() => onNavigateTab('hr-portal')}
              className="w-full py-3 rounded-xl bg-navy-800 text-white hover:bg-primary-800 font-semibold text-sm transition-colors flex items-center justify-center gap-2"
            >
              <Briefcase size={16} />
              <span>Open HR & Leave Portal</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
