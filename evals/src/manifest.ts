import { z } from 'zod';
import {
  ConfidenceSchema,
  IsoDateTimeSchema,
  PageBuilderSchema,
  PlatformEvidenceSchema,
  PlatformSchema,
  SlugSchema,
  UrlSchema,
} from '@srs/site-model';

/**
 * Test-site manifest (`evals/sites/manifest.json`). M0 plan, section 4; CLAUDE.md rule 5.
 *
 * Consent levels:
 * - `own-site`: our own site, crawlable.
 * - `granted`: the owner agreed in writing (T7 records it), crawlable.
 * - `requested`: we asked and have no answer yet. NOT crawlable.
 * - `none`: no consent. NOT crawlable. Synthetic fixtures only.
 */
export const ManifestConsentSchema = z.enum(['own-site', 'granted', 'requested', 'none']);
export type ManifestConsent = z.infer<typeof ManifestConsentSchema>;

/**
 * Consent levels that allow network use (crawl, screenshots, Lighthouse, live evals).
 * Exported frozen for documentation only; the gate uses its own private copy.
 */
export const NETWORK_ELIGIBLE_CONSENT: readonly ManifestConsent[] = Object.freeze([
  'own-site',
  'granted',
] as const);

/** Private copy used by the gate, so nothing outside this module can widen it. */
const ELIGIBLE: ReadonlySet<ManifestConsent> = new Set<ManifestConsent>(['own-site', 'granted']);

function isNetworkConsent(consent: ManifestConsent): boolean {
  return ELIGIBLE.has(consent);
}

/** A place where a test site did not fit the site model (T8 labeling, T9 review). */
export const MisfitSchema = z.strictObject({
  field: z.string().min(1),
  note: z.string().min(1),
  resolution: z.enum(['schema-change', 'accepted']).optional(),
});
export type Misfit = z.infer<typeof MisfitSchema>;

export const ManifestEntryObjectSchema = z.strictObject({
  slug: SlugSchema,
  url: UrlSchema,
  businessType: z.string().min(1),
  platform: PlatformSchema,
  /** Hosted builder (only with `platform: 'other-hosted'`), as in `platformDetails.builder`. */
  builder: SlugSchema.optional(),
  /** WordPress page builder (only with `platform: 'wordpress'`), as in `platformDetails.pageBuilder`. */
  pageBuilder: PageBuilderSchema.optional(),
  platformConfidence: ConfidenceSchema,
  /** Same shape as `Site.platformEvidence` in the site model. */
  evidence: z.array(PlatformEvidenceSchema),
  whyUseful: z.string().min(1),
  consent: ManifestConsentSchema,
  consentRecordedAt: IsoDateTimeSchema.optional(),
  misfits: z.array(MisfitSchema),
});

export const ManifestEntrySchema = ManifestEntryObjectSchema.superRefine((entry, ctx) => {
  if (isNetworkConsent(entry.consent) && entry.consentRecordedAt === undefined) {
    ctx.addIssue({
      code: 'custom',
      message: 'consentRecordedAt is required when consent is own-site or granted',
      path: ['consentRecordedAt'],
    });
  }
  if (entry.builder !== undefined && entry.platform !== 'other-hosted') {
    ctx.addIssue({
      code: 'custom',
      message: "builder is only allowed when platform is 'other-hosted'",
      path: ['builder'],
    });
  }
  if (entry.pageBuilder !== undefined && entry.platform !== 'wordpress') {
    ctx.addIssue({
      code: 'custom',
      message: "pageBuilder is only allowed when platform is 'wordpress'",
      path: ['pageBuilder'],
    });
  }
});
export type ManifestEntry = z.infer<typeof ManifestEntrySchema>;

export const ManifestSchema = z
  .strictObject({
    sites: z.array(ManifestEntrySchema),
  })
  .superRefine((manifest, ctx) => {
    const seen = new Set<string>();
    manifest.sites.forEach((entry, index) => {
      if (seen.has(entry.slug)) {
        ctx.addIssue({
          code: 'custom',
          message: `Duplicate slug "${entry.slug}"`,
          path: ['sites', index, 'slug'],
        });
      }
      seen.add(entry.slug);
    });
  });
export type Manifest = z.infer<typeof ManifestSchema>;

declare const networkEligibleBrand: unique symbol;
/** A validated entry that passed the consent gate. Only this module can produce one. */
export type NetworkEligibleEntry = ManifestEntry & { readonly [networkEligibleBrand]: true };

/** Validate raw manifest JSON. Throws a ZodError if invalid. */
export function parseManifest(data: unknown): Manifest {
  return ManifestSchema.parse(data);
}

function passesGate(entry: ManifestEntry): entry is NetworkEligibleEntry {
  return isNetworkConsent(entry.consent) && entry.consentRecordedAt !== undefined;
}

/**
 * True only for a valid entry whose consent is `own-site` or `granted` with a recorded date.
 * The input is validated first, so unparsed or malformed data is never eligible.
 */
export function isNetworkEligible(entry: unknown): entry is NetworkEligibleEntry {
  const result = ManifestEntrySchema.safeParse(entry);
  return result.success && passesGate(result.data);
}

/**
 * The single gate for any eval or job that touches a test site over the network.
 * Validates the whole manifest (throws a ZodError if invalid), then returns only the
 * `own-site` and `granted` entries. Everything else is offline / synthetic only.
 */
export function selectNetworkEligible(data: unknown): NetworkEligibleEntry[] {
  return parseManifest(data).sites.filter(passesGate);
}
