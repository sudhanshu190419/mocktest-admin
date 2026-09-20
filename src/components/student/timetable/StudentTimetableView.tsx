'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import {
  Calendar,
  Clock,
  VideoCamera,
  CaretLeft,
  CaretRight,
  ArrowsClockwise,
  Broadcast,
  CheckCircle,
  FileText,
  Play,
  ArrowRight,
  CalendarCheck,
  Sparkle,
} from '@phosphor-icons/react';
import {
  fetchTodayTimetable,
  fetchWeekTimetable,
  fetchMonthTimetable,
  fetchAnnualTimetable,
} from '@/services/student/studentTimetableWebService';
import {
  formatDateToIsoDate,
  getAcademicYearInfo,
  type TimetableSessionItem,
  type DynamicDayItem,
  type AcademicYearInfo,
} from '@/utils/studentTimetableProjector';
import { Skeleton } from '@/components/ui/mmt';

type TabView = 'today' | 'week' | 'month' | 'year';
type FilterType = 'all' | 'live' | 'test';

export function StudentTimetableView() {
  const [activeTab, setActiveTab] = useState<TabView>('today');
  const [activeFilter, setActiveFilter] = useState<FilterType>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Today State
  const [todaySessions, setTodaySessions] = useState<TimetableSessionItem[]>([]);

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
      const { sessions } = await fetchTodayTimetable();
      setTodaySessions(sessions);
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
      setSelectedWeekDateStr(todayInWeek ? todayInWeek.dateString : days[0]?.dateString || '');
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

  // Week Navigation
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

  // Month Navigation
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

  // Year Navigation
  const handleYearChange = (year: number) => {
    setSelectedStartYear(year);
    loadAnnualData(year);
  };

  // Month Grid Days
  const calendarMonthDays = useMemo(() => {
    const firstDay = new Date(monthYear, monthNumber - 1, 1);
    const lastDay = new Date(monthYear, monthNumber, 0);
    const daysInMonth = lastDay.getDate();

    let startDayOfWeek = firstDay.getDay();
    startDayOfWeek = startDayOfWeek === 0 ? 7 : startDayOfWeek;

    const days: Array<{ dayNum: number; dateStr: string; isCurrentMonth: boolean }> = [];

    for (let i = 1; i < startDayOfWeek; i++) {
      days.push({ dayNum: 0, dateStr: '', isCurrentMonth: false });
    }

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
            <h1 className="text-2xl font-extrabold text-ink tracking-tight">Class & Study Timetable</h1>
            {liveSessionNow && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-rose-100 text-rose-700 text-xs font-bold">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-600" />
                </span>
                LIVE NOW
              </span>
            )}
          </div>
          <p className="text-xs text-ink-secondary mt-1 max-w-2xl leading-relaxed">
            Live lecture timings, classroom join links, assignment deadlines, and the complete authoritative annual academic schedule.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleRefresh}
            disabled={isRefreshing || isLoading}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-field border border-line bg-surface hover:bg-paper text-ink font-bold text-xs shadow-2xs transition-colors disabled:opacity-50 min-h-[44px]"
            title="Refresh Schedule"
          >
            <ArrowsClockwise size={14} weight="bold" className={isRefreshing ? 'animate-spin' : ''} />
            <span>{isRefreshing ? 'Refreshing...' : 'Refresh'}</span>
          </button>
        </div>
      </div>

      {/* Main Navigation Tabs & Filter Strip */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-2 rounded-card bg-paper border border-line">
        {/* View Tabs */}
        <div className="flex items-center gap-1 p-1 bg-surface rounded-field border border-line shadow-2xs">
          <button
            type="button"
            onClick={() => setActiveTab('today')}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-field text-xs font-bold transition-all min-h-[40px] ${
              activeTab === 'today'
                ? 'bg-brand text-white shadow-2xs'
                : 'text-ink-secondary hover:text-ink hover:bg-paper'
            }`}
          >
            <Clock size={14} weight="duotone" />
            <span>TODAY</span>
            {todaySessions.length > 0 && (
              <span
                className={`px-1.5 py-0.5 rounded-full text-caption font-bold ${
                  activeTab === 'today' ? 'bg-brand-hover text-white' : 'bg-sky-tint text-ink'
                }`}
              >
                {todaySessions.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('week')}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-field text-xs font-bold transition-all min-h-[40px] ${
              activeTab === 'week'
                ? 'bg-brand text-white shadow-2xs'
                : 'text-ink-secondary hover:text-ink hover:bg-paper'
            }`}
          >
            <Calendar size={14} weight="duotone" />
            <span>WEEK</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('month')}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-field text-xs font-bold transition-all min-h-[40px] ${
              activeTab === 'month'
                ? 'bg-brand text-white shadow-2xs'
                : 'text-ink-secondary hover:text-ink hover:bg-paper'
            }`}
          >
            <CalendarCheck size={14} weight="duotone" />
            <span>MONTH</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('year')}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-field text-xs font-bold transition-all min-h-[40px] ${
              activeTab === 'year'
                ? 'bg-brand text-white shadow-2xs'
                : 'text-ink-secondary hover:text-ink hover:bg-paper'
            }`}
          >
            <Sparkle size={14} weight="duotone" />
            <span>ANNUAL YEAR</span>
          </button>
        </div>

        {/* Category Filters */}
        <div className="flex items-center gap-1.5 self-start md:self-auto">
          <span className="text-caption font-bold text-ink-muted uppercase tracking-wider mr-1 hidden sm:inline">Filter:</span>
          {(['all', 'live', 'test'] as FilterType[]).map((ft) => (
            <button
              key={ft}
              type="button"
              onClick={() => setActiveFilter(ft)}
              className={`px-3 py-2 rounded-field text-xs font-bold transition-colors min-h-[40px] ${
                activeFilter === ft
                  ? 'bg-ink text-white shadow-2xs'
                  : 'bg-surface text-ink-secondary hover:bg-paper border border-line'
              }`}
            >
              {ft === 'all' ? 'All Sessions' : ft === 'live' ? 'Live Classes' : 'Mock Tests'}
            </button>
          ))}
        </div>
      </div>

      {/* Loading Skeleton */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-40 rounded-card" />
          ))}
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
                <div className="p-6 sm:p-7 rounded-card bg-rose-50 border border-rose-200 text-ink shadow-card relative overflow-hidden">
                  <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
                    <div className="space-y-2">
                      <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-rose-200/70 text-rose-800 text-xs font-bold tracking-wider uppercase">
                        <Broadcast size={14} weight="fill" className="text-rose-600" />
                        <span>Class Is Live Right Now</span>
                      </div>
                      <h2 className="text-2xl sm:text-3xl font-extrabold text-ink tracking-tight">
                        {liveSessionNow.title || liveSessionNow.subject}
                      </h2>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs font-medium text-ink-secondary">
                        <span>Time: <strong className="text-ink">{liveSessionNow.timeSlot}</strong></span>
                        <span>Duration: <strong className="text-ink">{liveSessionNow.duration}</strong></span>
                        {liveSessionNow.teacher && <span>Instructor: <strong className="text-ink">{liveSessionNow.teacher}</strong></span>}
                      </div>
                      {liveSessionNow.chapter && (
                        <p className="text-xs font-bold text-rose-800 mt-1">
                          Unit: {liveSessionNow.chapter} {liveSessionNow.topic ? `• ${liveSessionNow.topic}` : ''}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <Link
                        href={liveSessionNow.classId ? `/student/classes/${liveSessionNow.classId}/room` : '/student/classes'}
                        className="px-6 py-3 rounded-field bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs shadow-card inline-flex items-center gap-2 min-h-[44px]"
                      >
                        <VideoCamera size={18} weight="fill" />
                        <span>Join Live Classroom</span>
                        <ArrowRight size={14} weight="bold" />
                      </Link>
                    </div>
                  </div>
                </div>
              ) : nextUpcomingSession ? (
                <div className="p-5 sm:p-6 rounded-card bg-sky-tint border border-line text-ink shadow-card flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="space-y-1">
                    <div className="inline-flex items-center gap-1.5 text-xs font-bold text-brand">
                      <Clock size={14} weight="bold" />
                      <span>Next Scheduled Session Today</span>
                    </div>
                    <h3 className="text-lg font-bold text-ink">
                      {nextUpcomingSession.subject}: {nextUpcomingSession.chapter || nextUpcomingSession.title}
                    </h3>
                    <p className="text-xs text-ink-secondary">
                      {nextUpcomingSession.timeSlot} ({nextUpcomingSession.duration})
                    </p>
                  </div>
                  <Link
                    href="/student/classes"
                    className="px-4 py-2.5 rounded-field bg-surface hover:bg-paper border border-line text-ink font-bold text-xs transition-colors self-start sm:self-auto min-h-[44px] inline-flex items-center shadow-2xs"
                  >
                    View Classroom Queue
                  </Link>
                </div>
              ) : (
                <div className="p-5 rounded-card bg-paper border border-line text-ink flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-bold text-ink">No more classes scheduled for today</h3>
                    <p className="text-xs text-ink-secondary mt-0.5">You are all caught up on lectures. Check the Week or Month tab to plan ahead.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveTab('week')}
                    className="px-4 py-2.5 rounded-field bg-brand hover:bg-brand-hover text-white text-xs font-bold transition-colors min-h-[44px] inline-flex items-center justify-center shadow-2xs shrink-0"
                  >
                    Browse Week
                  </button>
                </div>
              )}

              {/* Today's Session List */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-extrabold text-ink-muted tracking-wider uppercase">
                    Today's Schedule ({filteredTodaySessions.length} {filteredTodaySessions.length === 1 ? 'Session' : 'Sessions'})
                  </h3>
                  <span className="text-xs font-bold text-ink-secondary">
                    {new Date().toLocaleDateString('en-IN', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                  </span>
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
                    type="button"
                    onClick={handlePrevWeek}
                    className="p-2.5 rounded-field bg-surface border border-line hover:bg-paper text-ink font-bold transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center shadow-2xs"
                    title="Previous Week"
                  >
                    <CaretLeft size={16} weight="bold" />
                  </button>
                  <span className="text-sm font-bold text-ink px-2">
                    {weekDays[0]?.fullDate} — {weekDays[6]?.fullDate}
                  </span>
                  <button
                    type="button"
                    onClick={handleNextWeek}
                    className="p-2.5 rounded-field bg-surface border border-line hover:bg-paper text-ink font-bold transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center shadow-2xs"
                    title="Next Week"
                  >
                    <CaretRight size={16} weight="bold" />
                  </button>
                </div>

                <button
                  type="button"
                  onClick={handleCurrentWeek}
                  className="px-4 py-2 rounded-field border border-line bg-sky-tint text-brand-hover font-bold text-xs hover:bg-sky-tint/80 transition-colors min-h-[44px] shadow-2xs"
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
                      type="button"
                      onClick={() => setSelectedWeekDateStr(day.dateString)}
                      className={`p-2 sm:p-3 rounded-field border text-center transition-all flex flex-col items-center justify-center gap-1 relative min-h-[64px] ${
                        isSelected
                          ? 'bg-brand border-brand text-white shadow-card'
                          : day.isToday
                          ? 'bg-sky-tint border-brand/40 text-brand-hover'
                          : 'bg-surface border-line text-ink hover:bg-paper'
                      }`}
                    >
                      <span className={`text-caption font-bold uppercase ${isSelected ? 'text-white/80' : 'text-ink-muted'}`}>
                        {day.dayName}
                      </span>
                      <span className="text-base sm:text-lg font-extrabold">{day.date}</span>

                      {/* Session count */}
                      {daySessions.length > 0 ? (
                        <span
                          className={`px-1.5 py-0.5 rounded-full text-caption font-bold ${
                            isSelected
                              ? 'bg-white text-brand'
                              : 'bg-sky-tint text-brand-hover border border-line/60'
                          }`}
                        >
                          {daySessions.length} {daySessions.length === 1 ? 'class' : 'classes'}
                        </span>
                      ) : (
                        <span className="text-caption text-ink-muted">—</span>
                      )}

                      {day.isToday && (
                        <span
                          className={`absolute -top-2 px-1.5 py-0.5 rounded-full text-caption font-bold uppercase tracking-wider ${
                            isSelected ? 'bg-amber-300 text-ink' : 'bg-brand text-white'
                          }`}
                        >
                          Today
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Sessions for Selected Day */}
              <div className="space-y-4 pt-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-extrabold text-ink-muted tracking-wider uppercase">
                    Schedule for {weekDays.find((d) => d.dateString === selectedWeekDateStr)?.fullDate || selectedWeekDateStr}
                  </h3>
                  <span className="text-xs font-bold text-ink-secondary">
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
                    type="button"
                    onClick={handlePrevMonth}
                    className="p-2.5 rounded-field bg-surface border border-line hover:bg-paper text-ink font-bold transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center shadow-2xs"
                    title="Previous Month"
                  >
                    <CaretLeft size={16} weight="bold" />
                  </button>
                  <h2 className="text-lg font-extrabold text-ink px-2">
                    {new Date(monthYear, monthNumber - 1, 1).toLocaleString('en-IN', { month: 'long', year: 'numeric' })}
                  </h2>
                  <button
                    type="button"
                    onClick={handleNextMonth}
                    className="p-2.5 rounded-field bg-surface border border-line hover:bg-paper text-ink font-bold transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center shadow-2xs"
                    title="Next Month"
                  >
                    <CaretRight size={16} weight="bold" />
                  </button>
                </div>

                <button
                  type="button"
                  onClick={handleCurrentMonth}
                  className="px-4 py-2 rounded-field border border-line bg-sky-tint text-brand-hover font-bold text-xs hover:bg-sky-tint/80 transition-colors min-h-[44px] shadow-2xs"
                >
                  Current Month
                </button>
              </div>

              {/* Monthly Calendar Grid */}
              <div className="bg-surface rounded-card border border-line shadow-card overflow-hidden p-4 sm:p-6">
                <div className="grid grid-cols-7 gap-2 pb-3 mb-2 border-b border-line text-center">
                  {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((dayName) => (
                    <div key={dayName} className="text-caption font-bold text-ink-muted uppercase tracking-wider">
                      {dayName}
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-7 gap-2">
                  {calendarMonthDays.map((cell, idx) => {
                    if (!cell.isCurrentMonth) {
                      return <div key={`blank_${idx}`} className="h-16 sm:h-20 rounded-field bg-paper/40" />;
                    }

                    const isToday = cell.dateStr === formatDateToIsoDate(new Date());
                    const isSelected = selectedMonthDateStr === cell.dateStr;
                    const cellSessions = monthSessionsByDate[cell.dateStr] || [];

                    return (
                      <button
                        key={cell.dateStr}
                        type="button"
                        onClick={() => setSelectedMonthDateStr(cell.dateStr)}
                        className={`h-16 sm:h-20 p-2 rounded-field border text-left transition-all flex flex-col justify-between relative group ${
                          isSelected
                            ? 'bg-sky-tint border-brand ring-2 ring-brand/20 shadow-2xs'
                            : isToday
                            ? 'bg-amber-50/70 border-amber-300'
                            : 'bg-surface border-line hover:border-brand/40 hover:bg-paper'
                        }`}
                      >
                        <div className="flex items-center justify-between w-full">
                          <span
                            className={`text-xs font-bold ${
                              isToday
                                ? 'w-5 h-5 rounded-full bg-amber-500 text-white flex items-center justify-center text-caption font-extrabold'
                                : isSelected
                                ? 'text-brand-hover font-extrabold'
                                : 'text-ink'
                            }`}
                          >
                            {cell.dayNum}
                          </span>

                          {cellSessions.length > 0 && (
                            <span className="text-caption font-bold text-ink-secondary bg-paper px-1.5 py-0.5 rounded-md border border-line/60">
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
                              <span className="text-caption font-bold text-ink-muted">+{cellSessions.length - 4}</span>
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
                  <h3 className="text-xs font-extrabold text-ink-muted tracking-wider uppercase">
                    Sessions on {selectedMonthDateStr}
                  </h3>
                  <span className="text-xs font-bold text-ink-secondary">
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
              {/* Year Selector & Summary Banner on Design A Light Surface */}
              <div className="p-6 sm:p-7 rounded-card bg-surface border border-line shadow-card flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div className="space-y-2">
                  <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-sky-tint border border-line text-xs font-bold text-brand">
                    <Sparkle size={14} weight="duotone" />
                    <span>Complete Academic Year Timetable</span>
                  </div>
                  <h2 className="text-2xl sm:text-3xl font-extrabold text-ink tracking-tight">
                    Academic Year {annualInfo.label}
                  </h2>
                  <p className="text-xs text-ink-secondary max-w-xl leading-relaxed">
                    Full 12-month curriculum projection from <strong>{annualInfo.startDate}</strong> to <strong>{annualInfo.endDate}</strong>.
                    Every published recurring lecture rule and lesson plan is available here.
                  </p>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <label htmlFor="academic-year-select" className="text-xs font-bold text-ink-muted">Select Year:</label>
                  <select
                    id="academic-year-select"
                    value={selectedStartYear}
                    onChange={(e) => handleYearChange(parseInt(e.target.value, 10))}
                    className="px-3.5 py-2.5 rounded-field bg-paper border border-line text-ink font-bold text-xs focus:outline-none focus:border-brand cursor-pointer min-h-[44px]"
                  >
                    <option value={currentAcademicYear.startYear} className="text-ink">
                      {currentAcademicYear.startYear}–{currentAcademicYear.startYear + 1} (Current)
                    </option>
                    <option value={currentAcademicYear.startYear - 1} className="text-ink">
                      {currentAcademicYear.startYear - 1}–{currentAcademicYear.startYear}
                    </option>
                    <option value={currentAcademicYear.startYear + 1} className="text-ink">
                      {currentAcademicYear.startYear + 1}–{currentAcademicYear.startYear + 2}
                    </option>
                  </select>
                </div>
              </div>

              {/* 12-Month Quick Jump Grid */}
              <div className="space-y-3">
                <h3 className="text-xs font-extrabold text-ink-muted uppercase tracking-wider">
                  Academic Months (April → March)
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                  {annualMonths.map((m) => {
                    const monthKey = `${m.year}-${m.month}`;
                    const count = (annualSessionsByMonth[monthKey] || []).length;
                    const isExpanded = expandedAnnualMonth === monthKey;

                    return (
                      <button
                        key={monthKey}
                        type="button"
                        onClick={() => setExpandedAnnualMonth(isExpanded ? null : monthKey)}
                        className={`p-3.5 rounded-field border text-left transition-all flex flex-col justify-between gap-2 min-h-[72px] ${
                          isExpanded
                            ? 'bg-brand border-brand text-white shadow-card'
                            : 'bg-surface border-line text-ink hover:bg-paper'
                        }`}
                      >
                        <span className="text-xs font-extrabold">{m.label}</span>
                        <div className="flex items-center justify-between w-full">
                          <span className={`text-caption font-medium ${isExpanded ? 'text-white/80' : 'text-ink-secondary'}`}>
                            {count} {count === 1 ? 'session' : 'sessions'}
                          </span>
                          <span className={`text-caption font-bold ${isExpanded ? 'text-white' : 'text-brand'}`}>
                            {isExpanded ? 'Hide' : 'View'}
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
                    <div key={monthKey} className="rounded-card bg-surface border border-line shadow-card overflow-hidden">
                      <button
                        type="button"
                        onClick={() => setExpandedAnnualMonth(isExpanded ? null : monthKey)}
                        className="w-full p-5 flex items-center justify-between cursor-pointer bg-paper hover:bg-paper/80 border-b border-line transition-colors text-left min-h-[44px]"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-field bg-sky-tint text-brand-hover flex items-center justify-center font-extrabold text-xs">
                            {m.shortName}
                          </div>
                          <div>
                            <h4 className="text-sm font-extrabold text-ink">{m.label}</h4>
                            <p className="text-caption text-ink-secondary">{mSessions.length} scheduled occurrences</p>
                          </div>
                        </div>

                        <span className="text-xs font-bold text-brand hover:text-brand-hover">
                          {isExpanded ? 'Collapse' : 'Expand'}
                        </span>
                      </button>

                      {isExpanded && (
                        <div className="p-5 space-y-4">
                          {mSessions.length === 0 ? (
                            <p className="text-xs text-ink-muted text-center py-6">No timetable sessions scheduled for {m.label}.</p>
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
      className={`p-5 rounded-card border transition-all flex flex-col justify-between gap-4 shadow-card ${
        isLive
          ? 'bg-rose-50/60 border-rose-200'
          : 'bg-surface border-line hover:border-brand/40'
      }`}
      style={{ borderLeftWidth: '4px', borderLeftColor: session.accentColor }}
    >
      {/* Card Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className="px-2.5 py-1 rounded-field text-caption font-bold"
            style={{ backgroundColor: session.badgeBg, color: session.badgeText }}
          >
            {session.subject}
          </span>
          <span className="text-caption font-semibold text-ink-secondary">{session.date}</span>
        </div>

        <div>
          {isLive ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-100 text-rose-700 text-caption font-bold">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-600" />
              </span>
              LIVE
            </span>
          ) : isCompleted ? (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 text-caption font-bold">
              <CheckCircle size={12} weight="fill" />
              Completed
            </span>
          ) : isUpcoming ? (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-sky-tint text-brand-hover text-caption font-bold border border-line">
              <Clock size={12} weight="bold" />
              Upcoming
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-paper text-ink-secondary text-caption font-bold border border-line">
              Scheduled
            </span>
          )}
        </div>
      </div>

      {/* Card Body */}
      <div className="space-y-1">
        <h4 className="text-sm sm:text-base font-bold text-ink tracking-tight leading-snug">
          {session.title || session.chapter || `${session.subject} Lecture`}
        </h4>
        {session.topic && (
          <p className="text-xs text-ink-secondary">
            Topic: <span className="text-ink font-medium">{session.topic}</span>
          </p>
        )}
        {session.notes && (
          <p className="text-caption text-ink-secondary italic mt-1 bg-paper p-2 rounded-field border border-line/60">
            Note: {session.notes}
          </p>
        )}
      </div>

      {/* Card Meta & Actions */}
      <div className="pt-3 border-t border-line flex items-center justify-between gap-3 text-xs">
        <div className="space-y-0.5">
          <div className="flex items-center gap-1.5 font-bold text-ink">
            <Clock size={14} weight="bold" className="text-ink-muted" />
            <span>{session.timeSlot}</span>
            <span className="text-ink-muted font-normal">({session.duration})</span>
          </div>
          {session.teacher && (
            <p className="text-caption text-ink-secondary">Teacher: <strong className="text-ink">{session.teacher}</strong></p>
          )}
        </div>

        <div>
          {isLive ? (
            <Link
              href={session.classId ? `/student/classes/${session.classId}/room` : '/student/classes'}
              className="px-4 py-2.5 rounded-field bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs transition-colors inline-flex items-center gap-1.5 shadow-2xs min-h-[44px]"
            >
              <VideoCamera size={14} weight="fill" />
              <span>Join</span>
            </Link>
          ) : isCompleted ? (
            <Link
              href="/student/classes"
              className="px-3.5 py-2 rounded-field border border-line bg-sky-tint hover:bg-sky-tint/80 text-brand-hover font-bold text-xs transition-colors inline-flex items-center gap-1 min-h-[44px] shadow-2xs"
            >
              <Play size={12} weight="fill" />
              <span>Watch</span>
            </Link>
          ) : isTest ? (
            <Link
              href={session.testId ? `/student/tests/${session.testId}` : '/student/tests'}
              className="px-3.5 py-2 rounded-field bg-brand hover:bg-brand-hover text-white font-bold text-xs transition-colors inline-flex items-center gap-1 min-h-[44px] shadow-2xs"
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
    <div className="p-8 text-center rounded-card bg-surface border border-line shadow-card text-ink-secondary space-y-2">
      <p className="text-xs font-bold text-ink-secondary">{message}</p>
      <p className="text-caption text-ink-muted">
        Classes will automatically appear here once scheduled by your teachers or institute admin.
      </p>
    </div>
  );
}
