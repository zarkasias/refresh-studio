/**
 * Per-slug identity the label has no structured field for: landmarks, regions and districts that
 * appear only in headings, titles, short text or paths. Passed to `anonymize` and
 * `findLabelLeaks` as `extraIdentity`. Found by sweeping the anonymized output of every labeled
 * site (M1 T5 fix round 1); add to it whenever a new label names a place outside `business`.
 *
 * This file names real places from the labels, like the labels themselves (keep the repo private,
 * ADR-004). It never reaches a fixture: every entry is replaced in the output.
 */
export const EXTRA_IDENTITY: Readonly<Record<string, readonly string[]>> = {
  // "Nevada" is a town in the Iowa service area; extra identity overrides the keep-states rule.
  // "Dynasty Homes" is a local builder shown as a partner badge.
  'arc-electric': ['Nevada', 'Dynasty Homes'],
  'bella-lago-salon': ['Lake Norman', 'Birkdale'],
  'cafecito-santa-fe': ['Acequia Trail', 'Baca District', 'Railyard', 'South Capitol'],
  'chambers-consulting': ['Northern Virginia'],
  'delaware-valley-hardwoods': ['Northern Delaware'],
  // Local web agencies credited in the footer.
  'hair-and-co-brooklyn': ['Linkup Marketing'],
  iphci: ['Fusion Forward'],
};

/** The extra identity strings for a slug (empty when there are none). */
export function extraIdentityFor(slug: string): readonly string[] {
  return EXTRA_IDENTITY[slug] ?? [];
}
