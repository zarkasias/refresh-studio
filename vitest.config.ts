import { defineConfig } from 'vitest/config';

const dirs = [
  'apps/web',
  'packages/site-model',
  'packages/capture',
  'packages/audit',
  'packages/agents',
  'packages/sections',
  'packages/brand',
  'packages/exporters/wordpress-theme',
  'packages/exporters/style-guide',
  'packages/exporters/astro-site',
  'evals',
];

export default defineConfig({
  test: {
    projects: dirs.map((dir) => ({
      test: {
        name: dir,
        root: `./${dir}`,
        include: ['**/*.test.{ts,tsx}'],
        exclude: ['**/node_modules/**', '**/.next/**', '**/e2e/**'],
      },
    })),
  },
});
