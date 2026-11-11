import { describe, expect, it } from 'vitest';
import { MINIMAL_FINDING_ID, minimalAuditRun } from '../fixtures';
import type { AuditRun, CheckResult } from '../schemas/audit';
import { recomputeScores } from './recompute';

function failedCheck(id: CheckResult['id'], findingId: string): CheckResult {
  return {
    id,
    findingId,
    passed: false,
    severity: 'medium',
    evidence: [{ kind: 'page', pageUrl: 'https://example-plumbing.com/' }],
    plainEnglish: 'Something to fix.',
  };
}

describe('recomputeScores', () => {
  it('reproduces the AuditRun scores when nothing is dismissed (the contract with T20)', () => {
    const run = minimalAuditRun();
    expect(recomputeScores(run, [])).toEqual(run.scores);
  });

  it('removes the contribution of a dismissed finding and raises that score only', () => {
    const run = minimalAuditRun();
    const scores = recomputeScores(run, [MINIMAL_FINDING_ID]);
    expect(scores.easyToContact).toEqual({ value: 100, contributions: [] });
    expect(scores.speed).toEqual(run.scores.speed);
  });

  it('keeps tool-derived contributions (lighthouse, axe) whatever is dismissed', () => {
    const run = minimalAuditRun();
    const all = run.checks.map((c) => c.findingId);
    expect(recomputeScores(run, all).speed.contributions).toEqual([
      { source: 'lighthouse:performance', delta: -7 },
    ]);
  });

  it('ignores ids that match no finding', () => {
    const run = minimalAuditRun();
    expect(recomputeScores(run, ['nope:1'])).toEqual(run.scores);
  });

  it('keeps a check contribution until every failed finding of that check is dismissed', () => {
    const run: AuditRun = {
      ...minimalAuditRun(),
      checks: [
        failedCheck('text-contrast', 'text-contrast:a'),
        failedCheck('text-contrast', 'text-contrast:b'),
      ],
    };
    run.scores.accessibility = {
      value: 90,
      contributions: [{ source: 'text-contrast', delta: -10 }],
    };
    expect(recomputeScores(run, ['text-contrast:a']).accessibility.value).toBe(90);
    expect(recomputeScores(run, ['text-contrast:a', 'text-contrast:b']).accessibility.value).toBe(
      100,
    );
  });

  it('rounds the total and clamps it to 0..100', () => {
    const run = minimalAuditRun();
    run.scores.speed = {
      value: 0,
      contributions: [
        { source: 'lighthouse:performance', delta: -70.4 },
        { source: 'lighthouse:lcp', delta: -70 },
      ],
    };
    run.scores.accessibility = {
      value: 0,
      contributions: [{ source: 'axe:image-alt', delta: 12 }],
    };
    run.scores.worksOnPhones = {
      value: 0,
      contributions: [{ source: 'lighthouse:viewport', delta: -30.4 }],
    };
    run.scores.looksCurrent = {
      value: 0,
      contributions: [{ source: 'lighthouse:x', delta: -30.5 }],
    };
    const s = recomputeScores(run, []);
    expect(s.speed.value).toBe(0);
    expect(s.accessibility.value).toBe(100);
    expect(s.worksOnPhones.value).toBe(70);
    expect(s.looksCurrent.value).toBe(70); // 69.5 rounds up
  });

  it('is deterministic and does not mutate the run', () => {
    const run = minimalAuditRun();
    const before = structuredClone(run);
    expect(recomputeScores(run, [MINIMAL_FINDING_ID])).toEqual(
      recomputeScores(run, [MINIMAL_FINDING_ID]),
    );
    expect(run).toEqual(before);
  });
});
