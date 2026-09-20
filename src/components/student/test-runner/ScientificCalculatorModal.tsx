'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { X, Calculator, Backspace, ArrowCounterClockwise } from '@phosphor-icons/react';

interface ScientificCalculatorModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function evaluateScientificExpression(expr: string): string {
  if (!expr || !expr.trim()) return '0';

  try {
    const sanitized = expr
      .replace(/×/g, '*')
      .replace(/÷/g, '/')
      .replace(/π/g, `${Math.PI}`)
      .replace(/\be\b/g, `${Math.E}`)
      .replace(/(\d+)\^(\d+(\.\d+)?)/g, 'Math.pow($1,$2)')
      .replace(/√\(([^)]+)\)/g, 'Math.sqrt($1)')
      .replace(/sin\(([^)]+)\)/g, 'Math.sin(($1) * Math.PI / 180)')
      .replace(/cos\(([^)]+)\)/g, 'Math.cos(($1) * Math.PI / 180)')
      .replace(/tan\(([^)]+)\)/g, 'Math.tan(($1) * Math.PI / 180)')
      .replace(/ln\(([^)]+)\)/g, 'Math.log($1)')
      .replace(/log\(([^)]+)\)/g, 'Math.log10($1)');

    if (!/^[0-9+\-*/().,Math.powsqrtsincolg10EPI\s]+$/.test(sanitized)) {
      return 'Error';
    }

    const result = Function(`"use strict"; return (${sanitized});`)();

    if (result === undefined || result === null || isNaN(result)) {
      return 'Error';
    }
    if (!isFinite(result)) {
      return 'Undefined';
    }

    const rounded = Math.round(result * 1e10) / 1e10;
    return String(rounded);
  } catch {
    return 'Error';
  }
}

