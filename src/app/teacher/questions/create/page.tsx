'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useCreateQuestion } from '@/hooks/mockTest/useQuestions';
import { useSubjects } from '@/hooks/academic/useSubjects';
import { useChapters } from '@/hooks/academic/useChapters';
import { useTopics } from '@/hooks/academic/useTopics';
import { useAuth } from '@/context/AuthContext';
import { PageHeader } from '@/components/ui/PageHeader';
import { QuestionForm, type QuestionFormData } from '@/features/question-bank/components/QuestionForm';
import { AddSubjectModal } from '@/features/question-bank/components/AddSubjectModal';
import { AddChapterModal } from '@/features/question-bank/components/AddChapterModal';
import { AddTopicModal } from '@/features/question-bank/components/AddTopicModal';
import type { QuestionType, DifficultyLevel } from '@/types/mockTest';
import type { Chapter, Subject, Topic } from '@/types/academic';

const INITIAL_FORM: QuestionFormData = {
  subjectId: '',
  chapterId: '',
  topicId: '',
  questionType: 'mcq' as QuestionType,
  difficulty: '' as DifficultyLevel,
  status: 'draft',
  questionText: '',
  marks: '4',
  negativeMarks: '1',
  options: [
    { id: 'opt-init-1', optionText: '', isCorrect: false, orderSequence: 1, images: [] },
    { id: 'opt-init-2', optionText: '', isCorrect: false, orderSequence: 2, images: [] },
  ],
  explanationText: '',
  explanationVideoUrl: '',
  correctNumericalAnswer: '',
  numericalTolerance: '',
  correctTextAnswer: '',
  images: [],
};

