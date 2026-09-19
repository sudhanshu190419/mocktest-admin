'use client';

/**
 * Subject Learning Workspace Page
 * (/student/courses/[courseId]/subjects/[subjectId])
 *
 * Modeled after SubjectDashboardScreen from MockTestApp.
 * 3-pane layout for desktop with curriculum navigation, web content player, and progress.
 *
 * @module app/student/courses/[courseId]/subjects/[subjectId]/page
 */

import React, { useEffect, useState, useMemo } from 'react';
import {
  useParams,
  useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  CaretRight,
  ArrowLeft,
  BookOpen,
  VideoCamera,
  FileText,
  Exam,
  CheckCircle,
  Warning,
  ArrowsClockwise,
  MagnifyingGlass,
  Funnel,
  User,
  Clock,
  Sparkle,
  DownloadSimple,
  Question,
  PlayCircle,
  ListNumbers
} from '@phosphor-icons/react';
import {
  fetchSubjectLearningWorkspace,
  type SubjectLearningWorkspaceData,
  type SubjectWorkspaceContentItem,
  type AssignedMockTestItem,
} from '@/services/student/studentCourseWebService';
import { StudentWebContentPlayer } from '@/components/student/StudentWebContentPlayer';
import { createContextQueryUrl } from '@/services/student/studentDoubtAcademicService';

