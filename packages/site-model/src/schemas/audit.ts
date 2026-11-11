/**
 * Audit records (M1 plan section 2c, ADR-008). An AuditRun is what the tools measured about one
 * capture: Lighthouse numbers, our own checks and the five scores (CLAUDE.md rule 2). It is
 * written by `packages/audit` and never edited; a report only ever copies from it.
 *
 * No LLM output appears here. Every value is reproducible from the capture.
 */
import { z } from 'zod';
import { BoxSchema } from './capture';
import {
  IdSchema,
  IsoDateTimeSchema,
  STRICT_URLS,
  memoOnUrls,
  type UrlLike,
  type UrlSchemas,
} from './primitives';

export const CheckIdSchema = z.enum([
  'tel-matches-display',
  'tel-hidden-characters',
  'tap-to-call',
  'contact-above-fold-mobile',
  'form-works',
  'google-business-link',
  'hours-visible',
  'hours-consistent',
  'nap-consistent',
  'local-business-schema',
  'https',
  'h1-present',
  'dead-links',
  'text-contrast',
  'tap-targets',
  'no-horizontal-scroll',
  'nav-mobile',
  'image-weight',
  'title-meta',
  'dated-copyright',
  'placeholder-text',
  'font-count',
]);
export type CheckId = z.infer<typeof CheckIdSchema>;

export const SeveritySchema = z.enum(['high', 'medium', 'low']);
export type Severity = z.infer<typeof SeveritySchema>;

export const ViewportSchema = z.enum(['mobile', 'desktop']);
export type Viewport = z.infer<typeof ViewportSchema>;

export function makeCheckResultSchemas<U extends UrlLike, O extends UrlLike>(
  urls: UrlSchemas<U, O>,
) {
  return memoOnUrls(urls, 'makeCheckResultSchemas', () => {
    // Same names as the strict exports, so the bodies below are shared unchanged.
    const UrlSchema = urls.url;
    /**
     * Why a check passed or failed, in a form the consultant can verify: an element (selector and
     * box), a metric value, a piece of text, or a whole page. Rule: every finding carries evidence.
     */
    const EvidenceSchema = z.strictObject({
      kind: z.enum(['element', 'metric', 'text', 'page']),
      pageUrl: UrlSchema,
      selector: z.string().min(1).optional(),
      /** CSS px in the full-page screenshot for `viewport`. */
      box: BoxSchema.optional(),
      viewport: ViewportSchema.optional(),
      /** A metric, or text found on the client's site (so a string may be empty). */
      value: z.union([z.string(), z.number()]).optional(),
      note: z.string().min(1).optional(),
    });

    const CheckResultObjectSchema = z.strictObject({
      id: CheckIdSchema,
      /** `${id}:${hash(pageUrl, selector)}`: stable across reruns so a dismissal survives a re-audit. */
      findingId: z.string().min(1),
      passed: z.boolean(),
      severity: SeveritySchema,
      pageUrl: UrlSchema.optional(),
      /** At least one when the check failed. */
      evidence: z.array(EvidenceSchema),
      /** One sentence for a business owner, no jargon. From the check catalog, not an LLM. */
      plainEnglish: z.string().min(1),
    });

    /** CheckResult with its invariants: failed checks have evidence; `findingId` starts with `id:`. */
    const CheckResultSchema = CheckResultObjectSchema.superRefine((check, ctx) => {
      if (!check.passed && check.evidence.length === 0) {
        ctx.addIssue({
          code: 'custom',
          message: 'A failed check needs at least one piece of evidence',
          path: ['evidence'],
        });
      }
      const prefix = `${check.id}:`;
      if (!check.findingId.startsWith(prefix) || check.findingId.length === prefix.length) {
        ctx.addIssue({
          code: 'custom',
          message: `findingId must look like "${prefix}<hash>"`,
          path: ['findingId'],
        });
      }
    });
    return { EvidenceSchema, CheckResultObjectSchema, CheckResultSchema };
  });
}

const strictCheckResultSchemas = makeCheckResultSchemas(STRICT_URLS);
export const EvidenceSchema = strictCheckResultSchemas.EvidenceSchema;
export const CheckResultObjectSchema = strictCheckResultSchemas.CheckResultObjectSchema;
export const CheckResultSchema = strictCheckResultSchemas.CheckResultSchema;
export type Evidence = z.infer<typeof EvidenceSchema>;
export type CheckResult = z.infer<typeof CheckResultSchema>;
export const SCORE_KEYS = [
  'looksCurrent',
  'worksOnPhones',
  'easyToContact',
  'speed',
  'accessibility',
] as const;
export const ScoreKeySchema = z.enum(SCORE_KEYS);
export type ScoreKey = z.infer<typeof ScoreKeySchema>;

/** Where a score change came from: one of our checks, a Lighthouse audit or an axe rule. */
export const ScoreSourceSchema = z.union([
  CheckIdSchema,
  z.templateLiteral(['lighthouse:', z.string().min(1)]),
  z.templateLiteral(['axe:', z.string().min(1)]),
]);
export type ScoreSource = z.infer<typeof ScoreSourceSchema>;

