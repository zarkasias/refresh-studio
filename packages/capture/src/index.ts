export const packageName = '@srs/capture';
export * from './address';
export * from './discover';
export * from './errors';
export * from './identity';
export {
  MAX_BODY_BYTES,
  MAX_REDIRECTS,
  NAVIGATION_TIMEOUT_MS,
  assertPublicHost,
  fixturePortFor,
  guardedFetch,
  guardedGoto,
  type GotoPage,
  type GuardedFetchOptions,
  type GuardedGotoResult,
  type GuardedResponse,
  type LookupFn,
  type NetContext,
  type RequestKind,
} from './net';
export * from './robots';
