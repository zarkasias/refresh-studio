import { describe, expect, it } from 'vitest';
import {
  MINIMAL_FINDING_ID,
  minimalAuditRun,
  minimalReportDelivery,
  minimalReportDoc,
  minimalReportVersion,
} from '../fixtures';
import type { AuditRun, CheckResult } from '../schemas/audit';
import type { ReportDoc, ReportFinding, ReportVersion } from '../schemas/report';
import { recomputeScores } from '../scoring/recompute';
import { GuardError, type GuardErrorCode } from './errors';
import {
  approveReport,
  assertDeliverable,
  assertReportApprovable,
  assertReportShareable,
  requireNewestApprovedReportVersion,
  resolveSharedReportVersion,
} from './report';

function codeOf(fn: () => unknown): GuardErrorCode {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(GuardError);
    return (e as GuardError).code;
  }
  throw new Error('expected a GuardError');
}

const t = (minute: number) => new Date(Date.UTC(2026, 10, 9, 13, minute)).toISOString();

function withDoc(patch: Partial<ReportDoc>): ReportVersion {
  return { ...minimalReportVersion(), doc: { ...minimalReportDoc(), ...patch } };
}

function listed(findingId: string): ReportFinding {
  return { ...minimalReportDoc().fixNow[0]!, findingId };
}

/** A run with `n` extra failed checks (each its own finding) next to the minimal one. */
function runWithFailures(n: number): AuditRun {
  const run = minimalAuditRun();
  const extra: CheckResult[] = Array.from({ length: n }, (_, i) => ({
    id: 'title-meta',
    findingId: `title-meta:p${i}`,
    passed: false,
    severity: 'low',
    evidence: [{ kind: 'page', pageUrl: 'https://example-plumbing.com/' }],
    plainEnglish: 'A page title is missing.',
  }));
  return { ...run, checks: [...run.checks, ...extra] };
}

