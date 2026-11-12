/** Synthetic site generator (M1 T6a). See `build.ts` and `../recipes`. */
export { type BuildOptions, FIXTURE_SEED, SYNTHETIC_SITES_DIR, buildSyntheticSite } from './build';
export { ExpectedCaptureSchema, type ExpectedCapture } from './expected-capture';
export type { Recipe } from './recipe';
export { renderSyntheticSite } from './render';
export { findFileLeaks, type FileLeak } from './leak-scan';
