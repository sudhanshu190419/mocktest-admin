import Link from 'next/link';

/**
 * Site footer — light-blue tinted, matching the design system.
 */
export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-divider bg-surface">
      <div className="mx-auto max-w-7xl px-4 py-12 md:px-8">
        <div className="flex flex-col justify-between gap-8 md:flex-row">
          <div>
            <p className="font-display text-lg font-extrabold tracking-tight">
              Make<span className="text-brand">MeTopper</span>
            </p>
            <p className="mt-2 max-w-xs text-sm text-ink-secondary">
              Live classes, recorded lectures, PYQ practice, and a full mock-test
              engine for India&apos;s competitive exams.
            </p>
          </div>

          <div className="flex gap-12">
            <FooterCol
              title="Learn"
              links={[
                { href: '/courses', label: 'Courses' },
                { href: '/pyq', label: 'PYQ Packages' },
                { href: '/demo-class', label: 'Demo Class' },
              ]}
            />
            <FooterCol
              title="Account"
              links={[
                { href: '/login', label: 'Log in' },
                { href: '/signup', label: 'Sign up' },
                { href: '/student/overview', label: 'My Learning' },
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
          <li key={l.href}>
            <Link href={l.href} className="text-sm text-ink-secondary transition-colors hover:text-brand">
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
