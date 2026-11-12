/**
 * `expected.capture.json`: what capture must find in one synthetic site (M1 T6a). Written next
 * to the anonymized label (`expected.site.json`) in `evals/fixtures/sites/<slug>/`. Everything
 * here is fictional (it comes from the anonymized label); see `ADR-010`.
 *
 * No slug field: the slug is the real business's identifier, so it lives only in directory
 * names the task file fixes. Paths are site paths (`/contact-5`); files are relative to the site directory.
 */
import { z } from 'zod';

const PathSchema = z.string().startsWith('/');
const Hex = z.string().regex(/^#[0-9a-f]{6}$/);

export const ExpectedPageSchema = z.strictObject({
  path: PathSchema,
  /** File under the site directory that serves this page. */
  file: z.string().min(1),
  title: z.string(),
  /** Section ids from the label, in page order. Slider clones are not listed here. */
  sectionIds: z.array(z.string().min(1)),
});

export const ExpectedPlatformSchema = z.strictObject({
  platform: z.string().min(1),
  pageBuilder: z.string().optional(),
  /** The manifest's `evidence`, unchanged. */
  evidence: z.array(z.strictObject({ signal: z.string().min(1), where: z.string().min(1) })),
  /** Markers the recipe actually put in the pages. */
  markers: z.array(
    z.strictObject({
      where: z.enum(['html', 'asset-url']),
      value: z.string().min(1),
      page: PathSchema.optional(),
    }),
  ),
});

export const ExpectedFontSchema = z.strictObject({
  /** The real family name, as the labels record it. */
  family: z.string().min(1),
  /** The first family in the computed `font-family` (the builder's internal name on Wix). */
  computed: z.string().min(1),
  usedOn: z.array(z.string().min(1)).min(1),
});

export const ExpectedColorSchema = z.strictObject({
  hex: Hex,
  /** Where it shows on the page: text roles (`heading`, `link`, `cta`, `body`) or `background`. */
  usedOn: z.array(z.string().min(1)).min(1),
});

export const ExpectedPhoneSchema = z.strictObject({
  display: z.string().min(1),
  href: z.string().startsWith('tel:'),
  page: PathSchema,
  sectionId: z.string().min(1),
});

export const ExpectedPlainTextPhoneSchema = z.strictObject({
  display: z.string().min(1),
  page: PathSchema,
  sectionId: z.string().min(1),
});

export const ExpectedMismatchSchema = z.strictObject({
  page: PathSchema,
  sectionId: z.string().min(1),
  label: z.string(),
  href: z.string(),
});

export const ExpectedEmailSchema = z.strictObject({
  value: z.string().includes('@'),
  obfuscation: z.enum(['none', 'cloudflare']),
  page: PathSchema,
  sectionId: z.string().min(1),
});

export const ExpectedHiddenCopySchema = z.strictObject({
  page: PathSchema,
  /** CSS selector that matches the copy. */
  selector: z.string().min(1),
  /** Section id of the original block it copies. */
  copyOf: z.string().min(1),
  /** How a capture can tell: `class`, `aria-hidden`. */
  signals: z.array(z.enum(['class', 'aria-hidden', 'display-none'])).min(1),
});

export const ExpectedNavDropdownSchema = z.strictObject({
  page: PathSchema,
  sectionId: z.string().min(1),
  title: z.string().min(1),
  href: z.string().min(1),
  children: z.array(z.strictObject({ title: z.string().min(1), link: z.string().min(1) })).min(1),
});

export const ExpectedDeferredSchema = z.strictObject({
  page: PathSchema,
  sectionId: z.string().min(1),
  selector: z.string().min(1),
  /** Text shown until the script replaces it. */
  placeholderText: z.string().min(1),
  /** The script replaces the placeholder after this many milliseconds. */
  settleMs: z.number().int().positive(),
  finalItemCount: z.number().int().positive(),
  finalTextIncludes: z.string().min(1),
});

export const ExpectedCaptureSchema = z.strictObject({
  schemaVersion: z.literal(1),
  /** Seed given to `anonymize`; the same seed always gives the same bytes. */
  seed: z.string().min(1),
  pages: z.array(ExpectedPageSchema).min(1),
  platform: ExpectedPlatformSchema,
  fonts: z.array(ExpectedFontSchema),
  colors: z.array(ExpectedColorSchema),
  /** Phone links whose label and `tel:` href are the same number. */
  phones: z.array(ExpectedPhoneSchema),
  /** Phones shown as plain text with no link. */
  plainTextPhones: z.array(ExpectedPlainTextPhoneSchema),
  /** Links whose displayed number differs from the `tel:` href. */
  hrefMismatches: z.array(ExpectedMismatchSchema),
  emails: z.array(ExpectedEmailSchema),
  hiddenCopies: z.array(ExpectedHiddenCopySchema),
  navDropdowns: z.array(ExpectedNavDropdownSchema),
  deferredContent: z.array(ExpectedDeferredSchema),
  /** Strings capture must never record as content. */
  mustNotRecord: z.array(z.string().min(1)),
});
export type ExpectedCapture = z.infer<typeof ExpectedCaptureSchema>;
