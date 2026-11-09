import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../../../..');
const configFile = path.join(repoRoot, 'eslint.config.mjs');
const fixture = path.join(repoRoot, 'packages/sections/test-fixtures/imports-brand.fixture.ts');

// Client-facing packages that must never depend on the studio brand.
const clientPackages = [
  'packages/sections',
  'packages/agents',
  'packages/site-model',
  ...readdirSync(path.join(repoRoot, 'packages/exporters')).map((d) => `packages/exporters/${d}`),
];

async function lint(code: string, filePath: string) {
  const eslint = new ESLint({ cwd: repoRoot, overrideConfigFile: configFile, ignore: false });
  const [result] = await eslint.lintText(code, { filePath });
  return result!.messages;
}

const restricted = (m: { ruleId: string | null }) =>
  m.ruleId === 'no-restricted-imports' || m.ruleId === 'no-restricted-syntax';

describe('brand/client boundary: ESLint', () => {
  const source = readFileSync(fixture, 'utf8');

  it('rejects a brand import inside packages/sections', async () => {
    const messages = await lint(source, fixture);
    const errors = messages.filter((m) => m.ruleId === 'no-restricted-imports' && m.severity === 2);
    expect(errors.length).toBeGreaterThanOrEqual(2);
    expect(errors[0]!.message).toContain('Studio brand tokens are for the studio UI only');
  });

  it('positive control: the same import in apps/web is not flagged', async () => {
    const messages = await lint(source, path.join(repoRoot, 'apps/web/app/fixture.ts'));
    expect(messages.filter(restricted)).toEqual([]);
  });

  it.each([
    ["import('@srs/brand')"],
    ["require('@srs/brand/theme.css')"],
    ["import('../../brand/src/index')"],
    ["import('../../../apps/web/lib/x')"],
  ])('rejects dynamic access: %s', async (code) => {
    const messages = await lint(
      `void ${code};\n`,
      path.join(repoRoot, 'packages/exporters/astro-site/src/x.ts'),
    );
    expect(messages.filter(restricted).length).toBeGreaterThan(0);
  });

  const nearMisses = [
    './branding-utils',
    '@srs/brandkit',
    './brand-new-section',
    '@srs/webhooks',
    './rebrand',
    './brandon',
    '@srs/brand-utils',
    './mapper/happsy',
    'zod',
  ];

  it.each(nearMisses)('allows near-miss %s as static and dynamic import', async (spec) => {
    const code = `import x from '${spec}';\nexport { x };\nvoid import('${spec}');\n`;
    const messages = await lint(code, path.join(repoRoot, 'packages/agents/src/x.ts'));
    expect(messages.filter(restricted)).toEqual([]);
  });
});

describe('brand/client boundary: pnpm isolation', () => {
  it.each(clientPackages)('%s does not depend on @srs/brand', (dir) => {
    const pkg = JSON.parse(readFileSync(path.join(repoRoot, dir, 'package.json'), 'utf8'));
    for (const field of [
      'dependencies',
      'devDependencies',
      'peerDependencies',
      'optionalDependencies',
    ]) {
      expect(Object.keys(pkg[field] ?? {}), `${dir} ${field}`).not.toContain('@srs/brand');
    }
  });
});

describe('brand/client boundary: no studio tokens in client code', () => {
  // This file and the fixture mention the forbidden strings on purpose.
  const allowed = new Set([fixture, fileURLToPath(import.meta.url)]);

  const binary = /\.(png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|eot|zip|pdf)$/i;

  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === 'dist') continue;
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (!binary.test(name) && !allowed.has(full)) out.push(full);
    }
    return out;
  }

  const files = ['packages/sections', 'packages/exporters'].flatMap((d) =>
    walk(path.join(repoRoot, d)),
  );

  it('scans a non-empty file set', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('contains no studio- variables, @srs/brand or brand theme.css references in any text file', () => {
    const offenders = files.filter((f) => {
      const text = readFileSync(f, 'utf8');
      return /studio-/.test(text) || /@srs\/brand/.test(text) || /brand\/theme\.css/.test(text);
    });
    expect(offenders.map((f) => path.relative(repoRoot, f))).toEqual([]);
  });
});
