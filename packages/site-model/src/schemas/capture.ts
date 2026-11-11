/**
 * Capture records (M1 plan section 2b). Stored next to the Site, not inside it: the Site is what
 * capture concluded, these records are what it saw. The audit reads both.
 */
import { z } from 'zod';
import type { GuardErrorCode } from '../guards/errors';
import {
  HexColorSchema,
  IdSchema,
  IsoDateTimeSchema,
  OriginSchema,
  SlugSchema,
  UrlSchema,
} from './primitives';
import { MAX_CRAWL_PAGES } from './project';

/** Zod mirror of `GuardErrorCode`; the type assertion below fails to compile if they drift. */
export const GuardErrorCodeSchema = z.enum([
  'no-consent',
  'bad-consent',
  'bad-url',
  'cross-origin',
  'outside-path',
  'page-limit',
  'not-approved',
  'not-selected',
  'already-approved',
  'not-latest',
  'version-locked',
  'fix-now-limit',
  'unknown-finding',
  'dismissed-and-listed',
  'scores-mismatch',
  'delivery-mismatch',
  'sent-before-approval',
  'listed-twice',
  'unlisted-finding',
  'empty-copy',
  'report-mismatch',
  'link-mismatch',
  'link-expired',
  'link-revoked',
]);
type AssertSame<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const guardCodesMatch: AssertSame<z.infer<typeof GuardErrorCodeSchema>, GuardErrorCode> = true;
void guardCodesMatch;

export const CaptureStatusSchema = z.enum(['queued', 'running', 'done', 'failed', 'blocked']);
export type CaptureStatus = z.infer<typeof CaptureStatusSchema>;

/**
 * Why a crawl was blocked: the codes `assertCrawlAllowed` can throw (consent and crawl scope),
 * plus the two the capture layer finds itself. Report guard codes are not valid here.
 */
export const BlockedReasonSchema = z.enum([
  'no-consent',
  'bad-consent',
  'bad-url',
  'cross-origin',
  'outside-path',
  'page-limit',
  'robots-disallowed',
  'bot-challenge',
]);
export type BlockedReason = z.infer<typeof BlockedReasonSchema>;

export const SkipReasonSchema = z.enum([
  'robots',
  'cross-origin',
  'outside-path',
  'page-limit',
  'non-html',
  'bot-challenge',
  'error',
]);
export type SkipReason = z.infer<typeof SkipReasonSchema>;

export const RobotsInfoSchema = z.strictObject({
  fetchedAt: IsoDateTimeSchema,
  status: z.enum(['ok', 'missing', 'error']),
  crawlDelaySec: z.number().nonnegative().optional(),
});
export type RobotsInfo = z.infer<typeof RobotsInfoSchema>;

export const SkippedUrlSchema = z.strictObject({
  /** As found; may not be a valid absolute URL (that can be the reason it was skipped). */
  url: z.string().min(1),
  reason: SkipReasonSchema,
});
export type SkippedUrl = z.infer<typeof SkippedUrlSchema>;

/**
 * The CaptureRun object without its cross-field refinements (Zod 4 refined schemas cannot be
 * `.pick`ed, `.omit`ted or `.extend`ed). Validate with `CaptureRunSchema`.
 */
export const CaptureRunObjectSchema = z.strictObject({
  id: IdSchema,
  projectId: IdSchema,
  siteId: IdSchema.optional(),
  startUrl: UrlSchema,
  status: CaptureStatusSchema,
  blockedReason: BlockedReasonSchema.optional(),
  userAgent: z.string().min(1),
  robots: RobotsInfoSchema,
  /** At most MAX_CRAWL_PAGES; the consent's own `maxPages` is enforced by the crawl guard. */
  planned: z.array(UrlSchema).max(MAX_CRAWL_PAGES),
  skipped: z.array(SkippedUrlSchema),
  startedAt: IsoDateTimeSchema,
  finishedAt: IsoDateTimeSchema.optional(),
});

