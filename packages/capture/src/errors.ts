export type CaptureBlockCode =
  /** robots.txt disallows this URL for our crawler. */
  | 'robots'
  /** robots.txt could not be read (5xx or network error): the whole run is blocked. */
  | 'robots-unavailable'
  /** The host is, or resolves to, a loopback, private or otherwise non-public address. */
  | 'private-address'
  /** A redirect led somewhere we may not go (other origin, outside the consented path). */
  | 'redirect-refused'
  | 'too-many-redirects'
  | 'bad-response'
  | 'network'
  | 'timeout';

/** Thrown by the guarded network path. `message` is plain English. Consent errors stay `GuardError`. */
export class CaptureBlockedError extends Error {
  readonly code: CaptureBlockCode;
  readonly url?: string;

  constructor(code: CaptureBlockCode, message: string, url?: string) {
    super(message);
    this.name = 'CaptureBlockedError';
    this.code = code;
    if (url !== undefined) this.url = url;
  }
}
