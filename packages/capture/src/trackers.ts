/** Small tracker host list (M1 T9). Blocked during capture to speed it up; fonts and images are never listed. */
export const TRACKER_HOSTS: readonly string[] = [
  'google-analytics.com',
  'analytics.google.com',
  'googletagmanager.com',
  'googletagservices.com',
  'googlesyndication.com',
  'googleadservices.com',
  'doubleclick.net',
  'connect.facebook.net',
  'hotjar.com',
  'hotjar.io',
  'clarity.ms',
  'segment.io',
  'segment.com',
  'mixpanel.com',
  'fullstory.com',
  'js.hs-analytics.net',
  'js.hs-scripts.com',
  'bat.bing.com',
  'snap.licdn.com',
  'static.ads-twitter.com',
  'analytics.tiktok.com',
  'px.ads.linkedin.com',
  'nr-data.net',
  'crazyegg.com',
  'mouseflow.com',
  'quantserve.com',
  'scorecardresearch.com',
  'taboola.com',
  'outbrain.com',
];

/** True when `hostname` is a listed tracker host or a subdomain of one. Entries with a path are ignored here. */
export function isTrackerHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return TRACKER_HOSTS.some((t) => !t.includes('/') && (host === t || host.endsWith(`.${t}`)));
}
