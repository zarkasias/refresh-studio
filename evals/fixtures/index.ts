/**
 * Offline fixture tooling: loopback server, network lockdown, fixture project (M1 T4) and the
 * label anonymizer (M1 T5).
 */
export * from './network-policy';
export * from './server';
export * from './sinkhole';
// installRoutePolicy is deliberately not exported: on its own it doesn't contain traffic.
export {
  type BlockReason,
  type BlockedRequest,
  type LockdownEvent,
  type LockdownOptions,
  type LockedDownContext,
  type LockedDownContextOptions,
  type ServedAsset,
  LOOPBACK_PROXY_BYPASS,
  newLockedDownContext,
} from './lockdown';
export * from './project';
export * from './anonymize';
