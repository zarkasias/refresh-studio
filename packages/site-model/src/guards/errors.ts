export type GuardErrorCode =
  | 'no-consent'
  | 'bad-consent'
  | 'bad-url'
  | 'cross-origin'
  | 'outside-path'
  | 'page-limit'
  | 'not-approved'
  | 'not-selected'
  | 'already-approved'
  | 'not-latest'
  | 'version-locked'
  | 'fix-now-limit'
  | 'unknown-finding'
  | 'dismissed-and-listed'
  | 'scores-mismatch'
  | 'delivery-mismatch'
  | 'sent-before-approval'
  | 'listed-twice'
  | 'unlisted-finding'
  | 'empty-copy'
  | 'report-mismatch'
  | 'link-mismatch'
  | 'link-expired'
  | 'link-revoked';

/** Thrown by the guards. Callers branch on `code`; `message` is plain English for the consultant. */
export class GuardError extends Error {
  readonly code: GuardErrorCode;

  constructor(code: GuardErrorCode, message: string) {
    super(message);
    this.name = 'GuardError';
    this.code = code;
  }
}
