/**
 * Admin Dashboard Service
 *
 * Aggregates data from multiple tables for the Admin Dashboard home page.
 * Reuses existing services where possible and queries Supabase directly
 * for aggregate counts that no existing service provides.
 *
 * ## Data Sources
 *
 * | Widget                 | Source                                          |
 * |------------------------|-------------------------------------------------|
 * | Total Students         | profiles WHERE role = 'student'                 |
 * | Total Teachers         | profiles WHERE role = 'teacher'                 |
 * | Active Batches         | batches WHERE status = 'active'                 |
 * | Published Mock Tests   | mock_tests WHERE status = 'published'           |
 * | Pending Q. Approvals   | questions WHERE status = 'pending_approval'     |
 * | Pending Content Approv.| approval_requests WHERE status = 'pending' AND resource_type = 'content' |
 * | Pending MT Approvals   | approval_requests WHERE status = 'pending' AND resource_type = 'mock_test' |
 * | Monthly Revenue        | orders WHERE status = 'confirmed' AND created_at >= startOfMonth |
 * | Recent Registrations   | profiles ORDER BY created_at DESC LIMIT 10      |
 * | Upcoming Live Classes  | live_classes WHERE status = 'scheduled'         |
 *
 * @module services/admin/dashboardService
 */

import { supabase } from '@/config/supabase';
import type { ApiResponse } from '@/types/academic';

// ═══════════════════════════════════════════════════════════════════════════
//  Types
// ═══════════════════════════════════════════════════════════════════════════

export interface DashboardStats {
  totalStudents: number;
  totalTeachers: number;
  activeBatches: number;
  publishedMockTests: number;
  pendingQuestionApprovals: number;
  pendingContentApprovals: number;
  pendingMockTestApprovals: number;
  monthlyRevenue: number | null;
}

export interface RecentRegistration {
  profileId: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: string;
  createdAt: string;
}

export interface UpcomingLiveClass {
  classId: string;
  title: string;
  scheduledAt: string;
  durationMin: number;
}

export interface DashboardData {
  stats: DashboardStats;
  recentRegistrations: RecentRegistration[];
  upcomingClasses: UpcomingLiveClass[];
}

// ═══════════════════════════════════════════════════════════════════════════
//  Service
// ═══════════════════════════════════════════════════════════════════════════

