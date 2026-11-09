import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { eq, sql } from 'drizzle-orm';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  minimalAsset,
  minimalComment,
  minimalProject,
  minimalSite,
  minimalVariant,
  minimalVersion,
} from '../fixtures';
import { omit } from '../test-utils';
import { ProjectSchema, SiteSchema, VariantSchema } from '../schemas';
import {
  assetToRow,
  assets,
  commentToRow,
  comments,
  projects,
  projectToRow,
  rowToAsset,
  rowToComment,
  rowToProject,
  rowToSite,
  rowToVariant,
  rowToVersion,
  siteToRow,
  sites,
  variants,
  variantToRow,
  versions,
  versionToRow,
} from './index';

const pkgDir = fileURLToPath(new URL('../../', import.meta.url));
const migrationsFolder = join(pkgDir, 'drizzle');
const at = new Date('2026-11-09T12:00:00.000Z');

let client: PGlite;
let db: PgliteDatabase;

// Migrate once; each test starts from empty tables.
beforeAll(async () => {
  client = new PGlite();
  db = drizzle(client);
  await migrate(db, { migrationsFolder });
});
beforeEach(async () => {
  await db.execute(sql`TRUNCATE projects, sites, assets, variants, versions, comments CASCADE`);
});
afterAll(async () => {
  await client.close();
});

/** Asserts the insert/delete fails on the named constraint (Postgres reports it on `cause`). */
async function rejectsOn(promise: Promise<unknown>, constraint: string) {
  const err = (await promise.then(
    () => undefined,
    (e: unknown) => e,
  )) as { cause?: { constraint?: string }; constraint?: string } | undefined;
  expect(err, `expected a ${constraint} violation, but the statement succeeded`).toBeDefined();
  expect(err?.cause?.constraint ?? err?.constraint).toBe(constraint);
}

async function seedSite() {
  await db.insert(projects).values(projectToRow(minimalProject()));
  await db.insert(sites).values(siteToRow(minimalSite(), { createdAt: at, updatedAt: at }));
}

describe('migrations on PGlite', () => {
  it('round-trips a project with consent', async () => {
    const project = minimalProject();
    expect(project.consent).toBeDefined();
    await db.insert(projects).values(projectToRow(project));
    const [row] = await db.select().from(projects).where(eq(projects.id, project.id));
    expect(ProjectSchema.parse(rowToProject(row!))).toEqual(project);
  });

  it('round-trips a project without consent', async () => {
    const project = omit(minimalProject(), 'consent');
    await db.insert(projects).values(projectToRow(project));
    const [row] = await db.select().from(projects);
    expect(rowToProject(row!)).toEqual(project);
  });

  it('round-trips the minimal Site through the doc column', async () => {
    await seedSite();
    const [row] = await db.select().from(sites).where(eq(sites.id, minimalSite().id));
    expect(SiteSchema.parse(rowToSite(row!))).toEqual(minimalSite());
  });

  it('round-trips an asset, variant, version and comment', async () => {
    await seedSite();
    await db.insert(assets).values(assetToRow(minimalAsset()));
    await db.insert(variants).values(variantToRow(minimalVariant()));
    await db.insert(versions).values(versionToRow(minimalVersion()));
    await db.insert(comments).values(commentToRow(minimalComment()));
    const [a] = await db.select().from(assets);
    const [v] = await db.select().from(variants);
    const [ver] = await db.select().from(versions);
    const [c] = await db.select().from(comments);
    expect(rowToAsset(a!)).toEqual(minimalAsset());
    expect(VariantSchema.parse(rowToVariant(v!))).toEqual(minimalVariant());
    expect(rowToVersion(ver!)).toEqual(minimalVersion());
    expect(rowToComment(c!)).toEqual(minimalComment());
  });

  it('round-trips an approved version with its approval timestamp in UTC', async () => {
    await seedSite();
    await db.insert(variants).values(variantToRow(minimalVariant()));
    const approved = {
      ...minimalVersion(),
      approvedAt: '2026-11-09T15:30:00.000Z',
      approvedBy: 'consultant',
    };
    await db.insert(versions).values(versionToRow(approved));
    const [row] = await db.select().from(versions);
    expect(rowToVersion(row!)).toEqual(approved);
  });

  it('rejects a doc/row mismatch when reading a site', async () => {
    await seedSite();
    const [row] = await db.select().from(sites);
    expect(() => rowToSite({ ...row!, projectId: 'other' })).toThrow(/disagrees/);
  });

  it('migrates a stored v1 site doc on read (ADR-006)', async () => {
    await seedSite();
    const [row] = await db.select().from(sites);
    const v1Doc = {
      ...minimalSite(),
      schemaVersion: 1,
      business: { name: 'Example Plumbing', phone: '555-0100', socialLinks: [] },
    };
    await db
      .update(sites)
      .set({ schemaVersion: 1, doc: v1Doc as never })
      .where(eq(sites.id, row!.id));
    const [stored] = await db.select().from(sites);
    const site = rowToSite(stored!);
    expect(site.schemaVersion).toBe(2);
    expect(site.business.phones).toEqual([{ value: '555-0100' }]);
  });

  it('migrates the v1 snapshot of a frozen approved version on read (ADR-005, ADR-006)', async () => {
    await seedSite();
    await db.insert(variants).values(variantToRow(minimalVariant()));
    const approved = {
      ...minimalVersion(),
      approvedAt: '2026-11-09T15:30:00.000Z',
      approvedBy: 'consultant',
    };
    const row = versionToRow(approved);
    const v1Snapshot = {
      ...approved.snapshot,
      site: {
        ...approved.snapshot.site,
        schemaVersion: 1,
        business: { name: 'Example Plumbing', email: 'a@example.com', socialLinks: [] },
      },
    };
    await db.insert(versions).values({ ...row, snapshot: v1Snapshot as never });
    const [stored] = await db.select().from(versions);
    const version = rowToVersion(stored!);
    expect(version.snapshot.site.schemaVersion).toBe(2);
    expect(version.snapshot.site.business.emails).toEqual([{ value: 'a@example.com' }]);
  });
});

