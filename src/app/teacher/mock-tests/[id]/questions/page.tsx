'use client';

import { use } from 'react';
import { MockTestQuestionManager } from '@/features/mock-tests/components/MockTestQuestionManager';

export default function MockTestQuestionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: testId } = use(params);

  return (
    <MockTestQuestionManager
      testId={testId}
      roleContext="teacher"
      baseRoute="/teacher/mock-tests"
      onCompleteHref={`/teacher/mock-tests/${testId}/publish`}
      onCompleteLabel="Continue to Publish"
    />
  );
}
