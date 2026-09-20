'use client';

/**
 * Subject Learning Workspace Page
 * (/student/courses/[courseId]/subjects/[subjectId])
 *
 * Modeled after SubjectDashboardScreen from MockTestApp.
 * 3-pane layout for desktop (curriculum navigation, web content player, and progress).
 * Mobile (<1024px) has player primary with segmented curriculum drawer/sheet.
 * In-context doubt button next to every content item.
 *
 * @module app/student/courses/[courseId]/subjects/[subjectId]/page
 */

import React, { useEffect, useState, useMemo } from 'react';
import {
  useParams,
  useRouter,
  useSearchParams,
} from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  BookOpen,
  VideoCamera,
  FileText,
  Exam,
  CheckCircle,
  MagnifyingGlass,
  User,
  Question,
  ListBullets,
} from '@phosphor-icons/react';
import {
  fetchSubjectLearningWorkspace,
  type SubjectLearningWorkspaceData,
  type SubjectWorkspaceContentItem,
  type AssignedMockTestItem,
} from '@/services/student/studentCourseWebService';
import { StudentWebContentPlayer } from '@/components/student/StudentWebContentPlayer';
import { createContextQueryUrl } from '@/services/student/studentDoubtAcademicService';
import { Skeleton, ErrorState, Sheet } from '@/components/ui/mmt';
import { ProgressBar } from '@/components/ui/mmt/ProgressBar';

