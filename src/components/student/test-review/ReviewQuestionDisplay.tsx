'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import {
  CheckCircle,
  XCircle,
  MinusCircle,
  BookOpen,
  VideoCamera,
  MagnifyingGlass,
  Sparkle,
  Question,
} from '@phosphor-icons/react';
import { createContextQueryUrl } from '@/services/student/studentDoubtAcademicService';
import type { ReviewQuestionItem } from '@/services/student/studentTestResultWebService';

interface ReviewQuestionDisplayProps {
  question: ReviewQuestionItem;
  totalQuestions: number;
  testId?: string;
  testTitle?: string;
}

export const ReviewQuestionDisplay: React.FC<ReviewQuestionDisplayProps> = ({
  question,
  totalQuestions,
  testId,
  testTitle,
}) => {
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedImage) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedImage(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedImage]);

  const askDoubtUrl = createContextQueryUrl({
    relatedResourceType: 'question',
    relatedResourceId: question.questionId,
    prefillTitle: `Question ${question.index}: Doubt in ${testTitle || 'Test Review'}`,
    subjectName: question.sectionName || undefined,
  });

  const getStatusBadge = () => {
    switch (question.status) {
      case 'correct':
        return (
          <span className="flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
            <CheckCircle size={16} weight="fill" className="text-emerald-600" />
            <span>Correct (+{question.marksAwarded})</span>
          </span>
        );
      case 'incorrect':
        return (
          <span className="flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-rose-100 text-rose-800 border border-rose-300">
            <XCircle size={16} weight="fill" className="text-rose-600" />
            <span>Incorrect ({question.negativeMarks > 0 ? `-${question.negativeMarks}` : '0'})</span>
          </span>
        );
      case 'evaluated':
        return (
          <span className="flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-teal-100 text-teal-800 border border-teal-300">
            <CheckCircle size={16} weight="fill" className="text-teal-600" />
            <span>Evaluated ({question.marksAwarded} / {question.marks})</span>
          </span>
        );
      case 'pending':
        return (
          <span className="flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-300">
            <span>Subjective Pending Review</span>
          </span>
        );
      case 'skipped':
      default:
        return (
          <span className="flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-paper text-ink border border-line">
            <MinusCircle size={16} weight="fill" className="text-ink-secondary" />
            <span>Skipped (0 marks)</span>
          </span>
        );
    }
  };

  const getOptionFeedbackClasses = (feedback: string) => {
    switch (feedback) {
      case 'selected':
        return 'bg-emerald-50 border-emerald-500 text-emerald-950 font-medium shadow-xs';
      case 'wrong':
        return 'bg-rose-50 border-rose-500 text-rose-950 font-medium shadow-xs';
      case 'correct':
        return 'bg-emerald-50/60 border-emerald-400 border-dashed text-emerald-950 font-medium';
      case 'neutral':
      default:
        return 'bg-paper border-line text-ink';
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Question Card */}
      <div className="bg-white rounded-sheet p-6 sm:p-8 border border-line shadow-sm flex flex-col gap-5">
        {/* Top Header */}
        <div className="flex items-center justify-between flex-wrap gap-2 border-b border-line pb-4">
          <div className="flex items-center gap-2">
            <span className="px-3 py-1 bg-ink text-white rounded-lg text-xs font-bold">
              Question {question.index}
            </span>
            <span className="text-xs font-semibold text-ink-secondary uppercase">
              {question.sectionName}
            </span>
            <span className="px-2 py-0.5 rounded text-caption font-bold uppercase bg-paper text-ink-secondary border border-line">
              {question.questionType.replace(/_/g, ' ')}
            </span>
          </div>

          <div className="flex items-center gap-3">
            {getStatusBadge()}
            <div className="text-xs font-bold text-ink-secondary">
              <span>{question.marks} Marks</span>
            </div>
          </div>
        </div>

        {/* Stem Text */}
        <div className="text-base sm:text-lg text-ink font-medium leading-relaxed whitespace-pre-wrap">
          {question.questionText}
        </div>

        {/* Question Image */}
        {question.questionImageUrl && (
          <div className="relative rounded-card overflow-hidden border border-line bg-paper max-w-lg">
            <Image
              src={question.questionImageUrl}
              alt={question.questionImageAlt || 'Question diagram'}
              width={600}
              height={400}
              unoptimized
              className="w-full h-auto object-contain cursor-zoom-in"
              onClick={() => setSelectedImage(question.questionImageUrl || null)}
            />
          </div>
        )}

        {/* Options for MCQ / MSQ / True-False */}
        {question.options && question.options.length > 0 && (
          <div className="flex flex-col gap-3 mt-2">
            <span className="text-xs font-bold uppercase text-ink-muted tracking-wider">Options:</span>
            {question.options.map((opt) => {
              return (
                <div
                  key={opt.id}
                  className={`p-4 rounded-card border flex items-start justify-between gap-3 transition-colors ${getOptionFeedbackClasses(
                    opt.feedback
                  )}`}
                >
                  <div className="flex items-start gap-3">
                    <span className="w-7 h-7 rounded-lg bg-white border border-line flex items-center justify-center font-bold text-xs shrink-0 mt-0.5 text-ink shadow-2xs">
                      {opt.label}
                    </span>
                    <div className="flex flex-col gap-2">
                      <span className="text-sm leading-snug">{opt.text}</span>
                      {opt.imageUrl && (
                        <div className="relative rounded-lg overflow-hidden border border-line bg-white max-w-xs">
                          <Image
                            src={opt.imageUrl}
                            alt="Option diagram"
                            width={300}
                            height={200}
                            unoptimized
                            className="w-full h-auto object-contain cursor-zoom-in"
                            onClick={() => setSelectedImage(opt.imageUrl || null)}
                          />
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Feedback Tags */}
                  <div className="shrink-0 flex items-center gap-1.5 text-xs font-bold">
                    {opt.isSelected && opt.isCorrect && (
                      <span className="flex items-center gap-1 text-emerald-700 bg-emerald-100/80 px-2 py-0.5 rounded-md">
                        <CheckCircle size={14} weight="fill" />
                        <span>Your Answer (Correct)</span>
                      </span>
                    )}
                    {opt.isSelected && !opt.isCorrect && (
                      <span className="flex items-center gap-1 text-rose-700 bg-rose-100/80 px-2 py-0.5 rounded-md">
                        <XCircle size={14} weight="fill" />
                        <span>Your Answer (Wrong)</span>
                      </span>
                    )}
                    {!opt.isSelected && opt.isCorrect && (
                      <span className="flex items-center gap-1 text-emerald-700 bg-emerald-100/80 px-2 py-0.5 rounded-md">
                        <CheckCircle size={14} weight="bold" />
                        <span>Correct Answer</span>
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Numerical Answers */}
        {question.questionType === 'numerical' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-2 p-5 rounded-card bg-paper border border-line">
            <div className="flex flex-col gap-1">
              <span className="text-xs font-bold text-ink-secondary uppercase">Your Answer:</span>
              <span className="text-lg font-mono font-bold text-ink">
                {question.studentNumericalAnswer !== null ? question.studentNumericalAnswer : 'Not Answered'}
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs font-bold text-ink-secondary uppercase">Correct Value:</span>
              <span className="text-lg font-mono font-bold text-emerald-700">
                {question.correctNumericalAnswer !== null ? question.correctNumericalAnswer : 'N/A'}
              </span>
            </div>
          </div>
        )}

        {/* Subjective / Text Answers */}
        {(question.questionType === 'subjective' || question.questionType === 'text_based') && (
          <div className="flex flex-col gap-3 mt-2">
            <div className="p-4 rounded-card bg-paper border border-line">
              <span className="text-xs font-bold text-ink-secondary uppercase block mb-1">Your Submitted Response:</span>
              <p className="text-sm text-ink whitespace-pre-wrap font-mono">
                {question.studentAnswerText || 'No response submitted.'}
              </p>
            </div>

            {question.evaluatorFeedback && (
              <div className="p-4 rounded-card bg-sky-tint border border-line">
                <span className="text-xs font-bold text-brand-hover uppercase block mb-1">Teacher Feedback:</span>
                <p className="text-sm text-brand-hover whitespace-pre-wrap">
                  {question.evaluatorFeedback}
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Solution & Explanation Card */}
      <div className="bg-gradient-to-br bg-sky-tint/80 via-white bg-sky-tint/80 rounded-sheet p-6 sm:p-8 border border-line/80 shadow-sm flex flex-col gap-4">
        <div className="flex items-center gap-2.5">
          <div className="p-2 bg-brand text-white rounded-field shadow-xs">
            <BookOpen size={20} weight="bold" />
          </div>
          <div>
            <h3 className="text-base sm:text-lg font-bold text-ink">Explanation & Concept</h3>
            <p className="text-xs text-ink-secondary">Step-by-step verified solution</p>
          </div>
        </div>

        {question.explanationText ? (
          <div className="text-sm sm:text-base text-ink leading-relaxed whitespace-pre-wrap font-sans">
            {question.explanationText}
          </div>
        ) : (
          <div className="p-4 rounded-field bg-white border border-line text-xs text-ink-secondary italic">
            Detailed text solution is not yet available for this question.
          </div>
        )}

        {/* Explanation Images */}
        {question.explanationImages && question.explanationImages.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-2">
            {question.explanationImages.map((imgUrl, i) => (
              <div
                key={i}
                className="relative rounded-card overflow-hidden border border-line bg-white p-2"
              >
                <Image
                  src={imgUrl}
                  alt={`Solution diagram ${i + 1}`}
                  width={500}
                  height={350}
                  unoptimized
                  className="w-full h-auto object-contain cursor-zoom-in rounded-field"
                  onClick={() => setSelectedImage(imgUrl)}
                />
              </div>
            ))}
          </div>
        )}

        {/* Video Solution Link */}
        {question.explanationVideoUrl && (
          <div className="mt-2 pt-4 border-t border-line flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-bold text-brand-hover">
              <VideoCamera size={18} weight="fill" className="text-brand" />
              <span>Video Solution Available</span>
            </div>
            <a
              href={question.explanationVideoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 rounded-field bg-brand hover:bg-brand-hover text-white text-xs font-bold shadow-xs transition-colors"
            >
              Watch Video Solution
            </a>
          </div>
        )}
      </div>

      {/* Image Expand Modal */}
      {selectedImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 backdrop-blur-sm p-4 animate-in fade-in duration-150 cursor-zoom-out"
          onClick={() => setSelectedImage(null)}
        >
          <div className="relative max-w-4xl max-h-[90vh] bg-white rounded-card p-2 overflow-hidden shadow-2xl">
            <Image
              src={selectedImage}
              alt="Expanded diagram"
              width={1000}
              height={800}
              unoptimized
              className="w-full h-auto max-h-[85vh] object-contain rounded-field"
            />
          </div>
        </div>
      )}
    </div>
  );
};
