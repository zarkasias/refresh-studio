# @srs/brand

Chambers Consulting brand for the **studio UI only**. These tokens must never be used by
`packages/sections`, exporters or client previews (T11 enforces this). Client sites use the
client's own design tokens.

Source of truth: the chambers-consulting.dev source (`app/globals.css`, `app/layout.tsx`,
`components/ui/FloatingNav.tsx`), light theme. Values are copied, not estimated.

## Tokens

`src/tokens.ts` is the typed source; `theme.css` is the Tailwind v4 `@theme` block (a test
keeps them identical). Utilities: `bg-studio-primary`, `text-studio-foreground`,
`font-studio-heading`, `rounded-studio`, and so on.

| token | hex | source HSL |
| --- | --- | --- |
| background | #ffffff | 0 0% 100% |
| foreground | #16324b | 208 54% 19% |
| primary / ring | #0b6d8e | 195 86% 30% |
| primary-foreground, cta-foreground | #ffffff | 0 0% 100% |
| surface (secondary/muted/accent/hero) | #eff8fa | 195 55% 96% |
| muted-foreground | #475a6b | 208 20% 35% |
| cta | #c5202e | 355 72% 45% |
| border | #d2e2e9 | 198 35% 87% |
| input | #7e96a5 | 203 18% 57% |
| destructive | #b30015 | 353 100% 35% |
| radius | 0.375rem | n/a |

Input borders (#7e96a5) are for white backgrounds only; on the surface tint they are 2.87:1, under the 3:1 needed for non-text UI. The colour is the source value and is not changed.

`cta` (red) is reserved for the primary call to action only. Colors come from the logo.

Fonts: Inter (body) and DM Sans (headings, medium weight, tight tracking), loaded in
`apps/web/app/layout.tsx` via `next/font/google` into `--font-inter` and `--font-dm-sans`.

## Logo

`assets/cclogo-new.png` (170x168 RGBA, gradient mark, no wordmark). The site shows it at
40x40 in a `rounded-full` chip (gray-300 at 80%, 4px padding) next to "Chambers Consulting"
in DM Sans semibold, about 18px. The web app serves a copy from `apps/web/public/brand/`.

Alt-text rule:
- Logo beside the visible "Chambers Consulting" text in the same link: `alt=""`, so screen
  readers do not announce the name twice.
- Logo alone: `alt="Chambers Consulting"`.

Still wanted: an SVG or flat-colour logo. None exists; the site's `favicon.svg` is a PNG
wrapped in SVG.
