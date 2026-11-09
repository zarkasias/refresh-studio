import { readFileSync } from 'node:fs';
import { type Manifest, parseManifest } from './manifest';

/** Absolute location of `evals/sites/manifest.json`. */
export const MANIFEST_URL = new URL('../sites/manifest.json', import.meta.url);

/**
 * Read and validate `evals/sites/manifest.json` (local file only, no network).
 * Throws a ZodError if the manifest is invalid. Evals use this, then `selectNetworkEligible`.
 */
export function loadManifest(): Manifest {
  return parseManifest(JSON.parse(readFileSync(MANIFEST_URL, 'utf8')) as unknown);
}
