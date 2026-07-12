import { AdminSidebar } from '@/components/admin/AdminSidebar';
import { AdminHeader } from '@/components/admin/AdminHeader';
import RoleGuard from '@/components/auth/RoleGuard';

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <RoleGuard allowedRoles={['admin']}>
      <div className="flex h-screen overflow-hidden">
        {/* Sidebar - fixed width */}
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
    </RoleGuard>
  );
}
