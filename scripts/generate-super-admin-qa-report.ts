/**
 * Super Admin Dashboard — Testing & Production Readiness Report Generator
 *
 * Generates a professional .docx document with the complete testing plan
 * for the Super Admin Dashboard module.
 *
 * Run: npx tsx scripts/generate-super-admin-qa-report.ts
 */

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  ShadingType,
  PageBreak,
  Tab,
  TabStopType,
  TabStopPosition,
  NumberFormat,
  Header,
  Footer,
  PageNumber,
  convertInchesToTwip,
  LevelFormat,
} from 'docx';
import * as fs from 'fs';
import * as path from 'path';

// ═══════════════════════════════════════════════════════════════════════════
//  Style Constants
// ═══════════════════════════════════════════════════════════════════════════

const COLORS = {
  primary: '1a56db',
  secondary: '6b7280',
  success: '059669',
  warning: 'd97706',
  danger: 'dc2626',
  lightBg: 'f3f4f6',
  headerBg: '1e40af',
  headerText: 'ffffff',
  white: 'ffffff',
  black: '000000',
  lightBorder: 'd1d5db',
};

const FONT = 'Calibri';

// ═══════════════════════════════════════════════════════════════════════════
//  Helper Functions
// ═══════════════════════════════════════════════════════════════════════════

function heading(text: string, level: 1 | 2 | 3 = 1): Paragraph {
  const sizes: Record<number, number> = { 1: 32, 2: 26, 3: 22 };
  const colors: Record<number, string> = { 1: COLORS.headerBg, 2: COLORS.primary, 3: '374151' };
  return new Paragraph({
    children: [
      new TextRun({
        text,
        bold: true,
        size: sizes[level],
        font: FONT,
        color: colors[level],
      }),
    ],
    spacing: { before: level === 1 ? 400 : 300, after: 200 },
    heading: level === 1 ? HeadingLevel.HEADING_1 : level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
  });
}

function para(text: string, opts?: { bold?: boolean; italic?: boolean; size?: number; color?: string; spacing?: { before?: number; after?: number } }): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({
        text,
        bold: opts?.bold,
        italic: opts?.italic,
        size: opts?.size ?? 21,
        font: FONT,
        color: opts?.color ?? COLORS.black,
      }),
    ],
    spacing: opts?.spacing ?? { after: 120 },
  });
}

function bullet(text: string, level: number = 0): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({
        text,
        size: 21,
        font: FONT,
      }),
    ],
    bullet: { level },
    spacing: { after: 80 },
  });
}

function tableCell(text: string, opts?: { bold?: boolean; color?: string; bg?: string; width?: number; alignment?: typeof AlignmentType[keyof typeof AlignmentType]; fontSize?: number }): TableCell {
  return new TableCell({
    children: [
      new Paragraph({
        children: [
          new TextRun({
            text,
            bold: opts?.bold,
            size: opts?.fontSize ?? 20,
            font: FONT,
            color: opts?.color ?? COLORS.black,
          }),
        ],
        alignment: opts?.alignment,
      }),
    ],
    shading: opts?.bg ? { type: ShadingType.SOLID, color: opts.bg } : undefined,
    width: opts?.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
  });
}

function headerRow(cells: string[]): TableRow {
  return new TableRow({
    children: cells.map((text) =>
      tableCell(text, { bold: true, color: COLORS.headerText, bg: COLORS.headerBg, fontSize: 19 })
    ),
    tableHeader: true,
  });
}

function dataRow(cells: string[], shading?: string): TableRow {
  return new TableRow({
    children: cells.map((text) =>
      tableCell(text, { bg: shading })
    ),
  });
}

function spacer(): Paragraph {
  return new Paragraph({ children: [], spacing: { before: 100, after: 100 } });
}

function divider(): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({
        text: '─'.repeat(80),
        color: COLORS.lightBorder,
        size: 16,
        font: FONT,
      }),
    ],
    spacing: { before: 200, after: 200 },
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  Document Content
// ═══════════════════════════════════════════════════════════════════════════

// ── Feature Inventory ────────────────────────────────────────────────────

