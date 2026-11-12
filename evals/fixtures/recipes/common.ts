import { loadManifest } from '../../src/load-manifest';
import type { Recipe } from '../synthetic/recipe';

/** Platform, page builder and evidence for a slug, straight from `evals/sites/manifest.json`. */
export function platformFromManifest(slug: string): Recipe['platform'] {
  const entry = loadManifest().sites.find((s) => s.slug === slug);
  if (entry === undefined) throw new Error(`recipes: no manifest entry for ${slug}`);
  return {
    platform: entry.platform,
    ...(entry.pageBuilder === undefined ? {} : { pageBuilder: entry.pageBuilder }),
    evidence: entry.evidence.map((e) => ({ signal: e.signal, where: e.where })),
  };
}

/** A small flat SVG, used as every image on a synthetic site (no binary files). */
export function squareSvg(fill: string, size = 96): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" fill="${fill}"/></svg>\n`;
}

export function primaryColor(label: {
  brand: { extractedColors: readonly { hex: string; role?: string | undefined }[] };
}): string {
  return label.brand.extractedColors.find((c) => c.role === 'primary')?.hex ?? '#1a4d8f';
}
