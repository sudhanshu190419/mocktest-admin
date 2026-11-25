import { redirect } from 'next/navigation';

export default function StudentPyqRedirectPage() {
  redirect('/student/tests?type=pyq');
}