const featureInventory = [
  ['SA-001', 'Dashboard', 'Admin Dashboard Home', '/admin', 'Overview stats, quick actions, pending approvals, recent registrations, upcoming classes', 'CRITICAL', 'NOT TESTED'],
  ['SA-002', 'Admin Management', 'List Admin Users', '/admin/admin-management', 'View all admin accounts with roles, statuses, search/filter/sort', 'CRITICAL', 'NOT TESTED'],
  ['SA-003', 'Admin Management', 'Create Admin Account', '/admin/admin-management', 'Create new academic/finance admin with auth + profile + role', 'CRITICAL', 'NOT TESTED'],
  ['SA-004', 'Admin Management', 'Suspend Admin Role', '/admin/admin-management', 'Suspend an approved admin role', 'HIGH', 'NOT TESTED'],
  ['SA-005', 'Admin Management', 'Reactivate Admin Role', '/admin/admin-management', 'Reactivate a suspended/pending admin role', 'HIGH', 'NOT TESTED'],
  ['SA-006', 'Admin Management', 'Revoke Admin Role', '/admin/admin-management', 'Permanently revoke an admin role', 'HIGH', 'NOT TESTED'],
  ['SA-007', 'Trusted Devices', 'View Pending Devices', '/admin/devices', 'View pending device approval queue', 'HIGH', 'NOT TESTED'],
  ['SA-008', 'Trusted Devices', 'Approve Device', '/admin/devices', 'Approve a pending device request', 'HIGH', 'NOT TESTED'],
  ['SA-009', 'Trusted Devices', 'Reject Device', '/admin/devices', 'Reject a pending device with reason', 'HIGH', 'NOT TESTED'],
  ['SA-010', 'Trusted Devices', 'Revoke Device', '/admin/devices', 'Revoke an approved device', 'HIGH', 'NOT TESTED'],
  ['SA-011', 'Audit Logs', 'View Audit Logs', '/admin/audit-logs', 'View paginated audit logs with filters', 'HIGH', 'NOT TESTED'],
  ['SA-012', 'Audit Logs', 'View Audit Summary', '/admin/audit-logs', 'View audit summary counts', 'MEDIUM', 'NOT TESTED'],
  ['SA-013', 'Teacher Management', 'List Teachers', '/admin/teachers', 'Paginated teacher list with status/department/sort', 'CRITICAL', 'NOT TESTED'],
  ['SA-014', 'Teacher Management', 'View Teacher Detail', '/admin/teachers/[id]', 'Full teacher profile and actions', 'HIGH', 'NOT TESTED'],
  ['SA-015', 'Teacher Management', 'Approve Teacher', '/admin/teachers', 'Approve a pending teacher', 'CRITICAL', 'NOT TESTED'],
  ['SA-016', 'Teacher Management', 'Reject Teacher', '/admin/teachers', 'Reject a pending teacher', 'CRITICAL', 'NOT TESTED'],
  ['SA-017', 'Teacher Management', 'Suspend Teacher', '/admin/teachers', 'Suspend an active teacher', 'HIGH', 'NOT TESTED'],
  ['SA-018', 'Teacher Management', 'Activate Teacher', '/admin/teachers', 'Activate suspended/inactive teacher', 'HIGH', 'NOT TESTED'],
  ['SA-019', 'Teacher Management', 'Deactivate Teacher', '/admin/teachers', 'Deactivate an active teacher', 'MEDIUM', 'NOT TESTED'],
  ['SA-020', 'Teacher Management', 'Bulk Approve Teachers', '/admin/teachers', 'Bulk approve multiple pending teachers', 'HIGH', 'NOT TESTED'],
  ['SA-021', 'Teacher Management', 'Bulk Reject Teachers', '/admin/teachers', 'Bulk reject multiple pending teachers', 'HIGH', 'NOT TESTED'],
  ['SA-022', 'Teacher Management', 'Bulk Suspend Teachers', '/admin/teachers', 'Bulk suspend multiple teachers', 'MEDIUM', 'NOT TESTED'],
  ['SA-023', 'Teacher Management', 'Bulk Activate Teachers', '/admin/teachers', 'Bulk activate multiple teachers', 'MEDIUM', 'NOT TESTED'],
  ['SA-024', 'Student Management', 'List Students', '/admin/students', 'Paginated student list with status/batch/sort', 'CRITICAL', 'NOT TESTED'],
  ['SA-025', 'Student Management', 'View Student Detail', '/admin/students/[id]', 'Full student profile and actions', 'HIGH', 'NOT TESTED'],
  ['SA-026', 'Student Management', 'Approve Student', '/admin/students', 'Approve a pending student', 'CRITICAL', 'NOT TESTED'],
  ['SA-027', 'Student Management', 'Reject Student', '/admin/students', 'Reject a pending student', 'CRITICAL', 'NOT TESTED'],
  ['SA-028', 'Student Management', 'Suspend Student', '/admin/students', 'Suspend an active student', 'HIGH', 'NOT TESTED'],
  ['SA-029', 'Student Management', 'Activate Student', '/admin/students', 'Activate suspended/inactive student', 'HIGH', 'NOT TESTED'],
  ['SA-030', 'Student Management', 'Deactivate Student', '/admin/students', 'Deactivate an active student', 'MEDIUM', 'NOT TESTED'],
  ['SA-031', 'Student Management', 'Bulk Approve Students', '/admin/students', 'Bulk approve multiple pending students', 'HIGH', 'NOT TESTED'],
  ['SA-032', 'Student Management', 'Bulk Reject Students', '/admin/students', 'Bulk reject multiple pending students', 'HIGH', 'NOT TESTED'],
  ['SA-033', 'Student Management', 'Bulk Suspend Students', '/admin/students', 'Bulk suspend multiple students', 'MEDIUM', 'NOT TESTED'],
  ['SA-034', 'Student Management', 'Bulk Activate Students', '/admin/students', 'Bulk activate multiple students', 'MEDIUM', 'NOT TESTED'],
  ['SA-035', 'Batch Management', 'List Batches', '/admin/batches', 'Paginated batch list with filters and sort', 'HIGH', 'NOT TESTED'],
  ['SA-036', 'Batch Management', 'View Batch Detail', '/admin/batches/[id]', 'Full batch detail with subjects/teachers', 'HIGH', 'NOT TESTED'],
  ['SA-037', 'Batch Management', 'Create Batch', '/admin/batches', 'Create a new batch', 'HIGH', 'NOT TESTED'],
  ['SA-038', 'Batch Management', 'Update Batch', '/admin/batches/[id]', 'Update batch details', 'MEDIUM', 'NOT TESTED'],
  ['SA-039', 'Batch Management', 'Archive/Restore Batch', '/admin/batches', 'Archive or restore a batch', 'MEDIUM', 'NOT TESTED'],
  ['SA-040', 'Batch Management', 'Delete Batch (Soft)', '/admin/batches', 'Soft delete a batch (no students/tests)', 'HIGH', 'NOT TESTED'],
  ['SA-041', 'Batch Management', 'Assign Students to Batch', '/admin/batches/[id]', 'Add/remove students from a batch', 'HIGH', 'NOT TESTED'],
  ['SA-042', 'Batch Management', 'Assign Subjects to Batch', '/admin/batches/[id]', 'Add/remove subjects from a batch', 'HIGH', 'NOT TESTED'],
  ['SA-043', 'Batch Management', 'Assign Teachers to Subjects', '/admin/batches/[id]', 'Assign/remove teachers to batch subjects', 'HIGH', 'NOT TESTED'],
  ['SA-044', 'Batch Management', 'Assign Content to Batch', '/admin/batches/[id]', 'Add/remove content from a batch', 'MEDIUM', 'NOT TESTED'],
  ['SA-045', 'Batch Management', 'Assign Mock Tests to Batch', '/admin/batches/[id]', 'Add/remove mock tests from a batch', 'MEDIUM', 'NOT TESTED'],
  ['SA-046', 'Attendance', 'View Attendance', '/admin/attendance', 'View attendance records for batches', 'MEDIUM', 'NOT TESTED'],
  ['SA-047', 'Notification', 'Create Notification', '/admin/notifications/create', 'Create and send notification to audience', 'HIGH', 'NOT TESTED'],
  ['SA-048', 'Notification', 'View Notifications List', '/admin/notifications/list', 'View sent notifications', 'MEDIUM', 'NOT TESTED'],
  ['SA-049', 'Notification', 'View Scheduled Notifications', '/admin/notifications/scheduled', 'View scheduled notifications', 'LOW', 'NOT TESTED'],
  ['SA-050', 'Notification', 'View Notification History', '/admin/notifications/history', 'View notification delivery history', 'LOW', 'NOT TESTED'],
  ['SA-051', 'Notification', 'View Notification Detail', '/admin/notifications/[id]', 'View single notification details', 'LOW', 'NOT TESTED'],
  ['SA-052', 'Approval', 'View Approval Workspace', '/admin/approval-workspace', 'Centralized review hub for all approvals', 'HIGH', 'NOT TESTED'],
  ['SA-053', 'Approval', 'Approve Content', '/admin/approval-workspace', 'Approve pending content submissions', 'HIGH', 'NOT TESTED'],
  ['SA-054', 'Approval', 'Reject Content', '/admin/approval-workspace', 'Reject pending content submissions', 'HIGH', 'NOT TESTED'],
  ['SA-055', 'Leave Requests', 'View Leave Requests', '/admin/leave-requests', 'View teacher leave requests', 'MEDIUM', 'NOT TESTED'],
  ['SA-056', 'Leave Requests', 'Approve Leave', '/admin/leave-requests', 'Approve a teacher leave request', 'MEDIUM', 'NOT TESTED'],
  ['SA-057', 'Leave Requests', 'Reject Leave', '/admin/leave-requests', 'Reject a teacher leave request', 'MEDIUM', 'NOT TESTED'],
  ['SA-058', 'Timetable', 'View Timetable', '/admin/timetable', 'View timetable grid', 'MEDIUM', 'NOT TESTED'],
  ['SA-059', 'Timetable', 'Manage Timetable Slots', '/admin/timetable', 'Create/edit timetable slots', 'MEDIUM', 'NOT TESTED'],
  ['SA-060', 'Timetable', 'Bulk Import Timetable', '/admin/timetable/import', 'Import timetable from file', 'MEDIUM', 'NOT TESTED'],
  ['SA-061', 'Timetable', 'Manage Lesson Plans', '/admin/timetable/[slotId]', 'View/edit lesson plans per slot', 'MEDIUM', 'NOT TESTED'],
  ['SA-062', 'Commerce', 'View Commerce Overview', '/admin/commerce', 'Commerce dashboard with metrics', 'HIGH', 'NOT TESTED'],
  ['SA-063', 'Commerce', 'View Orders List', '/admin/commerce/orders', 'Paginated orders list with filters', 'HIGH', 'NOT TESTED'],
  ['SA-064', 'Commerce', 'View Order Detail', '/admin/commerce/orders/[id]', 'View single order detail', 'HIGH', 'NOT TESTED'],
  ['SA-065', 'Commerce', 'View Payments List', '/admin/commerce/payments', 'Paginated payments list', 'HIGH', 'NOT TESTED'],
  ['SA-066', 'Commerce', 'View Course Purchases', '/admin/commerce/courses', 'Paginated course purchases', 'MEDIUM', 'NOT TESTED'],
  ['SA-067', 'Commerce', 'View PYQ Purchases', '/admin/commerce/pyq', 'Paginated PYQ purchases', 'MEDIUM', 'NOT TESTED'],
  ['SA-068', 'Commerce', 'View Subscriptions', '/admin/commerce/subscriptions', 'Paginated subscriptions list', 'HIGH', 'NOT TESTED'],
  ['SA-069', 'Commerce', 'Manage Subscription Plans', '/admin/commerce/subscription-plans', 'CRUD for subscription plans', 'HIGH', 'NOT TESTED'],
  ['SA-070', 'Recycle Bin', 'View Trash', '/admin/trash', 'View soft-deleted records', 'MEDIUM', 'NOT TESTED'],
  ['SA-071', 'Recycle Bin', 'Restore Deleted Record', '/admin/trash', 'Restore a soft-deleted record', 'MEDIUM', 'NOT TESTED'],
  ['SA-072', 'Reports', 'View Reports', '/admin/reports', 'Reports page (placeholder)', 'LOW', 'NOT TESTED'],
  ['SA-073', 'Academic Structure', 'Manage Streams/Subjects', '/admin/academic', 'Manage academic structure', 'MEDIUM', 'NOT TESTED'],
  ['SA-074', 'Course Management', 'Manage Courses', '/admin/courses', 'CRUD for courses', 'MEDIUM', 'NOT TESTED'],
  ['SA-075', 'Questions', 'View Question Bank', '/admin/questions', 'View/manage question bank', 'HIGH', 'NOT TESTED'],
  ['SA-076', 'Mock Tests', 'Manage Mock Tests', '/admin/mock-tests', 'CRUD for mock tests', 'HIGH', 'NOT TESTED'],
  ['SA-077', 'Doubts', 'View Doubts', '/admin/doubts', 'View/manage student doubts', 'MEDIUM', 'NOT TESTED'],
  ['SA-078', 'Content', 'Manage Content', '/admin/content', 'Upload/manage educational content', 'HIGH', 'NOT TESTED'],
  ['SA-079', 'Demo Classes', 'Manage Demo Classes', '/admin/demo-classes', 'CRUD for demo classes', 'MEDIUM', 'NOT TESTED'],
  ['SA-080', 'Auth/Layout', 'RoleGuard Access', '/admin/*', 'Admin role gate for entire admin area', 'CRITICAL', 'NOT TESTED'],
  ['SA-081', 'Auth/Layout', 'AdminRouteGuard Permission Check', '/admin/*', 'Permission-based route protection per route', 'CRITICAL', 'NOT TESTED'],
  ['SA-082', 'Auth/Layout', 'AdminSidebar Navigation', '/admin/*', 'Permission-filtered sidebar navigation', 'HIGH', 'NOT TESTED'],
  ['SA-083', 'Auth/Layout', 'AdminHeader Breadcrumbs + Notifications', '/admin/*', 'Header with breadcrumbs, notification bell, logout', 'HIGH', 'NOT TESTED'],
  ['SA-084', 'Settings', 'System Settings', '/admin/settings', 'System settings management', 'MEDIUM', 'NOT TESTED'],
  ['SA-085', 'PYQ Packages', 'Manage PYQ Packages', '/admin/pyq-packages', 'Manage PYQ packages', 'MEDIUM', 'NOT TESTED'],
];

