# M1 section 6. Report flow and format

Part of the [M1 plan](../M1.md).

1. **Draft.** The audit job writes ReportVersion 1. The template (T22) always runs; the auditor agent (T23) refines it when a key is set.
2. **Edit.** The consultant edits wording, moves findings, dismisses false positives with a reason, and toggles crops. Scores can't be typed in. They change only by deterministic recomputation after a dismissal, and the dismissal is recorded on the version.
3. **Approve.** `assertReportApprovable` → `approvedAt`/`approvedBy`. The version is frozen (trigger). Later edits create version n+1.
4. **Share/export.**
   - PDF of a specific approved version (stamped with its number and approval date).
   - Private link that always shows the newest approved version.
   - Both require `approvedAt` (rule 4).
5. **Send.** The consultant emails it from his own mail (no email service in M1) and clicks "Mark as sent", which creates a `ReportDelivery`. That is what `gate:m1` counts.

**Format (D3):** the **PDF by email is the gate path**, because it needs no hosting. The share link is built in M1 but switched on only once hosting is decided (D10). If hosting slips, the PDF alone meets the gate.
