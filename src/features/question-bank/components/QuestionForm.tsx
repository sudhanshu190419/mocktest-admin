'use client';

import { useState, useCallback, useEffect } from 'react';
import { Select } from '@/components/ui/Select';
import { OptionEditor } from './OptionEditor';
import { ExplanationEditor } from './ExplanationEditor';
import { ImageUploader } from './ImageUploader';
import type { QuestionType, DifficultyLevel, QuestionStatus } from '@/types/mockTest';

export interface OptionImageEntry {
  id: string;
  file?: File;
  preview: string;
  altText: string;
}

export interface FormOption {
  id: string;
  optionText: string;
  isCorrect: boolean;
  orderSequence: number;
  /** Images associated with this option. Optional for backward compatibility with existing callers (e.g. Edit page). Defaults to [] when not provided. */
  images?: OptionImageEntry[];
}

export interface QuestionFormData {
  subjectId: string;
  chapterId: string;
  topicId: string;
  questionType: QuestionType;
  difficulty: DifficultyLevel;
  status: QuestionStatus;
  questionText: string;
  marks: string;
  negativeMarks: string;
  options: FormOption[];
  explanationText: string;
  explanationVideoUrl: string;
  correctNumericalAnswer: string;
  numericalTolerance: string;
  images: Array<{
    id: string;
    file?: File;
    preview: string;
    imageRole: string;
    altText: string;
  }>;
}

interface AcademicOption {
  value: string;
  label: string;
}

interface QuestionFormProps {
  subjects: AcademicOption[];
  chapters: AcademicOption[];
  topics: AcademicOption[];
  loadingSubjects: boolean;
  loadingChapters: boolean;
  loadingTopics: boolean;
  onSubjectChange: (subjectId: string) => void;
  onChapterChange: (chapterId: string) => void;
  data: QuestionFormData;
  onChange: (data: QuestionFormData) => void;
  errors?: Record<string, string>;
  isEditing?: boolean;
  /** Callback invoked when the user clicks \"+ Add New Subject\" in the dropdown. */
  onAddSubject?: () => void;
  /** Callback invoked when the user clicks \"+ Add New Chapter\" in the dropdown. */
  onAddChapter?: () => void;
  /** Callback invoked when the user clicks \"+ Add New Topic\" in the dropdown. */
  onAddTopic?: () => void;
}

const QUESTION_TYPES: { value: string; label: string }[] = [
  { value: 'mcq', label: 'Multiple Choice (Single)' },
  { value: 'msq', label: 'Multiple Choice (Multi)' },
  { value: 'numerical', label: 'Numerical' },
  { value: 'true_false', label: 'True / False' },
];

const DIFFICULTIES: { value: string; label: string }[] = [
  { value: 'easy', label: 'Easy' },
  { value: 'medium', label: 'Medium' },
  { value: 'hard', label: 'Hard' },
];

const STATUSES: { value: string; label: string }[] = [
  { value: 'draft', label: 'Draft' },
  { value: 'pending_approval', label: 'Pending Approval' },
];

const defaultOptions = (type: QuestionType) => {
  const base: FormOption = { id: '', optionText: '', isCorrect: false, orderSequence: 0, images: [] };
  if (type === 'true_false') {
    return [
      { ...base, id: 'tf-true', optionText: 'True', orderSequence: 1 },
      { ...base, id: 'tf-false', optionText: 'False', orderSequence: 2 },
    ];
  }
  return [
    { ...base, id: `opt-${Date.now()}-1`, orderSequence: 1 },
    { ...base, id: `opt-${Date.now()}-2`, orderSequence: 2 },
  ];
};