/**
 * CaptureRun with its invariants: `finishedAt >= startedAt` (also a DB CHECK), `blocked` runs
 * have a `blockedReason` and no other run has one, and `done`/`failed` runs have a `finishedAt`.
 */
export const CaptureRunSchema = CaptureRunObjectSchema.superRefine((run, ctx) => {
  if (run.finishedAt !== undefined && run.finishedAt < run.startedAt) {
    ctx.addIssue({
      code: 'custom',
      message: 'finishedAt cannot be earlier than startedAt',
      path: ['finishedAt'],
    });
  }
  if (run.status === 'blocked' && run.blockedReason === undefined) {
    ctx.addIssue({
      code: 'custom',
      message: 'A blocked run needs a blockedReason',
      path: ['blockedReason'],
    });
  }
  if (run.status !== 'blocked' && run.blockedReason !== undefined) {
    ctx.addIssue({
      code: 'custom',
      message: 'blockedReason is only allowed when status is blocked',
      path: ['blockedReason'],
    });
  }
  if ((run.status === 'done' || run.status === 'failed') && run.finishedAt === undefined) {
    ctx.addIssue({
      code: 'custom',
      message: 'A done or failed run needs a finishedAt',
      path: ['finishedAt'],
    });
  }
});
export type CaptureRun = z.infer<typeof CaptureRunSchema>;

/** CSS px in that viewport's full-page screenshot. */
export const BoxSchema = z.strictObject({
  x: z.number().nonnegative(),
  y: z.number().nonnegative(),
  w: z.number().nonnegative(),
  h: z.number().nonnegative(),
});
export type Box = z.infer<typeof BoxSchema>;

export const RegionSchema = z.enum(['header', 'nav', 'main', 'footer']);
export type Region = z.infer<typeof RegionSchema>;

const SelectorSchema = z.string().min(1);
const ShareSchema = z.number().min(0).max(1);
const SizeSchema = z.strictObject({ w: z.number().nonnegative(), h: z.number().nonnegative() });

/** Cloudflare's placeholder for an obfuscated address; it must be decoded, never stored. */
const OBFUSCATED_EMAIL = /\[email[\s\u00a0]*protected\]/i;

