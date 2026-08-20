'use client';

import React, { useState, useEffect } from 'react';
import { 
  MOCK_BATCHES, 
  MOCK_LIVE_CLASSES, 
  MOCK_AVAILABILITY
} from '@/data/mockData';
import type { 
  AcademicBatch, 
  StudentRosterItem, 
  CourseChapterItem, 
  TeacherAvailabilitySlot 
} from '@/data/mockData';
import { teacherService } from '@/services/teacherService';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/config/supabase';
import { 
  Users, 
  VideoCamera, 
  Calendar, 
  MapPin, 
  ArrowUpRight, 
  Clock,
  ChartBar,
  CheckCircle,
  XCircle,
  ClockAfternoon,
  BookOpen,
  Student,
  ChatCircleText,
  X,
  Sparkle,
  CircleNotch
} from '@phosphor-icons/react';

interface ScheduleViewProps {
  onLaunchLive: () => void;
}

export const ScheduleView: React.FC<ScheduleViewProps> = ({ onLaunchLive }) => {
  const { teacherProfile } = useAuth();
  const [batches, setBatches] = useState<AcademicBatch[]>([]);
  const [selectedBatchId, setSelectedBatchId] = useState<string>('');
  const [slots, setSlots] = useState<TeacherAvailabilitySlot[]>([]);
  const [upcomingClass, setUpcomingClass] = useState<any>(null);
  
  // Roster & Syllabus Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalTab, setModalTab] = useState<'roster' | 'syllabus'>('roster');
  const [students, setStudents] = useState<StudentRosterItem[]>([]);
  const [chapters, setChapters] = useState<CourseChapterItem[]>([]);
  const [loadingModal, setLoadingModal] = useState(false);
  
  // Doubt Reply State
  const [replyingDoubtId, setReplyingDoubtId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [isSubmittingReply, setIsSubmittingReply] = useState(false);

  useEffect(() => {
    if (teacherProfile) {
      teacherService.getAssignedBatches(teacherProfile.id).then((res) => {
        setBatches(res);
        if (res && res.length > 0) {
          setSelectedBatchId(res[0].id);
        } else {
          setSelectedBatchId('');
        }
      });

      supabase
          .from('live_classes')
          .select('*, batches(name)')
          .eq('teacher_id', teacherProfile.id)
          .in('status', ['scheduled', 'live'])
          .order('scheduled_start', { ascending: true })
          .limit(1)
          .then(({ data, error }) => {
            if (!error && data && data.length > 0) {
              const lc = data[0];
              const bName = (lc.batches as any)?.name || 'Allotted Batch';
              setUpcomingClass({
                title: lc.topic || 'Live Session',
                startTime: lc.scheduled_start ? new Date(lc.scheduled_start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Today',
                batchName: bName
              });
            } else {
              setUpcomingClass(null);
            }
          });
    }
  }, [teacherProfile]);

  const toggleAvailability = (id: string) => {
    setSlots(slots.map(s => s.id === id ? { ...s, isAvailable: !s.isAvailable } : s));
  };

  const handleInspectBatch = async (batchId: string) => {
    setSelectedBatchId(batchId);
    setIsModalOpen(true);
    setLoadingModal(true);
    try {
      const [stuRes, chapRes] = await Promise.all([
        teacherService.getStudentRoster(batchId),
        teacherService.getCourseChapters(batchId)
      ]);
      setStudents(stuRes);
      setChapters(chapRes);
    } catch (err) {
      console.error('Error loading modal data:', err);
    } finally {
      setLoadingModal(false);
    }
  };

  const handleResolveDoubt = async (doubtId?: string) => {
    if (!doubtId || !replyText.trim()) return;
    setIsSubmittingReply(true);
    await teacherService.resolveStudentDoubt(doubtId, replyText);
    
    // Update local state to mark doubt as resolved
    setStudents(prev => prev.map(s => s.pendingDoubt && s.id === replyingDoubtId ? { ...s, pendingDoubt: undefined } : s));
    setIsSubmittingReply(false);
    setReplyingDoubtId(null);
    setReplyText('');
  };

  const currentBatch = batches.find(b => b.id === selectedBatchId) || batches[0];

  return (
    <div className="space-y-8 pb-12 animate-fadeIn relative">
      {/* Top Banner Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        <div className="bezel-outer">
          <div className="bezel-inner !p-6 flex items-center justify-between">
            <div>
              <p className="text-xs text-text-muted font-medium uppercase tracking-wider">Assigned Batches</p>
              <p className="text-3xl font-extrabold text-text-primary font-mono mt-1">{batches.length} <span className="text-sm text-text-muted font-sans font-normal">Active</span></p>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-primary-100 text-primary-800 flex items-center justify-center">
              <Calendar size={24} />
            </div>
          </div>
        </div>
        <div className="bezel-outer">
          <div className="bezel-inner !p-6 flex items-center justify-between">
            <div>
              <p className="text-xs text-text-muted font-medium uppercase tracking-wider">Total Students</p>
              <p className="text-3xl font-extrabold text-primary-800 font-mono mt-1">145 <span className="text-sm text-text-muted font-sans font-normal">Roster</span></p>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-700 flex items-center justify-center">
              <Users size={24} />
            </div>
          </div>
        </div>
        <div className="bezel-outer">
          <div className="bezel-inner !p-6 flex items-center justify-between">
            <div>
              <p className="text-xs text-text-muted font-medium uppercase tracking-wider">Avg. Attendance</p>
              <p className="text-3xl font-extrabold text-success-base font-mono mt-1">91.5% <span className="text-xs text-success-base font-sans font-semibold bg-success-light px-2 py-0.5 rounded-full">+2.4%</span></p>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-success-light text-success-base flex items-center justify-center">
              <ChartBar size={24} />
            </div>
          </div>
        </div>
      </div>

      {/* Live Broadcast Studio Launchpad */}
      {upcomingClass ? (
        <div className="bezel-outer bg-gradient-to-r from-navy-800 to-primary-900 text-white p-1.5 animate-fadeIn">
          <div className="bg-navy-800/80 p-8 rounded-[calc(2.5rem-0.5rem)] border border-white/10 flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-5">
              <div className="w-16 h-16 rounded-3xl bg-amber-400 text-slate-900 flex items-center justify-center shadow-lg shrink-0 animate-pulse">
                <VideoCamera size={32} />
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-ping" />
                  <span className="text-xs font-mono uppercase tracking-widest text-amber-300">Live Studio Ready</span>
                </div>
                <h3 className="text-xl sm:text-2xl font-bold tracking-tight">
                  {upcomingClass.title}
                </h3>
                <p className="text-sm text-blue-100/80 mt-1">
                  Scheduled for {upcomingClass.startTime} • {upcomingClass.batchName}
                </p>
              </div>
            </div>
            <button 
              onClick={onLaunchLive}
              className="btn-primary bg-amber-400 text-slate-900 hover:bg-amber-300 pr-2 shadow-2xl shrink-0 w-full md:w-auto"
            >
              <span className="pl-3 font-bold">Start Live Broadcast</span>
              <div className="btn-icon-wrapper-dark">
                <ArrowUpRight size={16} />
              </div>
            </button>
          </div>
        </div>
      ) : (
        <div className="bezel-outer p-1.5 animate-fadeIn">
          <div className="bg-slate-50/50 p-6 rounded-[calc(2.5rem-0.5rem)] border border-border flex flex-col items-center justify-center text-center text-text-muted">
            <VideoCamera size={32} className="opacity-40 mb-2" />
            <p className="text-sm font-medium">No live broadcast scheduled for today</p>
          </div>
        </div>
      )}

      {/* Batches Grid Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xl font-bold text-text-primary tracking-tight">Assigned Batches & Course Roster</h3>
          <p className="text-sm text-text-muted mt-0.5">Click any batch card to inspect student attendance, academic rankings, syllabus progress, and doubt tickets.</p>
        </div>
      </div>

      {/* Batches Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {batches.map((batch) => {
          const isSelected = selectedBatchId === batch.id;
          return (
            <div 
              key={batch.id} 
              onClick={() => handleInspectBatch(batch.id)}
              className={`bezel-outer cursor-pointer transition-all duration-300 ${
                isSelected ? 'ring-2 ring-primary-700 shadow-2xl scale-[1.01]' : 'hover:scale-[1.01]'
              }`}
            >
              <div className="bezel-inner !p-6">
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-xs font-mono font-bold bg-slate-100 px-2.5 py-1 rounded-lg text-navy-800">
                      {batch.code}
                    </span>
                    <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-primary-100 text-primary-800 flex items-center gap-1">
                      <Sparkle size={12} weight="fill" /> {batch.status}
                    </span>
                  </div>

                  <h4 className="text-lg font-bold text-text-primary mb-1 leading-snug">{batch.name}</h4>
                  <p className="text-xs text-text-muted mb-6">{batch.stream}</p>

                  <div className="space-y-3 pt-4 border-t border-border">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-text-muted flex items-center gap-1.5">
                        <Users size={14} className="text-primary-700" /> Roster
                      </span>
                      <span className="font-mono font-bold text-primary-800 underline underline-offset-4">{batch.studentsCount} Students (Inspect &rarr;)</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-text-muted flex items-center gap-1.5">
                        <MapPin size={14} className="text-primary-700" /> Studio
                      </span>
                      <span className="font-mono font-semibold text-text-primary">{batch.room}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-text-muted flex items-center gap-1.5">
                        <Clock size={14} className="text-primary-700" /> Next Class
                      </span>
                      <span className="font-mono font-semibold text-primary-800">{batch.nextClass}</span>
                    </div>
                  </div>
                </div>

                <div className="mt-6 pt-4 border-t border-border">
                  <div className="flex justify-between text-xs mb-1.5">
                    <span className="text-text-muted">Syllabus Completion</span>
                    <span className="font-mono font-bold text-text-primary">{batch.progress}%</span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-slate-100 overflow-hidden">
                    <div className="h-full bg-primary-800 rounded-full" style={{ width: `${batch.progress}%` }} />
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Weekly Availability & Office Hours Scheduler */}
      <div className="bezel-outer">
        <div className="bezel-inner !p-8">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
            <div>
              <div className="flex items-center gap-2">
                <ClockAfternoon size={22} className="text-primary-800" />
                <h4 className="text-xl font-bold text-text-primary tracking-tight">Weekly Availability & Office Hours Scheduler</h4>
              </div>
              <p className="text-sm text-text-muted mt-0.5">
                Managed via <code className="font-mono bg-slate-100 px-1.5 py-0.5 rounded text-xs">teacher_availability</code> schema. Used by academic coordinators to schedule live sessions.
              </p>
            </div>
            <span className="text-xs font-mono font-bold px-3 py-1.5 rounded-xl bg-primary-100 text-primary-800">
              7 Recurring Slots Configured
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {slots.map((slot) => (
              <div 
                key={slot.id} 
                onClick={() => toggleAvailability(slot.id)}
                className={`p-4 rounded-2xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                  slot.isAvailable 
                    ? 'bg-white border-border hover:border-primary-700/40 shadow-sm' 
                    : 'bg-slate-100/70 border-border/40 opacity-60'
                }`}
              >
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-bold text-sm text-text-primary">{slot.dayOfWeek}</span>
                    <span className="text-[10px] font-mono bg-slate-100 px-2 py-0.5 rounded text-navy-800 font-bold">{slot.type}</span>
                  </div>
                  <p className="text-xs font-mono text-text-muted">{slot.startTime} — {slot.endTime}</p>
                </div>

                <div className="shrink-0">
                  {slot.isAvailable ? (
                    <span className="flex items-center gap-1 text-xs font-semibold text-success-base bg-success-light px-2.5 py-1 rounded-full">
                      <CheckCircle size={14} weight="fill" /> Active
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-xs font-semibold text-text-muted bg-slate-200 px-2.5 py-1 rounded-full">
                      <XCircle size={14} weight="fill" /> Offline
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-text-muted text-center mt-4 font-sans">
            Click any time slot to toggle your recurring broadcast availability on or off.
          </p>
        </div>
      </div>

      {/* INTERACTIVE COURSE & STUDENT ROSTER MODAL */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-navy-900/80 backdrop-blur-md flex items-center justify-center p-4 sm:p-6 animate-fadeIn">
          <div className="bg-surface w-full max-w-5xl rounded-[2.5rem] shadow-2xl border border-border overflow-hidden flex flex-col max-h-[88vh]">
            
            {/* Modal Header */}
            <div className="p-6 sm:p-8 bg-navy-900 text-white flex items-center justify-between gap-4 border-b border-white/10 shrink-0">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-mono font-bold uppercase tracking-wider text-amber-400 bg-white/10 px-2.5 py-0.5 rounded-full">
                    {currentBatch.code} • Domain 02 & 08
                  </span>
                </div>
                <h3 className="text-2xl font-bold tracking-tight">{currentBatch.name}</h3>
                <p className="text-xs text-blue-200 mt-1 font-mono">
                  Stream: {currentBatch.stream} • Enrolled Roster: {currentBatch.studentsCount} Students
                </p>
              </div>
              <button 
                onClick={() => setIsModalOpen(false)}
                className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-all shrink-0"
              >
                <X size={20} weight="bold" />
              </button>
            </div>

            {/* Modal Tabs */}
            <div className="px-6 sm:px-8 pt-4 bg-slate-50 border-b border-border flex gap-4 shrink-0">
              <button
                onClick={() => setModalTab('roster')}
                className={`pb-3 font-bold text-sm flex items-center gap-2 border-b-2 transition-all ${
                  modalTab === 'roster' 
                    ? 'border-primary-800 text-primary-800' 
                    : 'border-transparent text-text-muted hover:text-text-primary'
                }`}
              >
                <Student size={18} />
                <span>👨‍🎓 Enrolled Students Roster ({students.length})</span>
              </button>
              <button
                onClick={() => setModalTab('syllabus')}
                className={`pb-3 font-bold text-sm flex items-center gap-2 border-b-2 transition-all ${
                  modalTab === 'syllabus' 
                    ? 'border-primary-800 text-primary-800' 
                    : 'border-transparent text-text-muted hover:text-text-primary'
                }`}
              >
                <BookOpen size={18} />
                <span>📚 Syllabus & Chapter Mastery ({chapters.length})</span>
              </button>
            </div>

            {/* Modal Body Content */}
            <div className="p-6 sm:p-8 overflow-y-auto flex-1">
              {loadingModal ? (
                <div className="py-20 flex flex-col items-center justify-center gap-3">
                  <CircleNotch size={36} className="animate-spin text-primary-800" />
                  <p className="text-sm font-mono text-text-muted">Querying Supabase database tables...</p>
                </div>
              ) : modalTab === 'roster' ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {students.map((stu) => (
                      <div key={stu.id} className="p-4 rounded-2xl bg-slate-50 border border-border flex flex-col justify-between gap-4 hover:border-primary-700/40 transition-all">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-3">
                            <img src={stu.avatar} alt={stu.name} className="w-12 h-12 rounded-full object-cover border border-border shadow-sm shrink-0" />
                            <div>
                              <div className="flex items-center gap-2">
                                <h5 className="font-bold text-sm text-text-primary">{stu.name}</h5>
                                <span className="text-[10px] font-mono bg-primary-100 text-primary-800 px-1.5 py-0.5 rounded font-bold">Rank #{stu.rank}</span>
                              </div>
                              <p className="text-xs font-mono text-text-muted">{stu.rollNumber}</p>
                            </div>
                          </div>
                          <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full shrink-0 ${
                            stu.status === 'Present Live' ? 'bg-success-light text-success-base' :
                            stu.status === 'Watched Recording' ? 'bg-blue-50 text-blue-700' :
                            'bg-red-50 text-red-600'
                          }`}>
                            {stu.status}
                          </span>
                        </div>

                        {/* Diagnostic Progress */}
                        <div className="grid grid-cols-2 gap-2 text-xs py-2 border-y border-border/60 bg-white p-2.5 rounded-xl">
                          <div>
                            <span className="text-[10px] font-mono text-text-muted block uppercase">Attendance Rate</span>
                            <span className="font-bold font-mono text-text-primary">{stu.attendanceRate}</span>
                          </div>
                          <div>
                            <span className="text-[10px] font-mono text-text-muted block uppercase">Avg. Test Score</span>
                            <span className="font-bold font-mono text-primary-800">{stu.avgScore}</span>
                          </div>
                        </div>

                        <div className="text-[11px] space-y-1">
                          <p className="text-emerald-700"><span className="font-bold">✨ Strong:</span> {stu.strongChapter}</p>
                          <p className="text-amber-700"><span className="font-bold">⚠️ Review:</span> {stu.weakChapter}</p>
                        </div>

                        {/* Pending Doubt Ticket from Domain 14 */}
                        {stu.pendingDoubt && (
                          <div className="mt-2 p-3 rounded-xl bg-amber-50/80 border border-amber-200 text-xs">
                            <div className="flex items-center gap-1.5 text-amber-800 font-bold mb-1">
                              <ChatCircleText size={16} weight="fill" />
                              <span>Live Doubt Ticket Submitted:</span>
                            </div>
                            <p className="text-slate-700 italic mb-3">"{stu.pendingDoubt}"</p>
                            
                            {replyingDoubtId === stu.id ? (
                              <div className="space-y-2">
                                <textarea
                                  value={replyText}
                                  onChange={(e) => setReplyText(e.target.value)}
                                  placeholder="Type academic explanation here..."
                                  className="w-full p-2 text-xs rounded-lg border border-amber-300 bg-white outline-none focus:ring-2 focus:ring-amber-500"
                                  rows={2}
                                />
                                <div className="flex justify-end gap-2">
                                  <button onClick={() => setReplyingDoubtId(null)} className="px-2 py-1 text-xs text-text-muted hover:underline">Cancel</button>
                                  <button 
                                    onClick={() => handleResolveDoubt(stu.pendingDoubt)}
                                    disabled={isSubmittingReply}
                                    className="px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-lg transition-all"
                                  >
                                    {isSubmittingReply ? 'Resolving...' : 'Send Reply & Resolve'}
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <button 
                                onClick={() => { setReplyingDoubtId(stu.id); setReplyText(''); }}
                                className="w-full py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-bold transition-all text-center"
                              >
                                Reply & Resolve Ticket &rarr;
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs font-mono text-text-muted pb-2 border-b border-border">
                    <span>UNIT & CHAPTER TITLE</span>
                    <span>SYLLABUS STATUS</span>
                  </div>
                  {chapters.map((ch) => (
                    <div key={ch.id} className="p-4 rounded-2xl bg-slate-50 border border-border flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <span className={`w-8 h-8 rounded-full flex items-center justify-center font-mono font-bold text-xs shrink-0 ${
                          ch.status === 'completed' ? 'bg-success-light text-success-base' :
                          ch.status === 'current' ? 'bg-primary-100 text-primary-800 animate-pulse' :
                          'bg-slate-200 text-text-muted'
                        }`}>
                          {ch.order}
                        </span>
                        <div>
                          <h5 className="font-bold text-sm text-text-primary">{ch.title}</h5>
                          {ch.completedDate && <p className="text-[11px] text-text-muted font-mono">Completed on {ch.completedDate}</p>}
                        </div>
                      </div>
                      <div>
                        <span className={`text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider ${
                          ch.status === 'completed' ? 'bg-success-light text-success-base' :
                          ch.status === 'current' ? 'bg-amber-100 text-amber-800 border border-amber-300' :
                          'bg-slate-200 text-text-muted'
                        }`}>
                          {ch.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 sm:p-6 bg-slate-50 border-t border-border flex justify-end shrink-0">
              <button 
                onClick={() => setIsModalOpen(false)}
                className="btn-primary bg-navy-800 text-white hover:bg-navy-700 px-6"
              >
                Close Academic Drawer
              </button>
            </div>

          </div>
        </div>
      )}
    </div>
  );
};
