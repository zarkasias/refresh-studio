/**
 * Deterministic score recomputation (M1 plan D5, ADR-008).
 *
 * The consultant cannot type a score. Dismissing a finding as a false positive removes what that
 * finding cost, and the new scores come only from this function. `assertReportApprovable` calls
 * it, so a report whose scores were changed any other way cannot be approved.
 *
 * It works over data already in the AuditRun, so it needs nothing from `packages/audit`:
 *
 *   value = clamp(round(100 + sum of the remaining contributions' deltas), 0, 100)
 *
 * The sum is a left fold over `contributions` in list order, starting at 100 (see
 * `scoreValueFromContributions`). `AuditRunSchema` enforces the same rule on every stored run. *
 * A contribution is dropped when its `source` is a check id and every failed finding of that check
 * is dismissed. A check that failed on several pages keeps its contribution until all of its
 * findings are dismissed, because a contribution names a check, not a finding. `lighthouse:*` and
 * `axe:*` contributions have no finding behind them and are never dropped.
 *
 * CONTRACT FOR `packages/audit` (T20). The audit engine builds `AuditRun.scores`, and it must
 * produce contributions this function can reproduce:
 *   1. For every score, `value === clamp(round(100 + sum(delta in order)), 0, 100)`. List every
 *      deduction and every tool-derived adjustment as a contribution; keep nothing off the list.
 *   2. A deduction for a failed check has `source` equal to that check's `id`. One contribution
 *      per check per score is enough; per-check caps are applied before it is written.
 *   3. `recomputeScores(run, [])` deep-equals `run.scores`. T20 tests this on every fixture.
 * Deltas may be fractional; only the final value is rounded.
 */
import type { AuditRun, CheckId, Score, ScoreKey, Scores } from '../schemas/audit';
import { SCORE_KEYS, scoreValueFromContributions } from '../schemas/audit';

/** Check ids that have at least one failed finding and no failed finding left undismissed. */
function fullyDismissedChecks(
  checks: AuditRun['checks'],
  dismissed: ReadonlySet<string>,
): Set<CheckId> {
  const failed = new Set<CheckId>();
  const remaining = new Set<CheckId>();
  for (const check of checks) {
    if (check.passed) continue;
    failed.add(check.id);
    if (!dismissed.has(check.findingId)) remaining.add(check.id);
  }
  return new Set([...failed].filter((id) => !remaining.has(id)));
}

/**
 * The five scores after dismissing `dismissedFindingIds`. Ids that match no finding are ignored
 * (`assertReportApprovable` rejects them separately). Pure; the same input gives the same output.
 */
export function recomputeScores(
  auditRun: Pick<AuditRun, 'checks' | 'scores'>,
  dismissedFindingIds: readonly string[],
): Scores {
  const dropped = fullyDismissedChecks(auditRun.checks, new Set(dismissedFindingIds));
  const result = {} as Record<ScoreKey, Score>;
  for (const key of SCORE_KEYS) {
    const contributions = auditRun.scores[key].contributions.filter(
      (c) => !(dropped as ReadonlySet<string>).has(c.source),
    );
    result[key] = { value: scoreValueFromContributions(contributions), contributions };
  }
  return result;
}
