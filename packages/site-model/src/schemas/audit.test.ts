import { describe, expect, it } from 'vitest';
import { MINIMAL_FINDING_ID, minimalAuditRun } from '../fixtures';
import { omit } from '../test-utils';
import {
  AuditRunSchema,
  CheckIdSchema,
  CheckResultSchema,
  EvidenceSchema,
  ScoreSchema,
  ScoreSourceSchema,
} from './audit';

describe('AuditRunSchema', () => {
  it('accepts the minimal run', () => {
    expect(AuditRunSchema.safeParse(minimalAuditRun()).success).toBe(true);
  });
  it('lists all 22 check ids from the plan', () => {
    expect(CheckIdSchema.options).toHaveLength(22);
  });
  it('requires all five scores', () => {
    const run = minimalAuditRun();
    const scores = omit(run.scores, 'speed');
    expect(AuditRunSchema.safeParse({ ...run, scores }).success).toBe(false);
  });
  it('rejects an unknown score key and unknown fields', () => {
    const run = minimalAuditRun();
    expect(
      AuditRunSchema.safeParse({ ...run, scores: { ...run.scores, vibes: run.scores.speed } })
        .success,
    ).toBe(false);
    expect(AuditRunSchema.safeParse({ ...run, extra: 1 }).success).toBe(false);
  });
  it('rejects a repeated findingId', () => {
    const run = minimalAuditRun();
    const dup = { ...run.checks[0]!, passed: true };
    const r = AuditRunSchema.safeParse({ ...run, checks: [run.checks[0], dup] });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(['checks', 1, 'findingId']);
  });
  it('rejects Lighthouse category scores outside 0 to 1 and an unknown preset', () => {
    const run = minimalAuditRun();
    const lh = run.lighthouse[0]!;
    expect(
      AuditRunSchema.safeParse({ ...run, lighthouse: [{ ...lh, performance: 93 }] }).success,
    ).toBe(false);
    expect(
      AuditRunSchema.safeParse({ ...run, lighthouse: [{ ...lh, preset: 'tablet' }] }).success,
    ).toBe(false);
  });
});

describe('AuditRunSchema scores', () => {
  it('rejects a score value its contributions do not add up to', () => {
    const run = minimalAuditRun();
    const bad = { ...run.scores, easyToContact: { ...run.scores.easyToContact, value: 80 } };
    const r = AuditRunSchema.safeParse({ ...run, scores: bad });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(['scores', 'easyToContact', 'value']);
  });
  it('rounds and clamps like recomputeScores', () => {
    const run = minimalAuditRun();
    const scores = {
      ...run.scores,
      speed: { value: 70, contributions: [{ source: 'lighthouse:a' as const, delta: -30.5 }] },
      accessibility: { value: 0, contributions: [{ source: 'axe:b' as const, delta: -250 }] },
    };
    expect(AuditRunSchema.safeParse({ ...run, scores }).success).toBe(true);
  });
});

describe('CheckResultSchema', () => {
  it('requires evidence on a failed check but not on a passed one', () => {
    const failed = minimalAuditRun().checks[0]!;
    expect(CheckResultSchema.safeParse({ ...failed, evidence: [] }).success).toBe(false);
    expect(CheckResultSchema.safeParse({ ...failed, passed: true, evidence: [] }).success).toBe(
      true,
    );
  });
  it('requires findingId to start with the check id', () => {
    const failed = minimalAuditRun().checks[0]!;
    expect(CheckResultSchema.safeParse({ ...failed, findingId: 'https:abc' }).success).toBe(false);
    expect(CheckResultSchema.safeParse({ ...failed, findingId: 'tap-to-call:' }).success).toBe(
      false,
    );
    expect(CheckResultSchema.safeParse({ ...failed, findingId: MINIMAL_FINDING_ID }).success).toBe(
      true,
    );
  });
  it('rejects an empty plainEnglish', () => {
    expect(
      CheckResultSchema.safeParse({ ...minimalAuditRun().checks[0]!, plainEnglish: '' }).success,
    ).toBe(false);
  });
});

describe('EvidenceSchema', () => {
  it('allows an empty string value (text from the client site) and numeric metrics', () => {
    const base = { kind: 'text', pageUrl: 'https://example-plumbing.com/' };
    expect(EvidenceSchema.safeParse({ ...base, value: '' }).success).toBe(true);
    expect(
      EvidenceSchema.safeParse({ kind: 'metric', pageUrl: base.pageUrl, value: 2100 }).success,
    ).toBe(true);
  });
  it('rejects an empty selector and a negative box', () => {
    const base = { kind: 'element', pageUrl: 'https://example-plumbing.com/' };
    expect(EvidenceSchema.safeParse({ ...base, selector: '' }).success).toBe(false);
    expect(EvidenceSchema.safeParse({ ...base, box: { x: -1, y: 0, w: 1, h: 1 } }).success).toBe(
      false,
    );
  });
});

describe('Score', () => {
  it('accepts check, lighthouse and axe sources only', () => {
    for (const source of ['tap-to-call', 'lighthouse:performance', 'axe:color-contrast']) {
      expect(ScoreSourceSchema.safeParse(source).success).toBe(true);
    }
    for (const source of ['lighthouse:', 'axe:', 'vibes', 'LLM:opinion']) {
      expect(ScoreSourceSchema.safeParse(source).success).toBe(false);
    }
  });
  it('requires an integer value from 0 to 100 and finite deltas', () => {
    expect(ScoreSchema.safeParse({ value: 101, contributions: [] }).success).toBe(false);
    expect(ScoreSchema.safeParse({ value: 50.5, contributions: [] }).success).toBe(false);
    expect(
      ScoreSchema.safeParse({ value: 50, contributions: [{ source: 'https', delta: NaN }] })
        .success,
    ).toBe(false);
    expect(
      ScoreSchema.safeParse({ value: 50, contributions: [{ source: 'https', delta: -0.5 }] })
        .success,
    ).toBe(true);
  });
});