// ── User Flow Inventory ──────────────────────────────────────────────────

const userFlows = [
  {
    module: 'Dashboard Home',
    flows: [
      'Login → Navigate to /admin → Dashboard loads → Stats cards render → Quick actions visible → Pending approvals count shown',
      'Click "Refresh" → Loading spinner → Data refetched → Updated stats displayed',
      'Click Quick Action card → Navigate to respective module page',
      'Click "View all" on pending approvals → Navigate to /admin/approvals',
    ],
  },
  {
    module: 'Admin Management',
    flows: [
      'Navigate to /admin/admin-management → PermissionGuard checks manageAdmins → DataTable loads admin users',
      'Click "Create Admin" → Dialog opens → Fill form (name, phone, password, role) → Validate → Submit → Edge function creates auth user + profile + role → List refreshes',
      'Click "Suspend" on approved role → Confirm dialog → Confirm → Role status changes to suspended → List refreshes',
      'Click "Reactivate" on suspended/pending role → Confirm dialog → Confirm → Role status changes to approved → List refreshes',
      'Click "Revoke" on non-revoked role → Confirm dialog → Confirm → Role status changes to revoked → List refreshes',
    ],
  },
  {
    module: 'Trusted Devices',
    flows: [
      'Navigate to /admin/devices → Summary chips load → Pending/Approved tab displayed',
      'Click "Approve" on pending device → Confirm dialog → Approve mutation → Device moves to approved list → Previous device auto-revoked',
      'Click "Reject" on pending device → Reason textarea → Reject mutation → Device removed from list',
      'Click "Revoke" on approved device → Confirm dialog → Revoke mutation → Device removed from approved list',
      'Search devices → Client-side filtering by device name/owner/email',
    ],
  },
  {
    module: 'Teacher Management',
    flows: [
      'Navigate to /admin/teachers → Summary cards (counts) load → Paginated teacher list loads',
      'Search/Filter/Sort → Debounced search → Filter by status/department → Sort by various fields',
      'Click "Approve" on pending teacher → Confirm dialog → Approve mutation → Status updated → Cache invalidated → Counts refresh',
      'Click "View" → Navigate to teacher detail page',
      'Select multiple teachers → Bulk action bar appears → Bulk approve/reject/suspend/activate',
      'Bulk action → Confirm dialog → Bulk mutation → Selection cleared → List refreshes',
    ],
  },
  {
    module: 'Student Management',
    flows: [
      'Navigate to /admin/students → Summary cards (counts) load → Paginated student list loads',
      'Search/Filter/Sort → Debounced search → Filter by status/batch → Sort by various fields',
      'Click "Approve" on pending student → Confirm dialog → Approve mutation → Status updated → Cache invalidated → Counts refresh',
      'Select multiple students → Bulk action bar appears → Bulk approve/reject/suspend/activate',
      'Bulk action → Confirm dialog → Bulk mutation → Selection cleared → List refreshes',
    ],
  },
  {
    module: 'Batch Management',
    flows: [
      'Navigate to /admin/batches → Paginated batch list loads with summary stats',
      'Click "Create Batch" → Form → Submit → Batch created → List refreshes',
      'Click batch row → Navigate to batch detail → Tabs (Students, Subjects, Teachers, Content, Mock Tests)',
      'Click "Assign Students" → Dual panel (assigned/available) → Select → Confirm → Students assigned',
      'Click "Assign Subjects" → Similar dual panel flow → Subjects assigned to batch',
      'Archive/Restore/Delete batch → Confirm dialog → Status change → List refreshes',
    ],
  },
  {
    module: 'Commerce',
    flows: [
      'Navigate to /admin/commerce → Commerce dashboard metrics load',
      'Navigate to /admin/commerce/orders → Paginated orders list with filters',
      'Navigate to /admin/commerce/payments → Paginated payments list with filters',
      'Navigate to /admin/commerce/subscriptions → Paginated subscriptions list',
      'Navigate to /admin/commerce/subscription-plans → Plan management CRUD',
    ],
  },
  {
    module: 'Notifications',
    flows: [
      'Navigate to /admin/notifications/create → Form loads → Select audience/priority → Type message → Send',
      'Navigate to /admin/notifications/list → Sent notifications list loads',
      'Navigate to /admin/notifications/scheduled → Scheduled notifications list loads',
    ],
  },
  {
    module: 'Audit Logs',
    flows: [
      'Navigate to /admin/audit-logs → PermissionGuard checks viewAuditLogs → Summary cards + paginated log list loads',
      'Filter by action/resource type → Paginated results → Click to view detail drawer',
    ],
  },
  {
    module: 'Approval Workspace',
    flows: [
      'Navigate to /admin/approval-workspace → Summary stats for all pending approvals load',
      'Click approval type → Filtered list of pending items → Review → Approve/Reject with feedback',
    ],
  },
];

// ── Manual Test Cases ────────────────────────────────────────────────────

