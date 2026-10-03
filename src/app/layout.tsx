import type { Metadata } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';
import Providers from '@/lib/providers';
import './globals.css';

const plusJakartaSans = Plus_Jakarta_Sans({
  variable: '--font-plus-jakarta-sans',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
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
      className={`${plusJakartaSans.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
