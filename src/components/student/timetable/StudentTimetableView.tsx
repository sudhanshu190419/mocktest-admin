'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import {
  Calendar,
  Clock,
  VideoCamera,
  BookOpen,
  CaretLeft,
  CaretRight,
  ArrowsClockwise,
  Broadcast,
  CheckCircle,
  FileText,
  Play,
  Funnel,
  ArrowRight,
  CalendarCheck,
  Sparkle,
} from '@phosphor-icons/react';
import {
  fetchTimetableForRange,
  fetchTodayTimetable,
  fetchWeekTimetable,
  fetchMonthTimetable,
  fetchAnnualTimetable,
} from '@/services/student/studentTimetableWebService';
import {
  getSubjectTheme,
  formatDateToIsoDate,
  getAcademicYearInfo,
  getAcademicYearMonths,
  getWeekDaysForDate,
  type TimetableSessionItem,
  type TimetableSessionType,
  type TimetableSessionStatus,
  type DynamicDayItem,
  type AcademicYearInfo,
} from '@/utils/studentTimetableProjector';

type TabView = 'today' | 'week' | 'month' | 'year';
type FilterType = 'all' | 'live' | 'test';

export function StudentTimetableView() {
  const [activeTab, setActiveTab] = useState<TabView>('today');
  const [activeFilter, setActiveFilter] = useState<FilterType>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Today State
  const [todaySessions, setTodaySessions] = useState<TimetableSessionItem[]>([]);
  const [todayDateStr, setTodayDateStr] = useState<string>('');

  // Week State
  const [weekReferenceDate, setWeekReferenceDate] = useState<Date>(new Date());
  const [weekDays, setWeekDays] = useState<DynamicDayItem[]>([]);
  const [weekSessions, setWeekSessions] = useState<TimetableSessionItem[]>([]);
  const [selectedWeekDateStr, setSelectedWeekDateStr] = useState<string>('');

  // Month State
  const [monthYear, setMonthYear] = useState<number>(new Date().getFullYear());
  const [monthNumber, setMonthNumber] = useState<number>(new Date().getMonth() + 1); // 1..12
  const [monthSessions, setMonthSessions] = useState<TimetableSessionItem[]>([]);
  const [selectedMonthDateStr, setSelectedMonthDateStr] = useState<string>('');

  // Annual Year State
  const currentAcademicYear = useMemo(() => getAcademicYearInfo(), []);
  const [selectedStartYear, setSelectedStartYear] = useState<number>(currentAcademicYear.startYear);
  const [annualInfo, setAnnualInfo] = useState<AcademicYearInfo>(currentAcademicYear);
  const [annualMonths, setAnnualMonths] = useState<Array<{ year: number; month: number; label: string; shortName: string }>>([]);
  const [annualSessions, setAnnualSessions] = useState<TimetableSessionItem[]>([]);
  const [expandedAnnualMonth, setExpandedAnnualMonth] = useState<string | null>(null);

  // ═══════════════════════════════════════════════════════════════════════════
  //  Data Fetchers
  // ═══════════════════════════════════════════════════════════════════════════

  const loadTodayData = useCallback(async () => {
    try {
      const { sessions, todayStr } = await fetchTodayTimetable();
      setTodaySessions(sessions);
      setTodayDateStr(todayStr);
    } catch (err) {
      console.error('[StudentTimetableView] Failed to load today timetable:', err);
    }
  }, []);

  const loadWeekData = useCallback(async (refDate: Date) => {
    try {
      const { days, sessions } = await fetchWeekTimetable(refDate);
      setWeekDays(days);
      setWeekSessions(sessions);
      const todayInWeek = days.find((d) => d.isToday);
      setSelectedWeekDateStr(todayInWeek ? todayInWeek.dateString : days[0].dateString);
    } catch (err) {
      console.error('[StudentTimetableView] Failed to load week timetable:', err);
    }
  }, []);

  const loadMonthData = useCallback(async (yr: number, mo: number) => {
    try {
      const { sessions } = await fetchMonthTimetable(yr, mo);
      setMonthSessions(sessions);
      const todayStr = formatDateToIsoDate(new Date());
      const isCurrentMonth = todayStr.startsWith(`${yr}-${String(mo).padStart(2, '0')}`);
      setSelectedMonthDateStr(isCurrentMonth ? todayStr : `${yr}-${String(mo).padStart(2, '0')}-01`);
    } catch (err) {
      console.error('[StudentTimetableView] Failed to load month timetable:', err);
    }
  }, []);

  const loadAnnualData = useCallback(async (startYear: number) => {
    try {
      const { academicYear, months, sessions } = await fetchAnnualTimetable(startYear);
      setAnnualInfo(academicYear);
      setAnnualMonths(months);
      setAnnualSessions(sessions);
      // Auto expand current month by default
      const now = new Date();
      const currentMonthKey = `${now.getFullYear()}-${now.getMonth() + 1}`;
      setExpandedAnnualMonth(currentMonthKey);
    } catch (err) {
      console.error('[StudentTimetableView] Failed to load annual timetable:', err);
    }
  }, []);

  const loadInitialData = useCallback(async () => {
    setIsLoading(true);
    await Promise.all([
      loadTodayData(),
      loadWeekData(weekReferenceDate),
      loadMonthData(monthYear, monthNumber),
      loadAnnualData(selectedStartYear),
    ]);
    setIsLoading(false);
  }, [loadTodayData, loadWeekData, loadMonthData, loadAnnualData, weekReferenceDate, monthYear, monthNumber, selectedStartYear]);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    if (activeTab === 'today') await loadTodayData();
    else if (activeTab === 'week') await loadWeekData(weekReferenceDate);
    else if (activeTab === 'month') await loadMonthData(monthYear, monthNumber);
    else if (activeTab === 'year') await loadAnnualData(selectedStartYear);
    setIsRefreshing(false);
  };

  // ═══════════════════════════════════════════════════════════════════════════
  //  Filters and Computed Properties
  // ═══════════════════════════════════════════════════════════════════════════

  const liveSessionNow = useMemo(() => {
    return todaySessions.find((s) => s.status === 'live');
  }, [todaySessions]);

  const nextUpcomingSession = useMemo(() => {
    return todaySessions.find((s) => s.status === 'upcoming');
  }, [todaySessions]);

  const filteredTodaySessions = useMemo(() => {
    return todaySessions.filter((s) => {
      if (activeFilter === 'all') return true;
      return s.sessionType === activeFilter;
    });
  }, [todaySessions, activeFilter]);

  const weekSessionsByDate = useMemo(() => {
    const map: Record<string, TimetableSessionItem[]> = {};
    for (const s of weekSessions) {
      if (!map[s.date]) map[s.date] = [];
      if (activeFilter === 'all' || s.sessionType === activeFilter) {
        map[s.date].push(s);
      }
    }
    return map;
  }, [weekSessions, activeFilter]);

  const selectedWeekSessions = useMemo(() => {
    return weekSessionsByDate[selectedWeekDateStr] || [];
  }, [weekSessionsByDate, selectedWeekDateStr]);

  const monthSessionsByDate = useMemo(() => {
    const map: Record<string, TimetableSessionItem[]> = {};
    for (const s of monthSessions) {
      if (!map[s.date]) map[s.date] = [];
      if (activeFilter === 'all' || s.sessionType === activeFilter) {
        map[s.date].push(s);
      }
    }
    return map;
  }, [monthSessions, activeFilter]);

  const selectedMonthSessions = useMemo(() => {
    return monthSessionsByDate[selectedMonthDateStr] || [];
  }, [monthSessionsByDate, selectedMonthDateStr]);

  const annualSessionsByMonth = useMemo(() => {
    const map: Record<string, TimetableSessionItem[]> = {};
    for (const s of annualSessions) {
      if (activeFilter !== 'all' && s.sessionType !== activeFilter) continue;
      const [y, m] = s.date.split('-');
      const key = `${parseInt(y, 10)}-${parseInt(m, 10)}`;
      if (!map[key]) map[key] = [];
      map[key].push(s);
    }
    return map;
  }, [annualSessions, activeFilter]);

  // ═══════════════════════════════════════════════════════════════════════════
  //  Week Navigation
  // ═══════════════════════════════════════════════════════════════════════════

  const handlePrevWeek = () => {
    const prev = new Date(weekReferenceDate);
    prev.setDate(prev.getDate() - 7);
    setWeekReferenceDate(prev);
    loadWeekData(prev);
  };

  const handleNextWeek = () => {
    const next = new Date(weekReferenceDate);
    next.setDate(next.getDate() + 7);
    setWeekReferenceDate(next);
    loadWeekData(next);
  };

  const handleCurrentWeek = () => {
    const now = new Date();
    setWeekReferenceDate(now);
    loadWeekData(now);
  };

  // ═══════════════════════════════════════════════════════════════════════════
  //  Month Navigation
  // ═══════════════════════════════════════════════════════════════════════════

  const handlePrevMonth = () => {
    let newMo = monthNumber - 1;
    let newYr = monthYear;
    if (newMo < 1) {
      newMo = 12;
      newYr -= 1;
    }
    setMonthYear(newYr);
    setMonthNumber(newMo);
    loadMonthData(newYr, newMo);
  };

  const handleNextMonth = () => {
    let newMo = monthNumber + 1;
    let newYr = monthYear;
    if (newMo > 12) {
      newMo = 1;
      newYr += 1;
    }
    setMonthYear(newYr);
    setMonthNumber(newMo);
    loadMonthData(newYr, newMo);
  };

  const handleCurrentMonth = () => {
    const now = new Date();
    setMonthYear(now.getFullYear());
    setMonthNumber(now.getMonth() + 1);
    loadMonthData(now.getFullYear(), now.getMonth() + 1);
  };

  // ═══════════════════════════════════════════════════════════════════════════
  //  Year Navigation
  // ═══════════════════════════════════════════════════════════════════════════

  const handleYearChange = (year: number) => {
    setSelectedStartYear(year);
    loadAnnualData(year);
  };

  // ═══════════════════════════════════════════════════════════════════════════
  //  Month Grid Calculator
  // ═══════════════════════════════════════════════════════════════════════════

  const calendarMonthDays = useMemo(() => {
    const firstDay = new Date(monthYear, monthNumber - 1, 1);
    const lastDay = new Date(monthYear, monthNumber, 0);
    const daysInMonth = lastDay.getDate();

    // Monday = 1 ... Sunday = 7
    let startDayOfWeek = firstDay.getDay();
    startDayOfWeek = startDayOfWeek === 0 ? 7 : startDayOfWeek;

    const days: Array<{ dayNum: number; dateStr: string; isCurrentMonth: boolean }> = [];

    // Padded blanks before month starts
    for (let i = 1; i < startDayOfWeek; i++) {
      days.push({ dayNum: 0, dateStr: '', isCurrentMonth: false });
    }

    // Days in current month
    const mStr = String(monthNumber).padStart(2, '0');
    for (let d = 1; d <= daysInMonth; d++) {
      const dStr = String(d).padStart(2, '0');
      days.push({
        dayNum: d,
        dateStr: `${monthYear}-${mStr}-${dStr}`,
        isCurrentMonth: true,
      });
    }

    return days;
  }, [monthYear, monthNumber]);

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">Class & Study Timetable</h1>
            {liveSessionNow && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-red-100 text-red-700 text-xs font-black animate-pulse">
                <span className="w-2 h-2 rounded-full bg-red-600"></span>
                LIVE NOW
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-1 max-w-2xl leading-relaxed">
            Live lecture timings, classroom join links, assignment deadlines, and the complete authoritative annual academic schedule.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleRefresh}
            disabled={isRefreshing || isLoading}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-bold text-xs shadow-xs transition-colors disabled:opacity-50"
            title="Refresh Schedule"
          >
            <ArrowsClockwise size={14} weight="bold" className={isRefreshing ? 'animate-spin' : ''} />
            <span>{isRefreshing ? 'Refreshing...' : 'Refresh'}</span>
          </button>
        </div>
      </div>

      {/* Main Navigation Tabs & Filter Strip */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-2 rounded-2xl bg-slate-100 border border-slate-200/80">
        {/* View Tabs */}
        <div className="flex items-center gap-1 p-1 bg-white/70 backdrop-blur-xs rounded-xl border border-slate-200/60 shadow-xs">
          <button
            onClick={() => setActiveTab('today')}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-extrabold transition-all ${
              activeTab === 'today'
                ? 'bg-sky-600 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/60'
            }`}
          >
            <Clock size={14} weight="bold" />
            <span>TODAY</span>
            {todaySessions.length > 0 && (
              <span
                className={`px-1.5 py-0.2 rounded-full text-[10px] font-black ${
                  activeTab === 'today' ? 'bg-sky-700 text-white' : 'bg-slate-200 text-slate-700'
                }`}
              >
                {todaySessions.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('week')}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-extrabold transition-all ${
              activeTab === 'week'
                ? 'bg-sky-600 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/60'
            }`}
          >
            <Calendar size={14} weight="bold" />
            <span>WEEK</span>
          </button>

          <button
            onClick={() => setActiveTab('month')}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-extrabold transition-all ${
              activeTab === 'month'
                ? 'bg-sky-600 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/60'
            }`}
          >
            <CalendarCheck size={14} weight="bold" />
            <span>MONTH</span>
          </button>

          <button
            onClick={() => setActiveTab('year')}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-extrabold transition-all ${
              activeTab === 'year'
                ? 'bg-sky-600 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/60'
            }`}
          >
            <Sparkle size={14} weight="bold" />
            <span>ANNUAL YEAR</span>
          </button>
        </div>

        {/* Category Filters */}
        <div className="flex items-center gap-1.5 self-start md:self-auto">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mr-1 hidden sm:inline">Filter:</span>
          {(['all', 'live', 'test'] as FilterType[]).map((ft) => (
            <button
              key={ft}
              onClick={() => setActiveFilter(ft)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                activeFilter === ft
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'bg-white text-slate-600 hover:bg-slate-50 border border-slate-200'
              }`}
            >
              {ft === 'all' ? 'All Sessions' : ft === 'live' ? 'Live Classes' : 'Mock Tests'}
            </button>
          ))}
        </div>
      </div>

      {/* Loading Skeleton */}
      {isLoading ? (
        <div className="p-12 text-center rounded-3xl bg-white border border-slate-100 shadow-xs space-y-4 animate-pulse">
          <div className="w-12 h-12 mx-auto rounded-2xl bg-sky-100 flex items-center justify-center text-sky-600">
            <Clock size={24} weight="bold" className="animate-spin" />
          </div>
          <p className="text-sm font-bold text-slate-700">Loading your active timetable schedule...</p>
          <p className="text-xs text-slate-400">Syncing recurring rules, lesson plans, and live classroom instances.</p>
        </div>
      ) : (
        <>
          {/* ═════════════════════════════════════════════════════════════════ */}
          {/* TAB 1: TODAY VIEW                                                */}
          {/* ═════════════════════════════════════════════════════════════════ */}
          {activeTab === 'today' && (
            <div className="space-y-6">
              {/* Hero Banner for Active / Next Live Class */}
              {liveSessionNow ? (
                <div className="p-6 sm:p-8 rounded-3xl bg-gradient-to-r from-red-600 via-rose-600 to-amber-600 text-white shadow-md relative overflow-hidden">
                  <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
                    <div className="space-y-2">
                      <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/20 backdrop-blur-xs text-xs font-black tracking-wider uppercase">
                        <Broadcast size={14} weight="fill" className="animate-pulse text-yellow-300" />
                        <span>Class Is Live Right Now</span>
                      </div>
                      <h2 className="text-2xl sm:text-3xl font-black tracking-tight">{liveSessionNow.title || liveSessionNow.subject}</h2>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs font-medium text-rose-100">
                        <span>Time: <strong>{liveSessionNow.timeSlot}</strong></span>
                        <span>Duration: <strong>{liveSessionNow.duration}</strong></span>
                        {liveSessionNow.teacher && <span>Instructor: <strong>{liveSessionNow.teacher}</strong></span>}
                      </div>
                      {liveSessionNow.chapter && (
                        <p className="text-xs font-bold text-yellow-200 mt-1">
                          Unit: {liveSessionNow.chapter} {liveSessionNow.topic ? `• ${liveSessionNow.topic}` : ''}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-3">
                      <Link
                        href={liveSessionNow.classId ? `/student/classes/${liveSessionNow.classId}/room` : '/student/classes'}
                        className="px-6 py-3.5 rounded-2xl bg-white hover:bg-yellow-50 text-red-700 font-black text-sm transition-transform active:scale-95 shadow-lg inline-flex items-center gap-2"
                      >
                        <VideoCamera size={18} weight="fill" />
                        <span>Join Live Classroom</span>
                        <ArrowRight size={14} weight="bold" />
                      </Link>
                    </div>
                  </div>
                </div>
              ) : nextUpcomingSession ? (
                <div className="p-6 rounded-3xl bg-gradient-to-r from-sky-600 to-indigo-600 text-white shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="space-y-1">
                    <div className="inline-flex items-center gap-1.5 text-xs font-bold text-sky-200">
                      <Clock size={14} weight="bold" />
                      <span>Next Scheduled Session Today</span>
                    </div>
                    <h3 className="text-lg font-black">{nextUpcomingSession.subject}: {nextUpcomingSession.chapter || nextUpcomingSession.title}</h3>
                    <p className="text-xs text-sky-100">{nextUpcomingSession.timeSlot} ({nextUpcomingSession.duration})</p>
                  </div>
                  <Link
                    href="/student/classes"
                    className="px-5 py-2.5 rounded-xl bg-white/20 hover:bg-white/30 text-white font-bold text-xs transition-colors self-start sm:self-auto"
                  >
                    View Classroom Queue
                  </Link>
                </div>
              ) : (
                <div className="p-6 rounded-3xl bg-slate-50 border border-slate-200 text-slate-700 flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-slate-800">No more classes scheduled for today</h3>
                    <p className="text-xs text-slate-500 mt-0.5">You are all caught up on lectures. Check the Week or Month tab to plan ahead.</p>
                  </div>
                  <button
                    onClick={() => setActiveTab('week')}
                    className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold transition-colors"
                  >
                    Browse Week
                  </button>
                </div>
              )}

              {/* Today's Full Session List */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-extrabold text-slate-900 tracking-tight uppercase">
                    Today's Schedule ({filteredTodaySessions.length} {filteredTodaySessions.length === 1 ? 'Session' : 'Sessions'})
                  </h3>
                  <span className="text-xs font-bold text-slate-500">{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</span>
                </div>

                {filteredTodaySessions.length === 0 ? (
                  <EmptyTimetableCard message="No classes or tests scheduled for today matching your filter." />
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {filteredTodaySessions.map((session) => (
                      <SessionCard key={session.id} session={session} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ═════════════════════════════════════════════════════════════════ */}
          {/* TAB 2: WEEK VIEW                                                 */}
          {/* ═════════════════════════════════════════════════════════════════ */}
          {activeTab === 'week' && (
            <div className="space-y-6">
              {/* Week Navigation Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <button
                    onClick={handlePrevWeek}
                    className="p-2 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold transition-colors"
                    title="Previous Week"
                  >
                    <CaretLeft size={16} weight="bold" />
                  </button>
                  <span className="text-sm font-black text-slate-800 px-2">
                    {weekDays[0]?.fullDate} — {weekDays[6]?.fullDate}
                  </span>
                  <button
                    onClick={handleNextWeek}
                    className="p-2 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold transition-colors"
                    title="Next Week"
                  >
                    <CaretRight size={16} weight="bold" />
                  </button>
                </div>

                <button
                  onClick={handleCurrentWeek}
                  className="px-3.5 py-1.5 rounded-xl border border-sky-200 bg-sky-50 text-sky-700 font-bold text-xs hover:bg-sky-100 transition-colors"
                >
                  Jump to Current Week
                </button>
              </div>

              {/* 7-Day Interactive Strip */}
              <div className="grid grid-cols-7 gap-2">
                {weekDays.map((day) => {
                  const daySessions = weekSessionsByDate[day.dateString] || [];
                  const isSelected = selectedWeekDateStr === day.dateString;

                  return (
                    <button
                      key={day.dateString}
                      onClick={() => setSelectedWeekDateStr(day.dateString)}
                      className={`p-3 rounded-2xl border text-center transition-all flex flex-col items-center justify-center gap-1 relative ${
                        isSelected
                          ? 'bg-sky-600 border-sky-600 text-white shadow-md scale-[1.02]'
                          : day.isToday
                          ? 'bg-sky-50/80 border-sky-300 text-sky-900'
                          : 'bg-white border-slate-200/80 text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <span className={`text-[11px] font-bold uppercase ${isSelected ? 'text-sky-100' : 'text-slate-400'}`}>
                        {day.dayName}
                      </span>
                      <span className="text-lg font-black">{day.date}</span>

                      {/* Session count indicator */}
                      {daySessions.length > 0 ? (
                        <span
                          className={`px-1.5 py-0.5 rounded-full text-[10px] font-black ${
                            isSelected
                              ? 'bg-white text-sky-700'
                              : 'bg-sky-100 text-sky-800'
                          }`}
                        >
                          {daySessions.length} {daySessions.length === 1 ? 'class' : 'classes'}
                        </span>
                      ) : (
                        <span className="text-[10px] font-medium text-slate-400">—</span>
                      )}

                      {day.isToday && (
                        <span
                          className={`absolute -top-1.5 px-1.5 py-0.2 rounded-full text-[8px] font-black uppercase tracking-wider ${
                            isSelected ? 'bg-yellow-400 text-slate-950' : 'bg-sky-600 text-white'
                          }`}
                        >
                          Today
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Sessions for Selected Day in Week */}
              <div className="space-y-4 pt-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-extrabold text-slate-900 uppercase">
                    Schedule for {weekDays.find((d) => d.dateString === selectedWeekDateStr)?.fullDate || selectedWeekDateStr}
                  </h3>
                  <span className="text-xs font-bold text-slate-500">
                    {selectedWeekSessions.length} {selectedWeekSessions.length === 1 ? 'Session' : 'Sessions'}
                  </span>
                </div>

                {selectedWeekSessions.length === 0 ? (
                  <EmptyTimetableCard message="No sessions scheduled for this day." />
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {selectedWeekSessions.map((session) => (
                      <SessionCard key={session.id} session={session} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ═════════════════════════════════════════════════════════════════ */}
          {/* TAB 3: MONTH VIEW                                                */}
          {/* ═════════════════════════════════════════════════════════════════ */}
          {activeTab === 'month' && (
            <div className="space-y-6">
              {/* Month Navigation Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <button
                    onClick={handlePrevMonth}
                    className="p-2 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold transition-colors"
                    title="Previous Month"
                  >
                    <CaretLeft size={16} weight="bold" />
                  </button>
                  <h2 className="text-lg font-black text-slate-900 px-2">
                    {new Date(monthYear, monthNumber - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' })}
                  </h2>
                  <button
                    onClick={handleNextMonth}
                    className="p-2 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold transition-colors"
                    title="Next Month"
                  >
                    <CaretRight size={16} weight="bold" />
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCurrentMonth}
                    className="px-3.5 py-1.5 rounded-xl border border-sky-200 bg-sky-50 text-sky-700 font-bold text-xs hover:bg-sky-100 transition-colors"
                  >
                    Current Month
                  </button>
                </div>
              </div>

              {/* Monthly Calendar Grid */}
              <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs overflow-hidden p-4 sm:p-6">
                {/* Weekday Names Header */}
                <div className="grid grid-cols-7 gap-2 pb-3 mb-2 border-b border-slate-100 text-center">
                  {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((dayName) => (
                    <div key={dayName} className="text-xs font-black text-slate-400 uppercase tracking-wider">
                      {dayName}
                    </div>
                  ))}
                </div>

                {/* Calendar Cells */}
                <div className="grid grid-cols-7 gap-2">
                  {calendarMonthDays.map((cell, idx) => {
                    if (!cell.isCurrentMonth) {
                      return <div key={`blank_${idx}`} className="h-20 sm:h-24 rounded-2xl bg-slate-50/50" />;
                    }

                    const isToday = cell.dateStr === formatDateToIsoDate(new Date());
                    const isSelected = selectedMonthDateStr === cell.dateStr;
                    const cellSessions = monthSessionsByDate[cell.dateStr] || [];

                    return (
                      <button
                        key={cell.dateStr}
                        onClick={() => setSelectedMonthDateStr(cell.dateStr)}
                        className={`h-20 sm:h-24 p-2 rounded-2xl border text-left transition-all flex flex-col justify-between relative group ${
                          isSelected
                            ? 'bg-sky-50 border-sky-500 ring-2 ring-sky-500/20 shadow-xs'
                            : isToday
                            ? 'bg-amber-50/60 border-amber-300'
                            : 'bg-white border-slate-100 hover:border-slate-300 hover:bg-slate-50/60'
                        }`}
                      >
                        <div className="flex items-center justify-between w-full">
                          <span
                            className={`text-xs font-extrabold ${
                              isToday
                                ? 'w-5 h-5 rounded-full bg-amber-500 text-white flex items-center justify-center text-[10px]'
                                : isSelected
                                ? 'text-sky-700 font-black'
                                : 'text-slate-800'
                            }`}
                          >
                            {cell.dayNum}
                          </span>

                          {cellSessions.length > 0 && (
                            <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-1.5 py-0.2 rounded-md">
                              {cellSessions.length}
                            </span>
                          )}
                        </div>

                        {/* Subject dot indicators */}
                        {cellSessions.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1 mt-auto">
                            {cellSessions.slice(0, 4).map((s, sIdx) => (
                              <span
                                key={sIdx}
                                className="w-2 h-2 rounded-full"
                                style={{ backgroundColor: s.accentColor }}
                                title={`${s.subject}: ${s.timeSlot}`}
                              />
                            ))}
                            {cellSessions.length > 4 && (
                              <span className="text-[9px] font-black text-slate-400">+{cellSessions.length - 4}</span>
                            )}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Selected Day Schedule in Month View */}
              <div className="space-y-4 pt-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-extrabold text-slate-900 uppercase">
                    Sessions on {selectedMonthDateStr}
                  </h3>
                  <span className="text-xs font-bold text-slate-500">
                    {selectedMonthSessions.length} {selectedMonthSessions.length === 1 ? 'Session' : 'Sessions'}
                  </span>
                </div>

                {selectedMonthSessions.length === 0 ? (
                  <EmptyTimetableCard message="No classes or tests scheduled on this date." />
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {selectedMonthSessions.map((session) => (
                      <SessionCard key={session.id} session={session} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ═════════════════════════════════════════════════════════════════ */}
          {/* TAB 4: ANNUAL YEAR VIEW (Academic Year Apr -> Mar)              */}
          {/* ═════════════════════════════════════════════════════════════════ */}
          {activeTab === 'year' && (
            <div className="space-y-6">
              {/* Year Selector & Summary Banner */}
              <div className="p-6 sm:p-8 rounded-3xl bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-950 text-white shadow-md flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div className="space-y-2">
                  <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 text-xs font-bold text-indigo-300">
                    <Sparkle size={14} weight="fill" />
                    <span>Complete Academic Year Timetable</span>
                  </div>
                  <h2 className="text-2xl sm:text-3xl font-black tracking-tight">Academic Year {annualInfo.label}</h2>
                  <p className="text-xs text-slate-300 max-w-xl leading-relaxed">
                    Full 12-month curriculum projection from <strong>{annualInfo.startDate}</strong> to <strong>{annualInfo.endDate}</strong>.
                    Every published recurring lecture rule and lesson plan is available here.
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <label htmlFor="academic-year-select" className="text-xs font-bold text-slate-300">Select Year:</label>
                  <select
                    id="academic-year-select"
                    value={selectedStartYear}
                    onChange={(e) => handleYearChange(parseInt(e.target.value, 10))}
                    className="px-4 py-2.5 rounded-xl bg-white/10 border border-white/20 text-white font-black text-xs backdrop-blur-xs focus:outline-hidden focus:ring-2 focus:ring-indigo-400 cursor-pointer"
                  >
                    <option value={currentAcademicYear.startYear} className="text-slate-900">{currentAcademicYear.startYear}–{currentAcademicYear.startYear + 1} (Current)</option>
                    <option value={currentAcademicYear.startYear - 1} className="text-slate-900">{currentAcademicYear.startYear - 1}–{currentAcademicYear.startYear}</option>
                    <option value={currentAcademicYear.startYear + 1} className="text-slate-900">{currentAcademicYear.startYear + 1}–{currentAcademicYear.startYear + 2}</option>
                  </select>
                </div>
              </div>

              {/* 12-Month Quick Jump Grid */}
              <div className="space-y-3">
                <h3 className="text-xs font-extrabold text-slate-400 uppercase tracking-wider">Academic Months (April → March)</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                  {annualMonths.map((m) => {
                    const monthKey = `${m.year}-${m.month}`;
                    const count = (annualSessionsByMonth[monthKey] || []).length;
                    const isExpanded = expandedAnnualMonth === monthKey;

                    return (
                      <button
                        key={monthKey}
                        onClick={() => setExpandedAnnualMonth(isExpanded ? null : monthKey)}
                        className={`p-4 rounded-2xl border text-left transition-all flex flex-col justify-between gap-2 ${
                          isExpanded
                            ? 'bg-indigo-600 border-indigo-600 text-white shadow-md'
                            : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        <span className="text-xs font-black">{m.label}</span>
                        <div className="flex items-center justify-between w-full">
                          <span className={`text-[11px] font-bold ${isExpanded ? 'text-indigo-100' : 'text-slate-500'}`}>
                            {count} {count === 1 ? 'session' : 'sessions'}
                          </span>
                          <span className={`text-xs font-bold ${isExpanded ? 'text-white' : 'text-indigo-600'}`}>
                            {isExpanded ? 'Collapse' : 'View'}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Month-by-Month Timetable Accordions */}
              <div className="space-y-4 pt-2">
                {annualMonths.map((m) => {
                  const monthKey = `${m.year}-${m.month}`;
                  const mSessions = annualSessionsByMonth[monthKey] || [];
                  const isExpanded = expandedAnnualMonth === monthKey;

                  if (!isExpanded && expandedAnnualMonth !== null) return null;

                  return (
                    <div key={monthKey} className="rounded-3xl bg-white border border-slate-200/80 shadow-xs overflow-hidden">
                      <div
                        onClick={() => setExpandedAnnualMonth(isExpanded ? null : monthKey)}
                        className="p-5 flex items-center justify-between cursor-pointer bg-slate-50/60 hover:bg-slate-50 border-b border-slate-100 transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-xl bg-sky-100 text-sky-700 flex items-center justify-center font-black text-xs">
                            {m.shortName}
                          </div>
                          <div>
                            <h4 className="text-base font-extrabold text-slate-900">{m.label}</h4>
                            <p className="text-xs text-slate-500">{mSessions.length} total scheduled occurrences</p>
                          </div>
                        </div>

                        <span className="text-xs font-bold text-sky-600 hover:text-sky-700">
                          {isExpanded ? 'Hide Month Details' : 'Expand Month Details'}
                        </span>
                      </div>

                      {isExpanded && (
                        <div className="p-5 space-y-4">
                          {mSessions.length === 0 ? (
                            <p className="text-xs text-slate-400 text-center py-6">No recurring timetable sessions scheduled for {m.label}.</p>
                          ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              {mSessions.map((session) => (
                                <SessionCard key={session.id} session={session} />
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Helper Subcomponents
// ═══════════════════════════════════════════════════════════════════════════

function SessionCard({ session }: { session: TimetableSessionItem }) {
  const isLive = session.status === 'live';
  const isCompleted = session.status === 'completed';
  const isUpcoming = session.status === 'upcoming';
  const isTest = session.sessionType === 'test';

  return (
    <div
      className={`p-5 rounded-2xl border transition-all flex flex-col justify-between gap-4 ${
        isLive
          ? 'bg-red-50/50 border-red-200 shadow-sm'
          : 'bg-white border-slate-200/80 hover:border-slate-300 shadow-xs'
      }`}
      style={{ borderLeftWidth: '5px', borderLeftColor: session.accentColor }}
    >
      {/* Card Header: Subject Pill & Status */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className="px-2.5 py-1 rounded-lg text-xs font-extrabold"
            style={{ backgroundColor: session.badgeBg, color: session.badgeText }}
          >
            {session.subject}
          </span>
          <span className="text-xs font-bold text-slate-500">{session.date}</span>
        </div>

        <div>
          {isLive ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-100 text-red-700 text-xs font-black animate-pulse">
              <span className="w-2 h-2 rounded-full bg-red-600"></span>
              LIVE
            </span>
          ) : isCompleted ? (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 text-xs font-bold">
              <CheckCircle size={12} weight="fill" />
              Completed
            </span>
          ) : isUpcoming ? (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-sky-100 text-sky-800 text-xs font-bold">
              <Clock size={12} weight="bold" />
              Upcoming
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-xs font-bold">
              Scheduled
            </span>
          )}
        </div>
      </div>

      {/* Card Body: Title / Chapter / Topic */}
      <div className="space-y-1">
        <h4 className="text-base font-extrabold text-slate-900 tracking-tight leading-snug">
          {session.title || session.chapter || `${session.subject} Lecture`}
        </h4>
        {session.topic && (
          <p className="text-xs font-semibold text-slate-600">
            Topic: <span className="text-slate-800">{session.topic}</span>
          </p>
        )}
        {session.notes && (
          <p className="text-xs text-slate-500 italic mt-1 bg-slate-50 p-2 rounded-lg">
            Note: {session.notes}
          </p>
        )}
      </div>

      {/* Card Meta & Actions */}
      <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-3 text-xs">
        <div className="space-y-0.5">
          <div className="flex items-center gap-1.5 font-bold text-slate-800">
            <Clock size={14} weight="bold" className="text-slate-400" />
            <span>{session.timeSlot}</span>
            <span className="text-slate-400">({session.duration})</span>
          </div>
          {session.teacher && (
            <p className="text-slate-500 font-medium">Teacher: <strong>{session.teacher}</strong></p>
          )}
        </div>

        <div>
          {isLive ? (
            <Link
              href={session.classId ? `/student/classes/${session.classId}/room` : '/student/classes'}
              className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white font-black text-xs transition-transform active:scale-95 inline-flex items-center gap-1.5 shadow-sm"
            >
              <VideoCamera size={14} weight="fill" />
              <span>Join</span>
            </Link>
          ) : isCompleted ? (
            <Link
              href="/student/classes"
              className="px-3.5 py-1.5 rounded-xl border border-sky-200 bg-sky-50 hover:bg-sky-100 text-sky-700 font-bold text-xs transition-colors inline-flex items-center gap-1"
            >
              <Play size={12} weight="fill" />
              <span>Watch</span>
            </Link>
          ) : isTest ? (
            <Link
              href={session.testId ? `/student/tests/${session.testId}` : '/student/tests'}
              className="px-3.5 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs transition-colors inline-flex items-center gap-1"
            >
              <FileText size={12} weight="bold" />
              <span>Test Details</span>
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function EmptyTimetableCard({ message }: { message: string }) {
  return (
    <div className="p-8 text-center rounded-2xl bg-white border border-slate-100 text-slate-500 space-y-2">
      <p className="text-xs font-bold text-slate-600">{message}</p>
      <p className="text-[11px] text-slate-400">Classes will automatically appear here once scheduled by your teachers or institute admin.</p>
    </div>
  );
}
