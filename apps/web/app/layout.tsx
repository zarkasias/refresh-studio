import type { ReactNode } from 'react';
import { DM_Sans, Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'], display: 'swap', variable: '--font-inter' });
const dmSans = DM_Sans({ subsets: ['latin'], display: 'swap', variable: '--font-dm-sans' });

export const metadata = {
  title: 'Site Refresh Studio',
  description: 'A better website for your small business, without starting over.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${dmSans.variable}`}>
      <body className="bg-studio-background text-studio-foreground font-studio-sans">
        {children}
      </body>
    </html>
  );
}
