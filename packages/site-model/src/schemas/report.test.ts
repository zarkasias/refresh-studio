import { describe, expect, it } from 'vitest';
import {
  minimalAuditReport,
  minimalReportDelivery,
  minimalReportDoc,
  minimalReportExport,
  minimalReportVersion,
  minimalShareLink,
} from '../fixtures';
import { omit } from '../test-utils';
import {
  AuditReportSchema,
  ReportDeliverySchema,
  ReportDocSchema,
  ReportExportSchema,
  ReportVersionSchema,
  ShareLinkSchema,
  isApprovedReportVersion,
} from './report';

describe('ReportDocSchema', () => {
  it('accepts the minimal doc', () => {
    expect(ReportDocSchema.safeParse(minimalReportDoc()).success).toBe(true);
  });
  it('allows empty editable copy (summary, sentence, whyItMatters, what is working)', () => {
    const doc = minimalReportDoc();
    const r = ReportDocSchema.safeParse({
      ...doc,
      summary: '',
      whatsWorking: [''],
      fixNow: [{ ...doc.fixNow[0]!, sentence: '', whyItMatters: '' }],
    });
    expect(r.success).toBe(true);
  });
  it('needs a non-empty business name', () => {
    expect(ReportDocSchema.safeParse({ ...minimalReportDoc(), businessName: '' }).success).toBe(
      false,
    );
  });
  it('needs one or two "what is working" lines', () => {
    const doc = minimalReportDoc();
    expect(ReportDocSchema.safeParse({ ...doc, whatsWorking: [] }).success).toBe(false);
    expect(ReportDocSchema.safeParse({ ...doc, whatsWorking: ['a', 'b', 'c'] }).success).toBe(
      false,
    );
  });
  it('holds at most five fix-now items', () => {
    const doc = minimalReportDoc();
    const item = doc.fixNow[0]!;
    expect(ReportDocSchema.safeParse({ ...doc, fixNow: Array(5).fill(item) }).success).toBe(true);
    expect(ReportDocSchema.safeParse({ ...doc, fixNow: Array(6).fill(item) }).success).toBe(false);
  });
  it('needs a reason for a dismissal', () => {
    const doc = minimalReportDoc();
    const dismissed = [{ findingId: 'x:1', reason: '', dismissedAt: '2026-11-09T13:10:00.000Z' }];
    expect(ReportDocSchema.safeParse({ ...doc, dismissed }).success).toBe(false);
  });
  it('rejects an unknown draft source and a missing score', () => {
    const doc = minimalReportDoc();
    expect(ReportDocSchema.safeParse({ ...doc, draftSource: 'human' }).success).toBe(false);
    expect(ReportDocSchema.safeParse({ ...doc, scores: omit(doc.scores, 'speed') }).success).toBe(
      false,
    );
  });
});

describe('ReportVersionSchema', () => {
  it('accepts the minimal version and an approved one', () => {
    expect(ReportVersionSchema.safeParse(minimalReportVersion()).success).toBe(true);
    const approved = {
      ...minimalReportVersion(),
      approvedAt: '2026-11-09T14:00:00.000Z',
      approvedBy: 'consultant',
    };
    expect(ReportVersionSchema.safeParse(approved).success).toBe(true);
    expect(isApprovedReportVersion(approved)).toBe(true);
    expect(isApprovedReportVersion(minimalReportVersion())).toBe(false);
  });
  it('needs approvedAt and approvedBy together', () => {
    const v = minimalReportVersion();
    expect(
      ReportVersionSchema.safeParse({ ...v, approvedAt: '2026-11-09T14:00:00.000Z' }).success,
    ).toBe(false);
    expect(ReportVersionSchema.safeParse({ ...v, approvedBy: 'c' }).success).toBe(false);
  });
  it('rejects approval before creation and number 0', () => {
    const v = minimalReportVersion();
    const early = { ...v, approvedAt: '2026-11-09T12:00:00.000Z', approvedBy: 'c' };
    expect(ReportVersionSchema.safeParse(early).success).toBe(false);
    expect(ReportVersionSchema.safeParse({ ...v, number: 0 }).success).toBe(false);
  });
});

describe('relational records', () => {
  it('accept the fixtures', () => {
    expect(AuditReportSchema.safeParse(minimalAuditReport()).success).toBe(true);
    expect(ShareLinkSchema.safeParse(minimalShareLink()).success).toBe(true);
    expect(ReportExportSchema.safeParse(minimalReportExport()).success).toBe(true);
    expect(ReportDeliverySchema.safeParse(minimalReportDelivery()).success).toBe(true);
  });
  it('expire after they were created', () => {
    const link = minimalShareLink();
    expect(ShareLinkSchema.safeParse({ ...link, expiresAt: link.createdAt }).success).toBe(false);
  });
  it('store a token only as a sha256 hash', () => {
    const link = minimalShareLink();
    expect(ShareLinkSchema.safeParse({ ...link, tokenHash: 'my-secret-token' }).success).toBe(
      false,
    );
    expect(ShareLinkSchema.safeParse({ ...link, tokenHash: 'A'.repeat(64) }).success).toBe(false);
    expect(ShareLinkSchema.safeParse({ ...link, token: 'raw' }).success).toBe(false);
  });
  it('reject a bad export kind or hash and an unknown delivery channel', () => {
    expect(ReportExportSchema.safeParse({ ...minimalReportExport(), kind: 'docx' }).success).toBe(
      false,
    );
    expect(ReportExportSchema.safeParse({ ...minimalReportExport(), sha256: 'abc' }).success).toBe(
      false,
    );
    expect(
      ReportDeliverySchema.safeParse({ ...minimalReportDelivery(), channel: 'sms' }).success,
    ).toBe(false);
    expect(
      ReportDeliverySchema.safeParse({ ...minimalReportDelivery(), recipientName: '' }).success,
    ).toBe(false);
  });
});
