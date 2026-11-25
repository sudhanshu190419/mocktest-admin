'use client';

import React, { useMemo } from 'react';
import katex from 'katex';
import 'katex/dist/contrib/mhchem.mjs';
import 'katex/dist/katex.min.css';

export interface MathRendererProps {
  /** The text content containing plain text and mathematical/chemical expressions. */
  content: string | null | undefined;
  /** Optional container CSS class name. */
  className?: string;
  /** If true, wraps in an inline container (span) instead of div. */
  inline?: boolean;
}

interface MathToken {
  type: 'text' | 'inline-math' | 'display-math';
  value: string;
}

/**
 * Tokenizes content into text, inline math (\(...\) or $...$), and display math (\[...\] or $$...$$).
 * Prioritizes \(...\) and \[...\] as Make Me Topper's primary LaTeX delimiters,
 * while safely supporting $...$ and $$...$$ with currency disambiguation.
 */
export function tokenizeMathContent(text: string): MathToken[] {
  if (!text) return [];

  const tokens: MathToken[] = [];
  // Regex to match:
  // 1. Display math: \[...\] or $$...$$
  // 2. Inline math: \(...\)
  // 3. Inline math ($...$): (?<!\$)\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\$)
  const mathRegex = /(\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\$(?!\s)[^$\n]+?(?<!\s)\$)/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = mathRegex.exec(text)) !== null) {
    const matchIndex = match.index;
    const rawMatch = match[0];

    // Push preceding text if non-empty
    if (matchIndex > lastIndex) {
      tokens.push({
        type: 'text',
        value: text.slice(lastIndex, matchIndex),
      });
    }

    if (rawMatch.startsWith('$$') && rawMatch.endsWith('$$')) {
      tokens.push({
        type: 'display-math',
        value: rawMatch.slice(2, -2).trim(),
      });
    } else if (rawMatch.startsWith('\\[') && rawMatch.endsWith('\\]')) {
      tokens.push({
        type: 'display-math',
        value: rawMatch.slice(2, -2).trim(),
      });
    } else if (rawMatch.startsWith('\\(') && rawMatch.endsWith('\\)')) {
      tokens.push({
        type: 'inline-math',
        value: rawMatch.slice(2, -2).trim(),
      });
    } else if (rawMatch.startsWith('$') && rawMatch.endsWith('$')) {
      const inner = rawMatch.slice(1, -1).trim();
      // Currency disambiguation: if it's purely digits or simple amount without math symbols, treat as text
      if (/^\d+(?:\.\d{1,2})?$/.test(inner)) {
        tokens.push({
          type: 'text',
          value: rawMatch,
        });
      } else {
        tokens.push({
          type: 'inline-math',
          value: inner,
        });
      }
    } else {
      tokens.push({
        type: 'text',
        value: rawMatch,
      });
    }

    lastIndex = matchIndex + rawMatch.length;
  }

  // Push trailing text
  if (lastIndex < text.length) {
    tokens.push({
      type: 'text',
      value: text.slice(lastIndex),
    });
  }

  return tokens;
}

/**
 * Safely renders LaTeX string using KaTeX.
 * Returns rendered HTML or fallback string if parsing fails.
 */
function renderKaTeX(latex: string, displayMode: boolean): { html: string; isError: boolean } {
  try {
    const html = katex.renderToString(latex, {
      displayMode,
      throwOnError: false,
      trust: false,
      strict: 'warn',
    });
    return { html, isError: false };
  } catch {
    return { html: '', isError: true };
  }
}

/**
 * Renders mathematical expressions, chemistry equations (via mhchem),
 * and standard text with full XSS safety.
 */
export const MathRenderer: React.FC<MathRendererProps> = ({
  content,
  className = '',
  inline = false,
}) => {
  const tokens = useMemo(() => tokenizeMathContent(content ?? ''), [content]);

  if (!content) {
    return null;
  }

  const renderedTokens = tokens.map((token, idx) => {
    if (token.type === 'text') {
      return (
        <span key={`txt-${idx}`} className="whitespace-pre-line">
          {token.value}
        </span>
      );
    }

    const isDisplay = token.type === 'display-math';
    const { html, isError } = renderKaTeX(token.value, isDisplay);

    if (isError || !html) {
      return (
        <span
          key={`err-${idx}`}
          className="font-mono text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 px-1 py-0.5 rounded"
          title="Equation rendering fallback"
        >
          {isDisplay ? `\\[${token.value}\\]` : `\\(${token.value}\\)`}
        </span>
      );
    }

    if (isDisplay) {
      return (
        <span
          key={`disp-${idx}`}
          className="my-3 block overflow-x-auto text-center"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      );
    }

    return (
      <span
        key={`inl-${idx}`}
        className="inline-block px-0.5 align-baseline"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  });

  if (inline) {
    return <span className={`inline-math-container ${className}`}>{renderedTokens}</span>;
  }

  return <div className={`math-rendered-container ${className}`}>{renderedTokens}</div>;
};

export default MathRenderer;