export default function SubjectLearningWorkspacePage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const courseId = params?.courseId as string;
  const subjectId = params?.subjectId as string;
  const targetContentId = searchParams?.get('contentId');
  const targetTestId = searchParams?.get('testId');

  const [workspace, setWorkspace] = useState<SubjectLearningWorkspaceData | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Active selection state
  const [selectedContent, setSelectedContent] = useState<SubjectWorkspaceContentItem | null>(null);
  const [selectedMockTest, setSelectedMockTest] = useState<AssignedMockTestItem | null>(null);
  const [selectedTypeFilter, setSelectedTypeFilter] = useState<'all' | 'video' | 'pdf' | 'tests'>('all');
  const [curriculumSearch, setCurriculumSearch] = useState<string>('');

  // Mobile drawer state
  const [isMobileCurriculumOpen, setIsMobileCurriculumOpen] = useState<boolean>(false);

  const loadWorkspace = async () => {
    if (!courseId || !subjectId) return;
    setIsLoading(true);
    setError(null);
    try {
      const { data, error: resErr } = await fetchSubjectLearningWorkspace(courseId, subjectId);
      if (resErr) {
        setError(resErr);
      } else if (data) {
        setWorkspace(data);

        let selected = false;
        // Priority 1: Match contentId from link
        if (targetContentId && data.allItems?.length > 0) {
          const matchedItem = data.allItems.find((i) => i.contentId === targetContentId);
          if (matchedItem) {
            setSelectedContent(matchedItem);
            setSelectedMockTest(null);
            selected = true;
          }
        }

        // Priority 2: Match testId from link
        if (!selected && targetTestId && data.mockTests?.length > 0) {
          const matchedTest = data.mockTests.find((t) => t.testId === targetTestId);
          if (matchedTest) {
            setSelectedMockTest(matchedTest);
            setSelectedContent(null);
            selected = true;
          }
        }

        // Priority 3: Default auto-select first available item
        if (!selected) {
          if (data.allItems && data.allItems.length > 0) {
            setSelectedContent(data.allItems[0]);
            setSelectedMockTest(null);
          } else if (data.mockTests && data.mockTests.length > 0) {
            setSelectedMockTest(data.mockTests[0]);
            setSelectedContent(null);
          }
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
  }, [courseId, subjectId, targetContentId, targetTestId]);

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
    setIsMobileCurriculumOpen(false);
  };

  const handleSelectTest = (test: AssignedMockTestItem) => {
    setSelectedMockTest(test);
    setSelectedContent(null);
    setIsMobileCurriculumOpen(false);
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

  const handleAskDoubt = (contentId?: string, contentTitle?: string) => {
    const title = contentTitle || selectedContent?.title || 'Subject Topic';
    const doubtUrl = createContextQueryUrl({
      relatedResourceType: 'content',
      relatedResourceId: contentId || selectedContent?.contentId,
      subjectId: subjectId || workspace?.subject.subjectId,
      batchSubjectId: workspace?.subject.batchSubjectId,
      subjectName: workspace?.subject.subjectName,
      prefillTitle: `Doubt regarding ${title}`,
    });
    router.push(doubtUrl);
  };

  if (isLoading) {
    return (
      <div className="store-container space-y-6 animate-pulse">
        <Skeleton className="h-6 w-56" />
        <Skeleton className="h-28 w-full rounded-card" />
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <Skeleton className="lg:col-span-4 h-[600px] rounded-card" />
          <Skeleton className="lg:col-span-8 h-[600px] rounded-card" />
        </div>
      </div>
    );
  }

  if (error || !workspace) {
    return (
      <div className="store-container">
        <ErrorState
          title="Workspace Unavailable"
          detail={error || 'Could not load subject curriculum for this course.'}
          onRetry={loadWorkspace}
        />
      </div>
    );
  }

  const { subject, course, allItems, mockTests, progress } = workspace;

  const videoItemsCount = allItems.filter((i) => i.contentType === 'video').length;
  const pdfItemsCount = allItems.filter(
    (i) => i.contentType === 'pdf' || i.contentType === 'notes' || i.contentType === 'assignment'
  ).length;

  // Curriculum content renderer (shared between desktop sidebar and mobile drawer)
  const renderCurriculumList = () => (
    <div className="space-y-4">
      {/* Search & Filter Header */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-body font-bold text-ink flex items-center gap-1.5">
            <BookOpen className="h-4 w-4 text-brand" weight="duotone" />
            <span>Curriculum Syllabus</span>
          </h2>
          <span className="text-caption font-semibold text-ink-muted">
            {allItems.length} items
          </span>
        </div>

        {/* Search Box */}
        <div className="relative">
          <MagnifyingGlass className="absolute left-3 top-2.5 h-3.5 w-3.5 text-ink-muted" />
          <input
            type="text"
            placeholder="Search lectures or notes..."
            value={curriculumSearch}
            onChange={(e) => setCurriculumSearch(e.target.value)}
            className="w-full min-h-[38px] rounded-field border border-line bg-paper pl-8 pr-3 py-2 text-body font-medium placeholder:text-ink-muted focus:border-brand focus:bg-surface focus:outline-none"
          />
        </div>
      </div>

      {/* Type Filter Tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
        <button
          onClick={() => setSelectedTypeFilter('all')}
          className={`min-h-[34px] rounded-field px-2.5 py-1 text-caption font-bold whitespace-nowrap transition-colors ${
            selectedTypeFilter === 'all'
              ? 'bg-brand text-white shadow-xs'
              : 'bg-paper text-ink-secondary hover:bg-sky-tint'
          }`}
        >
          All ({allItems.length})
        </button>
        <button
          onClick={() => setSelectedTypeFilter('video')}
          className={`min-h-[34px] rounded-field px-2.5 py-1 text-caption font-bold whitespace-nowrap transition-colors ${
            selectedTypeFilter === 'video'
              ? 'bg-brand text-white shadow-xs'
              : 'bg-paper text-ink-secondary hover:bg-sky-tint'
          }`}
        >
          Videos ({videoItemsCount})
        </button>
        <button
          onClick={() => setSelectedTypeFilter('pdf')}
          className={`min-h-[34px] rounded-field px-2.5 py-1 text-caption font-bold whitespace-nowrap transition-colors ${
            selectedTypeFilter === 'pdf'
              ? 'bg-brand text-white shadow-xs'
              : 'bg-paper text-ink-secondary hover:bg-sky-tint'
          }`}
        >
          PDFs ({pdfItemsCount})
        </button>
        {mockTests.length > 0 && (
          <button
            onClick={() => setSelectedTypeFilter('tests')}
            className={`min-h-[34px] rounded-field px-2.5 py-1 text-caption font-bold whitespace-nowrap transition-colors ${
              selectedTypeFilter === 'tests'
                ? 'bg-brand text-white shadow-xs'
                : 'bg-paper text-ink-secondary hover:bg-sky-tint'
            }`}
          >
            Tests ({mockTests.length})
          </button>
        )}
      </div>

      {/* Curriculum Item Sections */}
      <div className="max-h-[560px] overflow-y-auto space-y-4 pr-1">
        {selectedTypeFilter === 'tests' ? (
          /* Mock Tests List */
          <div className="space-y-2">
            <p className="text-caption font-bold uppercase tracking-wider text-ink-muted">
              Assigned Tests
            </p>
            {mockTests.map((test) => {
              const isSelected = selectedMockTest?.testId === test.testId;
              const attempt = test.attemptSummary;
              return (
                <button
                  key={test.testId}
                  onClick={() => handleSelectTest(test)}
                  className={`flex min-h-[44px] w-full items-start gap-2.5 rounded-field border p-3 text-left transition-all ${
                    isSelected
                      ? 'border-brand bg-sky-tint shadow-xs ring-1 ring-brand'
                      : 'border-line bg-surface hover:border-line hover:bg-paper'
                  }`}
                >
                  <Exam className={`h-4 w-4 mt-0.5 shrink-0 ${isSelected ? 'text-brand' : 'text-ink-muted'}`} weight="duotone" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1">
                      <p className="text-body font-bold text-ink line-clamp-1">{test.title}</p>
                      {attempt?.attemptState === 'in_progress' && (
                        <span className="shrink-0 rounded bg-sand px-1.5 py-0.5 text-caption font-bold text-sand-ink">
                          Resume
                        </span>
                      )}
                      {attempt?.attemptState === 'submitted' && (
                        <span className="shrink-0 rounded bg-mint-tint px-1.5 py-0.5 text-caption font-bold text-mint-ink">
                          Done
                        </span>
                      )}
                      {attempt?.attemptState === 'limit_reached' && (
                        <span className="shrink-0 rounded bg-paper px-1.5 py-0.5 text-caption font-bold text-ink-secondary">
                          Used
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-caption text-ink-secondary">
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
          <div className="py-8 text-center text-body text-ink-muted">
            No learning content matching filter.
          </div>
        ) : (
          filteredSections.map((section, sIdx) => (
            <div key={section.sectionName || sIdx} className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-caption font-bold uppercase tracking-wider text-ink-secondary bg-paper px-2.5 py-1 rounded-field">
                <span className="h-1.5 w-1.5 rounded-full bg-brand" />
                <span className="truncate">{section.sectionName}</span>
              </div>

              <div className="space-y-1.5 pl-0.5">
                {section.items.map((item) => {
                  const isSelected = selectedContent?.contentId === item.contentId;
                  const isVideo = item.contentType === 'video';

                  return (
                    <div
                      key={item.contentId}
                      className={`group/item flex min-h-[44px] w-full items-center justify-between gap-2 rounded-field border p-2 text-left transition-all ${
                        isSelected
                          ? 'border-brand bg-sky-tint shadow-xs ring-1 ring-brand'
                          : 'border-line bg-surface hover:border-line hover:bg-paper'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => handleSelectContent(item)}
                        className="flex flex-1 items-center gap-2.5 min-w-0 text-left cursor-pointer"
                      >
                        <div
                          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-field text-white ${
                            isVideo ? 'bg-brand' : 'bg-brand-hover'
                          }`}
                        >
                          {isVideo ? (
                            <VideoCamera className="h-3.5 w-3.5" weight="duotone" />
                          ) : (
                            <FileText className="h-3.5 w-3.5" weight="duotone" />
                          )}
                        </div>

                        <div className="flex-1 min-w-0">
                          <p className="text-body font-semibold text-ink line-clamp-1 group-hover/item:text-brand transition-colors">
                            {item.title}
                          </p>
                          <div className="flex items-center gap-2 text-caption text-ink-secondary">
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
                              <span className="inline-flex items-center gap-0.5 text-mint-ink font-bold">
                                <CheckCircle className="h-3 w-3" weight="bold" />
                                Done
                              </span>
                            )}
                          </div>
                        </div>
                      </button>

                      {/* In-Context Doubt Deep Link Button */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAskDoubt(item.contentId, item.title);
                        }}
                        title={`Ask doubt on "${item.title}"`}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-field text-ink-muted hover:text-amber-800 hover:bg-sand transition-colors"
                      >
                        <Question className="h-4 w-4" weight="bold" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );

  return (
    <div className="store-container space-y-5 pb-12">
      {/* ── Breadcrumb & Top Bar ────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav className="store-breadcrumb" aria-label="Breadcrumb">
          <Link href="/student/overview">My Learning</Link>
          <span aria-hidden="true">/</span>
          <Link href="/student/courses">My Courses</Link>
          <span aria-hidden="true">/</span>
          <Link href={`/student/courses/${courseId}`}>{course.title}</Link>
          <span aria-hidden="true">/</span>
          <span>{subject.subjectName}</span>
        </nav>

        <Link
          href={`/student/courses/${courseId}`}
          className="inline-flex min-h-[38px] items-center gap-1.5 rounded-field border border-line bg-surface px-3 py-1.5 text-body font-semibold text-ink-secondary hover:bg-paper transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Course Syllabus</span>
        </Link>
      </div>

      {/* ── Subject Info Banner ──────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-card border border-line bg-surface p-5 shadow-card">
        <div className="flex items-center gap-3.5">
          <div
            className="flex h-14 w-14 items-center justify-center rounded-card text-3xl shadow-xs"
            style={{ backgroundColor: `${subject.color}15` }}
          >
            {subject.emoji}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-extrabold text-ink">{subject.subjectName}</h1>
              {subject.subjectCode && (
                <span className="rounded-field bg-paper px-2 py-0.5 text-caption font-bold text-ink-secondary border border-line">
                  {subject.subjectCode}
                </span>
              )}
            </div>
            <p className="mt-0.5 text-body text-ink-secondary">
              {subject.batchName} · {allItems.length} Study Items · {mockTests.length} Mock Tests
            </p>
          </div>
        </div>

        {/* Progress & Faculty Pill */}
        <div className="flex flex-wrap items-center gap-4 border-t sm:border-t-0 sm:border-l border-line pt-3 sm:pt-0 sm:pl-5">
          <div className="min-w-[120px] space-y-1">
            <div className="flex items-center justify-between text-caption font-bold">
              <span className="text-ink-secondary uppercase">Progress</span>
              <span className="text-ink tabular-nums">{progress.percent}%</span>
            </div>
            <ProgressBar
              value={progress.percent}
              label={`${subject.subjectName} completion`}
              tone={progress.percent >= 80 ? 'success' : 'brand'}
            />
          </div>

          <div className="flex items-center gap-2 rounded-field bg-paper px-3 py-2 text-body border border-line">
            <User className="h-4 w-4 text-ink-muted" weight="duotone" />
            <div>
              <p className="text-caption text-ink-muted uppercase font-bold">Faculty</p>
              <p className="font-semibold text-ink text-xs">{subject.teacherName || 'Assigned Faculty'}</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Mobile-Only Segmented Top Area (Curriculum Drawer Button) ────────── */}
      <div className="block lg:hidden">
        <button
          type="button"
          onClick={() => setIsMobileCurriculumOpen(true)}
          className="flex min-h-[44px] w-full items-center justify-between rounded-field border border-line bg-surface p-3 text-body font-bold text-ink shadow-xs hover:bg-paper transition-colors"
        >
          <span className="flex items-center gap-2">
            <ListBullets className="h-5 w-5 text-brand" weight="bold" />
            <span>Curriculum Syllabus</span>
          </span>
          <span className="rounded-full bg-sky-tint px-2.5 py-0.5 text-caption text-brand-hover font-bold">
            {allItems.length} items
          </span>
        </button>

        {/* Mobile Curriculum Sheet Drawer */}
        <Sheet
          open={isMobileCurriculumOpen}
          onClose={() => setIsMobileCurriculumOpen(false)}
          title={`${subject.subjectName} Curriculum`}
        >
          {renderCurriculumList()}
        </Sheet>
      </div>

      {/* ── Main Layout: Desktop 3-Pane / Mobile Player Primary ─────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* ── LEFT PANE: Curriculum Sidebar (Desktop only, Col 4) ─────────────── */}
        <div className="hidden lg:block lg:col-span-4 rounded-card border border-line bg-surface p-4 shadow-card">
          {renderCurriculumList()}
        </div>

        {/* ── CENTER & RIGHT: Content Player & Doubt CTA (Col 8) ─────────────── */}
        <div className="lg:col-span-8 space-y-6">
          {/* Main Web Content Player */}
          <StudentWebContentPlayer
            contentItem={selectedContent}
            mockTestItem={selectedMockTest}
            onComplete={handleMarkItemComplete}
            onAskDoubt={handleAskDoubt}
          />

          {/* Quick Doubts / Faculty Help Card (Design A) */}
          <div className="rounded-card border border-line bg-surface p-5 sm:p-6 shadow-card flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-sand-ink">
                <Question className="h-5 w-5 text-amber-600" weight="duotone" />
                <h3 className="text-h3 font-bold text-ink">Have a Doubt in {subject.subjectName}?</h3>
              </div>
              <p className="mt-1 text-body text-ink-secondary">
                Submit your academic questions to assigned faculty for step-by-step verified explanations.
              </p>
            </div>
            <div className="shrink-0">
              <button
                type="button"
                onClick={() => handleAskDoubt()}
                className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-field bg-sand px-4 py-2.5 text-body font-bold text-sand-ink hover:bg-amber-100 transition-colors w-full sm:w-auto border border-amber-200"
              >
                <Question className="h-4 w-4" weight="bold" />
                <span>Ask Faculty a Doubt</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