export function QuestionForm({
  subjects,
  chapters,
  topics,
  loadingSubjects,
  loadingChapters,
  loadingTopics,
  onSubjectChange,
  onChapterChange,
  onAddSubject,
  onAddChapter,
  onAddTopic,
  data,
  onChange,
  errors = {},
  isEditing,
}: QuestionFormProps) {
  const handleFieldChange = useCallback(
    <K extends keyof QuestionFormData>(field: K, value: QuestionFormData[K]) => {
      onChange({ ...data, [field]: value });
    },
    [data, onChange],
  );

  // When question type changes, reset options to defaults
  const handleTypeChange = useCallback(
    (type: string) => {
      const qType = type as QuestionType;
      const updates: Partial<QuestionFormData> = {
        questionType: qType,
        options: defaultOptions(qType),
      };
      // Clear numerical fields if not numerical
      if (qType !== 'numerical') {
        updates.correctNumericalAnswer = '';
        updates.numericalTolerance = '';
      }
      onChange({ ...data, ...updates });
    },
    [data, onChange],
  );

  // Initialize options for true_false on first render
  useEffect(() => {
    if (data.questionType === 'true_false' && data.options.length === 0) {
      handleTypeChange('true_false');
    }
  }, []);

  return (
    <div className="space-y-6">
      {/* Subject & Chapter & Topic */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Subject <span className="text-red-500">*</span>
          </label>
          <select
            value={data.subjectId}
            onChange={(e) => {
              if (e.target.value === '__add_new__') {
                onAddSubject?.();
                return;
              }
              handleFieldChange('subjectId', e.target.value);
              onSubjectChange(e.target.value);
            }}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
          >
            <option value="">Select subject...</option>
            {subjects.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
            <option disabled className="border-t border-gray-200" value="__divider__">──────────────</option>
            <option value="__add_new__" className="font-medium text-blue-600 dark:text-blue-400">
              + Add New Subject
            </option>
          </select>
          {errors.subjectId && <p className="text-xs text-red-500">{errors.subjectId}</p>}
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Chapter <span className="text-red-500">*</span>
          </label>
          <select
            value={data.chapterId}
            onChange={(e) => {
              if (e.target.value === '__add_new_chapter__') {
                onAddChapter?.();
                return;
              }
              handleFieldChange('chapterId', e.target.value);
              onChapterChange(e.target.value);
            }}
            disabled={!data.subjectId || loadingChapters}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
          >
            <option value="">Select chapter...</option>
            {chapters.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
            <option disabled className="border-t border-gray-200" value="__divider_ch__">──────────────</option>
            <option value="__add_new_chapter__" className="font-medium text-blue-600 dark:text-blue-400">
              + Add New Chapter
            </option>
          </select>
          {errors.chapterId && <p className="text-xs text-red-500">{errors.chapterId}</p>}
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Topic
          </label>
          <select
            value={data.topicId}
            onChange={(e) => {
              if (e.target.value === '__add_new_topic__') {
                onAddTopic?.();
                return;
              }
              handleFieldChange('topicId', e.target.value);
            }}
            disabled={!data.chapterId || loadingTopics}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
          >
            <option value="">Select topic...</option>
            {topics.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
            <option disabled className="border-t border-gray-200" value="__divider_topic__">──────────────</option>
            <option value="__add_new_topic__" className="font-medium text-blue-600 dark:text-blue-400">
              + Add New Topic
            </option>
          </select>
        </div>
      </div>

      {/* Type & Difficulty & Status */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Question Type <span className="text-red-500">*</span>
          </label>
          <select
            value={data.questionType}
            onChange={(e) => handleTypeChange(e.target.value)}
            disabled={isEditing}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
          >
            {QUESTION_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
          {errors.questionType && <p className="text-xs text-red-500">{errors.questionType}</p>}
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Difficulty <span className="text-red-500">*</span>
          </label>
          <select
            value={data.difficulty}
            onChange={(e) => handleFieldChange('difficulty', e.target.value as DifficultyLevel)}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
          >
            <option value="">Select difficulty...</option>
            {DIFFICULTIES.map((d) => (
              <option key={d.value} value={d.value}>{d.label}</option>
            ))}
          </select>
          {errors.difficulty && <p className="text-xs text-red-500">{errors.difficulty}</p>}
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Status</label>
          <select
            value={data.status}
            onChange={(e) => handleFieldChange('status', e.target.value as QuestionStatus)}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
          >
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Question Text */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
          Question Text <span className="text-red-500">*</span>
        </label>
        <textarea
          value={data.questionText}
          onChange={(e) => handleFieldChange('questionText', e.target.value)}
          placeholder="Write the question stem here..."
          rows={4}
          className="w-full resize-y rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
        />
        {errors.questionText && <p className="text-xs text-red-500">{errors.questionText}</p>}
      </div>

      {/* Marks & Negative Marks */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Marks <span className="text-red-500">*</span>
          </label>
          <input
            type="number"
            min="1"
            step="0.5"
            value={data.marks}
            onChange={(e) => handleFieldChange('marks', e.target.value)}
            placeholder="e.g. 4"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
          />
          {errors.marks && <p className="text-xs text-red-500">{errors.marks}</p>}
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Negative Marks
          </label>
          <input
            type="number"
            min="0"
            step="0.5"
            value={data.negativeMarks}
            onChange={(e) => handleFieldChange('negativeMarks', e.target.value)}
            placeholder="e.g. 1 (0 = no negative)"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
          />
        </div>
      </div>

      {/* Options (for MCQ, MSQ, True/False) */}
      {data.questionType !== 'numerical' && (
        <OptionEditor
          options={data.options}
          questionType={data.questionType}
          onChange={(options) => handleFieldChange('options', options)}
          error={errors.options}
        />
      )}

      {/* Explanation */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
          Explanation & Solution
        </h3>
        <ExplanationEditor
          data={{
            explanationText: data.explanationText,
            explanationVideoUrl: data.explanationVideoUrl,
            correctNumericalAnswer: data.correctNumericalAnswer,
            numericalTolerance: data.numericalTolerance,
          }}
          questionType={data.questionType}
          onChange={(ed) => {
            // Merge all 4 fields into a single state update.
            // Calling handleFieldChange 4 times sequentially would be batched
            // by React, each starting from the same base `data` object, so
            // only the last call's change would survive (the others get
            // overwritten). A single call preserves all changes atomically.
            onChange({
              ...data,
              explanationText: ed.explanationText,
              explanationVideoUrl: ed.explanationVideoUrl,
              correctNumericalAnswer: ed.correctNumericalAnswer,
              numericalTolerance: ed.numericalTolerance,
            });
          }}
        />
        {errors.explanationText && <p className="text-xs text-red-500">{errors.explanationText}</p>}
      </div>

      {/* Images */}
      <ImageUploader
        images={data.images}
        onAdd={(files) => {
          const newImages = Array.from(files).map((file, i) => ({
            id: `img-${Date.now()}-${i}`,
            file,
            preview: URL.createObjectURL(file),
            imageRole: 'question' as const,
            altText: '',
          }));
          handleFieldChange('images', [...data.images, ...newImages]);
        }}
        onRemove={(id) => {
          const img = data.images.find((i) => i.id === id);
          if (img) URL.revokeObjectURL(img.preview);
          handleFieldChange('images', data.images.filter((i) => i.id !== id));
        }}
        onRoleChange={(id, role) => {
          handleFieldChange(
            'images',
            data.images.map((i) => (i.id === id ? { ...i, imageRole: role } : i)),
          );
        }}
        onAltTextChange={(id, altText) => {
          handleFieldChange(
            'images',
            data.images.map((i) => (i.id === id ? { ...i, altText } : i)),
          );
        }}
      />
    </div>
  );
}
