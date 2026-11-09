import { describe, expect, it } from 'vitest';
import { GuardError, type GuardErrorCode } from './errors';
import { assertExportable, assertShareable } from './approval';

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

const at = '2026-02-01T00:00:00.000Z';
const by = 'Consultant';

describe('assertShareable', () => {
  it('allows an approved variant', () => {
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
  it('throws when approvedAt is not a real date', () => {
    expect(codeOf(() => assertShareable({ approvedAt: 'soon', approvedBy: by }))).toBe(
      'not-approved',
    );
  });
});

describe('assertExportable', () => {
  it('allows a selected, approved variant', () => {
    expect(() =>
      assertExportable({ status: 'selected', approvedAt: at, approvedBy: by }),
    ).not.toThrow();
  });
  it('throws when not approved, even if status says selected', () => {
    expect(codeOf(() => assertExportable({ status: 'selected' }))).toBe('not-approved');
  });
  it.each(['draft', 'approved', 'shared'] as const)('throws when status is %s', (status) => {
    expect(codeOf(() => assertExportable({ status, approvedAt: at, approvedBy: by }))).toBe(
      'not-selected',
    );
  });
});

describe('approval wording and dates', () => {
  const msg = (fn: () => void) => {
    try {
      fn();
    } catch (e) {
      return (e as GuardError).message;
    }
    return '';
  };

  it.each(['1', '2026', 'soon', '2026-02-01'])('rejects approvedAt %s', (d) => {
    expect(codeOf(() => assertShareable({ approvedAt: d, approvedBy: by }))).toBe('not-approved');
  });

  it('uses plain wording', () => {
    expect(msg(() => assertShareable({}))).toMatchInlineSnapshot(
      `"This design hasn't been approved yet. Review and approve it before sharing it with the client."`,
    );
    expect(msg(() => assertExportable({ status: 'draft' }))).toMatchInlineSnapshot(
      `"This design hasn't been approved yet. Review and approve it before exporting it."`,
    );
    expect(
      msg(() => assertExportable({ status: 'shared', approvedAt: at, approvedBy: by })),
    ).toMatchInlineSnapshot(
      `"The client hasn't chosen this design yet. Mark it as their selected design before exporting it."`,
    );
  });
});
