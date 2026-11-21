import type { ExamStreamCode } from './learnerGoal';

export type CourseStatus = 'draft' | 'published' | 'archived';

export interface CourseFacultyMember {
  name: string;
  subject: string;
  initials: string;
  description: string;
}

export interface CourseCurriculumModule {
  title: string;
  topics: string[];
}

export interface CourseFaq {
  question: string;
  answer: string;
}

export interface CoursePresentation {
  eyebrow: string;
  displayTitle: string;
  languageLabel: string;
  format: string;
  subjects: string[];
  schedule: string;
  audience: string;
  highlights: string[];
  faculty: CourseFacultyMember[];
  curriculum: CourseCurriculumModule[];
  faqs: CourseFaq[];
}

export interface CourseInstallmentPlan {
  planId: string;
  courseId: string;
  planName: string;
  totalFee: number;
  numberOfInstallments: number;
  intervalMonths: number;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface Course {
  courseId: string;
  slug: string;
  streamId: string;
  streamCode: ExamStreamCode;
  streamName: string;
  title: string;
  shortDescription: string;
  description: string;
  language: string;
  duration: number;
  difficultyLevel: string;
  originalPrice: number;
  discountedPrice: number | null;
  currency: string;
  thumbnailBucket: string | null;
  thumbnailPath: string | null;
  bannerBucket: string | null;
  bannerPath: string | null;
  featured: boolean;
  trending: boolean;
  status: CourseStatus;
  deletedAt: string | null;
  publishedAt?: string | null;
  sortOrder: number;
  presentation: CoursePresentation;
  installmentPlans?: CourseInstallmentPlan[];
}
