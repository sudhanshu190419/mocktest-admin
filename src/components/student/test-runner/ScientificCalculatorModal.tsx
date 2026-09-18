'use client';

import React, { useState, useCallback } from 'react';
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

    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
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

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 bg-slate-50 border-b border-slate-200">
          <div className="flex items-center gap-2 text-slate-800 font-semibold text-sm">
            <div className="p-1.5 bg-sky-100 text-sky-700 rounded-lg">
              <Calculator size={18} weight="bold" />
            </div>
            <span>Scientific Calculator</span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 rounded-lg transition-colors cursor-pointer"
            aria-label="Close Calculator"
          >
            <X size={18} weight="bold" />
          </button>
        </div>

        {/* Display Screen */}
        <div className="p-4 bg-slate-900 text-right flex flex-col justify-end min-h-[100px] select-all">
          <div className="text-slate-400 text-xs font-mono tracking-wide overflow-x-auto whitespace-nowrap scrollbar-none">
            {expression || '0'}
          </div>
          <div className="text-2xl sm:text-3xl font-bold font-mono text-white mt-1 overflow-x-auto whitespace-nowrap scrollbar-none">
            {resultDisplay}
          </div>
        </div>

        {/* Keypad */}
        <div className="p-4 bg-slate-100 flex flex-col gap-2">
          {/* Scientific Functions */}
          <div className="grid grid-cols-5 gap-1.5">
            {['sin', 'cos', 'tan', 'log', 'ln'].map((fn) => (
              <button
                key={fn}
                onClick={() => handleFunction(fn)}
                className="py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 font-medium text-xs rounded-lg transition-colors cursor-pointer"
              >
                {fn}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-5 gap-1.5">
            <button
              onClick={handleSquareRoot}
              className="py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 font-medium text-xs rounded-lg transition-colors cursor-pointer"
            >
              √
            </button>
            <button
              onClick={handleSquare}
              className="py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 font-medium text-xs rounded-lg transition-colors cursor-pointer"
            >
              x²
            </button>
            <button
              onClick={() => handleInput('^')}
              className="py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 font-medium text-xs rounded-lg transition-colors cursor-pointer"
            >
              ^
            </button>
            <button
              onClick={() => handleInput('π')}
              className="py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 font-medium text-xs rounded-lg transition-colors cursor-pointer"
            >
              π
            </button>
            <button
              onClick={() => handleInput('e')}
              className="py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 font-medium text-xs rounded-lg transition-colors cursor-pointer"
            >
              e
            </button>
          </div>

          <div className="grid grid-cols-5 gap-1.5">
            <button
              onClick={() => handleInput('(')}
              className="py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 font-medium text-xs rounded-lg transition-colors cursor-pointer"
            >
              (
            </button>
            <button
              onClick={() => handleInput(')')}
              className="py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 font-medium text-xs rounded-lg transition-colors cursor-pointer"
            >
              )
            </button>
            <button
              onClick={handleClear}
              className="py-2 bg-rose-100 hover:bg-rose-200 text-rose-700 font-bold text-xs rounded-lg transition-colors cursor-pointer flex items-center justify-center gap-1"
            >
              <ArrowCounterClockwise size={12} weight="bold" />
              CLR
            </button>
            <button
              onClick={handleDelete}
              className="py-2 bg-amber-100 hover:bg-amber-200 text-amber-800 font-bold text-xs rounded-lg transition-colors cursor-pointer flex items-center justify-center"
            >
              <Backspace size={14} weight="bold" />
            </button>
            <button
              onClick={() => handleInput('÷')}
              className="py-2 bg-sky-100 hover:bg-sky-200 text-sky-800 font-bold text-sm rounded-lg transition-colors cursor-pointer"
            >
              ÷
            </button>
          </div>

          {/* Numeric Keypad & Standard Operators */}
          <div className="grid grid-cols-4 gap-1.5 mt-1">
            {['7', '8', '9'].map((n) => (
              <button
                key={n}
                onClick={() => handleInput(n)}
                className="py-2.5 bg-white hover:bg-slate-50 text-slate-800 font-semibold text-sm rounded-lg shadow-xs border border-slate-200 transition-colors cursor-pointer"
              >
                {n}
              </button>
            ))}
            <button
              onClick={() => handleInput('×')}
              className="py-2.5 bg-sky-100 hover:bg-sky-200 text-sky-800 font-bold text-sm rounded-lg transition-colors cursor-pointer"
            >
              ×
            </button>

            {['4', '5', '6'].map((n) => (
              <button
                key={n}
                onClick={() => handleInput(n)}
                className="py-2.5 bg-white hover:bg-slate-50 text-slate-800 font-semibold text-sm rounded-lg shadow-xs border border-slate-200 transition-colors cursor-pointer"
              >
                {n}
              </button>
            ))}
            <button
              onClick={() => handleInput('-')}
              className="py-2.5 bg-sky-100 hover:bg-sky-200 text-sky-800 font-bold text-sm rounded-lg transition-colors cursor-pointer"
            >
              -
            </button>

            {['1', '2', '3'].map((n) => (
              <button
                key={n}
                onClick={() => handleInput(n)}
                className="py-2.5 bg-white hover:bg-slate-50 text-slate-800 font-semibold text-sm rounded-lg shadow-xs border border-slate-200 transition-colors cursor-pointer"
              >
                {n}
              </button>
            ))}
            <button
              onClick={() => handleInput('+')}
              className="py-2.5 bg-sky-100 hover:bg-sky-200 text-sky-800 font-bold text-sm rounded-lg transition-colors cursor-pointer"
            >
              +
            </button>

            <button
              onClick={() => handleInput('0')}
              className="py-2.5 bg-white hover:bg-slate-50 text-slate-800 font-semibold text-sm rounded-lg shadow-xs border border-slate-200 transition-colors cursor-pointer"
            >
              0
            </button>
            <button
              onClick={() => handleInput('.')}
              className="py-2.5 bg-white hover:bg-slate-50 text-slate-800 font-semibold text-sm rounded-lg shadow-xs border border-slate-200 transition-colors cursor-pointer"
            >
              .
            </button>
            <button
              onClick={handleEquals}
              className="col-span-2 py-2.5 bg-sky-600 hover:bg-sky-700 text-white font-bold text-base rounded-lg shadow-sm transition-colors cursor-pointer flex items-center justify-center"
            >
              =
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