export const adminDashboardService = {
  /**
   * Fetch aggregate KPI counts & revenue for dashboard cards.
   */
  async getDashboardStats(instituteId?: string | null): Promise<ApiResponse<DashboardStats>> {
    try {
      const instituteFilter = instituteId ? { institute_id: instituteId } : {};

      const now = new Date();
      const startOfMonthIso = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

      const [
        studentsRes,
        teachersRes,
        batchesRes,
        mockTestsRes,
        pendingQuestionsRes,
        pendingContentApprovalsRes,
        pendingMockTestApprovalsRes,
        ordersRes,
      ] = await Promise.allSettled([
        // Total Students
        supabase
          .from('profiles')
          .select('profile_id', { count: 'exact', head: true })
          .eq('role', 'student')
          .match(instituteFilter),

        // Total Teachers
        supabase
          .from('profiles')
          .select('profile_id', { count: 'exact', head: true })
          .eq('role', 'teacher')
          .match(instituteFilter),

        // Active Batches
        supabase
          .from('batches')
          .select('batch_id', { count: 'exact', head: true })
          .eq('status', 'active')
          .match(instituteFilter),

        // Published Mock Tests
        supabase
          .from('mock_tests')
          .select('test_id', { count: 'exact', head: true })
          .eq('status', 'published')
          .match(instituteFilter),

        // Pending Question Approvals
        supabase
          .from('questions')
          .select('question_id', { count: 'exact', head: true })
          .eq('status', 'pending_approval')
          .match(instituteFilter),

        // Pending Content Approvals (via approval_requests)
        supabase
          .from('approval_requests')
          .select('approval_id', { count: 'exact', head: true })
          .eq('status', 'pending')
          .eq('resource_type', 'content')
          .match(instituteFilter),

        // Pending Mock Test Approvals (via approval_requests)
        supabase
          .from('approval_requests')
          .select('approval_id', { count: 'exact', head: true })
          .eq('status', 'pending')
          .eq('resource_type', 'mock_test')
          .match(instituteFilter),

        // Monthly Revenue (orders confirmed this month)
        supabase
          .from('orders')
          .select('total_amount')
          .eq('status', 'confirmed')
          .gte('created_at', startOfMonthIso)
          .match(instituteFilter),
      ]);

      const totalStudents = studentsRes.status === 'fulfilled' ? studentsRes.value.count ?? 0 : 0;
      const totalTeachers = teachersRes.status === 'fulfilled' ? teachersRes.value.count ?? 0 : 0;
      const activeBatches = batchesRes.status === 'fulfilled' ? batchesRes.value.count ?? 0 : 0;
      const publishedMockTests = mockTestsRes.status === 'fulfilled' ? mockTestsRes.value.count ?? 0 : 0;
      const pendingQuestionApprovals = pendingQuestionsRes.status === 'fulfilled' ? pendingQuestionsRes.value.count ?? 0 : 0;
      const pendingContentApprovals = pendingContentApprovalsRes.status === 'fulfilled' ? pendingContentApprovalsRes.value.count ?? 0 : 0;
      const pendingMockTestApprovals = pendingMockTestApprovalsRes.status === 'fulfilled' ? pendingMockTestApprovalsRes.value.count ?? 0 : 0;

      let totalRevenue = 0;
      if (ordersRes.status === 'fulfilled' && ordersRes.value.data) {
        totalRevenue = (ordersRes.value.data as any[]).reduce(
          (sum: number, o: any) => sum + parseFloat(o.total_amount ?? 0),
          0
        );
      }

      return {
        success: true,
        data: {
          totalStudents,
          totalTeachers,
          activeBatches,
          publishedMockTests,
          pendingQuestionApprovals,
          pendingContentApprovals,
          pendingMockTestApprovals,
          monthlyRevenue: totalRevenue > 0 ? totalRevenue : null,
        },
      };
    } catch (err) {
      console.error('Failed to fetch dashboard stats:', err);
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to fetch dashboard stats.',
      };
    }
  },

  /**
   * Fetch recent user registrations (last 10).
   */
  async getRecentRegistrations(instituteId?: string | null): Promise<ApiResponse<RecentRegistration[]>> {
    try {
      const instituteFilter = instituteId ? { institute_id: instituteId } : {};

      const { data, error } = await supabase
        .from('profiles')
        .select('profile_id, name, email, phone, role, created_at')
        .match(instituteFilter)
        .order('created_at', { ascending: false })
        .limit(10);

      if (error) {
        throw error;
      }

      const recentRegistrations: RecentRegistration[] = (data ?? []).map((p: any) => ({
        profileId: p.profile_id,
        name: p.name ?? 'Unknown',
        email: p.email ?? null,
        phone: p.phone ?? null,
        role: p.role,
        createdAt: p.created_at,
      }));

      return {
        success: true,
        data: recentRegistrations,
      };
    } catch (err) {
      console.error('Failed to fetch recent registrations:', err);
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to fetch recent registrations.',
      };
    }
  },

  /**
   * Fetch upcoming scheduled live classes (next 5).
   */
  async getUpcomingClasses(instituteId?: string | null): Promise<ApiResponse<UpcomingLiveClass[]>> {
    try {
      const instituteFilter = instituteId ? { institute_id: instituteId } : {};

      const { data, error } = await supabase
        .from('live_classes')
        .select('class_id, title, scheduled_at, duration_min')
        .eq('status', 'scheduled')
        .match(instituteFilter)
        .gte('scheduled_at', new Date().toISOString())
        .order('scheduled_at', { ascending: true })
        .limit(5);

      if (error) {
        throw error;
      }

      const upcomingClasses: UpcomingLiveClass[] = (data ?? []).map((c: any) => ({
        classId: c.class_id,
        title: c.title,
        scheduledAt: c.scheduled_at,
        durationMin: c.duration_min,
      }));

      return {
        success: true,
        data: upcomingClasses,
      };
    } catch (err) {
      console.error('Failed to fetch upcoming classes:', err);
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to fetch upcoming classes.',
      };
    }
  },

  /**
   * Fetch all dashboard data in parallel.
   * Reuses granular fetchers for consistent behavior across single and composite callers.
   */
  async getDashboardData(instituteId?: string | null): Promise<ApiResponse<DashboardData>> {
    try {
      const [statsRes, regsRes, classesRes] = await Promise.all([
        this.getDashboardStats(instituteId),
        this.getRecentRegistrations(instituteId),
        this.getUpcomingClasses(instituteId),
      ]);

      const defaultStats: DashboardStats = {
        totalStudents: 0,
        totalTeachers: 0,
        activeBatches: 0,
        publishedMockTests: 0,
        pendingQuestionApprovals: 0,
        pendingContentApprovals: 0,
        pendingMockTestApprovals: 0,
        monthlyRevenue: null,
      };

      return {
        success: true,
        data: {
          stats: statsRes.success && statsRes.data ? statsRes.data : defaultStats,
          recentRegistrations: regsRes.success && regsRes.data ? regsRes.data : [],
          upcomingClasses: classesRes.success && classesRes.data ? classesRes.data : [],
        },
      };
    } catch (err) {
      console.error('Failed to fetch admin dashboard data:', err);
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to fetch dashboard data.',
      };
    }
  },
};
