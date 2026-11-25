import { describe, it, expect } from 'vitest';
import { tokenizeMathContent } from '../MathRenderer';
import katex from 'katex';
import 'katex/dist/contrib/mhchem.mjs';

describe('MathRenderer - tokenizeMathContent', () => {
  it('returns empty array for empty or null content', () => {
    expect(tokenizeMathContent('')).toEqual([]);
  });

  it('tokenizes plain text with no math', () => {
    const text = 'This is a regular question with no math.';
    const tokens = tokenizeMathContent(text);
    expect(tokens).toEqual([
      { type: 'text', value: 'This is a regular question with no math.' },
    ]);
  });

  it('tokenizes inline LaTeX delimiters \\(...\\)', () => {
    const text = 'Find the value of \\(x\\) if \\(x^2=25\\).';
    const tokens = tokenizeMathContent(text);
    expect(tokens).toEqual([
      { type: 'text', value: 'Find the value of ' },
      { type: 'inline-math', value: 'x' },
      { type: 'text', value: ' if ' },
      { type: 'inline-math', value: 'x^2=25' },
      { type: 'text', value: '.' },
    ]);
  });

  it('tokenizes display LaTeX delimiters \\[...\\]', () => {
    const text = 'Evaluate the integral:\n\\[\\int_0^1 x^2\\,dx\\]\nDone.';
    const tokens = tokenizeMathContent(text);
    expect(tokens).toEqual([
      { type: 'text', value: 'Evaluate the integral:\n' },
      { type: 'display-math', value: '\\int_0^1 x^2\\,dx' },
      { type: 'text', value: '\nDone.' },
    ]);
  });

  it('tokenizes chemistry expressions using \\(\\ce{...}\\)', () => {
    const text = 'Reaction: \\(\\ce{2H2 + O2 -> 2H2O}\\) produces water.';
    const tokens = tokenizeMathContent(text);
    expect(tokens).toEqual([
      { type: 'text', value: 'Reaction: ' },
      { type: 'inline-math', value: '\\ce{2H2 + O2 -> 2H2O}' },
      { type: 'text', value: ' produces water.' },
    ]);
  });

  it('tokenizes Markdown math $...$ and $$...$$', () => {
    const text = 'Inline $a^2+b^2=c^2$ and block $$\\sum_{k=1}^n k$$.';
    const tokens = tokenizeMathContent(text);
    expect(tokens).toEqual([
      { type: 'text', value: 'Inline ' },
      { type: 'inline-math', value: 'a^2+b^2=c^2' },
      { type: 'text', value: ' and block ' },
      { type: 'display-math', value: '\\sum_{k=1}^n k' },
      { type: 'text', value: '.' },
    ]);
  });

  it('disambiguates currency values from math', () => {
    const text = 'The item costs $50 and another costs $12.50.';
    const tokens = tokenizeMathContent(text);
    // Neither should be treated as math
    expect(tokens.every((t) => t.type === 'text')).toBe(true);
  });

  it('renders mhchem expressions through KaTeX successfully', () => {
    const html1 = katex.renderToString('\\ce{H2SO4}');
    expect(html1).toContain('katex');
    expect(html1).toContain('SO');

    const html2 = katex.renderToString('\\ce{2H2 + O2 -> 2H2O}');
    expect(html2).toContain('katex');

    const html3 = katex.renderToString('\\ce{Fe^3+}');
    expect(html3).toContain('katex');
  });

  it('renders JEE advanced math notation without error', () => {
    const matrix = '\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}';
    const htmlMatrix = katex.renderToString(matrix);
    expect(htmlMatrix).toContain('matrix');

    const integral = '\\int_0^1 x^2\\,dx';
    const htmlIntegral = katex.renderToString(integral);
    expect(htmlIntegral).toContain('int');

    const vector = '\\vec{a}\\cdot\\vec{b}';
    const htmlVector = katex.renderToString(vector);
    expect(htmlVector).toContain('katex');
  });
});
