import { describe, expect, it } from 'vitest';
import { minimalVersion } from '../fixtures';
import { GuardError } from '../guards/errors';
import { resolveSharedVersion } from '../guards/approval';
import type { Version, VersionSnapshot } from '../schemas/version';
import {
  approveVersion,
  createVersion,
  latestApprovedVersion,
  latestVersion,
  saveEdit,
} from './history';

const t = (minute: number) => new Date(Date.UTC(2026, 10, 9, 12, minute)).toISOString();

function snapshot(heading: string): VersionSnapshot {
  const s = minimalVersion().snapshot;
  const [page] = s.site.pages;
  const [section] = page!.sections;
  return {
    ...s,
    site: {
      ...s.site,
      pages: [{ ...page!, sections: [{ ...section!, content: { ...section!.content, heading } }] }],
    },
  };
}

const heading = (v: Version) => v.snapshot.site.pages[0]?.sections[0]?.content.heading;

/** Applies a saveEdit result to a history, as the persistence layer would. */
function apply(history: Version[], result: ReturnType<typeof saveEdit>): Version[] {
  return result.kind === 'created'
    ? [...history, result.version]
    : history.map((v) => (v.id === result.version.id ? result.version : v));
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

describe('createVersion', () => {
  it('numbers the first version 1 and leaves it unapproved', () => {
    const v = createVersion([], {
      id: 'v1',
      snapshot: snapshot('A'),
      createdBy: 'c',
      createdAt: t(0),
    });
    expect(v).toMatchObject({ number: 1, variantId: 'var_1', note: '' });
    expect(v.approvedAt).toBeUndefined();
    expect(v.approvedBy).toBeUndefined();
  });
  it('numbers after the highest existing version', () => {
    const v1 = createVersion([], {
      id: 'v1',
      snapshot: snapshot('A'),
      createdBy: 'c',
      createdAt: t(0),
    });
    const v2 = createVersion([v1], {
      id: 'v2',
      snapshot: snapshot('B'),
      createdBy: 'c',
      createdAt: t(1),
    });
    expect(v2.number).toBe(2);
  });
  it('refuses a snapshot of another variant', () => {
    const v1 = minimalVersion();
    const other = { ...snapshot('B'), variant: { ...snapshot('B').variant, id: 'var_2' } };
    expect(() =>
      createVersion([v1], { id: 'v2', snapshot: other, createdBy: 'c', createdAt: t(1) }),
    ).toThrow(/var_2/);
  });
});

describe('history checks', () => {
  it('rejects a history that mixes variants', () => {
    const a = minimalVersion();
    const b = { ...minimalVersion(), id: 'ver_2', number: 2, variantId: 'var_2' };
    expect(() => latestVersion([a, b])).toThrow(/mixes variants/);
  });
  it('rejects repeated version numbers', () => {
    expect(() => latestVersion([minimalVersion(), { ...minimalVersion(), id: 'ver_2' }])).toThrow(
      /repeats a version number/,
    );
  });
  it('returns undefined for an empty history', () => {
    expect(latestVersion([])).toBeUndefined();
    expect(latestApprovedVersion([])).toBeUndefined();
  });
});

describe('approval is per version (ADR-005)', () => {
  it('edits before approval update the same draft version', () => {
    let history: Version[] = [];
    let r = saveEdit(history, {
      id: 'v1',
      snapshot: snapshot('A'),
      createdBy: 'c',
      createdAt: t(0),
    });
    expect(r.kind).toBe('created');
    history = apply(history, r);
    r = saveEdit(history, {
      id: 'unused',
      snapshot: snapshot('B'),
      createdBy: 'c',
      createdAt: t(1),
    });
    expect(r.kind).toBe('updated');
    expect(r.version).toMatchObject({ id: 'v1', number: 1, createdAt: t(0) });
    history = apply(history, r);
    expect(history).toHaveLength(1);
    expect(heading(history[0]!)).toBe('B');
  });

  it('an edit after approval creates a new unapproved version and leaves the approved one untouched', () => {
    let history: Version[] = [];
    history = apply(
      history,
      saveEdit(history, { id: 'v1', snapshot: snapshot('A'), createdBy: 'c', createdAt: t(0) }),
    );
    const approved = approveVersion(history, 'v1', { approvedBy: 'David', approvedAt: t(1) });
    history = [approved];
    const frozen = structuredClone(approved);

    const r = saveEdit(history, {
      id: 'v2',
      snapshot: snapshot('B'),
      createdBy: 'c',
      createdAt: t(2),
    });
    expect(r.kind).toBe('created');
    expect(r.version).toMatchObject({ id: 'v2', number: 2 });
    expect(r.version.approvedAt).toBeUndefined();
    history = apply(history, r);

    expect(history.find((v) => v.id === 'v1')).toEqual(frozen);
    expect(latestVersion(history)?.id).toBe('v2');
    expect(latestApprovedVersion(history)?.id).toBe('v1');
  });

  it('the share link only ever shows the latest approved version, through a full cycle', () => {
    let history: Version[] = [];
    const save = (id: string, h: string, minute: number) => {
      history = apply(
        history,
        saveEdit(history, { id, snapshot: snapshot(h), createdBy: 'c', createdAt: t(minute) }),
      );
    };
    const approve = (id: string, minute: number) => {
      const v = approveVersion(history, id, { approvedBy: 'David', approvedAt: t(minute) });
      history = history.map((x) => (x.id === id ? v : x));
    };
    const shared = () => heading(resolveSharedVersion(history));

    save('v1', 'A', 0);
    expect(() => resolveSharedVersion(history)).toThrow(GuardError); // nothing approved yet
    save('ignored', 'A2', 1); // still a draft: updates v1
    approve('v1', 2);
    expect(shared()).toBe('A2');

    save('v2', 'B', 3); // edit after approval: new version
    expect(shared()).toBe('A2'); // client still sees v1
    save('ignored', 'B2', 4); // v2 still a draft: updated in place
    expect(shared()).toBe('A2');
    approve('v2', 5);
    expect(shared()).toBe('B2');

    save('v3', 'C', 6);
    expect(shared()).toBe('B2');
    expect(history.map((v) => [v.id, v.number, v.approvedAt !== undefined])).toEqual([
      ['v1', 1, true],
      ['v2', 2, true],
      ['v3', 3, false],
    ]);
  });

  it('refuses to approve a version twice', () => {
    const v = { ...minimalVersion(), approvedAt: t(5), approvedBy: 'David' };
    expect(codeOf(() => approveVersion([v], v.id, { approvedBy: 'David', approvedAt: t(6) }))).toBe(
      'already-approved',
    );
  });

  it('refuses to approve anything but the newest version', () => {
    const v1 = minimalVersion();
    const v2 = createVersion([v1], {
      id: 'ver_2',
      snapshot: snapshot('B'),
      createdBy: 'c',
      createdAt: t(10),
    });
    expect(
      codeOf(() => approveVersion([v1, v2], 'ver_1', { approvedBy: 'David', approvedAt: t(11) })),
    ).toBe('not-latest');
  });

  it('refuses an approval dated before the version was created', () => {
    const v1 = minimalVersion();
    expect(() =>
      approveVersion([v1], v1.id, { approvedBy: 'David', approvedAt: '2026-01-01T00:00:00.000Z' }),
    ).toThrow();
  });

  it('throws for an unknown version id', () => {
    expect(() =>
      approveVersion([minimalVersion()], 'nope', { approvedBy: 'D', approvedAt: t(1) }),
    ).toThrow(/not in this history/);
  });

  it('does not mutate its inputs', () => {
    const history = [minimalVersion()];
    const before = structuredClone(history);
    approveVersion(history, 'ver_1', { approvedBy: 'David', approvedAt: t(30) });
    saveEdit(history, { id: 'x', snapshot: snapshot('Z'), createdBy: 'c', createdAt: t(31) });
    expect(history).toEqual(before);
  });
});