const manualTestCases = [
  // Dashboard Home
  ['TC-DASH-001', 'Dashboard', 'Admin dashboard loads correctly', 'Admin is logged in', 'Navigate to /admin', 'Dashboard displays with stats cards, quick actions, pending approvals, recent registrations, upcoming classes', '☐ NOT TESTED'],
  ['TC-DASH-002', 'Dashboard', 'Dashboard loading state', 'Admin is logged in', 'Navigate to /admin while data is loading', 'Skeleton placeholders shown for all sections', '☐ NOT TESTED'],
  ['TC-DASH-003', 'Dashboard', 'Dashboard error state', 'API endpoint is down or returns error', 'Navigate to /admin with network failure', 'Error banner shown with retry button', '☐ NOT TESTED'],
  ['TC-DASH-004', 'Dashboard', 'Dashboard refresh', 'Admin is on dashboard', 'Click "Refresh" button', 'Loading spinner shows, data refreshes, stats update', '☐ NOT TESTED'],
  ['TC-DASH-005', 'Dashboard', 'Quick action navigation', 'Admin is on dashboard', 'Click each quick action card', 'Navigates to the correct module page', '☐ NOT TESTED'],
  ['TC-DASH-006', 'Dashboard', 'Pending approvals navigation', 'Admin is on dashboard', 'Click "View all" on pending approvals', 'Navigates to approval center page', '☐ NOT TESTED'],
  ['TC-DASH-007', 'Dashboard', 'Monthly revenue display', 'Admin is on dashboard', 'Check Monthly Revenue card', 'Revenue shown in ₹ format or "—" if no data', '☐ NOT TESTED'],

  // Admin Management
  ['TC-ADM-001', 'Admin Management', 'List admins', 'Super admin logged in', 'Navigate to /admin/admin-management', 'DataTable shows all admin users with roles, statuses, institute, granted by info', '☐ NOT TESTED'],
  ['TC-ADM-002', 'Admin Management', 'Create admin - valid input', 'Super admin logged in', 'Click "Create Admin" → Fill valid form → Submit', 'Admin created successfully, toast shown, list refreshes', '☐ NOT TESTED'],
  ['TC-ADM-003', 'Admin Management', 'Create admin - empty name', 'Super admin logged in', 'Click "Create Admin" → Leave name empty → Submit', 'Validation error: "Full name is required."', '☐ NOT TESTED'],
  ['TC-ADM-004', 'Admin Management', 'Create admin - invalid phone', 'Super admin logged in', 'Click "Create Admin" → Enter invalid phone → Submit', 'Validation error: "Enter a valid phone with country code"', '☐ NOT TESTED'],
  ['TC-ADM-005', 'Admin Management', 'Create admin - short password', 'Super admin logged in', 'Click "Create Admin" → Enter 4-char password → Submit', 'Validation error: "Password must be at least 6 characters."', '☐ NOT TESTED'],
  ['TC-ADM-006', 'Admin Management', 'Create admin - invalid email', 'Super admin logged in', 'Click "Create Admin" → Enter invalid email → Submit', 'Validation error: "Enter a valid email address."', '☐ NOT TESTED'],
  ['TC-ADM-007', 'Admin Management', 'Create admin - duplicate phone', 'Super admin logged in, phone already exists', 'Click "Create Admin" → Enter existing phone → Submit', 'Error message from server about duplicate phone', '☐ NOT TESTED'],
  ['TC-ADM-008', 'Admin Management', 'Suspend admin role', 'Super admin, approved admin exists', 'Click "Suspend" on approved role → Confirm', 'Role status changes to Suspended, toast shown', '☐ NOT TESTED'],
  ['TC-ADM-009', 'Admin Management', 'Cannot suspend own super admin role', 'Super admin logged in', 'Check action buttons on own super_admin role', 'Suspend button disabled with "You cannot modify your own super admin role" tooltip', '☐ NOT TESTED'],
  ['TC-ADM-010', 'Admin Management', 'Reactivate suspended role', 'Super admin, suspended admin exists', 'Click "Reactivate" on suspended role → Confirm', 'Role status changes to Approved, toast shown', '☐ NOT TESTED'],
  ['TC-ADM-011', 'Admin Management', 'Revoke admin role', 'Super admin, non-revoked role exists', 'Click "Revoke" → Confirm', 'Role status changes to Revoked, toast shown', '☐ NOT TESTED'],
  ['TC-ADM-012', 'Admin Management', 'Search admins', 'Super admin, multiple admins exist', 'Type in search bar', 'List filters by name, email, or phone (debounced)', '☐ NOT TESTED'],
  ['TC-ADM-013', 'Admin Management', 'Filter by role', 'Super admin, admins with different roles exist', 'Select role filter', 'List shows only admins with that role', '☐ NOT TESTED'],
  ['TC-ADM-014', 'Admin Management', 'Filter by status', 'Super admin, admins with different statuses exist', 'Select status filter', 'List shows only admins with that role status', '☐ NOT TESTED'],

  // Trusted Devices
  ['TC-DEV-001', 'Trusted Devices', 'View pending devices', 'Super admin logged in', 'Navigate to /admin/devices', 'Summary chips show counts, pending tab active, devices listed', '☐ NOT TESTED'],
  ['TC-DEV-002', 'Trusted Devices', 'Approve device', 'Super admin, pending device exists', 'Click "Approve" → Confirm', 'Device approved, moves to approved tab, toast shown', '☐ NOT TESTED'],
  ['TC-DEV-003', 'Trusted Devices', 'Reject device with reason', 'Super admin, pending device exists', 'Click "Reject" → Enter reason → Reject', 'Device rejected, removed from list, toast shown', '☐ NOT TESTED'],
  ['TC-DEV-004', 'Trusted Devices', 'Revoke approved device', 'Super admin, approved device exists', 'Click "Revoke" → Confirm', 'Device revoked, removed from approved list, toast shown', '☐ NOT TESTED'],
  ['TC-DEV-005', 'Trusted Devices', 'Switch tabs', 'Super admin on devices page', 'Click between Pending/Approved tabs', 'Correct list shown for each tab', '☐ NOT TESTED'],
  ['TC-DEV-006', 'Trusted Devices', 'Search devices', 'Super admin, multiple devices exist', 'Type in search bar', 'List filters by device name, owner name, or email', '☐ NOT TESTED'],

  // Teacher Management
  ['TC-TCH-001', 'Teacher Management', 'List teachers with pagination', 'Admin logged in', 'Navigate to /admin/teachers', 'Summary cards + paginated teacher list loads', '☐ NOT TESTED'],
  ['TC-TCH-002', 'Teacher Management', 'Approve pending teacher', 'Admin, pending teacher exists', 'Click "Approve" on pending teacher → Confirm', 'Teacher status changes to approved, list refreshes', '☐ NOT TESTED'],
  ['TC-TCH-003', 'Teacher Management', 'Reject pending teacher', 'Admin, pending teacher exists', 'Click "Reject" on pending teacher → Confirm', 'Teacher status changes to rejected, list refreshes', '☐ NOT TESTED'],
  ['TC-TCH-004', 'Teacher Management', 'Suspend approved teacher', 'Admin, approved teacher exists', 'Click "Suspend" → Confirm', 'Teacher status changes to suspended', '☐ NOT TESTED'],
  ['TC-TCH-005', 'Teacher Management', 'Activate suspended teacher', 'Admin, suspended teacher exists', 'Click "Activate" → Confirm', 'Teacher status changes to approved', '☐ NOT TESTED'],
  ['TC-TCH-006', 'Teacher Management', 'Bulk approve teachers', 'Admin, multiple pending teachers exist', 'Select multiple pending → Click "Approve Selected" → Confirm', 'All selected teachers approved, selection cleared', '☐ NOT TESTED'],
  ['TC-TCH-007', 'Teacher Management', 'Search teachers', 'Admin, teachers exist', 'Type in search bar', 'List filters by name or email (debounced)', '☐ NOT TESTED'],
  ['TC-TCH-008', 'Teacher Management', 'Filter by department', 'Admin, teachers with departments exist', 'Select department filter', 'List shows only teachers in that department', '☐ NOT TESTED'],
  ['TC-TCH-009', 'Teacher Management', 'Filter by status', 'Admin, teachers with different statuses exist', 'Select status filter', 'List shows only teachers with that status', '☐ NOT TESTED'],
  ['TC-TCH-010', 'Teacher Management', 'Pagination', 'Admin, more than 15 teachers exist', 'Navigate through pages', 'Correct data shown per page, page count correct', '☐ NOT TESTED'],
  ['TC-TCH-011', 'Teacher Management', 'View teacher detail', 'Admin, teacher exists', 'Click "View" on teacher row', 'Navigates to teacher detail page', '☐ NOT TESTED'],
  ['TC-TCH-012', 'Teacher Management', 'Mixed status bulk selection blocked', 'Admin, teachers with different statuses selected', 'Select teachers with different statuses', 'No bulk action bar shown (all selected must have same status)', '☐ NOT TESTED'],

  // Student Management
  ['TC-STU-001', 'Student Management', 'List students with pagination', 'Admin logged in', 'Navigate to /admin/students', 'Summary cards + paginated student list loads', '☐ NOT TESTED'],
  ['TC-STU-002', 'Student Management', 'Approve pending student', 'Admin, pending student exists', 'Click "Approve" → Confirm', 'Student status changes to approved, list refreshes', '☐ NOT TESTED'],
  ['TC-STU-003', 'Student Management', 'Reject pending student', 'Admin, pending student exists', 'Click "Reject" → Confirm', 'Student status changes to rejected', '☐ NOT TESTED'],
  ['TC-STU-004', 'Student Management', 'Suspend approved student', 'Admin, approved student exists', 'Click "Suspend" → Confirm', 'Student status changes to suspended', '☐ NOT TESTED'],
  ['TC-STU-005', 'Student Management', 'Activate suspended student', 'Admin, suspended student exists', 'Click "Activate" → Confirm', 'Student status changes to approved', '☐ NOT TESTED'],
  ['TC-STU-006', 'Student Management', 'Bulk approve students', 'Admin, multiple pending students exist', 'Select multiple pending → Click "Approve Selected" → Confirm', 'All selected students approved, selection cleared', '☐ NOT TESTED'],
  ['TC-STU-007', 'Student Management', 'Search students', 'Admin, students exist', 'Type in search bar', 'List filters by name or email (debounced)', '☐ NOT TESTED'],

  // Batch Management
  ['TC-BAT-001', 'Batch Management', 'List batches', 'Admin logged in', 'Navigate to /admin/batches', 'Paginated batch list with summary stats loads', '☐ NOT TESTED'],
  ['TC-BAT-002', 'Batch Management', 'Create batch', 'Admin logged in', 'Click create → Fill form → Submit', 'Batch created, list refreshes', '☐ NOT TESTED'],
  ['TC-BAT-003', 'Batch Management', 'Assign students to batch', 'Admin, batch exists', 'Navigate to batch detail → Students tab → Assign', 'Students assigned, counts updated', '☐ NOT TESTED'],
  ['TC-BAT-004', 'Batch Management', 'Archive batch', 'Admin, active batch exists', 'Click archive → Confirm', 'Batch status changes to archived', '☐ NOT TESTED'],

  // Notifications
  ['TC-NOT-001', 'Notifications', 'Create notification', 'Admin logged in', 'Navigate to /admin/notifications/create → Fill form → Send', 'Notification sent, success message shown', '☐ NOT TESTED'],
  ['TC-NOT-002', 'Notifications', 'Create notification - empty title', 'Admin on create page', 'Leave title empty → Submit', 'Validation error shown', '☐ NOT TESTED'],
  ['TC-NOT-003', 'Notifications', 'Create notification - empty body', 'Admin on create page', 'Leave body empty → Submit', 'Validation error shown', '☐ NOT TESTED'],

  // Commerce
  ['TC-COM-001', 'Commerce', 'View commerce metrics', 'Finance admin or super admin', 'Navigate to /admin/commerce', 'Commerce dashboard with metrics loads', '☐ NOT TESTED'],
  ['TC-COM-002', 'Commerce', 'View orders list', 'Finance admin or super admin', 'Navigate to /admin/commerce/orders', 'Paginated orders list loads', '☐ NOT TESTED'],
  ['TC-COM-003', 'Commerce', 'View subscriptions list', 'Finance admin or super admin', 'Navigate to /admin/commerce/subscriptions', 'Paginated subscriptions list loads', '☐ NOT TESTED'],

  // Audit Logs
  ['TC-AUD-001', 'Audit Logs', 'View audit logs', 'Super admin logged in', 'Navigate to /admin/audit-logs', 'Summary cards + paginated audit log list loads', '☐ NOT TESTED'],
  ['TC-AUD-002', 'Audit Logs', 'Filter by action type', 'Audit logs loaded', 'Select action type filter', 'List shows only logs with that action type', '☐ NOT TESTED'],
  ['TC-AUD-003', 'Audit Logs', 'View audit log detail', 'Audit logs loaded', 'Click on a log entry', 'Detail drawer opens with full log info', '☐ NOT TESTED'],

  // Layout/Auth
  ['TC-LAY-001', 'Layout', 'RoleGuard blocks non-admin', 'Non-admin user logged in', 'Navigate to /admin', 'Redirected away from admin area', '☐ NOT TESTED'],
  ['TC-LAY-002', 'Layout', 'Route guard blocks restricted routes', 'Academic admin logged in', 'Navigate to /admin/admin-management', 'Redirected to /admin dashboard', '☐ NOT TESTED'],
  ['TC-LAY-003', 'Layout', 'Sidebar shows only permitted items', 'Finance admin logged in', 'Check sidebar navigation', 'Only finance-accessible items shown', '☐ NOT TESTED'],
  ['TC-LAY-004', 'Layout', 'Notification bell shows unread count', 'Admin with unread notifications', 'Check header notification bell', 'Badge shows unread count', '☐ NOT TESTED'],
  ['TC-LAY-005', 'Layout', 'Logout', 'Admin logged in', 'Click logout button', 'Logged out, redirected to home', '☐ NOT TESTED'],
  ['TC-LAY-006', 'Layout', 'Breadcrumbs reflect current page', 'Admin on any admin page', 'Check header breadcrumbs', 'Breadcrumbs match current route', '☐ NOT TESTED'],
];

