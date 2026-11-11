/**
 * Version history for a report (ADR-008): the same rules as a variant's (ADR-005), bound to
 * `ReportVersion` and `reportId`. An approved report version is frozen; an edit after approval
 * becomes version n+1; only the newest version can be approved, once.
 */
import { ReportVersionSchema, type ReportDoc, type ReportVersion } from '../schemas/report';
import { createHistory, type SaveResult } from './core';

export interface NewReportVersionInput {
  id: string;
  reportId: string;
  doc: ReportDoc;
  createdBy: string;
  createdAt: string;
  note?: string;
}

export type SaveReportEditResult = SaveResult<ReportVersion>;

export const reportHistory = createHistory<ReportVersion, NewReportVersionInput>({
  ownerKey: 'reportId',
  ownerNoun: 'report',
  thingNoun: 'report',
  parse: (value) => ReportVersionSchema.parse(value),
  ownerOf: (input) => input.reportId,
  build: (input, reportId, number) => ({
    id: input.id,
    reportId,
    number,
    doc: input.doc,
    createdBy: input.createdBy,
    createdAt: input.createdAt,
    note: input.note ?? '',
  }),
  patch: (latest, input) => ({ ...latest, doc: input.doc, note: input.note ?? latest.note }),
});

export const latestReportVersion = reportHistory.latestVersion;
export const latestApprovedReportVersion = reportHistory.latestApprovedVersion;
export const createReportVersion = reportHistory.createVersion;
export const saveReportEdit = reportHistory.saveEdit;
export const approveReportVersion = reportHistory.approveVersion;
