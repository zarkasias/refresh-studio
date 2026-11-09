---
name: small-business-audit
description: Rules and wording for auditing small-business websites against the three promises (looks current, works on phones, easy to contact) plus speed and accessibility. Use when building or changing audit checks, scoring, or the plain-English audit report.
---

# Small-business audit

Clients are owners of local service businesses (trades, clinics, restaurants, salons,
professional services). They care whether the site brings in calls, bookings and messages.

## The five scores

| Score | What it answers | Main inputs |
| --- | --- | --- |
| Looks current | Would a customer trust this business at a glance? | Designer/auditor judgment from screenshots, dated patterns, font count, image quality |
| Works on phones | Can someone use it one-handed on a phone? | Lighthouse mobile, viewport, tap targets, horizontal scroll, text size |
| Easy to contact | Can someone call, book or message within one tap from any page? | Checks below |
| Speed | Does it load before people give up? | Lighthouse performance (mobile), LCP, image weight |
| Accessibility | Can everyone use it? | axe-core violations by impact, contrast, alt text, headings |

"Looks current" is the only score informed by model judgment; it must still be expressed
as a checklist of observed issues so it's explainable.

## Small-business checks

Each check returns `{ id, passed, severity: 'high' | 'medium' | 'low', evidence, plainEnglish }`.

| id | Pass when | plainEnglish when failing |
| --- | --- | --- |
| `tap-to-call` | Phone number on the page is a `tel:` link | "Customers on phones can't tap your number to call you." |
| `contact-above-fold-mobile` | A call, book or contact action is visible in the first 390×844 screen | "On a phone, people have to scroll before they see how to reach you." |
| `tap-targets` | Interactive elements ≥ 44×44px with spacing | "Some buttons and links are too small to tap easily." |
| `nav-mobile` | Menu opens and all links reachable at 390px | "Your menu is hard to use on phones." |
| `no-horizontal-scroll` | Page width ≤ viewport at 390px | "The page slides sideways on phones." |
| `local-business-schema` | Valid LocalBusiness (or subtype) JSON-LD | "Search engines can't easily read your business details." |
| `nap-consistent` | Name, address, phone identical across pages | "Your business details don't match on every page." |
| `google-business-link` | Link to Google Business Profile or Maps | "Customers can't jump to your Google reviews or directions." |
| `hours-visible` | Opening hours present (where relevant) | "Your opening hours are hard to find." |
| `image-weight` | No image over 300 KB; total page images under 2 MB | "Large photos are slowing your site down." |
| `title-meta` | Unique title and meta description per page | "Search results show the same, unclear description for your pages." |
| `form-works` | Contact form has labels and a visible confirmation | "Your contact form may confuse people or not confirm it was sent." |

## Report wording

- Lead with what's working (one or two lines), then the top 5 fixes ordered by impact on
  calls and bookings.
- One sentence per finding, then a "Why it matters" line in customer terms.
- Separate "Fix now" from "Can wait". Never more than 5 in "Fix now".
- No jargon: say "tap your number to call", not "tel: href"; "slow on phones", not "LCP".
- Every finding links to its evidence (screenshot crop or page).
