'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  X,
  UploadSimple,
  FilePdf,
  Image as ImageIcon,
  Trash,
  WarningCircle,
  SpinnerGap,
  Sparkle,
  GraduationCap,
  BookOpen,
  Folder,
  ChatCircleDots,
  VideoCamera,
  Exam,
  FileText,
} from '@phosphor-icons/react';
import { useAuth } from '@/context/AuthContext';
import { useSubmitDoubt } from '@/hooks/doubt/useDoubt';
import {
  studentDoubtAcademicService,
  type StudentBatchContext,
  type DoubtAcademicSelection,
  type ContextualDoubtParams,
  getDoubtResourceDisplay,
} from '@/services/student/studentDoubtAcademicService';
import { doubtAttachmentService } from '@/services/doubtAttachmentService';
import { validatePickedFile, formatFileSize } from '@/utils/doubtFileValidation';
import { doubtErrorMessage } from '@/utils/doubtErrors';
import type { DoubtResourceType } from '@/types/doubt';

export interface StudentAskDoubtModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialContext?: ContextualDoubtParams;
}

export function StudentAskDoubtModal({
  isOpen,
  onClose,
  initialContext,
}: StudentAskDoubtModalProps) {
  const router = useRouter();
  const { instituteId } = useAuth();
  const submitMutation = useSubmitDoubt();

  // ─── Form State ─────────────────────────────────────────────────────────────
  const [selection, setSelection] = useState<DoubtAcademicSelection>(() =>
    studentDoubtAcademicService.createEmptySelection(),
  );
  const [title, setTitle] = useState(initialContext?.prefillTitle || initialContext?.title || '');
  const [description, setDescription] = useState('');
  const [attachments, setAttachments] = useState<File[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isUploadingAttachments, setIsUploadingAttachments] = useState(false);
  const [uploadProgressText, setUploadProgressText] = useState<string | null>(null);

  // Contextual linked resource (can be detached by student)
  const [contextualResource, setContextualResource] = useState<{
    type: DoubtResourceType;
    id: string;
  } | null>(() => {
    const resType = (initialContext?.relatedResourceType || initialContext?.resourceType) as DoubtResourceType | null | undefined;
    const resId = initialContext?.relatedResourceId || initialContext?.resourceId;
    if (resType && resId) {
      return {
        type: studentDoubtAcademicService.normalizeDoubtResourceType(resType) || resType,
        id: resId,
      };
    }
    return null;
  });

  // Track if contextual preselection was applied
  const preselectedRef = useRef(false);

  // Field touch tracking for validation
  const [touched, setTouched] = useState<{ title: boolean; description: boolean; subject: boolean }>({
    title: false,
    description: false,
    subject: false,
  });

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ─── 1. Fetch Student Batch Contexts ────────────────────────────────────────
  const {
    data: batchContexts = [],
    isLoading: isContextsLoading,
  } = useQuery<StudentBatchContext[]>({
    queryKey: ['doubts', 'studentBatchContexts'],
    queryFn: async () => {
      const res = await studentDoubtAcademicService.getStudentBatchContexts();
      if (!res.success) {
        throw new Error(res.error ?? 'Failed to load enrolled batches.');
      }
      return res.data ?? [];
    },
    enabled: isOpen,
    staleTime: 5 * 60 * 1000,
  });

  // Sync initial preselection when contexts load or modal opens
  useEffect(() => {
    if (!isOpen) {
      preselectedRef.current = false;
      return;
    }

    const prefill = initialContext?.prefillTitle || initialContext?.title;
    if (prefill && !title) {
      setTitle(prefill);
    }

    const resType = (initialContext?.relatedResourceType || initialContext?.resourceType) as DoubtResourceType | null | undefined;
    const resId = initialContext?.relatedResourceId || initialContext?.resourceId;
    if (resType && resId && !contextualResource) {
      setContextualResource({
        type: studentDoubtAcademicService.normalizeDoubtResourceType(resType) || resType,
        id: resId,
      });
    }

    if (batchContexts.length > 0 && !preselectedRef.current) {
      preselectedRef.current = true;
      const preselected = studentDoubtAcademicService.preselectAcademicContext(
        batchContexts,
        selection,
        initialContext,
      );
      setSelection(preselected);
    }
  }, [isOpen, batchContexts, initialContext]);

  // Available subjects for the active batch
  const availableSubjects = useMemo(() => {
    return studentDoubtAcademicService.subjectsForBatch(batchContexts, selection.batchId);
  }, [batchContexts, selection.batchId]);

  // ─── 2. Dependent Chapters Fetch ────────────────────────────────────────────
  const {
    data: chapters = [],
    isLoading: isChaptersLoading,
  } = useQuery({
    queryKey: ['doubts', 'chapters', selection.subjectId],
    queryFn: async () => {
      if (!selection.subjectId) return [];
      const res = await studentDoubtAcademicService.fetchChaptersForSubject(selection.subjectId);
      if (!res.success) throw new Error(res.error);
      return res.data ?? [];
    },
    enabled: Boolean(isOpen && selection.subjectId),
    staleTime: 5 * 60 * 1000,
  });

  // Auto-preselect chapter once chapters load
  const chapterPreselectedRef = useRef(false);
  useEffect(() => {
    if (chapterPreselectedRef.current || chapters.length === 0) return;
    let match = null;
    if (initialContext?.chapterId) {
      match = chapters.find((c) => c.chapterId === initialContext.chapterId);
    } else if (initialContext?.chapterName) {
      const target = initialContext.chapterName.trim().toLowerCase();
      match = chapters.find((c) => c.name.toLowerCase() === target);
    }
    if (match) {
      chapterPreselectedRef.current = true;
      setSelection((prev) => ({ ...prev, chapterId: match.chapterId }));
    }
  }, [chapters, initialContext?.chapterId, initialContext?.chapterName]);

  // ─── 3. Dependent Topics Fetch ──────────────────────────────────────────────
  const {
    data: topics = [],
    isLoading: isTopicsLoading,
  } = useQuery({
    queryKey: ['doubts', 'topics', selection.chapterId],
    queryFn: async () => {
      if (!selection.chapterId) return [];
      const res = await studentDoubtAcademicService.fetchTopicsForChapter(selection.chapterId);
      if (!res.success) throw new Error(res.error);
      return res.data ?? [];
    },
    enabled: Boolean(isOpen && selection.chapterId),
    staleTime: 5 * 60 * 1000,
  });

  // Auto-preselect topic once topics load
  const topicPreselectedRef = useRef(false);
  useEffect(() => {
    if (topicPreselectedRef.current || topics.length === 0) return;
    let match = null;
    if (initialContext?.topicId) {
      match = topics.find((t) => t.topicId === initialContext.topicId);
    } else if (initialContext?.topicName) {
      const target = initialContext.topicName.trim().toLowerCase();
      match = topics.find((t) => t.name.toLowerCase() === target);
    }
    if (match) {
      topicPreselectedRef.current = true;
      setSelection((prev) => ({ ...prev, topicId: match.topicId }));
    }
  }, [topics, initialContext?.topicId, initialContext?.topicName]);

  // ─── Close & Escape Key Handlers ────────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !submitMutation.isPending && !isUploadingAttachments) {
        handleSafeClose();
      }
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [isOpen, submitMutation.isPending, isUploadingAttachments, title, description]);

  const hasUnsavedData = title.trim().length > 0 || description.trim().length > 0 || attachments.length > 0;

  const handleSafeClose = () => {
    if (submitMutation.isPending || isUploadingAttachments) return;
    if (hasUnsavedData) {
      const confirmed = window.confirm('You have unsaved changes in your doubt. Are you sure you want to close?');
      if (!confirmed) return;
    }
    resetForm();
    onClose();
  };

  const resetForm = () => {
    setSelection(studentDoubtAcademicService.createEmptySelection());
    setTitle('');
    setDescription('');
    setAttachments([]);
    setAttachError(null);
    setSubmitError(null);
    setContextualResource(null);
    setTouched({ title: false, description: false, subject: false });
    setIsUploadingAttachments(false);
    setUploadProgressText(null);
    preselectedRef.current = false;
    chapterPreselectedRef.current = false;
    topicPreselectedRef.current = false;
  };

  // ─── Attachment Selection ───────────────────────────────────────────────────
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    setAttachError(null);
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;

    if (attachments.length + files.length > 5) {
      setAttachError('You can attach a maximum of 5 files per doubt.');
      return;
    }

    const validNewFiles: File[] = [];
    for (const f of files) {
      const validationError = validatePickedFile({
        name: f.name,
        type: f.type,
        size: f.size,
      });
      if (validationError) {
        setAttachError(`${f.name}: ${validationError}`);
        return;
      }
      validNewFiles.push(f);
    }

    setAttachments((prev) => [...prev, ...validNewFiles]);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleRemoveAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
    setAttachError(null);
  };

  // ─── Form Validation ────────────────────────────────────────────────────────
  const isTitleValid = title.trim().length >= 5 && title.trim().length <= 200;
  const isDescriptionValid = description.trim().length >= 1 && description.trim().length <= 5000;
  const isSubjectValid = Boolean(selection.subjectId);
  const isFormValid = isTitleValid && isDescriptionValid && isSubjectValid;

  // ─── Submit Flow ────────────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched({ title: true, description: true, subject: true });
    setSubmitError(null);

    if (!isFormValid) return;

    const payload = studentDoubtAcademicService.buildSubmitDoubtInput(
      batchContexts,
      selection,
      {
        title,
        description,
        relatedResourceType: contextualResource?.type,
        relatedResourceId: contextualResource?.id,
      },
    );

    try {
      // Step 1: Submit Doubt via RPC
      const result = await submitMutation.mutateAsync(payload);
      const newDoubtId = result.doubtId;

      // Step 2: Upload Attachments (if any)
      if (attachments.length > 0 && instituteId) {
        setIsUploadingAttachments(true);
        let uploadFailures = 0;

        for (let i = 0; i < attachments.length; i++) {
          const file = attachments[i];
          setUploadProgressText(`Uploading attachment ${i + 1} of ${attachments.length}...`);
          const uploadRes = await doubtAttachmentService.uploadDoubtAttachment({
            file,
            instituteId,
            doubtId: newDoubtId,
          });
          if (!uploadRes.success) {
            console.error(`Failed to upload attachment ${file.name}:`, uploadRes.error);
            uploadFailures++;
          }
        }

        if (uploadFailures > 0) {
          console.warn(`${uploadFailures} of ${attachments.length} attachments failed to upload.`);
        }
      }

      // Step 3: Complete and redirect
      resetForm();
      onClose();
      router.push(`/student/doubts/${newDoubtId}`);
    } catch (err: any) {
      setSubmitError(doubtErrorMessage(err?.message ?? 'Failed to submit doubt.'));
    } finally {
      setIsUploadingAttachments(false);
      setUploadProgressText(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="ask-doubt-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 md:p-6 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200"
    >
      {/* Backdrop Click Dismiss */}
      <div
        className="fixed inset-0"
        onClick={handleSafeClose}
        aria-hidden="true"
      />

      {/* Modal Dialog Card */}
      <div className="relative w-full max-w-2xl max-h-[92vh] flex flex-col rounded-3xl bg-white shadow-2xl border border-slate-200/90 overflow-hidden z-10">
        {/* ─── Header ──────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 py-4.5 border-b border-slate-100 bg-gradient-to-r from-sky-50/60 via-white to-slate-50">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-sky-500 text-white font-bold shadow-xs">
              <ChatCircleDots size={22} weight="duotone" />
            </div>
            <div>
              <h2 id="ask-doubt-title" className="text-base font-extrabold text-slate-900 leading-tight">
                Ask a Doubt
              </h2>
              <p className="text-xs text-slate-500 mt-0.5 font-medium">
                Get step-by-step guidance from expert faculty
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleSafeClose}
            disabled={submitMutation.isPending || isUploadingAttachments}
            className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors disabled:opacity-50"
            aria-label="Close modal"
          >
            <X size={18} weight="bold" />
          </button>
        </div>

        {/* ─── Body (Scrollable) ───────────────────────────────────────────── */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Error Banner */}
          {submitError && (
            <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 flex items-start gap-3">
              <WarningCircle size={20} weight="duotone" className="text-rose-600 shrink-0 mt-0.5" />
              <div className="text-xs text-rose-700 leading-relaxed">
                <p className="font-bold text-rose-900">Submission Error</p>
                <p>{submitError}</p>
              </div>
            </div>
          )}

          {/* Contextual Resource Chip (with Detach action) */}
          {contextualResource && (
            <div className="p-3.5 rounded-2xl bg-indigo-50/80 border border-indigo-200 flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 font-bold text-indigo-950">
                <Sparkle size={16} weight="fill" className="text-indigo-600 shrink-0" />
                <span>Context:</span>
                <span className="text-indigo-700 font-semibold">
                  {getDoubtResourceDisplay(contextualResource.type).label}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setContextualResource(null)}
                className="text-[11px] font-bold text-slate-500 hover:text-rose-600 hover:bg-rose-50 px-2 py-1 rounded-lg transition-colors flex items-center gap-1"
                title="Detach resource from this doubt"
              >
                <X size={12} weight="bold" />
                <span>Detach Context</span>
              </button>
            </div>
          )}

          {/* ─── 1. Academic Hierarchy Selectors ────────────────────────────── */}
          <div className="p-4.5 rounded-2xl bg-slate-50/80 border border-slate-200/80 space-y-3.5">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                <GraduationCap size={16} weight="duotone" className="text-sky-600" />
                <span>Academic Details</span>
              </h3>
              <span className="text-[11px] font-medium text-slate-400">
                * Subject is required
              </span>
            </div>

            {/* Course / Batch selector (shown when multiple active batches exist) */}
            {studentDoubtAcademicService.needsBatchSelector(batchContexts) && (
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700">Course / Batch</label>
                <select
                  value={selection.batchId ?? ''}
                  onChange={(e) =>
                    setSelection((prev) =>
                      studentDoubtAcademicService.selectBatch(prev, e.target.value || null),
                    )
                  }
                  className="w-full h-10 px-3 rounded-xl bg-white border border-slate-200 text-xs font-medium text-slate-800 outline-none focus:border-sky-500 transition-colors"
                >
                  <option value="">Choose your course/batch...</option>
                  {batchContexts.map((ctx) => (
                    <option key={ctx.batchId} value={ctx.batchId}>
                      {studentDoubtAcademicService.batchOptionLabel(ctx)}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Subject Selector */}
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700 flex items-center justify-between">
                <span>Subject *</span>
                {touched.subject && !selection.subjectId && (
                  <span className="text-[11px] font-medium text-rose-500">Subject is required</span>
                )}
              </label>
              <select
                value={selection.subjectId ?? ''}
                onChange={(e) => {
                  setTouched((prev) => ({ ...prev, subject: true }));
                  setSelection((prev) =>
                    studentDoubtAcademicService.selectSubject(prev, e.target.value || null),
                  );
                }}
                disabled={isContextsLoading}
                className={`w-full h-10 px-3 rounded-xl bg-white border text-xs font-medium outline-none transition-colors ${
                  touched.subject && !selection.subjectId
                    ? 'border-rose-300 focus:border-rose-500'
                    : 'border-slate-200 focus:border-sky-500 text-slate-800'
                }`}
              >
                <option value="">Select a Subject...</option>
                {availableSubjects.map((sub) => (
                  <option key={sub.batchSubjectId} value={sub.subjectId}>
                    {sub.subjectName} {sub.subjectCode ? `(${sub.subjectCode})` : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* Chapter & Topic Selectors */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Chapter */}
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                  <BookOpen size={14} className="text-slate-400" />
                  <span>Chapter (Optional)</span>
                </label>
                <select
                  value={selection.chapterId ?? ''}
                  onChange={(e) =>
                    setSelection((prev) =>
                      studentDoubtAcademicService.selectChapter(prev, e.target.value || null),
                    )
                  }
                  disabled={!selection.subjectId || isChaptersLoading}
                  className="w-full h-10 px-3 rounded-xl bg-white border border-slate-200 text-xs font-medium text-slate-800 outline-none focus:border-sky-500 transition-colors disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed"
                >
                  <option value="">
                    {!selection.subjectId
                      ? 'Select subject first'
                      : isChaptersLoading
                      ? 'Loading chapters...'
                      : chapters.length === 0
                      ? 'No chapters found'
                      : 'Choose chapter (optional)'}
                  </option>
                  {chapters.map((ch) => (
                    <option key={ch.chapterId} value={ch.chapterId}>
                      {ch.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Topic */}
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                  <Folder size={14} className="text-slate-400" />
                  <span>Topic (Optional)</span>
                </label>
                <select
                  value={selection.topicId ?? ''}
                  onChange={(e) =>
                    setSelection((prev) =>
                      studentDoubtAcademicService.selectTopic(prev, e.target.value || null),
                    )
                  }
                  disabled={!selection.chapterId || isTopicsLoading}
                  className="w-full h-10 px-3 rounded-xl bg-white border border-slate-200 text-xs font-medium text-slate-800 outline-none focus:border-sky-500 transition-colors disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed"
                >
                  <option value="">
                    {!selection.chapterId
                      ? 'Select chapter first'
                      : isTopicsLoading
                      ? 'Loading topics...'
                      : topics.length === 0
                      ? 'No topics found'
                      : 'Choose topic (optional)'}
                  </option>
                  {topics.map((tp) => (
                    <option key={tp.topicId} value={tp.topicId}>
                      {tp.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* ─── 2. Question Title ─────────────────────────────────────────── */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor="doubt-title-input" className="text-xs font-bold text-slate-800">
                Doubt Title *
              </label>
              <span
                className={`text-[11px] font-medium ${
                  title.length > 200 ? 'text-rose-500 font-bold' : 'text-slate-400'
                }`}
              >
                {title.length} / 200
              </span>
            </div>
            <input
              id="doubt-title-input"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => setTouched((p) => ({ ...p, title: true }))}
              placeholder="e.g. Clarification on Lenz law sign convention in magnetic flux..."
              maxLength={200}
              className={`w-full h-11 px-4 rounded-xl text-xs sm:text-sm font-medium outline-none border transition-colors ${
                touched.title && !isTitleValid
                  ? 'border-rose-300 bg-rose-50/20 focus:border-rose-500'
                  : 'border-slate-200 bg-slate-50 focus:bg-white focus:border-sky-500 text-slate-900'
              }`}
            />
            {touched.title && !isTitleValid && (
              <p className="text-[11px] font-medium text-rose-500">
                Title must be between 5 and 200 characters.
              </p>
            )}
          </div>

          {/* ─── 3. Detailed Description ───────────────────────────────────── */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor="doubt-desc-input" className="text-xs font-bold text-slate-800">
                Detailed Question / Description *
              </label>
              <span
                className={`text-[11px] font-medium ${
                  description.length > 5000 ? 'text-rose-500 font-bold' : 'text-slate-400'
                }`}
              >
                {description.length} / 5000
              </span>
            </div>
            <textarea
              id="doubt-desc-input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={() => setTouched((p) => ({ ...p, description: true }))}
              placeholder="Describe your question in detail. Mention what step or formula you find confusing..."
              rows={4}
              maxLength={5000}
              className={`w-full p-4 rounded-2xl text-xs sm:text-sm font-medium outline-none border resize-none font-sans transition-colors ${
                touched.description && !isDescriptionValid
                  ? 'border-rose-300 bg-rose-50/20 focus:border-rose-500'
                  : 'border-slate-200 bg-slate-50 focus:bg-white focus:border-sky-500 text-slate-900'
              }`}
            />
            {touched.description && !isDescriptionValid && (
              <p className="text-[11px] font-medium text-rose-500">
                Please enter a detailed description of your doubt.
              </p>
            )}
          </div>

          {/* ─── 4. File Attachments Uploader ──────────────────────────────── */}
          <div className="space-y-2 pt-1">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                <UploadSimple size={15} weight="bold" className="text-sky-600" />
                <span>Attachments (Optional)</span>
              </label>
              <span className="text-[11px] text-slate-400 font-medium">
                JPEG, PNG, WEBP, PDF (Max 25MB, up to 5 files)
              </span>
            </div>

            {/* Hidden Input */}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf"
              onChange={handleFileSelect}
              className="hidden"
            />

            {/* Trigger Button */}
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-slate-200 hover:border-sky-400 rounded-2xl p-4.5 text-center cursor-pointer bg-slate-50/60 hover:bg-sky-50/40 transition-colors"
            >
              <div className="flex flex-col items-center gap-1.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-sky-600 border border-slate-200/80 shadow-2xs">
                  <UploadSimple size={18} weight="bold" />
                </div>
                <p className="text-xs font-bold text-slate-800">
                  Click to upload photos or PDF notes
                </p>
                <p className="text-[11px] text-slate-400">
                  Drag and drop files here or browse from your device
                </p>
              </div>
            </div>

            {attachError && (
              <p className="text-xs font-medium text-rose-600 mt-1">
                {attachError}
              </p>
            )}

            {/* Attachment Chips List */}
            {attachments.length > 0 && (
              <div className="space-y-2 pt-1">
                {attachments.map((file, idx) => {
                  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
                  return (
                    <div
                      key={idx}
                      className="flex items-center justify-between p-2.5 px-3.5 rounded-xl bg-white border border-slate-200 shadow-2xs"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div
                          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                            isPdf ? 'bg-rose-50 text-rose-600' : 'bg-sky-50 text-sky-600'
                          }`}
                        >
                          {isPdf ? (
                            <FilePdf size={16} weight="duotone" />
                          ) : (
                            <ImageIcon size={16} weight="duotone" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-slate-800 truncate">
                            {file.name}
                          </p>
                          <p className="text-[10px] text-slate-400 font-medium">
                            {formatFileSize(file.size)}
                          </p>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleRemoveAttachment(idx)}
                        disabled={submitMutation.isPending || isUploadingAttachments}
                        className="p-1 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors shrink-0"
                        title="Remove file"
                      >
                        <Trash size={15} weight="bold" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </form>

        {/* ─── Footer Action Bar ───────────────────────────────────────────── */}
        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={handleSafeClose}
            disabled={submitMutation.isPending || isUploadingAttachments}
            className="px-4 py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 text-xs font-bold text-slate-700 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>

          <div className="flex items-center gap-3">
            {uploadProgressText && (
              <span className="text-xs font-semibold text-sky-700 flex items-center gap-1.5 animate-pulse">
                <SpinnerGap size={14} className="animate-spin" />
                <span>{uploadProgressText}</span>
              </span>
            )}

            <button
              type="button"
              onClick={handleSubmit}
              disabled={!isFormValid || submitMutation.isPending || isUploadingAttachments}
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 active:bg-sky-800 text-white font-bold text-xs shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:shadow-md hover:-translate-y-0.5"
            >
              {submitMutation.isPending || isUploadingAttachments ? (
                <>
                  <SpinnerGap size={15} className="animate-spin" />
                  <span>
                    {isUploadingAttachments ? 'Uploading Files...' : 'Submitting Doubt...'}
                  </span>
                </>
              ) : (
                <>
                  <ChatCircleDots size={16} weight="bold" />
                  <span>Submit Doubt</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
