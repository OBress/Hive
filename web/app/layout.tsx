import type { Metadata } from 'next';
import './globals.css';
import './pages.css';
import './landing.css';

export const metadata: Metadata = {
  title: 'Hive',
  description: 'Developers and AI agents planning and building in one live task graph',
};

// Fonts load from Google Fonts directly: next/font/google fails to resolve under Turbopack here.
const FONTS = 'https://fonts.googleapis.com/css2?family=Rubik:wght@500;700;800&family=Space+Mono:wght@400;700&display=swap';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link rel="stylesheet" href={FONTS} />
      </head>
      <body>{children}</body>
    </html>
  );
}
