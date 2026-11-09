/**
 * T9: schema conformance for hand-labeled test sites (M0 gate items 4 and 5).
 *
 * Reads `evals/sites/<slug>/expected.site.json` for every manifest slug (local files only, no
 * network) and checks each against `SiteSchema` plus a few labeling rules. Directories whose
 * name starts with `_` (the blank template) are skipped.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { SiteSchema, type Site } from '@srs/site-model';
import type { Manifest, Misfit } from './manifest';

export const SITES_DIR = fileURLToPath(new URL('../sites/', import.meta.url));
export const LABEL_FILE = 'expected.site.json';

/** Gate item 4: at least this many sites need a valid hand label. */
export const GATE_MIN_LABELED = 10;

/** Placeholder marker used by the blank template; a finished label must not contain it. */
export const TODO_MARKER = 'TODO';

export interface LabelResult {
  slug: string;
  /** Problems that make this label fail conformance. Empty = passes. */
  errors: string[];
  /** Worth a look, but not a failure (e.g. platform differs from the manifest). */
  warnings: string[];
}

export interface ConformanceReport {
  labels: LabelResult[];
  /** Manifest slugs without an `expected.site.json` yet. */
  unlabeled: string[];
  /** Directories under evals/sites that are not in the manifest. */
  strayDirs: string[];
  /** Misfits with no `resolution` yet (gate item 5). */
  openMisfits: { slug: string; misfit: Misfit }[];
  resolvedMisfits: { slug: string; misfit: Misfit }[];
}

function findTodos(value: unknown, path: string, out: string[]): void {
  if (typeof value === 'string') {
    if (value.includes(TODO_MARKER)) out.push(path || '(root)');
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => findTodos(v, `${path}[${i}]`, out));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) findTodos(v, path ? `${path}.${k}` : k, out);
  }
}

const originOf = (url: string): string | undefined => {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
};

/** Check one parsed label against the schema and the labeling rules. Pure. */
export function checkLabel(
  slug: string,
  raw: unknown,
  entry: Manifest['sites'][number],
): LabelResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const todos: string[] = [];
  findTodos(raw, '', todos);
  if (todos.length > 0) {
    errors.push(`still has ${TODO_MARKER} placeholders at: ${todos.join(', ')}`);
  }

  const parsed = SiteSchema.safeParse(raw);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      errors.push(`${issue.path.join('.') || '(root)'}: ${issue.message}`);
    }
    return { slug, errors, warnings };
  }
  const site: Site = parsed.data;

  if (site.id !== `site_${slug}`) errors.push(`id should be "site_${slug}"`);
  if (!site.pages.some((p) => p.path === '/')) errors.push('no homepage (a page with path "/")');
  const hasContact =
    site.pages.some((p) => p.path !== '/' && /contact/i.test(p.path)) ||
    site.pages.some((p) => p.sections.some((s) => s.type === 'contact'));
  if (!hasContact) {
    errors.push(
      'no contact page or contact section (if the site truly has none, label what it has and log a misfit)',
    );
  }
  if (originOf(site.sourceUrl) !== originOf(entry.url)) {
    errors.push(`sourceUrl ${site.sourceUrl} is not on the manifest's site ${entry.url}`);
  }
  if (site.platform !== entry.platform) {
    warnings.push(`platform "${site.platform}" differs from the manifest's "${entry.platform}"`);
  }
  return { slug, errors, warnings };
}

/** Build the report from the manifest and the files under `sitesDir`. Local reads only. */
export function runConformance(
  manifest: Manifest,
  sitesDir: string = SITES_DIR,
): ConformanceReport {
  const bySlug = new Map(manifest.sites.map((e) => [e.slug, e]));
  const labels: LabelResult[] = [];
  const unlabeled: string[] = [];

  for (const entry of manifest.sites) {
    const file = join(sitesDir, entry.slug, LABEL_FILE);
    if (!existsSync(file)) {
      unlabeled.push(entry.slug);
      continue;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(file, 'utf8')) as unknown;
    } catch (e) {
      labels.push({
        slug: entry.slug,
        errors: [`not valid JSON: ${(e as Error).message}`],
        warnings: [],
      });
      continue;
    }
    labels.push(checkLabel(entry.slug, raw, entry));
  }

  const strayDirs = readdirSync(sitesDir).filter(
    (name) =>
      !name.startsWith('_') &&
      !name.startsWith('.') &&
      statSync(join(sitesDir, name)).isDirectory() &&
      !bySlug.has(name),
  );

  const misfits = manifest.sites.flatMap((e) =>
    e.misfits.map((m) => ({ slug: e.slug, misfit: m })),
  );
  return {
    labels,
    unlabeled,
    strayDirs,
    openMisfits: misfits.filter((m) => m.misfit.resolution === undefined),
    resolvedMisfits: misfits.filter((m) => m.misfit.resolution !== undefined),
  };
}

/** Gate items 4 and 5. Returns the reasons the gate is not met (empty = met). */
export function gateProblems(report: ConformanceReport): string[] {
  const problems: string[] = [];
  const passing = report.labels.filter((l) => l.errors.length === 0).length;
  if (passing < GATE_MIN_LABELED) {
    problems.push(`${passing} of ${GATE_MIN_LABELED} required sites have a passing label`);
  }
  if (report.openMisfits.length > 0) {
    problems.push(`${report.openMisfits.length} misfit(s) not yet resolved`);
  }
  return problems;
}

/** Human-readable summary for the test log. */
export function formatReport(report: ConformanceReport): string {
  const lines: string[] = ['', 'Site model conformance (M0 gate, T9)', ''];
  for (const l of report.labels) {
    lines.push(`${l.errors.length === 0 ? 'PASS' : 'FAIL'}  ${l.slug}`);
    for (const e of l.errors) lines.push(`        error: ${e}`);
    for (const w of l.warnings) lines.push(`        warning: ${w}`);
  }
  if (report.unlabeled.length > 0) lines.push(`Not labeled yet: ${report.unlabeled.join(', ')}`);
  if (report.strayDirs.length > 0) lines.push(`Not in manifest: ${report.strayDirs.join(', ')}`);
  lines.push(
    '',
    `Misfits: ${report.openMisfits.length} open, ${report.resolvedMisfits.length} resolved`,
  );
  for (const { slug, misfit } of report.openMisfits) {
    lines.push(`  OPEN      ${slug}  ${misfit.field}: ${misfit.note}`);
  }
  for (const { slug, misfit } of report.resolvedMisfits) {
    lines.push(`  ${misfit.resolution?.padEnd(9)} ${slug}  ${misfit.field}: ${misfit.note}`);
  }
  const problems = gateProblems(report);
  lines.push(
    '',
    problems.length === 0 ? 'Gate: MET' : `Gate: not met (${problems.join('; ')})`,
    '',
  );
  return lines.join('\n');
}
