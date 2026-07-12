import { TeacherSidebar } from '@/components/teacher/Sidebar';
import { TeacherHeader } from '@/components/teacher/Header';
import RoleGuard from '@/components/auth/RoleGuard';

export default function TeacherLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <RoleGuard
      allowedRoles={['teacher', 'admin']}
      allowedAccountStatuses={['approved']}
    >
      <div className="flex h-screen overflow-hidden">
        {/* Sidebar - fixed width */}
        <div className="w-56 flex-shrink-0">
          <TeacherSidebar />
        </div>

        {/* Main content area */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <TeacherHeader />
          <main className="flex-1 overflow-y-auto bg-gray-50 p-6 dark:bg-gray-950/50">
            {children}
          </main>
        </div>
      </div>
    </RoleGuard>
  );
}