// ── Security Test Cases ──────────────────────────────────────────────────

const securityTestCases = [
  ['SEC-001', 'Non-admin access to admin area', 'User with role=student/teacher navigates to /admin', 'RoleGuard should block access and redirect', '☐ NOT TESTED'],
  ['SEC-002', 'Academic admin accessing Super Admin only routes', 'Academic admin navigates to /admin/admin-management', 'AdminRouteGuard should redirect to /admin', '☐ NOT TESTED'],
  ['SEC-003', 'Finance admin accessing academic routes', 'Finance admin navigates to /admin/teachers', 'AdminRouteGuard should redirect to /admin', '☐ NOT TESTED'],
  ['SEC-004', 'Direct URL access without session', 'Unauthenticated user navigates to /admin/admin-management', 'Should redirect to login', '☐ NOT TESTED'],
  ['SEC-005', 'Admin cannot modify own super admin role', 'Super admin checks action buttons on own super_admin role', 'Suspend/Revoke buttons disabled', '☐ NOT TESTED'],
  ['SEC-006', 'Cross-institute data isolation', 'Super admin from Institute A checks data', 'Should only see Institute A data (RLS enforced)', '☐ NOT TESTED'],
  ['SEC-007', 'RLS on admin_roles table', 'Non-super-admin attempts direct API call to modify admin_roles', 'RLS should block the operation', '☐ NOT TESTED'],
  ['SEC-008', 'RLS on trusted_devices table', 'Non-super-admin attempts direct API call for device management', 'RLS should block the operation', '☐ NOT TESTED'],
  ['SEC-009', 'RLS on audit_logs table', 'Non-super-admin attempts direct API call for audit logs', 'RLS should block the operation', '☐ NOT TESTED'],
  ['SEC-010', 'RLS on profiles table', 'Admin attempts to view/modify profiles outside their institute', 'RLS should restrict access', '☐ NOT TESTED'],
  ['SEC-011', 'Device blocking enforcement', 'Admin with status "blocked" navigates to any admin page', 'Should redirect to device-pending/device-expired/device-rejected screen', '☐ NOT TESTED'],
  ['SEC-012', 'Session expiration handling', 'Admin session expires while on admin page', 'Should redirect to login on next API call', '☐ NOT TESTED'],
  ['SEC-013', 'Admin creation authorization', 'Academic admin attempts to create new admin', 'Should be blocked by manageAdmins permission check', '☐ NOT TESTED'],
  ['SEC-014', 'Edge function service role usage', 'Review admin-identity-create edge function', 'Service role should only be used for admin creation, not exposed to client', '☐ NOT TESTED'],
  ['SEC-015', 'Permission check is server-side, not client-only', 'Inspect AdminRouteGuard implementation', 'Permission check should be backed by RLS and edge function auth, not just UI hiding', '☐ NOT TESTED'],
  ['SEC-016', 'Bulk operation authorization', 'Academic admin attempts bulk teacher approve via direct API', 'RLS should block: only super_admin and academic_admin can approve teachers', '☐ NOT TESTED'],
  ['SEC-017', 'Notification creation authorization', 'Finance admin attempts to create notification', 'Should be blocked if notification creation requires approveAcademicResources', '☐ NOT TESTED'],
];

// ── Database Tables Involved ─────────────────────────────────────────────

const databaseTables = [
  ['profiles', 'User profiles (admin, teacher, student)', 'profile_id, name, email, phone, role, account_status, institute_id'],
  ['admin_roles', 'Admin role assignments', 'admin_role_id, profile_id, institute_id, admin_role, access_status, granted_by'],
  ['teacher_details', 'Teacher profile extensions', 'teacher_id, profile_id, department'],
  ['student_details', 'Student profile extensions', 'student_id, profile_id, enrollment_no, target_year, batch_id'],
  ['batches', 'Batch management', 'batch_id, name, stream_id, status, capacity'],
  ['batch_students', 'Student-batch assignments', 'batch_id, student_id'],
  ['batch_subjects', 'Subject assignments to batches', 'batch_subject_id, batch_id, subject_id'],
  ['batch_subject_teachers', 'Teacher assignments to batch subjects', 'batch_subject_teacher_id, batch_subject_id, teacher_id'],
  ['batch_subject_contents', 'Content assignments to batch subjects', 'content_id, batch_subject_id'],
  ['batch_subject_mock_tests', 'Mock test assignments to batch subjects', 'test_id, batch_subject_id'],
  ['questions', 'Question bank', 'question_id, status, content'],
  ['mock_tests', 'Mock test definitions', 'test_id, status, title'],
  ['approval_requests', 'Approval workflow', 'approval_id, resource_type, status'],
  ['audit_logs', 'System audit trail', 'log_id, action, resource_type, resource_id, actor_id'],
  ['trusted_devices', 'Device approval records', 'device_id, profile_id, status, device_name'],
  ['orders', 'Commerce orders', 'order_id, total_amount, status'],
  ['payments', 'Commerce payments', 'payment_id, order_id, amount, status'],
  ['subscriptions', 'Subscription records', 'subscription_id, student_id, plan_id, status'],
  ['subscription_plans', 'Subscription plan definitions', 'plan_id, name, price'],
  ['notifications', 'Notification records', 'notification_id, title, body, audience_type'],
  ['live_classes', 'Live class scheduling', 'class_id, title, scheduled_at, status'],
  ['courses', 'Course definitions', 'course_id, name, status'],
  ['content', 'Educational content', 'content_id, title, type, status'],
  ['streams', 'Academic streams', 'stream_id, name'],
  ['subjects', 'Academic subjects', 'subject_id, name'],
  ['teacher_leave_requests', 'Teacher leave management', 'leave_id, teacher_id, status'],
  ['holidays', 'Institute holidays', 'holiday_id, date, institute_id'],
  ['timetable_slots', 'Timetable management', 'slot_id, batch_id, subject_id, teacher_id'],
  ['pyq_packages', 'PYQ package management', 'package_id, title, status'],
  ['soft_deleted_records', 'Trash/Recycle Bin', 'record_id, resource_type, resource_id, deleted_at'],
];

// ═══════════════════════════════════════════════════════════════════════════
//  Build the Document
// ═══════════════════════════════════════════════════════════════════════════

const children: Paragraph[] = [];

// ── Title Page ───────────────────────────────────────────────────────────

children.push(new Paragraph({ children: [], spacing: { before: 3000 } }));
children.push(
  new Paragraph({
    children: [
      new TextRun({
        text: 'SUPER ADMIN DASHBOARD',
        bold: true,
        size: 52,
        font: FONT,
        color: COLORS.headerBg,
      }),
    ],
    alignment: AlignmentType.CENTER,
    spacing: { after: 200 },
  })
);
children.push(
  new Paragraph({
    children: [
      new TextRun({
        text: 'Testing & Production Readiness Plan',
        bold: true,
        size: 36,
        font: FONT,
        color: COLORS.primary,
      }),
    ],
    alignment: AlignmentType.CENTER,
    spacing: { after: 400 },
  })
);
children.push(
  new Paragraph({
    children: [
      new TextRun({
        text: 'Testing Plan Created — Testing Not Started',
        bold: true,
        size: 26,
        font: FONT,
        color: COLORS.warning,
      }),
    ],
    alignment: AlignmentType.CENTER,
    spacing: { after: 600 },
  })
);
children.push(divider());

// ── Project Info Table ───────────────────────────────────────────────────

