import { describe, expect, it } from 'vitest';
import { minimalCaptureRun, minimalCapturedPage, minimalPageFacts } from '../fixtures';
import { omit } from '../test-utils';
import {
  AxeSummarySchema,
  CaptureRunObjectSchema,
  CaptureRunSchema,
  CapturedPageSchema,
  PageFactsSchema,
} from './capture';

describe('PageFactsSchema', () => {
  it('accepts the minimal facts', () => {
    expect(PageFactsSchema.safeParse(minimalPageFacts()).success).toBe(true);
  });
  it('rejects the obfuscated "[email protected]" placeholder in emails[].value', () => {
    for (const value of ['[email protected]', 'Mail [EMAIL PROTECTED] now']) {
      const facts = {
        ...minimalPageFacts(),
        emails: [{ value, source: 'text', selector: 'footer p' }],
      };
      const r = PageFactsSchema.safeParse(facts);
      expect(r.success).toBe(false);
      expect(r.error?.issues[0]?.path).toEqual(['emails', 0, 'value']);
    }
  });
  it('accepts a real address', () => {
    const facts = {
      ...minimalPageFacts(),
      emails: [{ value: 'hi@example-plumbing.com', source: 'mailto', selector: 'footer a' }],
    };
    expect(PageFactsSchema.safeParse(facts).success).toBe(true);
  });
  it('rejects a negative box, a share above 1 and an uppercase hex', () => {
    const box = { x: 0, y: 0, w: -1, h: 1 };
    const withLink = {
      ...minimalPageFacts(),
      links: [{ href: '/a', text: 'A', selector: 'a', region: 'nav', box, isToggle: false }],
    };
    expect(PageFactsSchema.safeParse(withLink).success).toBe(false);
    const share = { ...minimalPageFacts(), fonts: [{ raw: 'x', family: 'x', share: 1.1 }] };
    expect(PageFactsSchema.safeParse(share).success).toBe(false);
    const hex = { ...minimalPageFacts(), colors: [{ hex: '#ABCDEF', kind: 'text', share: 0.5 }] };
    expect(PageFactsSchema.safeParse(hex).success).toBe(false);
  });
  it('requires a bare origin for iframes', () => {
    const iframe = (srcOrigin: string) => ({
      ...minimalPageFacts(),
      iframes: [
        {
          src: 'https://maps.example.com/embed?x=1',
          srcOrigin,
          box: { x: 0, y: 0, w: 10, h: 10 },
        },
      ],
    });
    expect(PageFactsSchema.safeParse(iframe('https://maps.example.com')).success).toBe(true);
    expect(PageFactsSchema.safeParse(iframe('https://maps.example.com/')).success).toBe(false);
  });
});

describe('CaptureRunSchema', () => {
  it('accepts the minimal run and a blocked run', () => {
    expect(CaptureRunSchema.safeParse(minimalCaptureRun()).success).toBe(true);
    const blocked = {
      ...omit(minimalCaptureRun(), 'finishedAt'),
      status: 'blocked',
      blockedReason: 'no-consent',
    };
    expect(CaptureRunSchema.safeParse(blocked).success).toBe(true);
    expect(
      CaptureRunSchema.safeParse({ ...blocked, blockedReason: 'robots-disallowed' }).success,
    ).toBe(true);
  });
  it('rejects an unknown blockedReason, status or skip reason', () => {
    const run = minimalCaptureRun();
    const blockedRun = { ...run, status: 'blocked', blockedReason: 'robots-disallowed' };
    expect(CaptureRunSchema.safeParse(blockedRun).success).toBe(true);
    expect(CaptureRunSchema.safeParse({ ...blockedRun, blockedReason: 'nope' }).success).toBe(
      false,
    );
    expect(CaptureRunSchema.safeParse({ ...run, status: 'paused' }).success).toBe(false);
    expect(
      CaptureRunSchema.safeParse({ ...run, skipped: [{ url: '/x', reason: 'why' }] }).success,
    ).toBe(false);
  });
  it('allows 25 planned URLs and rejects 26', () => {
    const urls = (n: number) =>
      Array.from({ length: n }, (_, i) => `https://example-plumbing.com/p${i}`);
    expect(CaptureRunSchema.safeParse({ ...minimalCaptureRun(), planned: urls(25) }).success).toBe(
      true,
    );
    expect(CaptureRunSchema.safeParse({ ...minimalCaptureRun(), planned: urls(26) }).success).toBe(
      false,
    );
  });
  it('rejects unknown keys', () => {
    expect(CaptureRunSchema.safeParse({ ...minimalCaptureRun(), extra: 1 }).success).toBe(false);
  });
});