export const ScientificCalculatorModal: React.FC<ScientificCalculatorModalProps> = ({ isOpen, onClose }) => {
  const [expression, setExpression] = useState('');
  const [resultDisplay, setResultDisplay] = useState('0');

  const handleInput = useCallback((val: string) => {
    setExpression((prev) => {
      if (prev === '0' && !isNaN(Number(val))) return val;
      return prev + val;
    });
  }, []);

  const handleClear = useCallback(() => {
    setExpression('');
    setResultDisplay('0');
  }, []);

  const handleDelete = useCallback(() => {
    setExpression((prev) => prev.slice(0, -1));
  }, []);

  const handleEquals = useCallback(() => {
    if (!expression) return;
    const computed = evaluateScientificExpression(expression);
    setResultDisplay(computed);
  }, [expression]);

  const handleSquare = useCallback(() => {
    setExpression((prev) => (prev ? `(${prev})^2` : ''));
  }, []);

  const handleSquareRoot = useCallback(() => {
    setExpression((prev) => `√(${prev || ''}`);
  }, []);

  const handleFunction = useCallback((fn: string) => {
    setExpression((prev) => `${prev}${fn}(`);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-scrim backdrop-blur-xs p-0 sm:p-4 animate-fade-quick"
      role="dialog"
      aria-modal="true"
      aria-label="Scientific Calculator"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md bg-white rounded-t-sheet sm:rounded-sheet shadow-dialog border border-line overflow-hidden flex flex-col animate-pop-in">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 bg-paper border-b border-line">
          <div className="flex items-center gap-2 text-ink font-semibold text-sm">
            <div className="p-1.5 bg-sky-tint text-brand rounded-field">
              <Calculator size={18} weight="bold" />
            </div>
            <span>Scientific Calculator</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-ink-secondary hover:text-ink hover:bg-sky-tint rounded-full transition-colors cursor-pointer"
            aria-label="Close Calculator"
          >
            <X size={18} weight="bold" />
          </button>
        </div>

        {/* Display Screen */}
        <div className="p-4 bg-ink text-right flex flex-col justify-end min-h-[100px] select-all">
          <div className="text-white/60 text-caption font-mono tracking-wide overflow-x-auto whitespace-nowrap scrollbar-none">
            {expression || '0'}
          </div>
          <div className="text-2xl sm:text-3xl font-bold font-mono text-white mt-1 overflow-x-auto whitespace-nowrap scrollbar-none tabular-nums">
            {resultDisplay}
          </div>
        </div>

        {/* Keypad */}
        <div className="p-4 bg-paper flex flex-col gap-2">
          {/* Scientific Functions */}
          <div className="grid grid-cols-5 gap-1.5">
            {['sin', 'cos', 'tan', 'log', 'ln'].map((fn) => (
              <button
                key={fn}
                type="button"
                onClick={() => handleFunction(fn)}
                className="min-h-[40px] py-2 bg-sky-tint hover:bg-sky-tint/80 text-ink font-semibold text-caption rounded-field transition-colors cursor-pointer"
              >
                {fn}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-5 gap-1.5">
            <button
              type="button"
              onClick={handleSquareRoot}
              className="min-h-[40px] py-2 bg-sky-tint hover:bg-sky-tint/80 text-ink font-semibold text-caption rounded-field transition-colors cursor-pointer"
            >
              √
            </button>
            <button
              type="button"
              onClick={handleSquare}
              className="min-h-[40px] py-2 bg-sky-tint hover:bg-sky-tint/80 text-ink font-semibold text-caption rounded-field transition-colors cursor-pointer"
            >
              x²
            </button>
            <button
              type="button"
              onClick={() => handleInput('^')}
              className="min-h-[40px] py-2 bg-sky-tint hover:bg-sky-tint/80 text-ink font-semibold text-caption rounded-field transition-colors cursor-pointer"
            >
              ^
            </button>
            <button
              type="button"
              onClick={() => handleInput('π')}
              className="min-h-[40px] py-2 bg-sky-tint hover:bg-sky-tint/80 text-ink font-semibold text-caption rounded-field transition-colors cursor-pointer"
            >
              π
            </button>
            <button
              type="button"
              onClick={() => handleInput('e')}
              className="min-h-[40px] py-2 bg-sky-tint hover:bg-sky-tint/80 text-ink font-semibold text-caption rounded-field transition-colors cursor-pointer"
            >
              e
            </button>
          </div>

          <div className="grid grid-cols-5 gap-1.5">
            <button
              type="button"
              onClick={() => handleInput('(')}
              className="min-h-[40px] py-2 bg-sky-tint hover:bg-sky-tint/80 text-ink font-semibold text-caption rounded-field transition-colors cursor-pointer"
            >
              (
            </button>
            <button
              type="button"
              onClick={() => handleInput(')')}
              className="min-h-[40px] py-2 bg-sky-tint hover:bg-sky-tint/80 text-ink font-semibold text-caption rounded-field transition-colors cursor-pointer"
            >
              )
            </button>
            <button
              type="button"
              onClick={handleClear}
              className="min-h-[40px] py-2 bg-red-500/20 hover:bg-red-500/30 text-red-900 font-bold text-caption rounded-field transition-colors cursor-pointer flex items-center justify-center gap-1"
            >
              <ArrowCounterClockwise size={12} weight="bold" />
              CLR
            </button>
            <button
              type="button"
              onClick={handleDelete}
              className="min-h-[40px] py-2 bg-amber-500/20 hover:bg-amber-500/30 text-amber-900 font-bold text-caption rounded-field transition-colors cursor-pointer flex items-center justify-center"
            >
              <Backspace size={14} weight="bold" />
            </button>
            <button
              type="button"
              onClick={() => handleInput('÷')}
              className="min-h-[40px] py-2 bg-sky-tint hover:bg-sky-tint/80 text-brand font-bold text-sm rounded-field transition-colors cursor-pointer"
            >
              ÷
            </button>
          </div>

          {/* Numeric Keypad & Standard Operators */}
          <div className="grid grid-cols-4 gap-1.5 mt-1">
            {['7', '8', '9'].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => handleInput(n)}
                className="min-h-[44px] py-2.5 bg-white hover:bg-paper text-ink font-semibold text-sm rounded-field shadow-xs border border-line transition-colors cursor-pointer"
              >
                {n}
              </button>
            ))}
            <button
              type="button"
              onClick={() => handleInput('×')}
              className="min-h-[44px] py-2.5 bg-sky-tint hover:bg-sky-tint/80 text-brand font-bold text-sm rounded-field transition-colors cursor-pointer"
            >
              ×
            </button>

            {['4', '5', '6'].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => handleInput(n)}
                className="min-h-[44px] py-2.5 bg-white hover:bg-paper text-ink font-semibold text-sm rounded-field shadow-xs border border-line transition-colors cursor-pointer"
              >
                {n}
              </button>
            ))}
            <button
              type="button"
              onClick={() => handleInput('-')}
              className="min-h-[44px] py-2.5 bg-sky-tint hover:bg-sky-tint/80 text-brand font-bold text-sm rounded-field transition-colors cursor-pointer"
            >
              -
            </button>

            {['1', '2', '3'].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => handleInput(n)}
                className="min-h-[44px] py-2.5 bg-white hover:bg-paper text-ink font-semibold text-sm rounded-field shadow-xs border border-line transition-colors cursor-pointer"
              >
                {n}
              </button>
            ))}
            <button
              type="button"
              onClick={() => handleInput('+')}
              className="min-h-[44px] py-2.5 bg-sky-tint hover:bg-sky-tint/80 text-brand font-bold text-sm rounded-field transition-colors cursor-pointer"
            >
              +
            </button>

            <button
              type="button"
              onClick={() => handleInput('0')}
              className="min-h-[44px] py-2.5 bg-white hover:bg-paper text-ink font-semibold text-sm rounded-field shadow-xs border border-line transition-colors cursor-pointer"
            >
              0
            </button>
            <button
              type="button"
              onClick={() => handleInput('.')}
              className="min-h-[44px] py-2.5 bg-white hover:bg-paper text-ink font-semibold text-sm rounded-field shadow-xs border border-line transition-colors cursor-pointer"
            >
              .
            </button>
            <button
              type="button"
              onClick={handleEquals}
              className="col-span-2 min-h-[44px] py-2.5 bg-brand hover:bg-brand-hover text-white font-bold text-base rounded-field shadow-xs transition-colors cursor-pointer flex items-center justify-center"
            >
              =
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
