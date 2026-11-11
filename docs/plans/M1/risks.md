# M1 section 9. Risks

Part of the [M1 plan](../M1.md).

- **Gate depends on 3 consents** (T36). This is on the calendar, outside engineering control. Start now; ask more prospects than you need.
- **Synthetic overfitting:** checks pass on fixtures we built. Mitigation: T7 audit labels from real browsing, the T34 real capture, and the consultant reviewing every prospect report before it goes out.
- **False positives in front of prospects** damage trust in the service. Mitigation: the arc-electric control rule; parsers that only fire on clear evidence (hours, phones); dismissal with recompute; never more than 5 fix-now items.
- **Lighthouse runtime and variance:** 25 pages × 2 presets may take 20–30 minutes; single runs vary by a few points. Scores are reproducible from the stored LHR, not from re-running.
- **Bot protection** (Cloudflare challenges) may block scans. We stop and say so; we never work around it.
- **Prompt injection** through page text into the auditor. Mitigation: the prompt treats inputs as data; the output can only reference known ids and numbers.
- **Prospect data in storage:** private buckets, a retention limit, delete on request.
- **Worker on a laptop:** fine for 3 prospects; not for client-facing reliability (D10).
- **Kit drift:** agent and skill files currently contradict ADR-004 and rule 2 until T38 lands.
