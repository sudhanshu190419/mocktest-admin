import { CourseStoreShell } from '@/components/marketing/CourseStoreShell';
import './courses.css';

export default function CoursesLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="course-store">
      <CourseStoreShell>{children}</CourseStoreShell>
    </div>
  );
}