describe('assertReportApprovable', () => {
  it('accepts the minimal draft', () => {
    expect(() => assertReportApprovable(minimalReportVersion(), minimalAuditRun())).not.toThrow();
  });

  it('accepts exactly five fix-now items', () => {
    const run = runWithFailures(4);
    const fixNow = [MINIMAL_FINDING_ID, ...[0, 1, 2, 3].map((i) => `title-meta:p${i}`)].map(listed);
    expect(() => assertReportApprovable(withDoc({ fixNow }), run)).not.toThrow();
  });

  it('rejects a sixth fix-now item', () => {
    const run = runWithFailures(5);
    const fixNow = [MINIMAL_FINDING_ID, ...[0, 1, 2, 3, 4].map((i) => `title-meta:p${i}`)].map(
      listed,
    );
    expect(fixNow).toHaveLength(6);
    expect(codeOf(() => assertReportApprovable(withDoc({ fixNow }), run))).toBe('fix-now-limit');
  });

  it.each(['fixNow', 'canWait', 'dismissed'] as const)(
    'rejects a findingId that is not in the AuditRun (%s)',
    (where) => {
      const ghost = 'https:ghost';
      const patch: Partial<ReportDoc> =
        where === 'dismissed'
          ? { dismissed: [{ findingId: ghost, reason: 'wrong', dismissedAt: t(1) }] }
          : { [where]: [listed(ghost)] };
      const doc = withDoc(patch);
      expect(codeOf(() => assertReportApprovable(doc, minimalAuditRun()))).toBe('unknown-finding');
    },
  );

  it('rejects a passed check listed in fix now, or dismissed (only problems can be listed)', () => {
    const passedId = minimalAuditRun().checks[1]!.findingId;
    expect(
      codeOf(() =>
        assertReportApprovable(withDoc({ fixNow: [listed(passedId)] }), minimalAuditRun()),
      ),
    ).toBe('unknown-finding');
    const dismissed = [{ findingId: passedId, reason: 'x', dismissedAt: t(1) }];
    expect(codeOf(() => assertReportApprovable(withDoc({ dismissed }), minimalAuditRun()))).toBe(
      'unknown-finding',
    );
  });

  it('rejects a finding listed twice, within a list or across lists', () => {
    const run = minimalAuditRun();
    expect(
      codeOf(() => assertReportApprovable(withDoc({ canWait: [listed(MINIMAL_FINDING_ID)] }), run)),
    ).toBe('listed-twice');
    expect(
      codeOf(() =>
        assertReportApprovable(
          withDoc({ fixNow: [listed(MINIMAL_FINDING_ID), listed(MINIMAL_FINDING_ID)] }),
          run,
        ),
      ),
    ).toBe('listed-twice');
    const twice = [
      { findingId: MINIMAL_FINDING_ID, reason: 'a', dismissedAt: t(1) },
      { findingId: MINIMAL_FINDING_ID, reason: 'b', dismissedAt: t(2) },
    ];
    expect(
      codeOf(() => assertReportApprovable(withDoc({ fixNow: [], dismissed: twice }), run)),
    ).toBe('listed-twice');
  });

  it('rejects a failed finding that is in none of fix now, can wait or dismissed', () => {
    const run = runWithFailures(1);
    expect(codeOf(() => assertReportApprovable(minimalReportVersion(), run))).toBe(
      'unlisted-finding',
    );
    expect(() => assertReportApprovable(minimalReportVersion(), run)).toThrow(
      "A problem the audit found (title-meta:p0) isn't in the report. Put it under Fix now or Can wait, or dismiss it with a reason.",
    );
    expect(() =>
      assertReportApprovable(withDoc({ canWait: [listed('title-meta:p0')] }), run),
    ).not.toThrow();
  });

  describe('empty copy', () => {
    const run = minimalAuditRun();
    const f = minimalReportDoc().fixNow[0]!;
    it.each([
      ['summary', { summary: '' }],
      ['summary (spaces)', { summary: '   ' }],
      ['whatsWorking', { whatsWorking: [''] }],
      ['sentence', { fixNow: [{ ...f, sentence: ' ' }] }],
      ['whyItMatters', { fixNow: [{ ...f, whyItMatters: '' }] }],
    ] as Array<[string, Partial<ReportDoc>]>)('rejects an empty %s', (_n, patch) => {
      expect(codeOf(() => assertReportApprovable(withDoc(patch), run))).toBe('empty-copy');
    });
    it('rejects empty wording in can wait', () => {
      const run2 = runWithFailures(1);
      const doc = withDoc({ canWait: [{ ...listed('title-meta:p0'), sentence: '' }] });
      expect(codeOf(() => assertReportApprovable(doc, run2))).toBe('empty-copy');
    });
    it('does not look at the note', () => {
      const v = { ...minimalReportVersion(), note: '' };
      expect(() => assertReportApprovable(v, run)).not.toThrow();
    });
  });

  it('rejects scores that differ from the recomputation', () => {
    const doc = minimalReportDoc();
    const typed = { ...doc.scores, easyToContact: { ...doc.scores.easyToContact, value: 100 } };
    expect(
      codeOf(() => assertReportApprovable(withDoc({ scores: typed }), minimalAuditRun())),
    ).toBe('scores-mismatch');
  });

  it('rejects scores whose contributions were edited even if the value matches', () => {
    const doc = minimalReportDoc();
    const typed = {
      ...doc.scores,
      easyToContact: {
        value: 75,
        contributions: [
          { source: 'tap-to-call' as const, delta: -24 },
          { source: 'https' as const, delta: -1 },
        ],
      },
    };
    expect(
      codeOf(() => assertReportApprovable(withDoc({ scores: typed }), minimalAuditRun())),
    ).toBe('scores-mismatch');
  });

  it('accepts a dismissal with recomputed scores, and rejects it with the old scores', () => {
    const run = minimalAuditRun();
    const dismissed = [
      { findingId: MINIMAL_FINDING_ID, reason: 'Number is tappable', dismissedAt: t(2) },
    ];
    const scores = recomputeScores(run, [MINIMAL_FINDING_ID]);
    expect(() =>
      assertReportApprovable(withDoc({ fixNow: [], dismissed, scores }), run),
    ).not.toThrow();
    expect(codeOf(() => assertReportApprovable(withDoc({ fixNow: [], dismissed }), run))).toBe(
      'scores-mismatch',
    );
  });

  it('rejects a finding that is both dismissed and listed', () => {
    const run = minimalAuditRun();
    const dismissed = [{ findingId: MINIMAL_FINDING_ID, reason: 'Wrong', dismissedAt: t(2) }];
    const scores = recomputeScores(run, [MINIMAL_FINDING_ID]);
    // Still listed under fixNow (fixture), also dismissed.
    expect(codeOf(() => assertReportApprovable(withDoc({ dismissed, scores }), run))).toBe(
      'dismissed-and-listed',
    );
    expect(
      codeOf(() =>
        assertReportApprovable(
          withDoc({ fixNow: [], canWait: [listed(MINIMAL_FINDING_ID)], dismissed, scores }),
          run,
        ),
      ),
    ).toBe('dismissed-and-listed');
  });

  it('gives plain-English messages', () => {
    const run = runWithFailures(5);
    const fixNow = [MINIMAL_FINDING_ID, ...[0, 1, 2, 3, 4].map((i) => `title-meta:p${i}`)].map(
      listed,
    );
    expect(() =>
      assertReportApprovable(withDoc({ fixNow }), run),
    ).toThrowErrorMatchingInlineSnapshot(
      `[GuardError: A report can list at most 5 things to fix now. Move the rest to "can wait".]`,
    );
  });
});

describe('assertReportShareable', () => {
  it('refuses an unapproved version, null and undefined', () => {
    expect(codeOf(() => assertReportShareable(minimalReportVersion()))).toBe('not-approved');
    expect(codeOf(() => assertReportShareable(null))).toBe('not-approved');
    expect(codeOf(() => assertReportShareable(undefined))).toBe('not-approved');
  });
  it('refuses a half-approved or malformed record', () => {
    expect(codeOf(() => assertReportShareable({ approvedAt: t(1) }))).toBe('not-approved');
    expect(codeOf(() => assertReportShareable({ approvedAt: 'yesterday', approvedBy: 'c' }))).toBe(
      'not-approved',
    );
    expect(codeOf(() => assertReportShareable({ approvedAt: t(1), approvedBy: ' ' }))).toBe(
      'not-approved',
    );
  });
  it('accepts an approved version', () => {
    expect(() => assertReportShareable({ approvedAt: t(1), approvedBy: 'David' })).not.toThrow();
  });
});