export default function CreateQuestionPage() {
  const router = useRouter();
  const { teacherProfile, instituteId } = useAuth();
  const { mutate: createQuestion, isPending } = useCreateQuestion();

  const [formData, setFormData] = useState<QuestionFormData>(INITIAL_FORM);
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
    setFormData((prev) => ({ ...prev, subjectId: newSubject.subjectId }));
    setAddSubjectFeedback({
      type: 'success',
      message: `✓ Subject "${newSubject.name}" created successfully.`,
    });
    setTimeout(() => setAddSubjectFeedback(null), 4000);
  }, []);

  const { data: chaptersData, isLoading: loadingChapters } = useChapters(
    formData.subjectId ? { subjectId: formData.subjectId } : undefined,
  );
  const chapters = (chaptersData?.data ?? []).map((c) => ({ value: c.chapterId, label: c.name }));
  const rawChapters: Chapter[] = chaptersData?.data ?? [];

  const handleChapterCreated = useCallback((newChapter: Chapter) => {
    setShowAddChapter(false);
    setFormData((prev) => ({ ...prev, chapterId: newChapter.chapterId, topicId: '' }));
    setAddSubjectFeedback({
      type: 'success',
      message: `✓ Chapter "${newChapter.name}" created successfully.`,
    });
    setTimeout(() => setAddSubjectFeedback(null), 4000);
  }, []);

  const { data: topicsData, isLoading: loadingTopics } = useTopics(
    formData.chapterId ? { chapterId: formData.chapterId } : undefined,
  );
  const topics = (topicsData?.data ?? []).map((t) => ({ value: t.topicId, label: t.name }));
  const rawTopics: Topic[] = topicsData?.data ?? [];

  const handleTopicCreated = useCallback((newTopic: Topic) => {
    setShowAddTopic(false);
    setFormData((prev) => ({ ...prev, topicId: newTopic.topicId }));
    setAddSubjectFeedback({
      type: 'success',
      message: `✓ Topic "${newTopic.name}" created successfully.`,
    });
    setTimeout(() => setAddSubjectFeedback(null), 4000);
  }, []);

  const validate = useCallback((): boolean => {
    const errs: Record<string, string> = {};
    if (!formData.subjectId) errs.subjectId = 'Subject is required';
    if (!formData.chapterId) errs.chapterId = 'Chapter is required';
    if (!formData.difficulty) errs.difficulty = 'Difficulty is required';
    if (!formData.questionText?.trim()) errs.questionText = 'Question text is required';
    else if (formData.questionText.trim().length < 10) errs.questionText = 'Question text must be at least 10 characters';
    if (!formData.marks || Number(formData.marks) <= 0) errs.marks = 'Marks must be greater than 0';

    if (formData.questionType !== 'numerical' && formData.questionType !== 'text_based' && formData.questionType !== 'subjective') {
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

    if (formData.questionType === 'text_based' && !formData.correctTextAnswer?.trim()) {
      errs.explanationText = 'Accepted text answer is required';
    }

    // subjective: model answer is optional, no validation needed

    setErrors(errs);
    return Object.keys(errs).length === 0;
  }, [formData]);

  const handleSave = useCallback(
    (status: 'draft' | 'pending_approval') => {
      if (!validate()) return;
      if (!teacherProfile?.id) {
        setSaveError('Teacher profile not found. Please log in again.');
        return;
      }

      if (!instituteId) {
        setSaveError('Institute not found. Please contact your administrator.');
        return;
      }

      setSaveError(null);

      // Build options payload with image files (only for non-numerical / non-text types)
      const optionsPayload = formData.questionType !== 'numerical' && formData.questionType !== 'text_based' && formData.questionType !== 'subjective'
        ? formData.options
            .filter((o) => o.optionText.trim() || (o.images ?? []).length > 0)
            .map((o) => ({
              optionText: o.optionText,
              isCorrect: o.isCorrect,
              orderSequence: o.orderSequence,
              images: (o.images ?? []).map((img) => ({
                file: img.file!,
                altText: img.altText || null,
              })),
            }))
        : undefined;

      createQuestion(
        {
          instituteId,
          subjectId: formData.subjectId,
          chapterId: formData.chapterId,
          createdBy: teacherProfile.id,
          questionType: formData.questionType,
          difficulty: formData.difficulty as DifficultyLevel,
          status,
          questionText: formData.questionText.trim(),
          marks: Number(formData.marks) || 1,
          negativeMarks: Number(formData.negativeMarks) || 0,
          options: optionsPayload && optionsPayload.length > 0 ? optionsPayload : undefined,
          images: formData.images.length > 0
            ? formData.images.map((img, index) => ({
                file: img.file!,
                imageRole: img.imageRole,
                altText: img.altText || null,
                displayOrder: index + 1,
              }))
            : undefined,
          // Pass explanation fields so they are written to question_explanations
          // during creation (not just on the Edit page).
          explanationText: formData.explanationText?.trim() || null,
          explanationVideoUrl: formData.explanationVideoUrl?.trim() || null,
          correctNumericalAnswer: formData.correctNumericalAnswer
            ? Number(formData.correctNumericalAnswer)
            : null,
          numericalTolerance: formData.numericalTolerance
            ? Number(formData.numericalTolerance)
            : null,
          correctTextAnswer: formData.correctTextAnswer?.trim() || null,
        },
        {
          onSuccess: (question) => {
            router.push(`/teacher/questions/${question.questionId}/edit`);
          },
          onError: (error) => {
            setSaveError(error.message);
          },
        },
      );
    },
    [formData, teacherProfile, instituteId, createQuestion, router, validate],
  );

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Create Question"
        description="Add a new question to the question bank"
        breadcrumbs={[
          { label: 'Question Bank', href: '/teacher/questions' },
          { label: 'Create Question' },
        ]}
        actions={
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => handleSave('draft')}
              disabled={isPending}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300"
            >
              Save as Draft
            </button>
            <button
              type="button"
              onClick={() => handleSave('pending_approval')}
              disabled={isPending}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700 disabled:opacity-50"
            >
              {isPending ? 'Saving...' : 'Submit for Approval'}
            </button>
          </div>
        }
      />

      {saveError && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
          {saveError}
        </div>
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
        subjectId={formData.subjectId}
        existingChapters={rawChapters}
        onClose={() => setShowAddChapter(false)}
        onCreated={handleChapterCreated}
      />

      <AddTopicModal
        isOpen={showAddTopic}
        chapterId={formData.chapterId}
        existingTopics={rawTopics}
        onClose={() => setShowAddTopic(false)}
        onCreated={handleTopicCreated}
      />

      <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
        <QuestionForm
          subjects={subjects}
          chapters={chapters}
          topics={topics}
          loadingSubjects={loadingSubjects}
          loadingChapters={loadingChapters}
          loadingTopics={loadingTopics}
          onSubjectChange={() => {}}
          onChapterChange={() => {}}
          onAddSubject={() => setShowAddSubject(true)}
          onAddChapter={() => setShowAddChapter(true)}
          onAddTopic={() => setShowAddTopic(true)}
          data={formData}
          onChange={setFormData}
          errors={errors}
        />
      </div>
    </div>
  );
}
