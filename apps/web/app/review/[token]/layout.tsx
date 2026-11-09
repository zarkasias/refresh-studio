import type { ReactNode } from 'react';
import { SkipLink } from '../../../components/skip-link';

export default function ReviewLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SkipLink />
      <header className="bg-studio-background border-studio-border border-b">
        <div className="mx-auto flex h-14 max-w-6xl items-center px-4 sm:px-6">
          <p className="font-studio-heading font-semibold">
            Website preview from Chambers Consulting
          </p>
        </div>
      </header>
      <main id="main" tabIndex={-1} className="outline-none mx-auto max-w-6xl px-4 py-6 sm:px-6">
        {children}
      </main>
    </>
  );
}
