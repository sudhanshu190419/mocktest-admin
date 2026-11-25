import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Auth Viewport Centering & Laptop/Mobile Optimization Contract', () => {
  const cssPath = path.resolve(__dirname, '../auth-preview.css');
  const cssSource = fs.readFileSync(cssPath, 'utf8');

  const shellPath = path.resolve(__dirname, '../../marketing/CourseStoreShell.tsx');
  const shellSource = fs.readFileSync(shellPath, 'utf8');

  const bottomNavPath = path.resolve(__dirname, '../../student/StudentBottomNav.tsx');
  const bottomNavSource = fs.readFileSync(bottomNavPath, 'utf8');

  it('guarantees .auth-preview centers content vertically and accommodates header height', () => {
    expect(cssSource).toContain('.auth-preview {');
    expect(cssSource).toContain('min-height: calc(100svh - var(--store-header-height, 72px));');
    expect(cssSource).toContain('display: flex;');
    expect(cssSource).toContain('flex-direction: column;');
    expect(cssSource).toContain('justify-content: safe center;');
    expect(cssSource).toContain('align-items: center;');
    expect(cssSource).toContain('overflow-y: auto;');
  });

  it('guarantees .auth-main uses margin: auto for mathematical vertical and horizontal centering', () => {
    expect(cssSource).toContain('.auth-main {');
    expect(cssSource).toContain('margin: auto;');
    expect(cssSource).toContain('display: grid;');
  });

  it('declares refined typography tokens to prevent oversized card heights on laptops', () => {
    expect(cssSource).toContain('--text-auth-title: clamp(1.2rem, 1.6vw, 1.45rem);');
    expect(cssSource).toContain('--text-auth-story: clamp(1.35rem, 2vw, 1.75rem);');
  });

  it('includes laptop-specific media query (height <= 720px) to prevent button cutoff', () => {
    expect(cssSource).toContain('@media (min-width: 769px) and (max-height: 720px)');
    expect(cssSource).toContain('padding: 14px 20px;');
    expect(cssSource).toContain('min-height: 36px;');
  });

  it('includes ultra-compact laptop media query (height <= 600px, e.g. 1024x550) for zero-scroll visibility', () => {
    expect(cssSource).toContain('@media (min-width: 769px) and (max-height: 600px)');
    expect(cssSource).toContain('padding: 10px 16px;');
    expect(cssSource).toContain('min-height: 32px;');
  });

  it('includes mobile media query (<= 768px) with iOS zoom prevention and touch targets', () => {
    expect(cssSource).toContain('@media (max-width: 768px)');
    expect(cssSource).toContain('.auth-story {\n    display: none;');
    expect(cssSource).toContain('font-size: 16px; /* Prevents auto-zoom in iOS Safari */');
    expect(cssSource).toContain('min-height: 44px;');
  });

  it('suppresses massive SiteFooter on auth pages in CourseStoreShell to eliminate vertical overflow', () => {
    expect(shellSource).toContain('isAuthPage');
    expect(shellSource).toContain('!isAuthPage && <SiteFooter />');
  });

  it('suppresses mobile StudentBottomNav on auth pages to maximize form vertical space', () => {
    expect(shellSource).toContain('!isAuthPage && <StudentBottomNav />');
    expect(bottomNavSource).toContain("pathname?.startsWith('/login')");
    expect(bottomNavSource).toContain("pathname?.startsWith('/signup')");
  });
});

