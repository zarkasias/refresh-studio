/**
 * ADR-010: the fixture URL schemas accept loopback URLs, so they may only be imported from
 * `evals/` and test files. Two layers: the ESLint rule (with a negative test that it fires) and
 * a repo scan that does not depend on ESLint at all.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../../../../..');
const configFile = path.join(repoRoot, 'eslint.config.mjs');

async function lint(code: string, relPath: string) {
  const eslint = new ESLint({ cwd: repoRoot, overrideConfigFile: configFile, ignore: false });
  const [result] = await eslint.lintText(code, { filePath: path.join(repoRoot, relPath) });
  return result!.messages.filter(
    (m) => m.ruleId === 'no-restricted-imports' || m.ruleId === 'no-restricted-syntax',
  );
}

const BARE = "import { FixtureProjectSchema } from '@srs/site-model/fixture-urls';\n";
const RELATIVE = "import { FixtureProjectSchema } from '../../site-model/src/fixture-urls';\n";
const DYNAMIC = "void import('@srs/site-model/fixture-urls');\n";
const REQUIRE = "void require('@srs/site-model/fixture-urls');\n";
const TEMPLATE_IMPORT = 'void import(`@srs/site-model/fixture-urls`);\n';
const TEMPLATE_PARTS = 'void import(`${base}/fixture-urls`);\n';
const TEMPLATE_REQUIRE = 'void require(`@srs/site-model/fixture-urls`);\n';

describe('fixture URL schemas: ESLint boundary', () => {
  // Production code, one place per kind of package.
  const production = [
    'apps/web/app/page.ts',
    'packages/capture/src/crawl.ts',
    'packages/audit/src/run.ts',
    'packages/agents/src/auditor.ts',
    'packages/sections/src/hero.tsx',
    'packages/exporters/astro-site/src/index.ts',
    'packages/site-model/src/db/mappers.ts',
  ];

  it.each(
    production.flatMap((file) =>
      [BARE, RELATIVE, DYNAMIC, REQUIRE, TEMPLATE_IMPORT, TEMPLATE_PARTS, TEMPLATE_REQUIRE].map(
        (c) => [file, c],
      ),
    ),
  )('fires in %s for %j', async (file, code) => {
    const messages = await lint(code!, file!);
    expect(messages.some((m) => m.message.includes('loopback'))).toBe(true);
  });

  it.each([
    'evals/fixtures/project.ts',
    'evals/src/x.ts',
    'evals/fixtures/project.test.ts',
    'packages/capture/src/crawl.test.ts',
    'packages/site-model/src/schemas/project.test.ts',
    'packages/agents/src/auditor.test.ts',
    'apps/web/app/page.test.tsx',
  ])('positive control: allowed in %s', async (file) => {
    for (const code of [BARE, DYNAMIC]) {
      const messages = await lint(code, file);
      expect(messages.filter((m) => m.message.includes('loopback'))).toEqual([]);
    }
  });

  // F2: the factories must not be reachable from production code, via any entry-point import.
  const FACTORY_IMPORTS = [
    "import { makeProjectSchemas } from '@srs/site-model';\nvoid makeProjectSchemas;\n",
    "import { makeOriginSchema } from '@srs/site-model';\nvoid makeOriginSchema;\n",
    "import { STRICT_URLS } from '@srs/site-model';\nvoid STRICT_URLS;\n",
    "import type { UrlLike, UrlSchemas } from '@srs/site-model';\nexport type T = [UrlLike, UrlSchemas];\n",
    "import { memoOnUrls } from '@srs/site-model';\nvoid memoOnUrls;\n",
  ];
  it.each(
    [...production, 'packages/capture/src/crawl.test.ts', 'apps/web/app/page.test.tsx'].flatMap(
      (file) => FACTORY_IMPORTS.map((c) => [file, c]),
    ),
  )('factory import fires in %s for %j', async (file, code) => {
    const messages = await lint(code!, file!);
    expect(messages.some((m) => m.message.includes('schema factories'))).toBe(true);
  });

  it('the ordinary schemas can still be imported from the main entry', async () => {
    const messages = await lint(
      "import { ProjectSchema, UrlSchema, SiteSchema } from '@srs/site-model';\nvoid [ProjectSchema, UrlSchema, SiteSchema];\n",
      'packages/capture/src/crawl.ts',
    );
    expect(messages).toEqual([]);
  });

  it('evals may use the factories', async () => {
    const messages = await lint(
      "import { makeProjectSchemas } from '@srs/site-model';\nvoid makeProjectSchemas;\n",
      'evals/src/x.ts',
    );
    expect(messages).toEqual([]);
  });

  it('schema modules may not import the strict UrlSchema; primitives.ts may', async () => {
    const code = "import { UrlSchema } from './primitives';\nvoid UrlSchema;\n";
    const bad = await lint(code, 'packages/site-model/src/schemas/newthing.ts');
    expect(bad.some((m) => m.message.includes('local `UrlSchema`'))).toBe(true);
    const ok = await lint(code, 'packages/site-model/src/schemas/newthing.test.ts');
    expect(ok.some((m) => m.message.includes('local `UrlSchema`'))).toBe(false);
  });

  it('keeps the brand boundary in site-model test files', async () => {
    const messages = await lint(
      "import x from '@srs/brand';\nvoid x;\n",
      'packages/site-model/src/schemas/x.test.ts',
    );
    expect(messages.some((m) => m.ruleId === 'no-restricted-imports')).toBe(true);
  });
});

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'coverage', '.git'].includes(entry.name)) continue;
    if (entry.name.startsWith('.next')) continue; // .next, .next-e2e, ...
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx|js|mjs|cjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const IMPORT_OF_FIXTURE_URLS =
  /(?:from\s*|import\s*\(\s*|require\s*\(\s*|import\s+)['"`][^'"`]*fixture-urls(?:\/[^'"`]*)?['"`]/;

describe('fixture URL schemas: repo scan', () => {
  it('are imported only from evals/ and test files', () => {
    const offenders = sourceFiles(repoRoot)
      .map((file) => path.relative(repoRoot, file))
      .filter((rel) => !rel.startsWith('evals/') && !/\.test\.tsx?$/.test(rel))
      .filter((rel) => IMPORT_OF_FIXTURE_URLS.test(readFileSync(path.join(repoRoot, rel), 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('the scan itself catches an import (sanity check on the pattern)', () => {
    for (const code of [
      BARE,
      RELATIVE,
      DYNAMIC,
      REQUIRE,
      TEMPLATE_IMPORT,
      TEMPLATE_REQUIRE,
      "import '../fixture-urls';",
    ]) {
      expect(IMPORT_OF_FIXTURE_URLS.test(code)).toBe(true);
    }
    expect(IMPORT_OF_FIXTURE_URLS.test("import { a } from './fixtures';")).toBe(false);
  });

  it('the production entry point does not re-export the fixture schemas', () => {
    const index = readFileSync(path.join(repoRoot, 'packages/site-model/src/index.ts'), 'utf8');
    const schemas = readFileSync(
      path.join(repoRoot, 'packages/site-model/src/schemas/index.ts'),
      'utf8',
    );
    expect(index + schemas).not.toMatch(/fixture-urls/);
  });
});