describe('CapturedPageSchema and AxeSummarySchema', () => {
  it('accepts the minimal page', () => {
    expect(CapturedPageSchema.safeParse(minimalCapturedPage()).success).toBe(true);
  });
  it('requires both screenshots and both fact sets', () => {
    const page = minimalCapturedPage();
    expect(CapturedPageSchema.safeParse({ ...page, screenshots: { mobile: 'a' } }).success).toBe(
      false,
    );
    expect(
      CapturedPageSchema.safeParse({ ...page, facts: { mobile: page.facts.mobile } }).success,
    ).toBe(false);
  });
  it('limits axe nodes to 10 per violation and keys axe per viewport', () => {
    const node = { selector: 'p', box: { x: 0, y: 0, w: 1, h: 1 } };
    const summary = (n: number) => ({
      violations: [
        {
          ruleId: 'color-contrast',
          impact: 'serious',
          help: 'Elements must have sufficient color contrast',
          nodes: Array.from({ length: n }, () => node),
        },
      ],
    });
    expect(AxeSummarySchema.safeParse(summary(10)).success).toBe(true);
    expect(AxeSummarySchema.safeParse(summary(11)).success).toBe(false);
    const page = minimalCapturedPage();
    const both = { mobile: summary(1), desktop: { violations: [] } };
    expect(CapturedPageSchema.safeParse({ ...page, axe: both }).success).toBe(true);
    expect(CapturedPageSchema.safeParse({ ...page, axe: summary(1) }).success).toBe(false);
    expect(CapturedPageSchema.safeParse({ ...page, axe: { mobile: summary(1) } }).success).toBe(
      false,
    );
  });
  it('rejects empty derived strings', () => {
    const f = minimalPageFacts();
    expect(
      PageFactsSchema.safeParse({ ...f, fonts: [{ raw: '', family: 'x', share: 1 }] }).success,
    ).toBe(false);
    expect(
      PageFactsSchema.safeParse({ ...f, fonts: [{ raw: 'x', family: '', share: 1 }] }).success,
    ).toBe(false);
    expect(
      PageFactsSchema.safeParse({
        ...f,
        phoneTexts: [
          { text: '', digits: '', selector: 'a', region: 'footer', insideTelLink: false },
        ],
      }).success,
    ).toBe(false);
    expect(
      PageFactsSchema.safeParse({
        ...f,
        forms: [{ selector: 'form', fields: [{ type: '', required: false, hasLabel: false }] }],
      }).success,
    ).toBe(false);
    expect(
      PageFactsSchema.safeParse({
        ...f,
        platformSignals: { ...f.platformSignals, generator: '' },
      }).success,
    ).toBe(false);
  });
});

describe('CaptureRunSchema invariants', () => {
  const run = minimalCaptureRun();
  it('rejects finishedAt earlier than startedAt', () => {
    const bad = { ...run, finishedAt: '2026-11-09T11:59:59.999Z' };
    const r = CaptureRunSchema.safeParse(bad);
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(['finishedAt']);
    expect(CaptureRunSchema.safeParse({ ...run, finishedAt: run.startedAt }).success).toBe(true);
  });
  it('exposes an unrefined object schema', () => {
    expect(CaptureRunObjectSchema.pick({ id: true }).parse({ id: 'x' })).toEqual({ id: 'x' });
  });
  it('requires blockedReason exactly when blocked', () => {
    const blocked = { ...omit(run, 'finishedAt'), status: 'blocked' as const };
    expect(CaptureRunSchema.safeParse(blocked).success).toBe(false);
    expect(CaptureRunSchema.safeParse({ ...blocked, blockedReason: 'no-consent' }).success).toBe(
      true,
    );
    expect(CaptureRunSchema.safeParse({ ...run, blockedReason: 'no-consent' }).success).toBe(false);
  });
  it('requires finishedAt for done and failed runs', () => {
    for (const status of ['done', 'failed'] as const) {
      expect(CaptureRunSchema.safeParse({ ...omit(run, 'finishedAt'), status }).success).toBe(
        false,
      );
    }
    expect(
      CaptureRunSchema.safeParse({ ...omit(run, 'finishedAt'), status: 'running' }).success,
    ).toBe(true);
  });
});