children.push(heading('1. Project Information', 2));
children.push(
  new Table({
    rows: [
      new TableRow({
        children: [
          tableCell('Project Name', { bold: true, bg: COLORS.lightBg }),
          tableCell('Mock Test Admin Platform'),
        ],
      }),
      new TableRow({
        children: [
          tableCell('Document Type', { bold: true, bg: COLORS.lightBg }),
          tableCell('Testing & Production Readiness Plan'),
        ],
      }),
      new TableRow({
        children: [
          tableCell('Module', { bold: true, bg: COLORS.lightBg }),
          tableCell('Super Admin Dashboard'),
        ],
      }),
      new TableRow({
        children: [
          tableCell('Generated On', { bold: true, bg: COLORS.lightBg }),
          tableCell('August 18, 2026'),
        ],
      }),
      new TableRow({
        children: [
          tableCell('Status', { bold: true, bg: COLORS.lightBg }),
          tableCell('TESTING PLAN CREATED — TESTING NOT STARTED'),
        ],
      }),
      new TableRow({
        children: [
          tableCell('Prepared By', { bold: true, bg: COLORS.lightBg }),
          tableCell('Buffy (Codebuff AI Agent)'),
        ],
      }),
    ],
    width: { size: 100, type: WidthType.PERCENTAGE },
  })
);

children.push(spacer());

// ── Purpose ──────────────────────────────────────────────────────────────

children.push(heading('2. Purpose of This Document', 2));
children.push(
  para(
    'This document establishes the testing roadmap and readiness checklist for the Super Admin Dashboard. It identifies all modules, features, user flows, and test cases that must be validated before the module can be declared production-ready.'
  )
);
children.push(
  para(
    'This is a PRE-TESTING document. No testing has been performed. No bugs have been identified. No features have been marked as passed. The purpose is to define WHAT needs to be tested during the subsequent module-by-module testing phase.',
    { bold: true }
  )
);
children.push(spacer());

// ── Scope ────────────────────────────────────────────────────────────────

children.push(heading('3. Scope', 2));
children.push(heading('3.1 In Scope', 3));
children.push(bullet('Super Admin Dashboard home page'));
children.push(bullet('Admin Management (create, suspend, reactivate, revoke admin roles)'));
children.push(bullet('Trusted Device Management (approve, reject, revoke devices)'));
children.push(bullet('Audit Logs (view, filter, detail)'));
children.push(bullet('Teacher Management (CRUD lifecycle, bulk actions)'));
children.push(bullet('Student Management (CRUD lifecycle, bulk actions)'));
children.push(bullet('Batch Management (CRUD, student/subject/teacher/content/mock test assignments)'));
children.push(bullet('Attendance module'));
children.push(bullet('Notification system (create, list, history, scheduled, detail)'));
children.push(bullet('Approval Workspace (centralized review hub)'));
children.push(bullet('Leave Requests (view, approve, reject)'));
children.push(bullet('Timetable Management (view, create, bulk import, lesson plans)'));
children.push(bullet('Commerce module (orders, payments, subscriptions, course/purchases)'));
children.push(bullet('Recycle Bin (view soft-deleted records, restore)'));
children.push(bullet('Academic Structure (streams, subjects, chapters, topics)'));
children.push(bullet('Course Management'));
children.push(bullet('Question Bank'));
children.push(bullet('Mock Tests'));
children.push(bullet('Content Management'));
children.push(bullet('Doubts'));
children.push(bullet('Demo Classes'));
children.push(bullet('PYQ Packages'));
children.push(bullet('System Settings'));
children.push(bullet('Admin Layout (sidebar, header, breadcrumbs, auth/permission guards)'));

children.push(heading('3.2 Out of Scope', 3));
children.push(bullet('Teacher Dashboard'));
children.push(bullet('Student Dashboard'));
children.push(bullet('Academic Dashboard'));
children.push(bullet('Finance Dashboard'));
children.push(bullet('Deleted /dev/demo routes'));
children.push(bullet('Performance/load testing'));
children.push(bullet('E2E browser automation testing'));

children.push(spacer());

// ── Dashboard Overview ───────────────────────────────────────────────────

children.push(heading('4. Super Admin Dashboard Overview', 2));

children.push(heading('4.1 Architecture', 3));
children.push(
  para(
    'The Super Admin Dashboard is built with Next.js (App Router) and uses a layered architecture:'
  )
);
children.push(bullet('Layout: /admin/layout.tsx → RoleGuard (role=admin) → AdminRouteGuard (permission-based) → AdminSidebar + AdminHeader + children'));
children.push(bullet('Pages: /admin/page.tsx (home) and ~25+ sub-route pages'));
children.push(bullet('Components: Shared UI (DataTable, ConfirmDialog, PageHeader, SearchBar, Select, etc.) + Admin-specific (AdminSidebar, AdminHeader, AdminRouteGuard, PermissionGuard, AuditSummaryCards, AuditDetailDrawer, etc.)'));
children.push(bullet('Hooks: React Query hooks in src/hooks/admin/ (~30 hooks)'));
children.push(bullet('Services: Backend service layer in src/services/admin/ (~28 services)'));
children.push(bullet('Auth: Supabase Auth + custom permission model (super_admin, academic_admin, finance_admin)'));
children.push(bullet('Database: Supabase PostgreSQL with RLS policies'));
children.push(bullet('Edge Functions: Supabase Edge Functions for sensitive operations'));

children.push(heading('4.2 Permission Model', 3));
children.push(
  para('Three admin roles with distinct permission sets:')
);
children.push(bullet('super_admin: ALL permissions (manageAdmins, approveAcademicResources, accessFinance, viewAuditLogs, restoreDeletedData, manageSystemSettings)'));
children.push(bullet('academic_admin: approveAcademicResources only'));
children.push(bullet('finance_admin: accessFinance only'));
children.push(
  para(
    'Permission enforcement is two-layered: (1) Client-side: AdminSidebar hides menu items, AdminRouteGuard redirects, PermissionGuard hides sections. (2) Server-side: RLS policies on database tables restrict data access by role and institute.',
    { italic: true }
  )
);

children.push(heading('4.3 Key Technical Details', 3));
children.push(bullet('React Query for data fetching with configurable stale times (1-5 minutes)'));
children.push(bullet('Client-side filtering, sorting, and pagination for small lists'));
children.push(bullet('Server-side pagination for large lists (teachers, students, batches, audit logs)'));
children.push(bullet('Debounced search (300-400ms) to prevent rapid re-fetching'));
children.push(bullet('Optimistic cache invalidation on mutations'));
children.push(bullet('Toast-based feedback for success/error states'));
children.push(bullet('ConfirmDialog for destructive actions'));
children.push(bullet('PermissionGuard for in-page section-level hiding'));

children.push(spacer());

// ── Feature Inventory ────────────────────────────────────────────────────

children.push(new Paragraph({ children: [], spacing: { before: 200 } }));
children.push(heading('5. Feature / Module Inventory', 2));
children.push(
  para(
    'Complete inventory of all Super Admin Dashboard features identified in the codebase. Each feature has been traced through actual code imports and route definitions.',
    { italic: true }
  )
);

// Split into table chunks to avoid exceeding limits
const chunkSize = 25;
for (let i = 0; i < featureInventory.length; i += chunkSize) {
  const chunk = featureInventory.slice(i, i + chunkSize);
  children.push(
    new Table({
      rows: [
        headerRow(['ID', 'Module', 'Feature', 'Route/Page', 'Purpose', 'Priority', 'Status']),
        ...chunk.map((row) =>
          dataRow(row, i % 50 === 0 ? undefined : undefined)
        ),
      ],
      width: { size: 100, type: WidthType.PERCENTAGE },
    })
  );
  if (i + chunkSize < featureInventory.length) {
    children.push(spacer());
  }
}

children.push(
  para(
    `Total features identified: ${featureInventory.length}`,
    { bold: true, spacing: { before: 200, after: 100 } }
  )
);

// Module summary
const moduleCounts = new Map<string, number>();
featureInventory.forEach((row) => {
  const mod = row[1];
  moduleCounts.set(mod, (moduleCounts.get(mod) || 0) + 1);
});

children.push(heading('5.1 Feature Count by Module', 3));
children.push(
  new Table({
    rows: [
      headerRow(['Module', 'Feature Count']),
      ...Array.from(moduleCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([mod, count]) => dataRow([mod, count.toString()])),
    ],
    width: { size: 60, type: WidthType.PERCENTAGE },
  })
);

children.push(spacer());

// ── User Flow Inventory ──────────────────────────────────────────────────

children.push(heading('6. User Flow Inventory', 2));
children.push(
  para('Documented user workflows for each module based on actual codebase analysis.')
);

userFlows.forEach((flow) => {
  children.push(heading(`6.${userFlows.indexOf(flow) + 1} ${flow.module}`, 3));
  flow.flows.forEach((f) => {
    children.push(bullet(f));
  });
});

children.push(spacer());

// ── Manual Test Cases ────────────────────────────────────────────────────

children.push(new Paragraph({ children: [], spacing: { before: 200 } }));
children.push(heading('7. Manual Test Case Plan', 2));
children.push(
  para(
    `Total manual test cases created: ${manualTestCases.length}. All test cases are initially set to "NOT TESTED". They will be executed during the module-by-module testing phase.`,
    { bold: true }
  )
);

