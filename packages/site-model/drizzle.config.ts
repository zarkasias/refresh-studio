import { defineConfig } from 'drizzle-kit';

// `drizzle-kit generate` is offline: it diffs the schema against drizzle/meta, no DB needed.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
});
