import { AdminSidebar } from '@/components/admin/AdminSidebar';
import { AdminHeader } from '@/components/admin/AdminHeader';
import RoleGuard from '@/components/auth/RoleGuard';
import { AdminRouteGuard } from '@/components/admin/AdminRouteGuard';

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <RoleGuard allowedRoles={['admin']}>
      {/**
       * Permission-based route protection: resolves the required permission
       * from the route matrix (src/lib/admin/routePermissions.ts) for the
       * current pathname and redirects to /admin when denied. This means a
       * finance admin manually entering /admin/teachers is sent back to the
       * dashboard instead of seeing a forbidden page.
       */}
      <AdminRouteGuard>
        <div className="flex h-screen overflow-hidden">
          {/* Sidebar - fixed width. Menu items are permission-filtered. */}
          <div className="w-56 flex-shrink-0">
            <AdminSidebar />
          </div>

          {/* Main content area */}
          <div className="flex flex-1 flex-col overflow-hidden">
            <AdminHeader />
            <main className="flex-1 overflow-y-auto bg-gray-50 p-6 dark:bg-gray-950/50">
              {children}
            </main>
          </div>
        </div>
      </AdminRouteGuard>
    </RoleGuard>
  );
}
