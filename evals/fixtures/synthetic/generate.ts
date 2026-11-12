/**
 * Glue for the committed synthetic sites (M1 T6a): hand label -> `anonymize` -> recipe.
 *
 * `anonymizedLabel` is the only place a raw label is read, and it goes straight into
 * `anonymize(label, seed, { extraIdentity: extraIdentityFor(slug) })`; nothing downstream sees
 * the raw label. `loadRawLabel` exists for the leak tests, which compare output against it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Site, SiteSchema } from '@srs/site-model';
import { LABEL_FILE, SITES_DIR } from '../../src/conformance';
import { anonymize, extraIdentityFor } from '../anonymize';
import { recipeFor } from '../recipes';
import { FIXTURE_SEED } from './build';
import { renderSyntheticSite } from './render';

/** The hand label, validated. Tests only: never build a site from this. */
export function loadRawLabel(slug: string): Site {
  return SiteSchema.parse(JSON.parse(readFileSync(join(SITES_DIR, slug, LABEL_FILE), 'utf8')));
}

export function anonymizedLabel(slug: string, seed: string = FIXTURE_SEED): Site {
  return anonymize(loadRawLabel(slug), seed, { extraIdentity: extraIdentityFor(slug) });
}

/** The full file set for a slug, in memory. */
export function renderSlug(slug: string, seed: string = FIXTURE_SEED): Map<string, string> {
  return renderSyntheticSite(anonymizedLabel(slug, seed), recipeFor(slug), seed);
}
