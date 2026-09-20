'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useAuth } from '@/context/AuthContext';

/**
 * Site footer — light-blue tinted, matching the design system.
 * PRD §4.3: Logged-in variant suppressing guest login links and displaying support/help links.
 */
export function SiteFooter() {
  const { user } = useAuth();
  const loggedIn = Boolean(user);

  return (
    <footer className="mt-auto border-t border-divider bg-surface">
      <div className="mx-auto max-w-7xl px-4 py-12 md:px-8">
        <div className="flex flex-col justify-between gap-8 md:flex-row">
          <div>
            <Link href="/" className="inline-block" aria-label="Make Me Topper home">
              <Image
                src="/brand/logo-primary-horizontal.svg"
                alt="Make Me Topper"
                width={160}
                height={38}
                className="h-8 w-auto object-contain"
              />
            </Link>
            <p className="mt-2 max-w-xs text-sm text-ink-secondary">
              Live classes, recorded lectures, PYQ practice, and a full mock-test
              engine for India&apos;s competitive exams.
            </p>
          </div>

          <div className="flex flex-wrap gap-8 sm:gap-12">
            <FooterCol
              title="Learn"
              links={[
                { href: '/courses', label: 'Courses' },
                { href: '/pyq', label: 'PYQ Packages' },
                { href: '/demo-class', label: 'Demo Class' },
              ]}
            />
            {loggedIn ? (
              <FooterCol
                title="My Learning"
                links={[
                  { href: '/student/overview', label: 'Dashboard' },
                  { href: '/student/tests', label: 'Mock tests' },
                  { href: '/student/doubts', label: 'Help & Doubts' },
                  { href: '/student/profile', label: 'Profile & Settings' },
                ]}
              />
            ) : (
              <FooterCol
                title="Account"
                links={[
                  { href: '/login', label: 'Log in' },
                  { href: '/signup', label: 'Sign up' },
                  { href: '/student/overview', label: 'My Learning' },
                ]}
              />
            )}
            <FooterCol
              title="Support"
              links={[
                { href: loggedIn ? '/student/doubts' : '/login', label: 'Ask a Doubt' },
                { href: '/courses', label: 'Explore Programs' },
              ]}
            />
          </div>
        </div>

        <p className="mt-10 text-xs text-ink-muted">
          © {new Date().getFullYear()} MakeMeTopper. All rights reserved.
        </p>
      </div>
    </footer>
  );
}

function FooterCol({
  title,
  links,
}: {
  title: string;
  links: { href: string; label: string }[];
}) {
  return (
    <div>
      <p className="font-display text-xs font-bold uppercase tracking-widest text-ink-muted">
        {title}
      </p>
      <ul className="mt-3 space-y-2">
        {links.map((l) => (
          <li key={l.href + l.label}>
            <Link href={l.href} className="text-sm text-ink-secondary transition-colors hover:text-brand">
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
