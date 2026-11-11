/**
 * Fixture variants of every URL-bearing record, built by the same factories as the strict ones
 * (ADR-010). For `evals/` and tests only: do not import from production code.
 */
import { makeVersionSchemas } from '../schemas/version';
import { makeAssetSchemas } from '../schemas/asset';
import {
  makeCaptureRunSchemas,
  makeCapturedPageSchemas,
  makePageFactsSchemas,
} from '../schemas/capture';
import {
  makeAuditRunSchemas,
  makeCheckResultSchemas,
  makeLighthouseSchemas,
} from '../schemas/audit';
import { makeProjectSchemas } from '../schemas/project';
import {
  makeReportDocSchemas,
  makeReportFindingSchemas,
  makeReportVersionSchemas,
} from '../schemas/report';
import {
  makeBusinessSchemas,
  makeLocationSchemas,
  makeSiteSchemas,
  makeSocialLinkSchemas,
  makeTrustSchemas,
} from '../schemas/site';
import { FIXTURE_URLS } from './loopback';

export {
  FIXTURE_URLS,
  FixtureOriginSchema,
  FixtureUrlSchema,
  isLoopbackHost,
  isLoopbackHttpUrl,
} from './loopback';

const project = makeProjectSchemas(FIXTURE_URLS);
export const FixtureConsentScopeSchema = project.ConsentScopeSchema;
export const FixtureConsentSchema = project.ConsentSchema;
export const FixtureProjectSchema = project.ProjectSchema;

export const FixtureAssetSchema = makeAssetSchemas(FIXTURE_URLS).AssetSchema;

const run = makeCaptureRunSchemas(FIXTURE_URLS);
export const FixtureCaptureRunObjectSchema = run.CaptureRunObjectSchema;
export const FixtureCaptureRunSchema = run.CaptureRunSchema;
export const FixturePageFactsSchema = makePageFactsSchemas(FIXTURE_URLS).PageFactsSchema;
export const FixtureCapturedPageSchema = makeCapturedPageSchemas(FIXTURE_URLS).CapturedPageSchema;

const checks = makeCheckResultSchemas(FIXTURE_URLS);
export const FixtureEvidenceSchema = checks.EvidenceSchema;
export const FixtureCheckResultObjectSchema = checks.CheckResultObjectSchema;
export const FixtureCheckResultSchema = checks.CheckResultSchema;
export const FixtureLighthouseSummarySchema =
  makeLighthouseSchemas(FIXTURE_URLS).LighthouseSummarySchema;
const audit = makeAuditRunSchemas(FIXTURE_URLS);
export const FixtureAuditRunObjectSchema = audit.AuditRunObjectSchema;
export const FixtureAuditRunSchema = audit.AuditRunSchema;

export const FixtureReportFindingSchema =
  makeReportFindingSchemas(FIXTURE_URLS).ReportFindingSchema;
export const FixtureReportDocSchema = makeReportDocSchemas(FIXTURE_URLS).ReportDocSchema;
const reportVersion = makeReportVersionSchemas(FIXTURE_URLS);
export const FixtureReportVersionObjectSchema = reportVersion.ReportVersionObjectSchema;
export const FixtureReportVersionSchema = reportVersion.ReportVersionSchema;

export const FixtureSocialLinkSchema = makeSocialLinkSchemas(FIXTURE_URLS).SocialLinkSchema;
export const FixtureLocationSchema = makeLocationSchemas(FIXTURE_URLS).LocationSchema;
const trust = makeTrustSchemas(FIXTURE_URLS);
export const FixtureCredentialSchema = trust.CredentialSchema;
export const FixtureTrustSchema = trust.TrustSchema;
export const FixtureBusinessSchema = makeBusinessSchemas(FIXTURE_URLS).BusinessSchema;
const site = makeSiteSchemas(FIXTURE_URLS);
export const FixtureSiteObjectSchema = site.SiteObjectSchema;
export const FixtureSiteSchema = site.SiteSchema;

const version = makeVersionSchemas(FIXTURE_URLS);
export const FixtureVersionSnapshotSchema = version.VersionSnapshotSchema;
export const FixtureVersionObjectSchema = version.VersionObjectSchema;
export const FixtureVersionSchema = version.VersionSchema;
