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
 * | Monthly Revenue        | orders WHERE status = 'confirmed' (MTD)         |
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
  teacherName: string | null;
  scheduledAt: string;
  durationMin: number;
  batchName: string | null;
}

export interface DashboardData {
  stats: DashboardStats;
  recentRegistrations: RecentRegistration[];
  upcomingClasses: UpcomingLiveClass[];
  commerce?: {
    totalOrders: number;
    totalRevenue: number;
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  Service
// ═══════════════════════════════════════════════════════════════════════════

export const adminDashboardService = {
  /**
   * Fetch all dashboard data in parallel.
   * Each query is independent so Promise.allSettled ensures partial results
   * if one table is unreachable.
   */
  async getDashboardData(instituteId?: string | null): Promise<ApiResponse<DashboardData>> {
    try {
      const instituteFilter = instituteId ? { institute_id: instituteId } : {};

      const [
        studentsRes,
        teachersRes,
        batchesRes,
        mockTestsRes,
        pendingQuestionsRes,
        pendingContentApprovalsRes,
        pendingMockTestApprovalsRes,
        recentRegsRes,
        upcomingClassesRes,
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

        // Recent Registrations (last 10)
        supabase
          .from('profiles')
          .select('profile_id, name, email, phone, role, created_at')
          .match(instituteFilter)
          .order('created_at', { ascending: false })
          .limit(10),

        // Upcoming Live Classes (next 5)
        supabase
          .from('live_classes')
          .select('class_id, title, scheduled_at, duration_min')
          .eq('status', 'scheduled')
          .match(instituteFilter)
          .gte('scheduled_at', new Date().toISOString())
          .order('scheduled_at', { ascending: true })
          .limit(5),
      ]);

      // ── Extract results with fallbacks ──────────────────────────────

      const totalStudents = studentsRes.status === 'fulfilled' ? studentsRes.value.count ?? 0 : 0;
      const totalTeachers = teachersRes.status === 'fulfilled' ? teachersRes.value.count ?? 0 : 0;
      const activeBatches = batchesRes.status === 'fulfilled' ? batchesRes.value.count ?? 0 : 0;
      const publishedMockTests = mockTestsRes.status === 'fulfilled' ? mockTestsRes.value.count ?? 0 : 0;
      const pendingQuestionApprovals = pendingQuestionsRes.status === 'fulfilled' ? pendingQuestionsRes.value.count ?? 0 : 0;
      const pendingContentApprovals = pendingContentApprovalsRes.status === 'fulfilled' ? pendingContentApprovalsRes.value.count ?? 0 : 0;
      const pendingMockTestApprovals = pendingMockTestApprovalsRes.status === 'fulfilled' ? pendingMockTestApprovalsRes.value.count ?? 0 : 0;

      // Recent Registrations
      let recentRegistrations: RecentRegistration[] = [];
      if (recentRegsRes.status === 'fulfilled' && recentRegsRes.value.data) {
        recentRegistrations = recentRegsRes.value.data.map((p: any) => ({
          profileId: p.profile_id,
          name: p.name ?? 'Unknown',
          email: p.email ?? null,
          phone: p.phone ?? null,
          role: p.role,
          createdAt: p.created_at,
        }));
      }

      // Upcoming Live Classes
      let upcomingClasses: UpcomingLiveClass[] = [];
      if (upcomingClassesRes.status === 'fulfilled' && upcomingClassesRes.value.data) {
        upcomingClasses = upcomingClassesRes.value.data.map((c: any) => ({
          classId: c.class_id,
          title: c.title,
          teacherName: null, // would need a join — placeholder for now
          scheduledAt: c.scheduled_at,
          durationMin: c.duration_min,
          batchName: null,   // would need a join — placeholder for now
        }));
      }

      // ── Commerce Metrics ─────────────────────────────────────────────
      let totalOrders = 0;
      let totalRevenue = 0;

      try {
        const { data: ordersData, count: ordersCount } = await supabase
          .from('orders')
          .select('total_amount, status', { count: 'exact' })
          .match(instituteFilter);

        if (ordersData) {
          totalOrders = ordersCount ?? ordersData.length;
          totalRevenue = ordersData
            .filter((o: any) => o.status === 'confirmed')
            .reduce((sum: number, o: any) => sum + parseFloat(o.total_amount ?? 0), 0);
        }
      } catch (_err) {
        // Commerce data may not be available yet
      }

      return {
        success: true,
        data: {
          stats: {
            totalStudents,
            totalTeachers,
            activeBatches,
            publishedMockTests,
            pendingQuestionApprovals,
            pendingContentApprovals,
            pendingMockTestApprovals,
            monthlyRevenue: totalRevenue > 0 ? totalRevenue : null,
          },
          recentRegistrations,
          upcomingClasses,
          commerce: {
            totalOrders,
            totalRevenue,
          },
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