describe('constraints', () => {
  it('rejects consent_max_pages = 26 (rule 6)', async () => {
    const row = { ...projectToRow(minimalProject()), consentMaxPages: 26 };
    await rejectsOn(db.insert(projects).values(row), 'projects_consent_max_pages_range');
  });

  it('rejects consent_max_pages = 0', async () => {
    const row = { ...projectToRow(minimalProject()), consentMaxPages: 0 };
    await rejectsOn(db.insert(projects).values(row), 'projects_consent_max_pages_range');
  });

  it('accepts consent_max_pages = 25', async () => {
    const row = { ...projectToRow(minimalProject()), consentMaxPages: 25 };
    await expect(db.insert(projects).values(row)).resolves.toBeDefined();
  });

  it('rejects partial consent (method missing)', async () => {
    const row = { ...projectToRow(minimalProject()), consentMethod: null };
    await rejectsOn(db.insert(projects).values(row), 'projects_consent_all_or_none');
  });

  it.each([
    ['consent_path_prefix', { consentPathPrefix: '/jolly' }],
    ['consent_evidence_asset_id', { consentEvidenceAssetId: 'asset_email' }],
  ])('rejects %s set when the rest of consent is null', async (_name, extra) => {
    const row = {
      ...projectToRow(omit(minimalProject(), 'consent')),
      ...extra,
    };
    await rejectsOn(db.insert(projects).values(row), 'projects_consent_all_or_none');
  });

  it('rejects an unknown consent method', async () => {
    const row = { ...projectToRow(minimalProject()), consentMethod: 'verbal' };
    await rejectsOn(db.insert(projects).values(row), 'projects_consent_method_values');
  });

  describe('versions (rule 4, ADR-005)', () => {
    async function seedVariant() {
      await seedSite();
      await db.insert(variants).values(variantToRow(minimalVariant()));
    }

    it('rejects approved_at without approved_by', async () => {
      await seedVariant();
      const row = { ...versionToRow(minimalVersion()), approvedAt: at };
      await rejectsOn(db.insert(versions).values(row), 'versions_approval_pair');
    });

    it('rejects an empty approved_by', async () => {
      await seedVariant();
      const row = { ...versionToRow(minimalVersion()), approvedAt: at, approvedBy: '' };
      await rejectsOn(db.insert(versions).values(row), 'versions_approved_by_nonempty');
    });

    it('rejects approval before creation', async () => {
      await seedVariant();
      const row = {
        ...versionToRow(minimalVersion()),
        approvedAt: new Date('2026-11-09T11:00:00.000Z'),
        approvedBy: 'consultant',
      };
      await rejectsOn(db.insert(versions).values(row), 'versions_approved_after_created');
    });

    it('rejects a duplicate version number for the same variant', async () => {
      await seedVariant();
      await db.insert(versions).values(versionToRow(minimalVersion()));
      const dup = { ...versionToRow(minimalVersion()), id: 'ver_2' };
      await rejectsOn(db.insert(versions).values(dup), 'versions_variant_number_unique');
    });

    it('rejects version number 0', async () => {
      await seedVariant();
      const row = { ...versionToRow(minimalVersion()), number: 0 };
      await rejectsOn(db.insert(versions).values(row), 'versions_number_positive');
    });

    it('allows editing and then approving an unapproved version', async () => {
      await seedVariant();
      await db.insert(versions).values(versionToRow(minimalVersion()));
      await db.update(versions).set({ note: 'edited' }).where(eq(versions.id, 'ver_1'));
      await db
        .update(versions)
        .set({ approvedAt: at, approvedBy: 'consultant' })
        .where(eq(versions.id, 'ver_1'));
      const [row] = await db.select().from(versions);
      expect(rowToVersion(row!)).toMatchObject({ note: 'edited', approvedBy: 'consultant' });
    });

    it('freezes an approved version: no update', async () => {
      await seedVariant();
      const approved = { ...minimalVersion(), approvedAt: at.toISOString(), approvedBy: 'c' };
      await db.insert(versions).values(versionToRow(approved));
      await rejectsOn(
        db.update(versions).set({ note: 'sneaky edit' }).where(eq(versions.id, 'ver_1')),
        'versions_freeze_approved',
      );
      await rejectsOn(
        db
          .update(versions)
          .set({ approvedAt: null, approvedBy: null })
          .where(eq(versions.id, 'ver_1')),
        'versions_freeze_approved',
      );
    });

    it('freezes an approved version: no delete', async () => {
      await seedVariant();
      const approved = { ...minimalVersion(), approvedAt: at.toISOString(), approvedBy: 'c' };
      await db.insert(versions).values(versionToRow(approved));
      await rejectsOn(
        db.delete(versions).where(eq(versions.id, 'ver_1')),
        'versions_freeze_approved',
      );
    });
  });

  it('allows any variant status at the database level (checked by assertStatusAllowed)', async () => {
    await seedSite();
    const row = { ...variantToRow(minimalVariant()), status: 'shared' };
    await expect(db.insert(variants).values(row)).resolves.toBeDefined();
  });

  it('allows a draft variant without approval', async () => {
    await seedSite();
    await expect(db.insert(variants).values(variantToRow(minimalVariant()))).resolves.toBeDefined();
  });

  it('rejects an unknown variant status', async () => {
    await seedSite();
    const row = { ...variantToRow(minimalVariant()), status: 'published' };
    await rejectsOn(db.insert(variants).values(row), 'variants_status_values');
  });

  it('rejects a site whose project does not exist (FK)', async () => {
    await rejectsOn(
      db.insert(sites).values(siteToRow(minimalSite(), { createdAt: at, updatedAt: at })),
      'sites_project_id_projects_id_fk',
    );
  });
});

