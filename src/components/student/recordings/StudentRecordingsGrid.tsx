'use client';

import React from 'react';
import type { StudentRecording } from '@/services/student/studentRecordingWebService';
import { StudentRecordingCard } from './StudentRecordingCard';

interface StudentRecordingsGridProps {
  recordings: StudentRecording[];
}

export const StudentRecordingsGrid: React.FC<StudentRecordingsGridProps> = ({ recordings }) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 sm:gap-6">
      {recordings.map((recording) => (
        <StudentRecordingCard key={recording.recordingId} recording={recording} />
      ))}
    </div>
  );
};