export const ScoreContributionSchema = z.strictObject({
  source: ScoreSourceSchema,
  /** Added to 100; negative for a deduction. Finite. */
  delta: z.number().refine(Number.isFinite, { message: 'delta must be a finite number' }),
});
export type ScoreContribution = z.infer<typeof ScoreContributionSchema>;

/**
 * One score. `contributions` is the list "how we measured this" shows. `recomputeScores`
 * (`scoring/recompute.ts`) must be able to rebuild `value` from it: 100, plus every delta, rounded,
 * clamped to 0..100.
 */
export const ScoreSchema = z.strictObject({
  value: z.int().min(0).max(100),
  contributions: z.array(ScoreContributionSchema),
});
export type Score = z.infer<typeof ScoreSchema>;

/**
 * The value a score's contributions add up to: start at 100, add each delta in list order (a left
 * fold), round, clamp to 0..100. The single definition used by `AuditRunSchema` and
 * `recomputeScores`.
 */
export function scoreValueFromContributions(contributions: readonly ScoreContribution[]): number {
  const total = contributions.reduce((sum, c) => sum + c.delta, 100);
  return Math.min(100, Math.max(0, Math.round(total)));
}

/** All five scores; each key is required. */
export const ScoresSchema = z.record(ScoreKeySchema, ScoreSchema);
export type Scores = z.infer<typeof ScoresSchema>;

export const LighthousePresetSchema = z.enum(['mobile', 'desktop']);
export type LighthousePreset = z.infer<typeof LighthousePresetSchema>;

const Unit = z.number().min(0).max(1);

export function makeLighthouseSchemas<U extends UrlLike, O extends UrlLike>(
  urls: UrlSchemas<U, O>,
) {
  return memoOnUrls(urls, 'makeLighthouseSchemas', () => {
    // Same names as the strict exports, so the bodies below are shared unchanged.
    const UrlSchema = urls.url;
    /** One Lighthouse run for one page and preset. The full report is kept as an Asset. */
    const LighthouseSummarySchema = z.strictObject({
      pageUrl: UrlSchema,
      preset: LighthousePresetSchema,
      /** Category scores, 0 to 1 as Lighthouse reports them. */
      performance: Unit,
      accessibility: Unit,
      bestPractices: Unit,
      seo: Unit,
      lcpMs: z.number().nonnegative(),
      tbtMs: z.number().nonnegative(),
      cls: z.number().nonnegative(),
      lhrAssetId: IdSchema,
    });
    return { LighthouseSummarySchema };
  });
}

const strictLighthouseSchemas = makeLighthouseSchemas(STRICT_URLS);
export const LighthouseSummarySchema = strictLighthouseSchemas.LighthouseSummarySchema;
export type LighthouseSummary = z.infer<typeof LighthouseSummarySchema>;

export function makeAuditRunSchemas<U extends UrlLike, O extends UrlLike>(urls: UrlSchemas<U, O>) {
  return memoOnUrls(urls, 'makeAuditRunSchemas', () => {
    // Same names as the strict exports, so the bodies below are shared unchanged.
    const { CheckResultSchema } = makeCheckResultSchemas(urls);
    const { LighthouseSummarySchema } = makeLighthouseSchemas(urls);
    const AuditRunObjectSchema = z.strictObject({
      id: IdSchema,
      projectId: IdSchema,
      siteId: IdSchema,
      captureRunId: IdSchema,
      createdAt: IsoDateTimeSchema,
      toolVersions: z.strictObject({
        lighthouse: z.string().min(1),
        axe: z.string().min(1),
        /** The `@srs/audit` package version. */
        audit: z.string().min(1),
      }),
      lighthouse: z.array(LighthouseSummarySchema),
      checks: z.array(CheckResultSchema),
      scores: ScoresSchema,
      /** Which weights config produced `scores` (T20), so an old run can be explained later. */
      weightsVersion: z.string().min(1),
    });

    /**
     * AuditRun with its invariants: `findingId` is unique across `checks`, and every score's `value`
     * is what its `contributions` add up to (`scoreValueFromContributions`), so the scores can be
     * reproduced.
     */
    const AuditRunSchema = AuditRunObjectSchema.superRefine((run, ctx) => {
      const seen = new Set<string>();
      run.checks.forEach((check, index) => {
        if (seen.has(check.findingId)) {
          ctx.addIssue({
            code: 'custom',
            message: `findingId "${check.findingId}" appears more than once`,
            path: ['checks', index, 'findingId'],
          });
        }
        seen.add(check.findingId);
      });
      for (const key of SCORE_KEYS) {
        const score = run.scores[key];
        if (score.value !== scoreValueFromContributions(score.contributions)) {
          ctx.addIssue({
            code: 'custom',
            message: `scores.${key}.value must equal 100 plus its contributions, rounded and clamped`,
            path: ['scores', key, 'value'],
          });
        }
      }
    });
    return { AuditRunObjectSchema, AuditRunSchema };
  });
}

const strictAuditRunSchemas = makeAuditRunSchemas(STRICT_URLS);
export const AuditRunObjectSchema = strictAuditRunSchemas.AuditRunObjectSchema;
export const AuditRunSchema = strictAuditRunSchemas.AuditRunSchema;
export type AuditRun = z.infer<typeof AuditRunSchema>;
