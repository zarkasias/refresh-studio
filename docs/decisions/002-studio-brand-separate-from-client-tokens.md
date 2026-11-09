# 002 — Studio brand is separate from client design tokens

- **Date:** 2026-11-09
- **Status:** accepted

## Context

The studio (studio.chambers-consulting.dev) is styled with the Chambers Consulting brand. Client
redesign variants are styled with *client* design tokens from `packages/sections`. If studio
colors or fonts leak into a variant, an export or a client preview, the client sees our brand in
their site. The consultant asked for the two to be kept completely separate (M0 plan, T10–T12,
section 5). Decisions D4, D4a and D5 are recorded here.

## Decision

- Studio tokens live in **`packages/brand` (`@srs/brand`)**, not a top-level `brand/` folder (D4).
  They're a typed `tokens.ts` plus a Tailwind v4 `@theme` file (D5). Every variable is
  studio-namespaced (`--color-studio-*`, `--font-studio-*`, `--radius-studio`). Tailwind needs its
  `--color-`/`--font-` namespace first, so `studio-` follows it.
- **Values are copied from the chambers-consulting.dev source** (D4a; its `app/globals.css`
  `:root`, `app/layout.tsx` and header component), with no estimates. Inter for body text and
  DM Sans for headings via `next/font`. Red (`cta`) is reserved for the single primary call to
  action. Input borders are used on white only, because they fall under 3:1 on the surface color.
- **The boundary is enforced in three layers** (T11):
  1. pnpm isolation: only `apps/web` depends on `@srs/brand`, so nothing else can resolve it.
  2. ESLint blocks `@srs/brand`, `@srs/web`, `apps/**` and `brand/**` in `packages/{sections,
     exporters,agents,site-model}`, for static imports, `import()` and `require()`.
  3. Tests: an ESLint-API negative fixture, a dependency check, and a scan of every text file in
     sections and exporters for `studio-` tokens.
- **In M2 the variant canvas renders inside an `<iframe>`**, so studio CSS can't cascade into a
  client preview. Client tokens apply only inside that frame.

## Alternatives considered

- A top-level `brand/` folder: has no package boundary, so anything could import it by path.
- Sharing one token system with a "theme" switch: one bug away from studio styles in a client
  export.
- Shadow DOM instead of an iframe for the canvas: weaker isolation for fonts and global styles.

## Consequences

- Client packages can't name a local module `brand` (the name is reserved by the lint rule). Use
  `client-brand` or `tokens`.
- A sync test keeps `theme.css` and `tokens.ts` identical, and AA contrast is unit-tested for
  every studio text pair. Rule 7 applies to our own UI too.
- The root `brand/` folder only holds the original logo WebP. The logo still needs a vector/SVG
  version for favicons and single-color use.
