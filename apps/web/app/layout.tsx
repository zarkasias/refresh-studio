import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'Site Refresh Studio',
  description: 'A better website for your small business, without starting over.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
