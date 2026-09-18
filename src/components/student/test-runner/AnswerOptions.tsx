'use client';

import React, { useCallback } from 'react';
import Image from 'next/image';
import { Check, Backspace, ArrowCounterClockwise } from '@phosphor-icons/react';
import type { RunnerQuestionOption } from '@/services/student/studentTestWebService';

interface AnswerOptionsProps {
  questionType: 'mcq' | 'msq' | 'numerical' | 'true_false' | 'text_based' | 'subjective';
  options: RunnerQuestionOption[];
  value: string | string[] | null;
  onChange: (val: string | string[]) => void;
  disabled?: boolean;
}

export const AnswerOptions: React.FC<AnswerOptionsProps> = ({
  questionType,
  options,
  value,
  onChange,
  disabled = false,
}) => {
  // Single choice toggle (MCQ / True-False)
  const handleSingleSelect = useCallback(
    (optionId: string) => {
      if (disabled) return;
      onChange(optionId);
    },
    [disabled, onChange]
  );

  // Multi-choice toggle (MSQ)
  const handleMultiToggle = useCallback(
    (optionId: string) => {
      if (disabled) return;
      const currentArr = Array.isArray(value) ? [...value] : [];
      const exists = currentArr.includes(optionId);
      const nextArr = exists
        ? currentArr.filter((id) => id !== optionId)
        : [...currentArr, optionId];
      onChange(nextArr);
    },
    [disabled, value, onChange]
  );

  // Numerical keypad press
  const handleNumericKey = useCallback(
    (key: string) => {
      if (disabled) return;
      const cur = typeof value === 'string' ? value : '';
      if (key === 'backspace') {
        onChange(cur.slice(0, -1));
        return;
      }
      if (key === 'CLR') {
        onChange('');
        return;
      }
      if (key === '.') {
        if (cur.includes('.')) return;
      }
      if (key === '-') {
        if (cur.includes('-') || cur.length > 0) return;
      }
      if (cur.length < 15) {
        onChange(cur + key);
      }
    },
    [disabled, value, onChange]
  );

  // 1. Single Choice (MCQ or True/False)
  if (questionType === 'mcq' || questionType === 'true_false') {
    const selectedId = typeof value === 'string' ? value : null;

    return (
      <div className="flex flex-col gap-3">
        {options.map((opt) => {
          const isSelected = selectedId === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              disabled={disabled}
              onClick={() => handleSingleSelect(opt.id)}
              className={`w-full text-left p-4 rounded-xl border-2 transition-all flex items-start gap-3.5 cursor-pointer ${
                isSelected
                  ? 'bg-sky-50/80 border-sky-600 shadow-xs'
                  : 'bg-white hover:bg-slate-50 border-slate-200 hover:border-slate-300'
              } ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
            >
              {/* Radio Indicator */}
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs shrink-0 border-2 transition-colors mt-0.5 ${
                  isSelected
                    ? 'bg-sky-600 border-sky-600 text-white'
                    : 'bg-slate-50 border-slate-300 text-slate-600'
                }`}
              >
                {opt.label}
              </div>

              {/* Option Text & Optional Image */}
              <div className="flex-1 min-w-0 pt-0.5">
                <div className="text-sm sm:text-base text-slate-800 leading-relaxed whitespace-pre-line">
                  {opt.text}
                </div>
                {opt.imageUrl && (
                  <div className="mt-3 relative max-w-sm rounded-lg overflow-hidden border border-slate-200 bg-white">
                    <img
                      src={opt.imageUrl}
                      alt={`Option ${opt.label}`}
                      className="max-h-48 object-contain"
                      loading="lazy"
                    />
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    );
  }

  // 2. Multiple Choice (MSQ)
  if (questionType === 'msq') {
    const selectedIds = Array.isArray(value) ? value : [];

    return (
      <div className="flex flex-col gap-3">
        <div className="text-xs font-semibold text-purple-700 bg-purple-50 px-3 py-1.5 rounded-lg border border-purple-200 self-start">
          Multiple Choice Question (One or more options may be correct)
        </div>
        {options.map((opt) => {
          const isSelected = selectedIds.includes(opt.id);
          return (
            <button
              key={opt.id}
              type="button"
              disabled={disabled}
              onClick={() => handleMultiToggle(opt.id)}
              className={`w-full text-left p-4 rounded-xl border-2 transition-all flex items-start gap-3.5 cursor-pointer ${
                isSelected
                  ? 'bg-purple-50/80 border-purple-600 shadow-xs'
                  : 'bg-white hover:bg-slate-50 border-slate-200 hover:border-slate-300'
              } ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
            >
              {/* Checkbox Indicator */}
              <div
                className={`w-7 h-7 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 border-2 transition-colors mt-0.5 ${
                  isSelected
                    ? 'bg-purple-600 border-purple-600 text-white'
                    : 'bg-slate-50 border-slate-300 text-slate-600'
                }`}
              >
                {isSelected ? <Check size={14} weight="bold" /> : opt.label}
              </div>

              {/* Option Text & Optional Image */}
              <div className="flex-1 min-w-0 pt-0.5">
                <div className="text-sm sm:text-base text-slate-800 leading-relaxed whitespace-pre-line">
                  {opt.text}
                </div>
                {opt.imageUrl && (
                  <div className="mt-3 relative max-w-sm rounded-lg overflow-hidden border border-slate-200 bg-white">
                    <img
                      src={opt.imageUrl}
                      alt={`Option ${opt.label}`}
                      className="max-h-48 object-contain"
                      loading="lazy"
                    />
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    );
  }

  // 3. Numerical Type
  if (questionType === 'numerical') {
    const numVal = typeof value === 'string' ? value : '';

    return (
      <div className="flex flex-col gap-4 max-w-md">
        <div className="text-xs font-semibold text-sky-800 bg-sky-50 px-3 py-1.5 rounded-lg border border-sky-200 self-start">
          Numerical Answer Question (Enter integer or decimal value)
        </div>

        {/* Input box */}
        <div className="flex items-center gap-2">
          <input
            type="text"
            inputMode="decimal"
            disabled={disabled}
            value={numVal}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Enter numerical answer"
            className="w-full px-4 py-3 text-lg font-mono font-bold text-slate-900 bg-white rounded-xl border-2 border-slate-300 focus:border-sky-600 focus:outline-none shadow-xs"
          />
        </div>

        {/* On-screen Keypad */}
        <div className="p-3 bg-slate-100 rounded-2xl border border-slate-200 grid grid-cols-3 gap-2">
          {['7', '8', '9', '4', '5', '6', '1', '2', '3'].map((n) => (
            <button
              key={n}
              type="button"
              disabled={disabled}
              onClick={() => handleNumericKey(n)}
              className="py-3 bg-white hover:bg-slate-50 text-slate-800 font-bold text-base rounded-xl shadow-xs border border-slate-200 transition-colors cursor-pointer"
            >
              {n}
            </button>
          ))}
          <button
            type="button"
            disabled={disabled}
            onClick={() => handleNumericKey('.')}
            className="py-3 bg-white hover:bg-slate-50 text-slate-800 font-bold text-base rounded-xl shadow-xs border border-slate-200 transition-colors cursor-pointer"
          >
            .
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => handleNumericKey('0')}
            className="py-3 bg-white hover:bg-slate-50 text-slate-800 font-bold text-base rounded-xl shadow-xs border border-slate-200 transition-colors cursor-pointer"
          >
            0
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => handleNumericKey('-')}
            className="py-3 bg-white hover:bg-slate-50 text-slate-800 font-bold text-base rounded-xl shadow-xs border border-slate-200 transition-colors cursor-pointer"
          >
            -
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => handleNumericKey('backspace')}
            className="py-3 bg-amber-100 hover:bg-amber-200 text-amber-900 font-bold text-sm rounded-xl transition-colors cursor-pointer flex items-center justify-center"
            title="Backspace"
          >
            <Backspace size={18} weight="bold" />
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => handleNumericKey('CLR')}
            className="col-span-2 py-3 bg-rose-100 hover:bg-rose-200 text-rose-800 font-bold text-sm rounded-xl transition-colors cursor-pointer flex items-center justify-center gap-1"
          >
            <ArrowCounterClockwise size={14} weight="bold" />
            CLEAR
          </button>
        </div>
      </div>
    );
  }

  // 4. Subjective / Text-based Type
  if (questionType === 'subjective' || questionType === 'text_based') {
    const textVal = typeof value === 'string' ? value : '';

    return (
      <div className="flex flex-col gap-3">
        <div className="text-xs font-semibold text-slate-700 bg-slate-100 px-3 py-1.5 rounded-lg border border-slate-200 self-start">
          Subjective Question (Write your response below)
        </div>
        <textarea
          rows={6}
          disabled={disabled}
          value={textVal}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Type your response here..."
          className="w-full p-4 text-sm sm:text-base text-slate-800 bg-white rounded-xl border-2 border-slate-300 focus:border-sky-600 focus:outline-none shadow-xs resize-y"
        />
      </div>
    );
  }

  return null;
};
