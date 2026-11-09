import { defineConfig, devices } from '@playwright/test';

// Port 3100 on purpose: 3000 is the developer's own dev server.
// The e2e server builds into .next-e2e (NEXT_DIST_DIR, read in next.config.ts) so it cannot
// clash with the .next dir of a dev server running at the same time. Side effect: Next
// rewrites next-env.d.ts to point at .next-e2e/dev/types until the normal dev server restarts.
// The file is gitignored and tsconfig includes both type dirs, so typecheck still works.
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  reporter: 'list',
  use: { baseURL: 'http://localhost:3100' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'next dev --port 3100',
    url: 'http://localhost:3100/dashboard',
    reuseExistingServer: false,
    timeout: 120_000,
    env: { NEXT_DIST_DIR: '.next-e2e' },
  },
});
