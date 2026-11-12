/**
 * `buildSyntheticSite(anonLabel, recipe)` (M1 T6a): writes static HTML/CSS/JS pages for one
 * anonymized label to `evals/fixtures/sites/<slug>/`.
 *
 * The input must come from `anonymize(label, seed, { extraIdentity: extraIdentityFor(slug) })`
 * (ADR-010); never pass a raw label. The only side effect is writing files; rendering is pure
 * (`renderSyntheticSite`).
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Site } from '@srs/site-model';
import type { Recipe } from './recipe';
import { renderSyntheticSite } from './render';

/** Committed synthetic sites live here, one directory per slug. */
export const SYNTHETIC_SITES_DIR = fileURLToPath(new URL('../sites/', import.meta.url));

/** Seed for the committed fixtures. Changing it changes every fictional name and number. */
export const FIXTURE_SEED = 'm1-t6a';

export interface BuildOptions {
  /** Seed that produced `anonLabel` (recorded in `expected.capture.json`). Default: FIXTURE_SEED. */
  seed?: string;
  /** Directory to write into. Default: `SYNTHETIC_SITES_DIR/<slug>`. Emptied first. */
  outDir?: string;
}

/** Write the site and return the directory it was written to. */
export async function buildSyntheticSite(
  anonLabel: Site,
  recipe: Recipe,
  options: BuildOptions = {},
): Promise<string> {
  const outDir = path.resolve(options.outDir ?? path.join(SYNTHETIC_SITES_DIR, recipe.slug));
  const files = renderSyntheticSite(anonLabel, recipe, options.seed ?? FIXTURE_SEED);
  await rm(outDir, { recursive: true, force: true });
  for (const [file, text] of files) {
    const target = path.join(outDir, file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, text, 'utf8');
  }
  return outDir;
}