export const PageFactsSchema = z.strictObject({
  viewport: z.strictObject({ width: z.int().positive(), height: z.int().positive() }),
  documentWidth: z.number().nonnegative(),
  hasViewportMeta: z.boolean(),
  protocol: z.enum(['http', 'https']),
  title: z.string(),
  metaDescription: z.string().optional(),
  headings: z.array(
    z.strictObject({ level: z.int().min(1).max(6), text: z.string(), selector: SelectorSchema }),
  ),
  links: z.array(
    z.strictObject({
      /** As found in the markup. */
      href: z.string(),
      resolved: UrlSchema.optional(),
      text: z.string(),
      selector: SelectorSchema,
      region: RegionSchema,
      box: BoxSchema,
      /** aria-expanded, aria-haspopup, or controls a submenu. */
      isToggle: z.boolean(),
      /** For same-page `#id` links. */
      targetExists: z.boolean().optional(),
    }),
  ),
  phoneTexts: z.array(
    z.strictObject({
      text: z.string(),
      digits: z.string().min(1),
      selector: SelectorSchema,
      region: RegionSchema,
      insideTelLink: z.boolean(),
    }),
  ),
  emails: z.array(
    z.strictObject({
      value: z
        .string()
        .min(1)
        .refine((v) => !OBFUSCATED_EMAIL.test(v), {
          message: 'Obfuscated placeholder "[email protected]" is not an email address',
        }),
      source: z.enum(['mailto', 'text', 'cfemail']),
      selector: SelectorSchema,
    }),
  ),
  hoursBlocks: z.array(
    z.strictObject({
      text: z.string(),
      selector: SelectorSchema,
      region: RegionSchema,
      heading: z.string().optional(),
    }),
  ),
  /** Parsed, not trusted; the checks validate it. */
  jsonLd: z.array(z.record(z.string(), z.unknown())),
  iframes: z.array(
    z.strictObject({
      src: UrlSchema,
      srcOrigin: OriginSchema,
      title: z.string().optional(),
      box: BoxSchema,
      provider: SlugSchema.optional(),
    }),
  ),
  forms: z.array(
    z.strictObject({
      selector: SelectorSchema,
      fields: z.array(
        z.strictObject({
          label: z.string().optional(),
          type: z.string().min(1),
          required: z.boolean(),
          hasLabel: z.boolean(),
        }),
      ),
      submitLabel: z.string().optional(),
    }),
  ),
  images: z.array(
    z.strictObject({
      src: UrlSchema,
      bytes: z.int().nonnegative().optional(),
      natural: SizeSchema,
      rendered: SizeSchema,
      /** null = no alt attribute; empty string = decorative. */
      alt: z.string().nullable(),
      selector: SelectorSchema,
    }),
  ),
  fonts: z.array(
    z.strictObject({ raw: z.string().min(1), family: z.string().min(1), share: ShareSchema }),
  ),
  colors: z.array(
    z.strictObject({
      hex: HexColorSchema,
      kind: z.enum(['text', 'background']),
      share: ShareSchema,
    }),
  ),
  /** Mobile only. */
  interactive: z.array(
    z.strictObject({
      selector: SelectorSchema,
      box: BoxSchema,
      kind: z.enum(['link', 'button', 'input']),
    }),
  ),
  footerText: z.string(),
  copyrightYears: z.array(z.int()),
  platformSignals: z.strictObject({
    generator: z.string().min(1).optional(),
    bodyClasses: z.array(z.string()),
    assetUrls: z.array(z.string()),
    headers: z.record(z.string(), z.string()),
    footerText: z.string(),
  }),
});
export type PageFacts = z.infer<typeof PageFactsSchema>;

export const AxeImpactSchema = z.enum(['minor', 'moderate', 'serious', 'critical']);
export type AxeImpact = z.infer<typeof AxeImpactSchema>;

/**
 * One viewport's axe run: per violation, rule id, impact, help text, up to 10 node selectors with
 * boxes (T14). Boxes are in that viewport's screenshot.
 */
export const AxeSummarySchema = z.strictObject({
  violations: z.array(
    z.strictObject({
      ruleId: z.string().min(1),
      /** axe leaves impact unset on some results. */
      impact: AxeImpactSchema.optional(),
      help: z.string().min(1),
      nodes: z.array(z.strictObject({ selector: SelectorSchema, box: BoxSchema })).max(10),
    }),
  ),
});
export type AxeSummary = z.infer<typeof AxeSummarySchema>;

export const CapturedPageSchema = z.strictObject({
  id: IdSchema,
  captureRunId: IdSchema,
  url: UrlSchema,
  finalUrl: UrlSchema,
  redirectChain: z.array(UrlSchema),
  httpStatus: z.int().min(100).max(599),
  fetchedAt: IsoDateTimeSchema,
  /** Asset of kind 'document'. */
  htmlAssetId: IdSchema,
  /** Assets of kind 'screenshot', full page. */
  screenshots: z.strictObject({ mobile: IdSchema, desktop: IdSchema }),
  facts: z.strictObject({ mobile: PageFactsSchema, desktop: PageFactsSchema }),
  axe: z.strictObject({ mobile: AxeSummarySchema, desktop: AxeSummarySchema }).optional(),
  /** Content still showing a placeholder ("Loading...") when the wait cap hit. */
  pendingContent: z.array(
    z.strictObject({ selector: SelectorSchema, placeholderText: z.string() }),
  ),
});
export type CapturedPage = z.infer<typeof CapturedPageSchema>;
