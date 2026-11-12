/**
 * Regenerates `evals/fixtures/sites/<slug>/` (M1 T6a). Skipped unless `SRS_WRITE_FIXTURES=1`:
 * `pnpm fixtures:build`. The ordinary tests then check that the committed files equal what the
 * generator produces, so a stale fixture fails `pnpm test`.
 */
import { describe, it } from 'vitest';
import { RECIPES } from '../recipes';
import { buildSyntheticSite, FIXTURE_SEED } from './build';
import { anonymizedLabel } from './generate';

describe.skipIf(process.env.SRS_WRITE_FIXTURES !== '1')('write synthetic sites', () => {
  it.each(RECIPES.map((r) => r.slug))('%s', async (slug) => {
    const recipe = RECIPES.find((r) => r.slug === slug);
    if (recipe === undefined) throw new Error(slug);
    await buildSyntheticSite(anonymizedLabel(slug), recipe, { seed: FIXTURE_SEED });
  });
});
