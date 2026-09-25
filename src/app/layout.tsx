import type { Metadata } from 'next';
import { Manrope, DM_Sans } from 'next/font/google';
import Providers from '@/lib/providers';
import './globals.css';

const manrope = Manrope({
  variable: '--font-store-display',
  subsets: ['latin'],
  display: 'swap',
});

const dmSans = DM_Sans({
  variable: '--font-store-body',
  subsets: ['latin'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Make Me Topper',
  description: 'Make Me Topper — Learn. Aspire. Achieve. Live classes, recorded lectures, PYQ practice, and mock test engine.',
  icons: {
    icon: '/brand/logo-favicon.svg',
    shortcut: '/brand/logo-favicon.svg',
    apple: '/brand/logo-submark.svg',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${manrope.variable} ${dmSans.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

