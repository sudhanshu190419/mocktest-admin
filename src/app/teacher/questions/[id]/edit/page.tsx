'use client';

import { useState, useCallback, useEffect, use, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useQuestion, useUpdateQuestion, usePublishQuestion, useArchiveQuestion, useRestoreQuestion, useDeleteQuestion } from '@/hooks/mockTest/useQuestions';
import { useQuestionOptions, useReplaceQuestionOptions } from '@/hooks/mockTest/useQuestionOptions';
import { useQuestionExplanation, useUpsertQuestionExplanation } from '@/hooks/mockTest/useQuestionExplanations';
import { useQuestionImages } from '@/hooks/mockTest/useQuestionImages';
import { useSubjects } from '@/hooks/academic/useSubjects';
import { useChapters } from '@/hooks/academic/useChapters';
import { useTopics } from '@/hooks/academic/useTopics';
import { supabase } from '@/config/supabase';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { QuestionForm, type QuestionFormData } from '@/features/question-bank/components/QuestionForm';
import { AddSubjectModal } from '@/features/question-bank/components/AddSubjectModal';
import { AddChapterModal } from '@/features/question-bank/components/AddChapterModal';
import { AddTopicModal } from '@/features/question-bank/components/AddTopicModal';
import type { DifficultyLevel, QuestionOption } from '@/types/mockTest';
import type { Chapter, Subject, Topic } from '@/types/academic';
import { deleteQuestionImage, uploadQuestionImage } from '@/services/mockTest/questionImageService';
import { deleteOptionImage, uploadOptionImage } from '@/services/questionOptionImageService';

