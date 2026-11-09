import type { ReactNode } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { SkipLink } from '../../components/skip-link';

/** Consultant-facing shell. Client review links use their own slimmer chrome (app/review). */
export default function StudioLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SkipLink />
      <header className="bg-studio-background border-studio-border border-b">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/dashboard" className="rounded-studio flex min-h-11 items-center gap-3">
            {/* alt="" because the visible name sits beside the logo (see @srs/brand README). */}
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-gray-300/80 p-1">
              <Image src="/brand/cclogo-new.png" alt="" width={40} height={40} />
            </span>
            <span className="flex flex-col leading-tight">
              <span className="font-studio-heading text-lg font-semibold">Site Refresh Studio</span>
              <span className="text-studio-muted-foreground hidden text-xs sm:block">
                by Chambers Consulting
              </span>
            </span>
          </Link>
          <nav aria-label="Main">
            <Link
              href="/dashboard"
              className="rounded-studio text-studio-primary inline-flex min-h-11 items-center px-3 font-medium hover:underline"
            >
              Projects
            </Link>
          </nav>
        </div>
      </header>
      <main id="main" tabIndex={-1} className="outline-none mx-auto max-w-6xl px-4 py-8 sm:px-6">
        {children}
      </main>
    </>
  );
}
