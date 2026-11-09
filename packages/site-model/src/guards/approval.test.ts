import { describe, expect, it } from 'vitest';
import { minimalVersion } from '../fixtures';
import type { Version } from '../schemas/version';
import { GuardError, type GuardErrorCode } from './errors';
import {
  assertExportable,
  assertShareable,
  assertStatusAllowed,
  assertVersionEditable,
  resolveSharedVersion,
} from './approval';

function codeOf(fn: () => void): GuardErrorCode {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(GuardError);
    const m = (e as GuardError).message;
    expect(m.trim().length).toBeGreaterThan(10);
    expect(m).not.toMatch(/undefined|\[object|Zod|NaN|TypeError|approvedAt|approvedBy|status|URL/);
    return (e as GuardError).code;
  }
  throw new Error('expected the guard to throw');
}

const at = '2026-11-09T13:00:00.000Z';
const by = 'Consultant';

function version(n: number, approved: boolean): Version {
  const base = minimalVersion();
  const createdAt = new Date(Date.parse(base.createdAt) + n * 60_000).toISOString();
  return {
    ...base,
    id: `ver_${n}`,
    number: n,
    createdAt,
    ...(approved ? { approvedAt: createdAt, approvedBy: by } : {}),
  };
}

describe('assertShareable (one version)', () => {
  it('allows an approved version', () => {
    expect(() => assertShareable({ approvedAt: at, approvedBy: by })).not.toThrow();
  });
  it('throws without approvedAt', () => {
    expect(codeOf(() => assertShareable({ approvedBy: by }))).toBe('not-approved');
  });
  it('throws without approvedBy', () => {
    expect(codeOf(() => assertShareable({ approvedAt: at }))).toBe('not-approved');
    expect(codeOf(() => assertShareable({ approvedAt: at, approvedBy: '  ' }))).toBe(
      'not-approved',
    );
  });
  it('throws for a missing version', () => {
    expect(codeOf(() => assertShareable(undefined))).toBe('not-approved');
  });
  it.each(['1', '2026', 'soon', '2026-02-01'])('rejects approvedAt %s', (d) => {
    expect(codeOf(() => assertShareable({ approvedAt: d, approvedBy: by }))).toBe('not-approved');
  });
});

describe('resolveSharedVersion (the client share link)', () => {
  it('throws when nothing has been approved', () => {
    expect(codeOf(() => resolveSharedVersion([]))).toBe('not-approved');
    expect(codeOf(() => resolveSharedVersion([version(1, false), version(2, false)]))).toBe(
      'not-approved',
    );
  });
  it('shows the only approved version', () => {
    expect(resolveSharedVersion([version(1, true)]).id).toBe('ver_1');
  });
  it('keeps showing the last approved version while a newer edit awaits approval', () => {
    const history = [version(1, true), version(2, true), version(3, false)];
    expect(resolveSharedVersion(history).id).toBe('ver_2');
  });
  it('shows the newest approved version, whatever the array order', () => {
    const history = [version(3, true), version(1, true), version(4, false), version(2, true)];
    expect(resolveSharedVersion(history).id).toBe('ver_3');
  });
});

describe('assertStatusAllowed', () => {
  it('allows draft without any approved version', () => {
    expect(() => assertStatusAllowed('draft', [])).not.toThrow();
  });
  it.each(['approved', 'shared', 'selected'] as const)(
    'refuses %s without an approved version',
    (status) => {
      expect(codeOf(() => assertStatusAllowed(status, [version(1, false)]))).toBe('not-approved');
    },
  );
  it.each(['approved', 'shared', 'selected'] as const)(
    'allows %s once a version is approved, even with a newer unapproved edit',
    (status) => {
      expect(() =>
        assertStatusAllowed(status, [version(1, true), version(2, false)]),
      ).not.toThrow();
    },
  );
});

describe('assertExportable', () => {
  it('returns the newest approved version of a selected variant', () => {
    const history = [version(1, true), version(2, true), version(3, false)];
    expect(assertExportable({ status: 'selected' }, history).id).toBe('ver_2');
  });
  it('throws when no version is approved, even if status says selected', () => {
    expect(codeOf(() => assertExportable({ status: 'selected' }, [version(1, false)]))).toBe(
      'not-approved',
    );
  });
  it.each(['draft', 'approved', 'shared'] as const)('throws when status is %s', (status) => {
    expect(codeOf(() => assertExportable({ status }, [version(1, true)]))).toBe('not-selected');
  });
});

describe('assertVersionEditable', () => {
  it('allows an unapproved version', () => {
    expect(() => assertVersionEditable(version(1, false))).not.toThrow();
  });
  it('refuses an approved version', () => {
    expect(codeOf(() => assertVersionEditable(version(1, true)))).toBe('version-locked');
  });
});

describe('approval wording', () => {
  const msg = (fn: () => void) => {
    try {
      fn();
    } catch (e) {
      return (e as GuardError).message;
    }
    return '';
  };

  it('uses plain wording', () => {
    expect(msg(() => assertShareable({}))).toMatchInlineSnapshot(
      `"This design hasn't been approved yet. Review and approve it before sharing it with the client."`,
    );
    expect(msg(() => assertExportable({ status: 'draft' }, []))).toMatchInlineSnapshot(
      `"This design hasn't been approved yet. Review and approve it before exporting it."`,
    );
    expect(
      msg(() => assertExportable({ status: 'shared' }, [version(1, true)])),
    ).toMatchInlineSnapshot(
      `"The client hasn't chosen this design yet. Mark it as their selected design before exporting it."`,
    );
  });
});