export default function EditQuestionPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const { id: questionId } = use(params);

  const { data: question, isLoading: loadingQuestion, isError } = useQuestion(questionId);
  const { data: options } = useQuestionOptions(questionId);
  const { data: explanation } = useQuestionExplanation(questionId);
  const { data: stemImages } = useQuestionImages(questionId);

  const { mutateAsync: updateQuestionAsync, isPending: isUpdating } = useUpdateQuestion();
  const { mutateAsync: replaceOptionsAsync, isPending: isReplacingOptions } = useReplaceQuestionOptions();
  const { mutateAsync: upsertExplanationAsync, isPending: isUpsertingExplanation } = useUpsertQuestionExplanation();
  const { mutate: publishQuestion, isPending: isPublishing } = usePublishQuestion();
  const { mutate: archiveQuestion } = useArchiveQuestion();
  const { mutate: restoreQuestion } = useRestoreQuestion();

  const isSaving = isUpdating || isReplacingOptions || isUpsertingExplanation;

  // ── Refs for computing image diffs at save time ──────────────────────
  // Populated in loadImages() when formData is populated from DB.
  const originalStemImageIdsRef = useRef<Set<string>>(new Set());
  const originalOptionImageIdsByOptionRef = useRef<Record<string, Set<string>>>({});

  const [formData, setFormData] = useState<QuestionFormData | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<string | null>(null);

  // ── Subject creation modal ──────────────────────────────────────────────
  const [showAddSubject, setShowAddSubject] = useState(false);
  const [showAddChapter, setShowAddChapter] = useState(false);
  const [showAddTopic, setShowAddTopic] = useState(false);
  const [addSubjectFeedback, setAddSubjectFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  const { data: subjectsData, isLoading: loadingSubjects } = useSubjects();
  const subjects = (subjectsData?.data ?? []).map((s) => ({ value: s.subjectId, label: s.name }));
  const rawSubjects: Subject[] = subjectsData?.data ?? [];

  const handleSubjectCreated = useCallback((newSubject: Subject) => {
    setShowAddSubject(false);
    setFormData((prev) =>
      prev ? { ...prev, subjectId: newSubject.subjectId, chapterId: '', topicId: '' } : prev,
    );
    setAddSubjectFeedback({
      type: 'success',
      message: `✓ Subject "${newSubject.name}" created successfully.`,
    });
    setTimeout(() => setAddSubjectFeedback(null), 4000);
  }, []);

  const { data: chaptersData, isLoading: loadingChapters } = useChapters(
    formData?.subjectId ? { subjectId: formData.subjectId } : undefined,
  );
  const chapters = (chaptersData?.data ?? []).map((c) => ({ value: c.chapterId, label: c.name }));
  const rawChapters: Chapter[] = chaptersData?.data ?? [];

  const handleChapterCreated = useCallback((newChapter: Chapter) => {
    setShowAddChapter(false);
    setFormData((prev) =>
      prev ? { ...prev, chapterId: newChapter.chapterId, topicId: '' } : prev,
    );
    setAddSubjectFeedback({
      type: 'success',
      message: `✓ Chapter "${newChapter.name}" created successfully.`,
    });
    setTimeout(() => setAddSubjectFeedback(null), 4000);
  }, []);

  const { data: topicsData, isLoading: loadingTopics } = useTopics(
    formData?.chapterId ? { chapterId: formData.chapterId } : undefined,
  );
  const topics = (topicsData?.data ?? []).map((t) => ({ value: t.topicId, label: t.name }));
  const rawTopics: Topic[] = topicsData?.data ?? [];

  const handleTopicCreated = useCallback((newTopic: Topic) => {
    setShowAddTopic(false);
    setFormData((prev) =>
      prev ? { ...prev, topicId: newTopic.topicId } : prev,
    );
    setAddSubjectFeedback({
      type: 'success',
      message: `✓ Topic "${newTopic.name}" created successfully.`,
    });
    setTimeout(() => setAddSubjectFeedback(null), 4000);
  }, []);

  useEffect(() => {
    // Wait for ALL data sources to resolve before populating formData.
    // Guards use truthiness checks: undefined = still loading, [] = loaded with no data.
    if (!question || !stemImages || !options || formData) return;

    // Capture narrowed values for TypeScript (closures can't narrow across async boundaries)
    const q = question;
    const si = stemImages;
    const opts = options;
    const expl = explanation;

    async function loadImages() {
      // ── 1. Build stem image entries with signed URLs ────────────────────
      const stemImageEntries: QuestionFormData['images'] = [];
      if (si.length > 0) {
        for (const img of si) {
          const { data: urlData } = await supabase.storage
            .from(img.storageBucket)
            .createSignedUrl(img.storagePath, 3600);
          stemImageEntries.push({
            id: img.imageId,
            preview: urlData?.signedUrl ?? '',
            imageRole: img.imageRole,
            altText: img.altText ?? '',
          });
        }
      }

      // ── 2. Load option images in a single bulk query ────────────────────
      const optionIds = opts.map((o) => o.optionId);
      const optionImagesByOptionId: Record<
        string,
        Array<{ id: string; preview: string; altText: string }>
      > = {};

      if (optionIds.length > 0) {
        const { data: dbOptionImages, error } = await supabase
          .from('question_option_images')
          .select('*')
          .in('option_id', optionIds)
          .order('display_order', { ascending: true });

        if (!error && dbOptionImages) {
          for (const img of dbOptionImages) {
            const { data: urlData } = await supabase.storage
              .from(img.storage_bucket)
              .createSignedUrl(img.storage_path, 3600);

            const list = optionImagesByOptionId[img.option_id] ?? [];
            list.push({
              id: img.option_image_id,
              preview: urlData?.signedUrl ?? '',
              altText: img.alt_text ?? '',
            });
            optionImagesByOptionId[img.option_id] = list;
          }
        }
      }

      // ── 3. Populate formData ───────────────────────────────────────────
      originalStemImageIdsRef.current = new Set(si.map((img) => img.imageId));

      const optionImageMap: Record<string, Set<string>> = {};
      for (const opt of opts) {
        optionImageMap[opt.optionId] = new Set(
          (optionImagesByOptionId[opt.optionId] ?? []).map((i) => i.id),
        );
      }
      originalOptionImageIdsByOptionRef.current = optionImageMap;

      setFormData({
        subjectId: q.subjectId,
        chapterId: q.chapterId,
        topicId: '',
        questionType: q.questionType,
        difficulty: q.difficulty as DifficultyLevel,
        status: q.status,
        questionText: q.questionText,
        marks: String(q.marks),
        negativeMarks: String(q.negativeMarks),
        options: opts.map((o) => ({
          id: o.optionId,
          optionText: o.optionText ?? '',
          isCorrect: o.isCorrect,
          orderSequence: o.orderSequence,
          images: optionImagesByOptionId[o.optionId] ?? [],
        })),
        explanationText: expl?.explanationText ?? '',
        explanationVideoUrl: expl?.explanationVideoUrl ?? '',
        correctNumericalAnswer: expl?.correctNumericalAnswer != null ? String(expl.correctNumericalAnswer) : '',
        numericalTolerance: expl?.numericalTolerance != null ? String(expl.numericalTolerance) : '',
        images: stemImageEntries,
      });
    }

    loadImages();
  }, [question, stemImages, options, explanation, formData]);

  const [confirmAction, setConfirmAction] = useState<{ type: string } | null>(null);

  const handleSubjectChange = useCallback((subjectId: string) => {
    setFormData((prev) => prev ? { ...prev, subjectId, chapterId: '', topicId: '' } : null);
  }, []);

  const handleChapterChange = useCallback((chapterId: string) => {
    setFormData((prev) => prev ? { ...prev, chapterId, topicId: '' } : null);
  }, []);

  const handleSave = useCallback(
    async (status?: 'draft' | 'pending_approval' | 'published') => {
      if (!formData || !question) return;

      // ── Validation ──────────────────────────────────────────────────────
      const errs: Record<string, string> = {};
      if (!formData.subjectId) errs.subjectId = 'Subject is required';
      if (!formData.chapterId) errs.chapterId = 'Chapter is required';
      if (!formData.questionText?.trim()) errs.questionText = 'Question text is required';
      else if (formData.questionText.trim().length < 10) errs.questionText = 'Question text must be at least 10 characters';
      if (!formData.marks || Number(formData.marks) <= 0) errs.marks = 'Marks must be greater than 0';

      if (formData.questionType !== 'numerical') {
        const validOptions = formData.options.filter((o) => o.optionText.trim() || (o.images ?? []).length > 0);
        if (validOptions.length < 2) errs.options = 'At least 2 non-empty options required';
        const correctCount = formData.options.filter((o) => o.isCorrect).length;
        if (correctCount === 0) errs.options = 'At least one option must be marked as correct';
        if ((formData.questionType === 'mcq' || formData.questionType === 'true_false') && correctCount !== 1) {
          errs.options = `${formData.questionType === 'true_false' ? 'True/False' : 'MCQ'} questions must have exactly one correct answer`;
        }
      }

      if (formData.questionType === 'numerical' && formData.correctNumericalAnswer === '') {
        errs.explanationText = 'Correct numerical answer is required';
      }

      setErrors(errs);
      if (Object.keys(errs).length > 0) return;

      setSaveError(null);

      try {
        // Step 1: Update question metadata
        await updateQuestionAsync({
          id: questionId,
          input: {
            subjectId: formData.subjectId,
            chapterId: formData.chapterId,
            difficulty: formData.difficulty as DifficultyLevel,
            status: status ?? formData.status,
            questionText: formData.questionText.trim(),
            marks: Number(formData.marks) || 1,
            negativeMarks: Number(formData.negativeMarks) || 0,
          },
        });

        // Step 2: Replace options (only for non-numerical question types)
        let freshOptions: QuestionOption[] | undefined;
        if (formData.questionType !== 'numerical') {
          const optionsPayload = formData.options
            .filter((o) => o.optionText.trim() || (o.images ?? []).length > 0)
            .map((o) => ({
              // Pass the existing optionId so the service can UPDATE in place
              // instead of DELETE + re-INSERT. New options (temp IDs like
              // "opt-...") are filtered out by the service automatically.
              optionId: o.id,
              optionText: o.optionText,
              isCorrect: o.isCorrect,
              orderSequence: o.orderSequence,
            }));

          freshOptions = await replaceOptionsAsync({
            questionId,
            instituteId: question.instituteId,
            options: optionsPayload,
            questionType: formData.questionType,
          });
        }

        // Step 3: Upsert explanation text and numerical answer
        // Only proceed if:
        //   - An explanation row already exists (update it), OR
        //   - The teacher entered explanation text or a numerical answer (create new)
        // Skipping avoids the service error when trying to create an explanation
        // with all-empty fields for a question that has never had one.
        const hasExistingExplanation = !!explanation?.explanationId;
        const hasExplanationContent =
          !!formData.explanationText?.trim() ||
          formData.correctNumericalAnswer !== '';

        if (hasExistingExplanation || hasExplanationContent) {
          await upsertExplanationAsync({
            questionId,
            instituteId: question.instituteId,
            explanationText: formData.explanationText?.trim() || null,
            videoUrl: formData.explanationVideoUrl?.trim() || null,
            correctNumericalAnswer: formData.correctNumericalAnswer !== '' ? Number(formData.correctNumericalAnswer) : null,
            numericalTolerance: formData.numericalTolerance !== '' ? Number(formData.numericalTolerance) : null,
          });
        }

        // ═══════════════════════════════════════════════════════════════
        //  Step 4: Stem image operations
        // ═══════════════════════════════════════════════════════════════
        const currentStemImageIds = new Set(formData.images.map((i) => i.id));

        // 4a. Delete stem images that were removed from the form
        for (const origId of originalStemImageIdsRef.current) {
          if (!currentStemImageIds.has(origId)) {
            const result = await deleteQuestionImage(origId);
            if (!result.success) {
              throw new Error(`Failed to delete stem image: ${result.error}`);
            }
          }
        }

        // 4b. Upload new stem images (temp IDs starting with "img-")
        for (const img of formData.images) {
          if (img.id.startsWith('img-') && img.file) {
            const result = await uploadQuestionImage({
              questionId,
              instituteId: question.instituteId,
              file: img.file,
              imageRole: img.imageRole,
              altText: img.altText || null,
            });
            if (!result.success) {
              throw new Error(`Failed to upload stem image: ${result.error}`);
            }
          }
        }

        // ═══════════════════════════════════════════════════════════════
        //  Step 5: Option image operations
        // ═══════════════════════════════════════════════════════════════
        if (freshOptions) {
          // Map fresh options by orderSequence for ID resolution
          const freshOptionBySequence = new Map(
            freshOptions.map((o) => [o.orderSequence, o]),
          );

          for (const formOption of formData.options) {
            // Resolve the real optionId (new options get fresh UUIDs from the DB)
            const freshOption = freshOptionBySequence.get(formOption.orderSequence);
            const resolvedOptionId = freshOption?.optionId ?? formOption.id;

            const originalImgIds = originalOptionImageIdsByOptionRef.current[formOption.id] ?? new Set();
            const currentImgIds = new Set((formOption.images ?? []).map((i) => i.id));

            // 5a. Delete option images that were removed from this option
            for (const origId of originalImgIds) {
              if (!currentImgIds.has(origId)) {
                const result = await deleteOptionImage(origId);
                if (!result.success) {
                  throw new Error(`Failed to delete option image: ${result.error}`);
                }
              }
            }

            // 5b. Upload new option images (temp IDs starting with "opt-img-")
            for (const img of formOption.images ?? []) {
              if (img.id.startsWith('opt-img-') && img.file) {
                const result = await uploadOptionImage({
                  optionId: resolvedOptionId,
                  questionId,
                  instituteId: question.instituteId,
                  file: img.file,
                  altText: img.altText || null,
                });
                if (!result.success) {
                  throw new Error(`Failed to upload option image: ${result.error}`);
                }
              }
            }
          }
        }

        // Clear form data to trigger a fresh load from the database
        // (the React Query cache will be invalidated by the mutations' onSuccess handlers)
        setFormData(null);
      } catch (error: any) {
        setSaveError(error.message || 'Failed to save question.');
      }
    },
    [formData, question, explanation, questionId, updateQuestionAsync, replaceOptionsAsync, upsertExplanationAsync],
  );

  if (loadingQuestion) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-blue-600" />
      </div>
    );
  }

  if (isError || !question) {
    return (
      <div className="py-20 text-center">
        <p className="text-gray-500">Question not found</p>
        <button onClick={() => router.push('/teacher/questions/list')} className="mt-3 text-sm text-blue-600 hover:text-blue-700">Back to Question List</button>
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Edit Question"
        breadcrumbs={[
          { label: 'Question Bank', href: '/teacher/questions' },
          { label: 'All Questions', href: '/teacher/questions/list' },
          { label: 'Edit' },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge status={question.status} />
            {question.status === 'draft' && (
              <>
                <button type="button" onClick={() => handleSave('draft')} disabled={isSaving}
                  className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700">Save Draft</button>
                <button type="button" onClick={() => handleSave('pending_approval')} disabled={isSaving}
                  className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">Submit for Approval</button>
              </>
            )}
            {question.status === 'pending_approval' && (
              <>
                <button type="button" onClick={() => handleSave('draft')} disabled={isSaving}
                  className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700">Save as Draft</button>
                <button type="button" onClick={() => handleSave('pending_approval')} disabled={isSaving}
                  className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">Save Changes</button>
                <button type="button" onClick={() => publishQuestion(questionId, {
                  onError: (err) => setSaveError(err.message),
                })} disabled={isPublishing}
                  className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
                  {isPublishing ? 'Publishing...' : 'Publish'}
                </button>
              </>
            )}
            {question.status === 'published' && (
              <button type="button" onClick={() => setConfirmAction({ type: 'archive' })}
                className="rounded-lg border border-rose-200 px-3 py-1.5 text-sm font-medium text-rose-600 hover:bg-rose-50">Archive</button>
            )}
            {question.status === 'archived' && (
              <button type="button" onClick={() => restoreQuestion(questionId, {
                onError: (err) => setSaveError(err.message),
              })}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">Restore</button>
            )}
            <button type="button" onClick={() => router.push(`/teacher/questions/${questionId}/preview`)}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">Preview</button>
          </div>
        }
      />

      {saveError && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{saveError}</div>
      )}

      {addSubjectFeedback && (
        <div
          className={`mb-4 rounded-lg border px-4 py-3 text-sm ${
            addSubjectFeedback.type === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-400'
              : 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400'
          }`}
        >
          {addSubjectFeedback.message}
        </div>
      )}

      <AddSubjectModal
        isOpen={showAddSubject}
        existingSubjects={rawSubjects}
        onClose={() => setShowAddSubject(false)}
        onCreated={handleSubjectCreated}
      />

      <AddChapterModal
        isOpen={showAddChapter}
        subjectId={formData?.subjectId ?? ''}
        existingChapters={rawChapters}
        onClose={() => setShowAddChapter(false)}
        onCreated={handleChapterCreated}
      />

      <AddTopicModal
        isOpen={showAddTopic}
        chapterId={formData?.chapterId ?? ''}
        existingTopics={rawTopics}
        onClose={() => setShowAddTopic(false)}
        onCreated={handleTopicCreated}
      />

      {formData && (
        <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
          <QuestionForm
            subjects={subjects}
            chapters={chapters}
            topics={topics}
            loadingSubjects={loadingSubjects}
            loadingChapters={loadingChapters}
            loadingTopics={loadingTopics}
            onSubjectChange={handleSubjectChange}
            onChapterChange={handleChapterChange}
            onAddSubject={() => setShowAddSubject(true)}
            onAddChapter={() => setShowAddChapter(true)}
            onAddTopic={() => setShowAddTopic(true)}
            data={formData}
            onChange={setFormData}
            errors={errors}
            isEditing
          />
        </div>
      )}

      <ConfirmDialog
        open={confirmAction?.type === 'archive'}
        onClose={() => setConfirmAction(null)}
        onConfirm={() => { archiveQuestion(questionId); setConfirmAction(null); }}
        title="Archive Question"
        message="Archived questions are excluded from test composition but their data is preserved. You can restore it later."
        confirmLabel="Archive"
        variant="warning"
      />
    </div>
  );
}
