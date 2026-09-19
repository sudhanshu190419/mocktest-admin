import { CourseStoreShell } from '@/components/marketing/CourseStoreShell';
import '../courses/courses.css';

export default function PYQLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="course-store">
      <CourseStoreShell>{children}</CourseStoreShell>
    </div>
  );
}