describe('delete policy', () => {
  async function seedHistory() {
    await seedSite();
    await db.insert(variants).values(variantToRow(minimalVariant()));
    await db.insert(versions).values(versionToRow(minimalVersion()));
    await db.insert(comments).values(commentToRow(minimalComment()));
  }

  it('refuses to delete a variant that has versions', async () => {
    await seedHistory();
    await rejectsOn(
      db.delete(variants).where(eq(variants.id, 'var_1')),
      'versions_variant_id_variants_id_fk',
    );
  });

  it('refuses to delete a version that has comments', async () => {
    await seedHistory();
    await rejectsOn(
      db.delete(versions).where(eq(versions.id, 'ver_1')),
      'comments_version_id_versions_id_fk',
    );
  });

  it('refuses to delete a project whose variants have history', async () => {
    await seedHistory();
    await rejectsOn(
      db.delete(projects).where(eq(projects.id, minimalProject().id)),
      'versions_variant_id_variants_id_fk',
    );
  });

  it('cascades project -> site -> assets and variants when there is no history', async () => {
    await seedSite();
    await db.insert(assets).values(assetToRow(minimalAsset()));
    await db.insert(variants).values(variantToRow(minimalVariant()));
    await db.delete(projects).where(eq(projects.id, minimalProject().id));
    expect(await db.select().from(sites)).toHaveLength(0);
    expect(await db.select().from(assets)).toHaveLength(0);
    expect(await db.select().from(variants)).toHaveLength(0);
  });
});

describe('generated migration', () => {
  it('is up to date with src/db/schema.ts (drizzle-kit generate produces nothing new)', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'srs-drizzle-'));
    try {
      const bin = join(pkgDir, 'node_modules/.bin/drizzle-kit');
      const configPath = join(tmp, 'drizzle.config.mjs');
      // Re-generate into a copy of the committed migrations; a drift would add a new file.
      execFileSync('cp', ['-R', migrationsFolder, join(tmp, 'out')]);
      // drizzle-kit prefixes "./" to `out`, so pass paths relative to the package dir.
      const out = relative(pkgDir, join(tmp, 'out'));
      const config = `export default { dialect: 'postgresql', schema: './src/db/schema.ts', out: ${JSON.stringify(out)} };`;
      execFileSync('sh', ['-c', `printf '%s' "$CFG" > "$P"`], {
        env: { ...process.env, CFG: config, P: configPath },
      });
      const output = execFileSync(bin, ['generate', '--config', configPath], {
        cwd: pkgDir,
        encoding: 'utf8',
      });
      expect(output).toMatch(/No schema changes/i);
      const sql = (dir: string) =>
        readdirSync(dir)
          .filter((f) => f.endsWith('.sql'))
          .sort();
      expect(sql(join(tmp, 'out'))).toEqual(sql(migrationsFolder));
      expect(readFileSync(join(tmp, 'out/meta/_journal.json'), 'utf8')).toBe(
        readFileSync(join(migrationsFolder, 'meta/_journal.json'), 'utf8'),
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 60_000);
});
