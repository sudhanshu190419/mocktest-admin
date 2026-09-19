import type { ExamStreamCode } from './learnerGoal';

export interface PYQPackage {
  packageId: string;
  slug: string;
  streamId: string;
  streamCode: ExamStreamCode;
  streamName: string;
  title: string;
  displayTitle: string;
  shortDescription: string;
  description: string;
  yearFrom: number;
  yearTo: number;
  yearRange: string;
  totalPapers: number;
  totalQuestions: number;
  originalPrice: number;
  discountedPrice: number;
  currency: string;
  accessType: 'Lifetime Access';
  includesDiagnosticPaper: boolean;
  features: string[];
  subjectBreakdown: PYQSubjectBreakdown[];
  inclusions: string[];
  howItWorks: string[];
  faqs: PYQFaq[];
  status: 'published' | 'draft' | 'archived';
  sortOrder: number;
  papers?: PYQPaperPreviewItem[];
}

export interface PYQPaperPreviewItem {
  paperId: string;
  packageId: string;
  title: string;
  examYear: number | null;
  examSession: string | null;
  totalQuestions: number;
  totalMarks: number | null;
  durationMin: number | null;
  isLocked: boolean;
}

export interface PYQSubjectBreakdown {
  subject: string;
  papers: number;
  questions: number;
}

export interface PYQFaq {
  question: string;
  answer: string;
}
