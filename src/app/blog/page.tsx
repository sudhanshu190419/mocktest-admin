import type { Metadata } from 'next';
import Link from 'next/link';
import { IconSpark, IconArrowLeft } from '@/components/icons/student-icons';

export const metadata: Metadata = {
  title: 'Blog — coming soon | MockTest',
  description: 'Study strategy, exam pattern breakdowns, and product updates — coming soon.',
};

export default function BlogPage() {
  return (
    <div className="store-container flex items-center justify-center min-h-[60vh] py-16">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-sky-tint text-brand">
          <IconSpark size={32} />
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl sm:text-3xl font-extrabold text-ink tracking-tight">
            The MockTest Blog
          </h1>
          <p className="text-body text-ink-secondary leading-relaxed">
            Study strategy, exam pattern breakdowns, and product updates — coming soon.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            href="/courses"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-field bg-brand text-white font-bold text-body shadow-xs hover:bg-brand-hover transition-colors min-h-[44px]"
          >
            Browse courses
          </Link>
          <Link
            href="/#contact"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-field bg-surface border border-line text-ink font-bold text-body hover:bg-paper transition-colors min-h-[44px]"
          >
            Questions? Contact us
          </Link>
        </div>

        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-caption font-bold text-ink-secondary hover:text-brand transition-colors"
        >
          <IconArrowLeft size={14} />
          <span>Back to home</span>
        </Link>
      </div>
    </div>
  );
}