// Split test cases into manageable chunks
const testChunkSize = 20;
for (let i = 0; i < manualTestCases.length; i += testChunkSize) {
  const chunk = manualTestCases.slice(i, i + testChunkSize);
  children.push(
    new Table({
      rows: [
        headerRow(['Test ID', 'Module', 'Scenario', 'Preconditions', 'Steps', 'Expected Result', 'Status']),
        ...chunk.map((row) => dataRow(row)),
      ],
      width: { size: 100, type: WidthType.PERCENTAGE },
    })
  );
  if (i + testChunkSize < manualTestCases.length) {
    children.push(spacer());
  }
}

children.push(spacer());

// ── Security Test Plan ───────────────────────────────────────────────────

children.push(heading('8. Security Test Plan', 2));
children.push(
  para(
    `${securityTestCases.length} security test cases created. These cover authentication, authorization, RLS, cross-tenant isolation, privilege escalation, and sensitive data exposure.`,
    { bold: true }
  )
);

children.push(
  new Table({
    rows: [
      headerRow(['Test ID', 'Scenario', 'Expected Behaviour', 'Status']),
      ...securityTestCases.map((row) => dataRow(row)),
    ],
    width: { size: 100, type: WidthType.PERCENTAGE },
  })
);

children.push(spacer());

// ── Automated Test Coverage ──────────────────────────────────────────────

children.push(heading('9. Automated Test Coverage', 2));
children.push(heading('9.1 Existing Test Files', 3));
children.push(
  para(
    'The project has 9 test files total. None are specific to the Super Admin Dashboard.'
  )
);

const testFiles = [
  ['src/hooks/__tests__/doubtQueryKeys.test.ts', 'Doubt query key factory', 'No', 'LOW'],
  ['src/hooks/__tests__/teacherLeaveQueryKeys.test.ts', 'Teacher leave query keys', 'Partial', 'LOW'],
  ['src/utils/__tests__/bulkTimetableParser.test.ts', 'Bulk timetable parser', 'Partial', 'MEDIUM'],
  ['src/utils/__tests__/bulkTimetableValidator.test.ts', 'Bulk timetable validator', 'Partial', 'MEDIUM'],
  ['src/utils/__tests__/doubtErrors.test.ts', 'Doubt error handling', 'No', 'LOW'],
  ['src/utils/__tests__/doubtMappers.test.ts', 'Doubt data mappers', 'No', 'LOW'],
  ['src/utils/__tests__/notificationDoubt.test.ts', 'Notification doubt utils', 'No', 'LOW'],
  ['src/utils/__tests__/teacherLeaveErrors.test.ts', 'Teacher leave error handling', 'No', 'LOW'],
  ['src/utils/__tests__/teacherLeaveMappers.test.ts', 'Teacher leave data mappers', 'No', 'LOW'],
];

children.push(
  new Table({
    rows: [
      headerRow(['Test File', 'What It Tests', 'Admin Dashboard Relevant?', 'Priority']),
      ...testFiles.map((row) => dataRow(row)),
    ],
    width: { size: 100, type: WidthType.PERCENTAGE },
  })
);

children.push(spacer());

children.push(heading('9.2 Coverage Gap Analysis', 3));
children.push(
  para('The following critical admin functionality has NO automated test coverage:')
);

const gaps = [
  'Dashboard home page (stats loading, error states, refresh)',
  'Admin management (CRUD, role lifecycle)',
  'Trusted device management (approve, reject, revoke)',
  'Teacher lifecycle management (CRUD, bulk actions)',
  'Student lifecycle management (CRUD, bulk actions)',
  'Batch management (CRUD, assignments)',
  'Permission system (usePermissions, permissionService, AdminRouteGuard)',
  'Commerce module (orders, payments, subscriptions)',
  'Audit log viewing and filtering',
  'Notification creation and delivery',
  'Approval workspace workflow',
  'Leave request management',
  'Timetable management',
  'Recycle bin / soft delete restore',
];

gaps.forEach((gap) => children.push(bullet(gap)));

children.push(
  para(
    'NOTE: The 2 timetable-related test files (bulkTimetableParser.test.ts and bulkTimetableValidator.test.ts) provide partial coverage for the timetable import feature only.',
    { italic: true }
  )
);

children.push(spacer());

// ── Database Tables ──────────────────────────────────────────────────────

children.push(heading('10. Database Tables Involved', 2));
children.push(
  para(
    'Tables involved in the Super Admin Dashboard functionality. RLS policies must be verified for each.'
  )
);

children.push(
  new Table({
    rows: [
      headerRow(['Table', 'Purpose', 'Key Columns']),
      ...databaseTables.map((row) => dataRow(row)),
    ],
    width: { size: 100, type: WidthType.PERCENTAGE },
  })
);

children.push(spacer());

// ── Module Completion Tracker ────────────────────────────────────────────

children.push(heading('11. Module Completion Tracker', 2));
children.push(
  para(
    'This tracker will be updated as each module is tested. Currently all modules are in the "Analysis Complete" state with testing not yet started.'
  )
);

const modules = [
  ['Dashboard Home', '✅', '☐', '☐', '☐', '☐', '☐', 'NOT STARTED'],
  ['Admin Management', '✅', '☐', '☐', '☐', '☐', '☐', 'NOT STARTED'],
  ['Trusted Devices', '✅', '☐', '☐', '☐', '☐', '☐', 'NOT STARTED'],
  ['Audit Logs', '✅', '☐', '☐', '☐', '☐', '☐', 'NOT STARTED'],
  ['Teacher Management', '✅', '☐', '☐', '☐', '☐', '☐', 'NOT STARTED'],
  ['Student Management', '✅', '☐', '☐', '☐', '☐', '☐', 'NOT STARTED'],
  ['Batch Management', '✅', '☐', '☐', '☐', '☐', '☐', 'NOT STARTED'],
  ['Attendance', '✅', '☐', '☐', '☐', '☐', '☐', 'NOT STARTED'],
  ['Notifications', '✅', '☐', '☐', '☐', '☐', '☐', 'NOT STARTED'],
  ['Approval Workspace', '✅', '☐', '☐', '☐', '☐', '☐', 'NOT STARTED'],
  ['Leave Requests', '✅', '☐', '☐', '☐', '☐', '☐', 'NOT STARTED'],
  ['Timetable', '✅', '☐', '☐', '☐', '☐', '☐', 'NOT STARTED'],
  ['Commerce', '✅', '☐', '☐', '☐', '☐', '☐', 'NOT STARTED'],
  ['Recycle Bin', '✅', '☐', '☐', '☐', '☐', '☐', 'NOT STARTED'],
  ['Academic Structure', '✅', '☐', '☐', '☐', '☐', '☐', 'NOT STARTED'],
  ['Course Management', '✅', '☐', '☐', '☐', '☐', '☐', 'NOT STARTED'],
  ['Question Bank', '✅', '☐', '☐', '☐', '☐', '☐', 'NOT STARTED'],
  ['Mock Tests', '✅', '☐', '☐', '☐', '☐', '☐', 'NOT STARTED'],
  ['Content Management', '✅', '☐', '☐', '☐', '☐', '☐', 'NOT STARTED'],
  ['Doubts', '✅', '☐', '☐', '☐', '☐', '☐', 'NOT STARTED'],
  ['Demo Classes', '✅', '☐', '☐', '☐', '☐', '☐', 'NOT STARTED'],
  ['PYQ Packages', '✅', '☐', '☐', '☐', '☐', '☐', 'NOT STARTED'],
  ['Settings', '✅', '☐', '☐', '☐', '☐', '☐', 'NOT STARTED'],
  ['Layout/Auth Guards', '✅', '☐', '☐', '☐', '☐', '☐', 'NOT STARTED'],
];

children.push(
  new Table({
    rows: [
      headerRow(['Module', 'Analysis', 'Bug Testing', 'Fixes', 'Auto Test', 'Manual Test', 'Regression', 'Status']),
      ...modules.map((row) => dataRow(row)),
    ],
    width: { size: 100, type: WidthType.PERCENTAGE },
  })
);

children.push(spacer());

// ── Bug Tracking Register ────────────────────────────────────────────────

children.push(heading('12. Bug Tracking Register', 2));
children.push(
  para(
    'Empty register for confirmed bugs discovered during module-by-module testing. Currently no bugs have been identified.',
    { italic: true }
  )
);

children.push(
  new Table({
    rows: [
      headerRow(['Bug ID', 'Module', 'Description', 'Severity', 'File/Location', 'Status', 'Verification']),
      dataRow(['—', '—', 'No bugs identified yet — testing has not started', '—', '—', '—', '—']),
    ],
    width: { size: 100, type: WidthType.PERCENTAGE },
  })
);

children.push(spacer());

// ── Production Readiness Checklist ───────────────────────────────────────

children.push(heading('13. Production Readiness Checklist', 2));
children.push(
  para('This checklist will be completed during the testing phase. All items are currently unchecked.', { italic: true })
);

