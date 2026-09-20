import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { supabase } from '@/config/supabase';
import {
  fetchStudentTestResult,
  fetchStudentAnswerReview,
} from '@/services/student/studentTestResultWebService';

describe('Student "My Test Results" Dedicated Flow Verification', () => {
  it('1. Dedicated /student/results page file exists', () => {
    const resultsPagePath = path.join(process.cwd(), 'src/app/student/results/page.tsx');
    expect(fs.existsSync(resultsPagePath)).toBe(true);

    const content = fs.readFileSync(resultsPagePath, 'utf8');
    expect(content).toContain('fetchStudentAssignedMockTests');
    expect(content).toContain('My Test Results');
    expect(content).toContain('/student/tests');
    expect(content).toContain('View results');
    expect(content).toContain('Solutions');
  });

  it('2. StudentSidebar contains "My Test Results" entry with Trophy icon', () => {
    const sidebarPath = path.join(process.cwd(), 'src/components/student/StudentSidebar.tsx');
    const content = fs.readFileSync(sidebarPath, 'utf8');

    expect(content).toContain("label: 'My Test Results'");
    expect(content).toContain("href: '/student/results'");
    expect(content).toContain('icon: Trophy');
  });

  it('3. Security & Ownership: fetchStudentTestResult rejects unauthorized attempt tampering', async () => {
    // Mock authenticated user as 'user-auth-123'
    vi.spyOn(supabase.auth, 'getUser').mockResolvedValue({
      data: { user: { id: 'user-auth-123' } } as any,
      error: null,
    });

    // Mock student_details resolving student_id as 'student-real-001'
    vi.spyOn(supabase, 'from').mockImplementation(((table: string) => {
      if (table === 'student_details') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { student_id: 'student-real-001' },
            error: null,
          }),
        } as any;
      }

      if (table === 'mock_attempts') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              attempt_id: 'att-other-victim',
              student_id: 'student-DIFFERENT-VICTIM', // Mismatched student
              attempt_number: 1,
            },
            error: null,
          }),
        } as any;
      }

      if (table === 'mock_results' || table === 'mock_tests') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { is_released: true },
            error: null,
          }),
        } as any;
      }

      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      } as any;
    }) as any);

    const result = await fetchStudentTestResult('test-any', 'att-other-victim');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('not authorized to view this test result');
    }
  });

  it('4. Security & Release Gating: fetchStudentAnswerReview blocks unreleased results', async () => {
    vi.spyOn(supabase.auth, 'getUser').mockResolvedValue({
      data: { user: { id: 'user-auth-123' } } as any,
      error: null,
    });

    vi.spyOn(supabase, 'from').mockImplementation(((table: string) => {
      if (table === 'mock_tests') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { test_id: 'test-1', title: 'Unreleased Test' },
            error: null,
          }),
        } as any;
      }

      if (table === 'mock_attempts') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { attempt_id: 'att-1', attempt_number: 1 },
            error: null,
          }),
        } as any;
      }

      if (table === 'mock_results') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { is_released: false }, // Unreleased!
            error: null,
          }),
        } as any;
      }

      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      } as any;
    }) as any);

    const reviewRes = await fetchStudentAnswerReview('test-1', 'att-1');
    expect(reviewRes.success).toBe(false);
    if (!reviewRes.success) {
      expect(reviewRes.error).toContain('not yet released');
    }
  });
});
