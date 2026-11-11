import { describe, expect, it } from 'vitest';
import { minimalReportDoc, minimalReportVersion } from '../fixtures';
import { GuardError } from '../guards/errors';
import { requireNewestApprovedReportVersion } from '../guards/report';
import type { ReportDoc, ReportVersion } from '../schemas/report';
import {
  approveReportVersion,
  createReportVersion,
  latestApprovedReportVersion,
  latestReportVersion,
  reportHistory,
  saveReportEdit,
} from './report-history';

const t = (minute: number) => new Date(Date.UTC(2026, 10, 9, 13, minute)).toISOString();

const doc = (summary: string): ReportDoc => ({ ...minimalReportDoc(), summary });
const input = (id: string, summary: string, minute: number) => ({
  id,
  reportId: 'report_1',
  doc: doc(summary),
  createdBy: 'consultant',
  createdAt: t(minute),
});

function apply(history: ReportVersion[], r: ReturnType<typeof saveReportEdit>): ReportVersion[] {
  return r.kind === 'created'
    ? [...history, r.version]
    : history.map((v) => (v.id === r.version.id ? r.version : v));
}

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(GuardError);
    return (e as GuardError).code;
  }
  throw new Error('expected a GuardError');
}

describe('report version history (ADR-008)', () => {
  it('numbers versions per report and starts unapproved', () => {
    const v1 = createReportVersion([], input('rver_1', 'A', 0));
    expect(v1).toMatchObject({ number: 1, reportId: 'report_1', note: '' });
    expect(v1.approvedAt).toBeUndefined();
    expect(createReportVersion([v1], input('rver_2', 'B', 1)).number).toBe(2);
  });

  it('refuses another report and a history that mixes reports', () => {
    const v1 = minimalReportVersion();
    expect(() =>
      createReportVersion([v1], { ...input('rver_2', 'B', 1), reportId: 'report_2' }),
    ).toThrow(/report_2/);
    expect(() =>
      latestReportVersion([v1, { ...v1, id: 'rver_2', number: 2, reportId: 'report_2' }]),
    ).toThrow(/mixes reports/);
    expect(() => latestReportVersion([v1, { ...v1, id: 'rver_2' }])).toThrow(
      /repeats a version number/,
    );
  });

  it('edits before approval update the same draft', () => {
    let history: ReportVersion[] = [];
    history = apply(history, saveReportEdit(history, input('rver_1', 'A', 0)));
    const r = saveReportEdit(history, input('ignored', 'B', 1));
    expect(r.kind).toBe('updated');
    expect(r.version).toMatchObject({ id: 'rver_1', number: 1, createdAt: t(0) });
    history = apply(history, r);
    expect(history).toHaveLength(1);
    expect(history[0]?.doc.summary).toBe('B');
  });

  it('an edit after approval creates version n+1 and leaves the approved one untouched', () => {
    let history: ReportVersion[] = [];
    history = apply(history, saveReportEdit(history, input('rver_1', 'A', 0)));
    const approved = approveReportVersion(history, 'rver_1', {
      approvedBy: 'David',
      approvedAt: t(1),
    });
    history = [approved];
    const frozen = structuredClone(approved);

    const r = saveReportEdit(history, input('rver_2', 'B', 2));
    expect(r.kind).toBe('created');
    expect(r.version).toMatchObject({ id: 'rver_2', number: 2 });
    expect(r.version.approvedAt).toBeUndefined();
    history = apply(history, r);

    expect(history.find((v) => v.id === 'rver_1')).toEqual(frozen);
    expect(latestReportVersion(history)?.id).toBe('rver_2');
    expect(latestApprovedReportVersion(history)?.id).toBe('rver_1');
  });

  it('refuses to approve a version that is not the newest (not-latest)', () => {
    const v1 = minimalReportVersion();
    const v2 = createReportVersion([v1], input('rver_2', 'B', 10));
    expect(
      codeOf(() =>
        approveReportVersion([v1, v2], 'rver_1', { approvedBy: 'David', approvedAt: t(11) }),
      ),
    ).toBe('not-latest');
  });

  it('refuses to approve twice (already-approved)', () => {
    const v = { ...minimalReportVersion(), approvedAt: t(5), approvedBy: 'David' };
    expect(
      codeOf(() => approveReportVersion([v], v.id, { approvedBy: 'David', approvedAt: t(6) })),
    ).toBe('already-approved');
  });

  it('refuses approval before creation, and an unknown version id', () => {
    const v1 = minimalReportVersion();
    expect(() =>
      approveReportVersion([v1], v1.id, {
        approvedBy: 'D',
        approvedAt: '2026-01-01T00:00:00.000Z',
      }),
    ).toThrow();
    expect(() =>
      approveReportVersion([v1], 'nope', { approvedBy: 'D', approvedAt: t(30) }),
    ).toThrow(/not in this history/);
  });

  it('messages say "report", not "design"', () => {
    const v1 = minimalReportVersion();
    const v2 = createReportVersion([v1], input('rver_2', 'B', 10));
    expect(() =>
      approveReportVersion([v1, v2], 'rver_1', { approvedBy: 'D', approvedAt: t(30) }),
    ).toThrowErrorMatchingInlineSnapshot(
      `[GuardError: There is a newer version of this report. Review and approve the newest version instead.]`,
    );
  });

  it('a share link resolves to the newest approved version while a newer draft exists', () => {
    let history: ReportVersion[] = [];
    const save = (id: string, s: string, minute: number) => {
      history = apply(history, saveReportEdit(history, input(id, s, minute)));
    };
    const approve = (id: string, minute: number) => {
      const v = approveReportVersion(history, id, { approvedBy: 'David', approvedAt: t(minute) });
      history = history.map((x) => (x.id === id ? v : x));
    };
    const shared = () => requireNewestApprovedReportVersion(history).doc.summary;

    save('rver_1', 'A', 0);
    expect(() => requireNewestApprovedReportVersion(history)).toThrow(GuardError);
    approve('rver_1', 1);
    save('rver_2', 'B', 2); // draft after approval
    expect(shared()).toBe('A');
    save('ignored', 'B2', 3);
    expect(shared()).toBe('A');
    approve('rver_2', 4);
    expect(shared()).toBe('B2');
    save('rver_3', 'C', 5);
    expect(shared()).toBe('B2');
    expect(history.map((v) => [v.id, v.number, v.approvedAt !== undefined])).toEqual([
      ['rver_1', 1, true],
      ['rver_2', 2, true],
      ['rver_3', 3, false],
    ]);
  });

  it('does not mutate its inputs and exposes the same operations as an object', () => {
    const history = [minimalReportVersion()];
    const before = structuredClone(history);
    approveReportVersion(history, 'rver_1', { approvedBy: 'David', approvedAt: t(30) });
    saveReportEdit(history, input('x', 'Z', 31));
    expect(history).toEqual(before);
    expect(reportHistory.approveVersion).toBe(approveReportVersion);
  });
});
