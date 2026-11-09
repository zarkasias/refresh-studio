---
description: Run the capture + audit pipeline on one URL locally and summarize the result
argument-hint: <url>
---

Run a local audit of $ARGUMENTS for development and testing.

1. Confirm with me that the site owner has agreed to this crawl (or that it is my own site,
   chambers-consulting.dev, or a site in `evals/sites/`). Do not crawl otherwise.
2. Run `pnpm --filter capture crawl $ARGUMENTS` then `pnpm --filter audit run-audit` on the output.
3. Run the auditor agent on the result.
4. Summarize for me: detected platform (with evidence), the five scores, the top 5 fixes in
   plain English, and anything that looked wrong in the pipeline itself.

If the packages don't exist yet, say which milestone builds them instead of improvising.
