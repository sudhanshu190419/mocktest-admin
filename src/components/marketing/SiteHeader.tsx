import Link from 'next/link';
import Image from 'next/image';
import { SignOutButton } from './SignOutButton';

/**
 * Site header — shared across marketing + portal.
 * Design: white surface over light-blue page, pill-shaped active nav.
 * Preserves `nextHref` on login/signup links so visitors return to their browsing position.
 */
export function SiteHeader({
  userName,
  nextHref,
}: {
  userName?: string | null;
  nextHref?: string;
}) {
  const loginHref = nextHref
    ? `/login?next=${encodeURIComponent(nextHref)}`
    : '/login';
  const signupHref = nextHref
    ? `/signup?next=${encodeURIComponent(nextHref)}`
    : '/signup';

  return (
    <header className="sticky top-0 z-40 border-b border-divider bg-surface/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 md:px-8">
        <Link href="/" className="flex items-center" aria-label="Make Me Topper home">
          <Image
            src="/brand/logo-primary-horizontal.svg"
            alt="Make Me Topper"
            width={165}
            height={38}
            className="h-8 md:h-9 w-auto object-contain"
            priority
          />
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          <NavLink href="/courses">Courses</NavLink>
          <NavLink href="/pyq">PYQ Packages</NavLink>
          <NavLink href="/demo-class">Demo Class</NavLink>
        </nav>

        <div className="flex items-center gap-3">
          {userName ? (
            <>
              <Link
                href="/student/overview"
                className="rounded-pill bg-brand px-4 py-2 text-sm font-semibold text-ink-inverse transition-colors hover:bg-brand-hover"
              >
                My Learning
              </Link>
              <SignOutButton />
            </>
          ) : (
            <>
              <Link
                href={loginHref}
                className="rounded-pill px-4 py-2 text-sm font-semibold text-brand transition-colors hover:bg-brand-soft"
              >
                Log in
              </Link>
              <Link
                href={signupHref}
                className="rounded-pill bg-brand px-5 py-2 text-sm font-semibold text-ink-inverse shadow-card transition-colors hover:bg-brand-hover"
              >
                Start free
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-pill px-4 py-2 text-sm font-medium text-ink-secondary transition-colors hover:bg-page-tint hover:text-ink"
    >
      {children}
    </Link>
  );
}
