import type { ExamStreamCode } from './learnerGoal';

export type CourseStatus = 'draft' | 'published' | 'archived';

export type BillingCycle = 'monthly' | 'quarterly' | 'half_yearly' | 'yearly';

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

export interface PlanFeature {
  featureKey: string;
  displayName: string;
}

export interface SubscriptionPlan {
  planId: string;
  courseId: string;
  name: string;
  slug: string;
  description: string;
  price: number;
  currencyCode: string;
  billingCycle: BillingCycle;
  durationDays: number;
  trialDays: number;
  isFeatured: boolean;
  sortOrder: number;
  isActive: boolean;
  features: PlanFeature[];
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
  plans: SubscriptionPlan[];
}
