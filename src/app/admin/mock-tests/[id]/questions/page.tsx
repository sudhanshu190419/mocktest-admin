'use client';

import { use } from 'react';
import { MockTestQuestionManager } from '@/features/mock-tests/components/MockTestQuestionManager';

export default function AdminMockTestQuestionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: testId } = use(params);

  return (
    <MockTestQuestionManager
      testId={testId}
      roleContext="admin"
      baseRoute="/admin/mock-tests"
      onCompleteHref={`/admin/mock-tests/${testId}`}
      onCompleteLabel="Done / View Details"
    />
  );
}
