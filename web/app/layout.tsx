import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Hive',
  description: 'Humans and AI agents building one site together',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