describe('requireNewestApprovedReportVersion', () => {
  const v = (number: number, approved: boolean): ReportVersion => ({
    ...minimalReportVersion(),
    id: `rver_${number}`,
    number,
    createdAt: t(number),
    ...(approved ? { approvedAt: t(number + 30), approvedBy: 'David' } : {}),
  });

  it('returns the newest approved version while a newer draft exists', () => {
    const history = [v(1, true), v(2, true), v(3, false)];
    expect(requireNewestApprovedReportVersion(history).id).toBe('rver_2');
  });
  it('throws when nothing is approved', () => {
    expect(codeOf(() => requireNewestApprovedReportVersion([v(1, false)]))).toBe('not-approved');
    expect(codeOf(() => requireNewestApprovedReportVersion([]))).toBe('not-approved');
  });
});

describe('assertDeliverable', () => {
  const approved: ReportVersion = {
    ...minimalReportVersion(),
    approvedAt: '2026-11-09T14:00:00.000Z',
    approvedBy: 'David',
  };
  it('accepts a delivery of an approved version sent after approval', () => {
    expect(() => assertDeliverable(minimalReportDelivery(), approved)).not.toThrow();
  });
  it('refuses an unapproved version', () => {
    expect(codeOf(() => assertDeliverable(minimalReportDelivery(), minimalReportVersion()))).toBe(
      'not-approved',
    );
  });
  it('refuses a delivery recorded against another version', () => {
    expect(
      codeOf(() =>
        assertDeliverable({ ...minimalReportDelivery(), reportVersionId: 'rver_9' }, approved),
      ),
    ).toBe('delivery-mismatch');
  });
  it('refuses a delivery dated before the approval', () => {
    expect(
      codeOf(() =>
        assertDeliverable(
          { ...minimalReportDelivery(), sentAt: '2026-11-09T13:59:59.000Z' },
          approved,
        ),
      ),
    ).toBe('sent-before-approval');
  });
});

describe('approveReport', () => {
  const report = { id: 'report_1', auditRunId: 'audit_1' };
  const approval = { approvedBy: 'David', approvedAt: t(30) };

  it('approves the newest version when the report checks out', () => {
    const v = approveReport(
      [minimalReportVersion()],
      'rver_1',
      approval,
      report,
      minimalAuditRun(),
    );
    expect(v).toMatchObject({ id: 'rver_1', approvedBy: 'David' });
  });
  it('runs assertReportApprovable', () => {
    const bad = withDoc({ summary: '' });
    expect(codeOf(() => approveReport([bad], 'rver_1', approval, report, minimalAuditRun()))).toBe(
      'empty-copy',
    );
  });
  it('refuses a report or audit that does not match', () => {
    const h = [minimalReportVersion()];
    expect(
      codeOf(() =>
        approveReport(h, 'rver_1', approval, { ...report, id: 'report_2' }, minimalAuditRun()),
      ),
    ).toBe('report-mismatch');
    expect(
      codeOf(() =>
        approveReport(
          h,
          'rver_1',
          approval,
          { ...report, auditRunId: 'audit_2' },
          minimalAuditRun(),
        ),
      ),
    ).toBe('report-mismatch');
  });
  it('keeps the newest-only and once-only rules', () => {
    const v1 = minimalReportVersion();
    const v2 = { ...v1, id: 'rver_2', number: 2 };
    expect(
      codeOf(() => approveReport([v1, v2], 'rver_1', approval, report, minimalAuditRun())),
    ).toBe('not-latest');
  });
});

describe('resolveSharedReportVersion', () => {
  const approved: ReportVersion = {
    ...minimalReportVersion(),
    approvedAt: t(1),
    approvedBy: 'David',
  };
  const draft: ReportVersion = {
    ...minimalReportVersion(),
    id: 'rver_2',
    number: 2,
    createdAt: t(2),
  };
  const link = { reportId: 'report_1', expiresAt: t(50) };

  it('returns the newest approved version while a newer draft exists', () => {
    expect(resolveSharedReportVersion(link, [approved, draft], t(10)).id).toBe('rver_1');
  });
  it('refuses an expired link, a revoked link and another report', () => {
    expect(codeOf(() => resolveSharedReportVersion(link, [approved], t(50)))).toBe('link-expired');
    expect(
      codeOf(() => resolveSharedReportVersion({ ...link, revokedAt: t(5) }, [approved], t(10))),
    ).toBe('link-revoked');
    expect(
      codeOf(() => resolveSharedReportVersion({ ...link, reportId: 'report_2' }, [approved], t(10))),
    ).toBe('link-mismatch');
  });
  it('refuses a link whose report has nothing approved', () => {
    expect(codeOf(() => resolveSharedReportVersion(link, [draft], t(10)))).toBe('not-approved');
  });
});
