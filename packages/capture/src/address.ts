/** Pure address classification for the guarded network path. No I/O. */

/** Dotted-decimal only. Leading zeros (`012.0.0.1`) are ambiguous (octal in many parsers), so they fail. */
function ipv4ToInts(ip: string): number[] | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => (/^(0|[1-9]\d{0,2})$/.test(p) ? Number(p) : NaN));
  return nums.some((n) => Number.isNaN(n) || n > 255) ? null : nums;
}

function isPrivateV4(ip: string): boolean {
  const o = ipv4ToInts(ip);
  if (!o) return true; // fail closed
  const [a, b, c] = o as [number, number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

/** Expand an IPv6 literal to eight 16-bit groups, or null if it isn't one. */
function expandV6(ip: string): number[] | null {
  let text = ip.split('%')[0]!.toLowerCase();
  const tail = text.lastIndexOf(':');
  if (text.slice(tail + 1).includes('.')) {
    const v4 = ipv4ToInts(text.slice(tail + 1));
    if (!v4) return null;
    text = `${text.slice(0, tail + 1)}${((v4[0]! << 8) | v4[1]!).toString(16)}:${((v4[2]! << 8) | v4[3]!).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...rest];
  const ints = groups.map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  return ints.length === 8 && !ints.some(Number.isNaN) ? ints : null;
}

function isPrivateV6(ip: string): boolean {
  const g = expandV6(ip);
  if (!g) return true; // fail closed
  const [g0, g1, g2, g3, g4, g5, g6, g7] = g as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const embedded = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  if (g.every((x) => x === 0)) return true; // ::
  if (
    g0 === 0 &&
    g1 === 0 &&
    g2 === 0 &&
    g3 === 0 &&
    g4 === 0 &&
    g5 === 0 &&
    g6 === 0 &&
    g7 === 1
  ) {
    return true; // ::1
  }
  // IPv4-mapped (::ffff:a.b.c.d), IPv4-compatible (::a.b.c.d) and NAT64 (64:ff9b::/96):
  // judged by the IPv4 address inside.
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && (g5 === 0xffff || g5 === 0)) {
    return isPrivateV4(embedded(g6, g7));
  }
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
    return isPrivateV4(embedded(g6, g7));
  }
  if ((g0 & 0xfe00) === 0xfc00) return true; // unique local fc00::/7
  if ((g0 & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
  if ((g0 & 0xff00) === 0xff00) return true; // multicast
  if (g0 === 0x2001 && g1 === 0x0db8) return true; // documentation
  return false;
}

/** 4 or 6 for an IP literal (no brackets), 0 for anything else. No `node:net`: see the lint rule. */
export function ipFamily(value: string): 0 | 4 | 6 {
  if (ipv4ToInts(value)) return 4;
  return value.includes(':') && expandV6(value) ? 6 : 0;
}

/** True unless `ip` is a public unicast address. Anything unparseable counts as private. */
export function isPrivateAddress(ip: string): boolean {
  const bare = ip.replace(/^\[|\]$/g, '');
  const family = ipFamily(bare);
  if (family === 4) return isPrivateV4(bare);
  if (family === 6) return isPrivateV6(bare);
  return true;
}

/** Reserved `.test` hostname (RFC 2606). Only these may use the fixture host map. */
export function isTestHostname(host: string): boolean {
  const h = host.toLowerCase();
  return /^(?:[a-z0-9-]+\.)+test$/.test(h);
}