export default function SubjectLearningWorkspacePage() {
  const params = useParams();
  const router = useRouter();
  const courseId = params?.courseId as string;
  const subjectId = params?.subjectId as string;

  const [workspace, setWorkspace] = useState<SubjectLearningWorkspaceData | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Active selection state
  const [selectedContent, setSelectedContent] = useState<SubjectWorkspaceContentItem | null>(null);
  const [selectedMockTest, setSelectedMockTest] = useState<AssignedMockTestItem | null>(null);
  const [selectedTypeFilter, setSelectedTypeFilter] = useState<'all' | 'video' | 'pdf' | 'tests'>('all');
  const [curriculumSearch, setCurriculumSearch] = useState<string>('');

  const loadWorkspace = async () => {
    if (!courseId || !subjectId) return;
    setIsLoading(true);
    setError(null);
    try {
      const { data, error: resErr } = await fetchSubjectLearningWorkspace(courseId, subjectId);
      if (resErr) {
        setError(resErr);
      } else {
        setWorkspace(data);
        // Auto-select first available content item
        if (data?.allItems && data.allItems.length > 0) {
          setSelectedContent(data.allItems[0]);
          setSelectedMockTest(null);
        } else if (data?.mockTests && data.mockTests.length > 0) {
          setSelectedMockTest(data.mockTests[0]);
          setSelectedContent(null);
        }
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load subject learning workspace');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadWorkspace();
  }, [courseId, subjectId]);

  // Filter curriculum sections based on search query and content type filter
  const filteredSections = useMemo(() => {
    if (!workspace) return [];

    return workspace.sections
      .map((section) => {
        const filteredItems = section.items.filter((item) => {
          const matchesSearch =
            item.title.toLowerCase().includes(curriculumSearch.toLowerCase()) ||
            (item.description && item.description.toLowerCase().includes(curriculumSearch.toLowerCase()));

          const matchesType =
            selectedTypeFilter === 'all' ||
            (selectedTypeFilter === 'video' && item.contentType === 'video') ||
            (selectedTypeFilter === 'pdf' && (item.contentType === 'pdf' || item.contentType === 'notes' || item.contentType === 'assignment'));

          return matchesSearch && matchesType;
        });

        return {
          sectionName: section.sectionName,
          items: filteredItems,
        };
      })
      .filter((s) => s.items.length > 0);
  }, [workspace, curriculumSearch, selectedTypeFilter]);

  const handleSelectContent = (item: SubjectWorkspaceContentItem) => {
    setSelectedContent(item);
    setSelectedMockTest(null);
  };

  const handleSelectTest = (test: AssignedMockTestItem) => {
    setSelectedMockTest(test);
    setSelectedContent(null);
  };

  const handleMarkItemComplete = (contentId: string) => {
    if (!workspace) return;
    setWorkspace((prev) => {
      if (!prev) return prev;
      const updatedItems = prev.allItems.map((item) =>
        item.contentId === contentId ? { ...item, isCompleted: true } : item
      );
      const updatedSections = prev.sections.map((sec) => ({
        ...sec,
        items: sec.items.map((item) =>
          item.contentId === contentId ? { ...item, isCompleted: true } : item
        ),
      }));
      const completedCount = updatedItems.filter((i) => i.isCompleted).length;
      return {
        ...prev,
        allItems: updatedItems,
        sections: updatedSections,
        progress: {
          completedItems: completedCount,
          totalItems: updatedItems.length,
          percent: updatedItems.length > 0 ? Math.round((completedCount / updatedItems.length) * 100) : 0,
        },
      };
    });
  };

  const handleAskDoubt = (contentId: string, title: string) => {
    const doubtUrl = createContextQueryUrl({
      relatedResourceType: 'content',
      relatedResourceId: contentId,
      subjectId: subjectId || workspace?.subject.subjectId,
      batchSubjectId: workspace?.subject.batchSubjectId,
      subjectName: workspace?.subject.subjectName,
      prefillTitle: `Doubt regarding ${title}`,
    });
    router.push(doubtUrl);
  };

  if (isLoading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-6 w-56 rounded bg-slate-200" />
        <div className="h-28 rounded-2xl bg-slate-200" />
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-4 h-[600px] rounded-2xl bg-slate-200" />
          <div className="lg:col-span-8 h-[600px] rounded-2xl bg-slate-200" />
        </div>
      </div>
    );
  }

  if (error || !workspace) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-8 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-100 text-rose-600">
          <Warning className="h-6 w-6" />
        </div>
        <h3 className="mt-3 text-base font-bold text-slate-900">Workspace Unavailable</h3>
        <p className="mt-1 text-xs text-slate-600 max-w-sm mx-auto">
          {error || 'Could not load subject curriculum for this course.'}
        </p>
        <div className="mt-5 flex justify-center gap-3">
          <button
            onClick={loadWorkspace}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
          >
            <ArrowsClockwise className="h-3.5 w-3.5" />
            Retry
          </button>
          <Link
            href={`/student/courses/${courseId}`}
            className="inline-flex items-center gap-1.5 rounded-xl bg-sky-600 px-4 py-2 text-xs font-bold text-white hover:bg-sky-700"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Syllabus
          </Link>
        </div>
      </div>
    );
  }

  const { subject, course, allItems, mockTests, progress } = workspace;

  const videoItemsCount = allItems.filter((i) => i.contentType === 'video').length;
  const pdfItemsCount = allItems.filter(
    (i) => i.contentType === 'pdf' || i.contentType === 'notes' || i.contentType === 'assignment'
  ).length;

  return (
    <div className="store-container space-y-5 pb-12">
      {/* ── Breadcrumb & Top Bar ────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav className="store-breadcrumb" aria-label="Breadcrumb">
          <Link href="/student/overview">Student Hub</Link>
          <span aria-hidden="true">/</span>
          <Link href="/student/courses">My Courses</Link>
          <span aria-hidden="true">/</span>
          <Link href={`/student/courses/${courseId}`}>{course.title}</Link>
          <span aria-hidden="true">/</span>
          <span>{subject.subjectName}</span>
        </nav>

        <Link
          href={`/student/courses/${courseId}`}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:border-slate-300 hover:bg-slate-50 transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Course Syllabus
        </Link>
      </div>

      {/* ── Subject Info Banner ──────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-3.5">
          <div
            className="flex h-14 w-14 items-center justify-center rounded-2xl text-3xl shadow-sm"
            style={{ backgroundColor: `${subject.color}15` }}
          >
            {subject.emoji}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-extrabold text-slate-900">{subject.subjectName}</h1>
              {subject.subjectCode && (
                <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600">
                  {subject.subjectCode}
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-slate-500">
              {subject.batchName} · {allItems.length} Study Items · {mockTests.length} Mock Tests
            </p>
          </div>
        </div>

        {/* Teacher & Progress Pills */}
        <div className="flex flex-wrap items-center gap-3 border-t sm:border-t-0 sm:border-l border-slate-100 pt-3 sm:pt-0 sm:pl-5">
          <div className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs">
            <User className="h-4 w-4 text-slate-400" />
            <div>
              <p className="text-[10px] text-slate-400 uppercase font-bold">Faculty</p>
              <p className="font-semibold text-slate-800">{subject.teacherName || 'Assigned Faculty'}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 rounded-xl bg-sky-50 px-3 py-2 text-xs text-sky-800 border border-sky-100">
            <Sparkle className="h-4 w-4 text-sky-600" />
            <div>
              <p className="text-[10px] text-sky-600 uppercase font-bold">Subject Progress</p>
              <p className="font-bold">{progress.percent}% Completed</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Main 3-Pane Curriculum Learning Layout ───────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* ── LEFT PANE: Curriculum Sidebar & Modules (Col 4) ────────────────── */}
        <div className="lg:col-span-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-4">
          {/* Header & Search */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                <BookOpen className="h-4 w-4 text-sky-600" />
                Curriculum Syllabus
              </h2>
              <span className="text-[11px] font-semibold text-slate-400">
                {allItems.length} items
              </span>
            </div>

            {/* Search Box */}
            <div className="relative">
              <MagnifyingGlass className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                placeholder="Search lectures or notes..."
                value={curriculumSearch}
                onChange={(e) => setCurriculumSearch(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 pl-8 pr-3 py-2 text-xs placeholder:text-slate-400 focus:border-sky-500 focus:bg-white focus:outline-none"
              />
            </div>
          </div>

          {/* Type Filter Tabs */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
            <button
              onClick={() => setSelectedTypeFilter('all')}
              className={`rounded-lg px-2.5 py-1 text-[11px] font-bold whitespace-nowrap transition-colors ${
                selectedTypeFilter === 'all'
                  ? 'bg-sky-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              All ({allItems.length})
            </button>
            <button
              onClick={() => setSelectedTypeFilter('video')}
              className={`rounded-lg px-2.5 py-1 text-[11px] font-bold whitespace-nowrap transition-colors ${
                selectedTypeFilter === 'video'
                  ? 'bg-purple-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              Videos ({videoItemsCount})
            </button>
            <button
              onClick={() => setSelectedTypeFilter('pdf')}
              className={`rounded-lg px-2.5 py-1 text-[11px] font-bold whitespace-nowrap transition-colors ${
                selectedTypeFilter === 'pdf'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              PDFs ({pdfItemsCount})
            </button>
            {mockTests.length > 0 && (
              <button
                onClick={() => setSelectedTypeFilter('tests')}
                className={`rounded-lg px-2.5 py-1 text-[11px] font-bold whitespace-nowrap transition-colors ${
                  selectedTypeFilter === 'tests'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                Tests ({mockTests.length})
              </button>
            )}
          </div>

          {/* Curriculum Item Sections */}
          <div className="mt-3 max-h-[580px] overflow-y-auto space-y-4 pr-1">
            {selectedTypeFilter === 'tests' ? (
              /* Mock Tests List */
              <div className="space-y-2">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Assigned Tests
                </p>
                {mockTests.map((test) => {
                  const isSelected = selectedMockTest?.testId === test.testId;
                  const attempt = test.attemptSummary;
                  return (
                    <button
                      key={test.testId}
                      onClick={() => handleSelectTest(test)}
                      className={`flex w-full items-start gap-2.5 rounded-xl border p-3 text-left transition-all ${
                        isSelected
                          ? 'border-indigo-500 bg-indigo-50/70 shadow-sm ring-1 ring-indigo-200'
                          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      <Exam className={`h-4 w-4 mt-0.5 shrink-0 ${isSelected ? 'text-indigo-600' : 'text-slate-400'}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1">
                          <p className="text-xs font-bold text-slate-900 line-clamp-1">{test.title}</p>
                          {attempt?.attemptState === 'in_progress' && (
                            <span className="shrink-0 rounded bg-sky-100 px-1.5 py-0.5 text-[9px] font-bold text-sky-700">
                              Resume
                            </span>
                          )}
                          {attempt?.attemptState === 'submitted' && (
                            <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700">
                              Done
                            </span>
                          )}
                          {attempt?.attemptState === 'limit_reached' && (
                            <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold text-slate-600">
                              Exhausted
                            </span>
                          )}
                        </div>
                        <div className="mt-1 flex items-center gap-2 text-[10px] text-slate-500">
                          <span>{test.durationMin !== null ? `${test.durationMin}m` : 'Flexible'}</span>
                          <span>·</span>
                          <span>{test.totalMarks !== null ? `${test.totalMarks} Marks` : 'Assessed'}</span>
                          {test.questionCount > 0 && (
                            <>
                              <span>·</span>
                              <span>{test.questionCount} Q</span>
                            </>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : filteredSections.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-400">
                No learning content matching filter.
              </div>
            ) : (
              filteredSections.map((section, sIdx) => (
                <div key={section.sectionName || sIdx} className="space-y-1.5">
                  <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500 bg-slate-50 px-2 py-1 rounded-md">
                    <span className="h-1.5 w-1.5 rounded-full bg-sky-500" />
                    <span className="truncate">{section.sectionName}</span>
                  </div>

                  <div className="space-y-1 pl-1">
                    {section.items.map((item) => {
                      const isSelected = selectedContent?.contentId === item.contentId;
                      const isVideo = item.contentType === 'video';

                      return (
                        <button
                          key={item.contentId}
                          onClick={() => handleSelectContent(item)}
                          className={`flex w-full items-start gap-2.5 rounded-xl border p-2.5 text-left transition-all ${
                            isSelected
                              ? 'border-sky-500 bg-sky-50/70 shadow-sm ring-1 ring-sky-200'
                              : 'border-slate-100 bg-white hover:border-slate-200 hover:bg-slate-50'
                          }`}
                        >
                          <div
                            className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-white ${
                              isVideo ? 'bg-purple-600' : 'bg-sky-600'
                            }`}
                          >
                            {isVideo ? <VideoCamera className="h-3 w-3" /> : <FileText className="h-3 w-3" />}
                          </div>

                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold text-slate-900 line-clamp-1">{item.title}</p>
                            <div className="mt-0.5 flex items-center gap-2 text-[10px] text-slate-400">
                              <span className="capitalize">{item.contentType}</span>
                              {item.durationSeconds ? (
                                <>
                                  <span>·</span>
                                  <span>{Math.round(item.durationSeconds / 60)} min</span>
                                </>
                              ) : item.pageCount ? (
                                <>
                                  <span>·</span>
                                  <span>{item.pageCount} pgs</span>
                                </>
                              ) : null}
                              {item.isCompleted && (
                                <span className="inline-flex items-center gap-0.5 text-emerald-600 font-bold">
                                  <CheckCircle className="h-2.5 w-2.5" />
                                  Done
                                </span>
                              )}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* ── CENTER & RIGHT PANE: Content Display & Learning Workspace (Col 8) ── */}
        <div className="lg:col-span-8 space-y-6">
          {/* Main Web Content Player */}
          <StudentWebContentPlayer
            contentItem={selectedContent}
            mockTestItem={selectedMockTest}
            onComplete={handleMarkItemComplete}
            onAskDoubt={handleAskDoubt}
          />

          {/* Secondary Subject Performance & Quick Resources Bar */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Subject Progress Summary Card */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="text-sm font-bold text-slate-900">Syllabus Completion</h3>
              <p className="mt-0.5 text-xs text-slate-500">
                {progress.completedItems} of {progress.totalItems} lectures & notes completed
              </p>
              <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-sky-500 to-emerald-500 transition-all duration-500"
                  style={{ width: `${Math.max(5, progress.percent)}%` }}
                />
              </div>
              <div className="mt-3 flex justify-between text-xs font-semibold text-slate-600">
                <span>Completed: {progress.percent}%</span>
                <span>Remaining: {100 - progress.percent}%</span>
              </div>
            </div>

            {/* Quick Doubts / Faculty Help Card */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-2 text-amber-600">
                  <Question className="h-4 w-4" />
                  <h3 className="text-sm font-bold text-slate-900">Have a Doubt in {subject.subjectName}?</h3>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Submit your academic queries directly to faculty and receive step-by-step solutions.
                </p>
              </div>
              <div className="mt-4">
                <Link
                  href={createContextQueryUrl({
                    subjectId: subjectId || workspace?.subject.subjectId,
                    batchSubjectId: workspace?.subject.batchSubjectId,
                    subjectName: workspace?.subject.subjectName,
                  })}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-amber-300 bg-amber-50/70 px-3.5 py-2 text-xs font-bold text-amber-900 hover:bg-amber-100 transition-colors w-full"
                >
                  <Question className="h-3.5 w-3.5" />
                  Ask Faculty a Doubt
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