const checklistItems = [
  ['Authentication', ['Login verified', 'Logout verified', 'Session handling verified', 'Unauthorized access blocked']],
  ['Authorization', ['Super Admin permissions verified', 'Academic Admin permissions verified', 'Finance Admin permissions verified', 'RLS verified for all tables', 'Cross-user access tested', 'Cross-institute access tested']],
  ['Dashboard', ['Stats cards display correctly', 'Quick actions navigate correctly', 'Pending approvals shown', 'Recent registrations shown', 'Upcoming classes shown', 'Refresh functionality works']],
  ['Admin Management', ['List admins', 'Create admin', 'Suspend admin role', 'Reactivate admin role', 'Revoke admin role', 'Cannot modify own super admin role', 'Form validation', 'Search/filter works']],
  ['Trusted Devices', ['List pending devices', 'Approve device', 'Reject device with reason', 'Revoke device', 'Tab switching', 'Search works']],
  ['Teacher Management', ['List teachers', 'View teacher detail', 'Approve/reject/suspend/activate', 'Bulk actions', 'Search/filter/sort', 'Pagination']],
  ['Student Management', ['List students', 'View student detail', 'Approve/reject/suspend/activate', 'Bulk actions', 'Search/filter/sort', 'Pagination']],
  ['Batch Management', ['List batches', 'Create/update/delete batch', 'Assign students', 'Assign subjects', 'Assign teachers', 'Archive/restore']],
  ['Commerce', ['View metrics', 'View orders', 'View payments', 'View subscriptions', 'Manage plans']],
  ['Notifications', ['Create notification', 'View notification list', 'View history', 'View detail']],
  ['Audit Logs', ['View logs', 'Filter logs', 'View detail']],
  ['Layout/Auth', ['RoleGuard blocks non-admin', 'RouteGuard blocks unauthorized', 'Sidebar permission-filtered', 'Breadcrumbs correct', 'Notification bell works', 'Logout works']],
  ['Error Handling', ['Loading states tested', 'Empty states tested', 'Error states tested', 'Network failures tested']],
  ['UI Quality', ['Desktop layout tested', 'Dialogs work correctly', 'Forms validated', 'Toasts display correctly', 'Dark mode renders']],
  ['Automated Tests', ['Relevant unit tests executed', 'Relevant integration tests executed', 'All tests passing']],
  ['Final Verification', ['Module-by-module testing completed', 'All bugs fixed', 'Regression testing completed', 'Smoke testing completed', 'Security testing completed']],
];

checklistItems.forEach(([category, items]) => {
  children.push(heading(category as string, 3));
  (items as string[]).forEach((item) => {
    children.push(bullet(`☐ ${item}`));
  });
});

children.push(spacer());

// ── Final UAT & Sign-off ────────────────────────────────────────────────

children.push(heading('14. Final UAT & Sign-off Section', 2));

children.push(heading('14.1 Testing Phase Plan', 3));
children.push(
  para('After this document is created, the following workflow will be executed per module:')
);
children.push(bullet('Step 1: Select a module from the Module Completion Tracker'));
children.push(bullet('Step 2: Perform deep code analysis of the module'));
children.push(bullet('Step 3: Identify confirmed bugs'));
children.push(bullet('Step 4: Fix identified bugs'));
children.push(bullet('Step 5: Run relevant automated tests'));
children.push(bullet('Step 6: Manually test the functionality'));
children.push(bullet('Step 7: Record actual results in this document'));
children.push(bullet('Step 8: Mark the module complete in the tracker'));
children.push(bullet('Step 9: Move to the next module'));

children.push(heading('14.2 Overall Status', 3));

children.push(
  new Table({
    rows: [
      new TableRow({
        children: [
          tableCell('Overall Status', { bold: true, bg: COLORS.lightBg, width: 40 }),
          tableCell('⚪ TESTING PLAN CREATED — TESTING NOT STARTED', { bold: true, bg: 'fef3c7', color: COLORS.warning, width: 60 }),
        ],
      }),
      new TableRow({
        children: [
          tableCell('Modules Discovered', { bold: true, bg: COLORS.lightBg }),
          tableCell('24'),
        ],
      }),
      new TableRow({
        children: [
          tableCell('Features Discovered', { bold: true, bg: COLORS.lightBg }),
          tableCell(featureInventory.length.toString()),
        ],
      }),
      new TableRow({
        children: [
          tableCell('Manual Test Cases Created', { bold: true, bg: COLORS.lightBg }),
          tableCell(manualTestCases.length.toString()),
        ],
      }),
      new TableRow({
        children: [
          tableCell('Security Test Cases Created', { bold: true, bg: COLORS.lightBg }),
          tableCell(securityTestCases.length.toString()),
        ],
      }),
      new TableRow({
        children: [
          tableCell('Relevant Automated Tests', { bold: true, bg: COLORS.lightBg }),
          tableCell('2 (partial - timetable only)'),
        ],
      }),
      new TableRow({
        children: [
          tableCell('Bugs Found', { bold: true, bg: COLORS.lightBg }),
          tableCell('0 (testing not started)'),
        ],
      }),
    ],
    width: { size: 80, type: WidthType.PERCENTAGE },
  })
);

children.push(spacer());

children.push(heading('14.3 Sign-off', 3));

children.push(
  new Table({
    rows: [
      new TableRow({
        children: [
          tableCell('Role', { bold: true, bg: COLORS.lightBg, width: 30 }),
          tableCell('Name', { bold: true, bg: COLORS.lightBg, width: 30 }),
          tableCell('Date', { bold: true, bg: COLORS.lightBg, width: 20 }),
          tableCell('Signature', { bold: true, bg: COLORS.lightBg, width: 20 }),
        ],
      }),
      new TableRow({
        children: [
          tableCell('QA Lead'),
          tableCell(''),
          tableCell(''),
          tableCell(''),
        ],
      }),
      new TableRow({
        children: [
          tableCell('Project Manager'),
          tableCell(''),
          tableCell(''),
          tableCell(''),
        ],
      }),
      new TableRow({
        children: [
          tableCell('Client'),
          tableCell(''),
          tableCell(''),
          tableCell(''),
        ],
      }),
    ],
    width: { size: 100, type: WidthType.PERCENTAGE },
  })
);

children.push(spacer());
children.push(divider());

children.push(
  new Paragraph({
    children: [
      new TextRun({
        text: 'END OF DOCUMENT',
        bold: true,
        size: 22,
        font: FONT,
        color: COLORS.secondary,
      }),
    ],
    alignment: AlignmentType.CENTER,
    spacing: { before: 400, after: 200 },
  })
);

// ═══════════════════════════════════════════════════════════════════════════
//  Generate the Document
// ═══════════════════════════════════════════════════════════════════════════

const doc = new Document({
  creator: 'Buffy (Codebuff AI Agent)',
  title: 'SUPER ADMIN DASHBOARD — Testing & Production Readiness Plan',
  description: 'Complete testing roadmap and readiness plan for the Super Admin Dashboard module.',
  styles: {
    default: {
      document: {
        run: {
          font: FONT,
          size: 21,
        },
      },
    },
  },
  sections: [
    {
      properties: {
        page: {
          margin: {
            top: convertInchesToTwip(1),
            bottom: convertInchesToTwip(1),
            left: convertInchesToTwip(1),
            right: convertInchesToTwip(1),
          },
        },
      },
      headers: {
        default: new Header({
          children: [
            new Paragraph({
              children: [
                new TextRun({
                  text: 'SUPER ADMIN DASHBOARD — Testing & Production Readiness Plan',
                  size: 16,
                  font: FONT,
                  color: COLORS.secondary,
                  italics: true,
                }),
              ],
              alignment: AlignmentType.RIGHT,
            }),
          ],
        }),
      },
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              children: [
                new TextRun({
                  text: 'Confidential — For Internal Use Only  |  Page ',
                  size: 16,
                  font: FONT,
                  color: COLORS.secondary,
                }),
                new TextRun({
                  children: [PageNumber.CURRENT],
                  size: 16,
                  font: FONT,
                  color: COLORS.secondary,
                }),
                new TextRun({
                  text: ' of ',
                  size: 16,
                  font: FONT,
                  color: COLORS.secondary,
                }),
                new TextRun({
                  children: [PageNumber.TOTAL_PAGES],
                  size: 16,
                  font: FONT,
                  color: COLORS.secondary,
                }),
              ],
              alignment: AlignmentType.CENTER,
            }),
          ],
        }),
      },
      children,
    },
  ],
});

// Write to file
async function main() {
  const outputPath = path.resolve(process.cwd(), 'Super_Admin_Dashboard_Testing_Readiness_Report.docx');
  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(outputPath, buffer);

  console.log(`✅ Document generated: ${outputPath}`);
  console.log(`   File size: ${(buffer.length / 1024).toFixed(1)} KB`);
  console.log(`   Features documented: ${featureInventory.length}`);
  console.log(`   Manual test cases: ${manualTestCases.length}`);
  console.log(`   Security test cases: ${securityTestCases.length}`);
  console.log(`   Database tables: ${databaseTables.length}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
