---
name: wordpress-theme-export
description: Conventions for turning a selected redesign variant into a WordPress block child theme (theme.json, style.css, patterns) or page-builder global styles. Use when building or changing the wordpress-theme exporter.
---

# WordPress theme export

Goal: apply the redesign to the client's existing WordPress site "without starting over".
Content stays in WordPress; we change styles and add patterns.

## Decide the path from capture evidence

| Site uses | Output |
| --- | --- |
| Block theme / Gutenberg | Child theme with `theme.json` + patterns (preferred) |
| Classic theme, no page builder | Child theme with `style.css` overrides + CSS custom properties |
| Elementor | Global Colors + Global Fonts values and a step-by-step guide (style-guide path) |
| Divi | Theme Customizer values + guide (style-guide path) |

Check the current `theme.json` schema version in the WordPress developer docs before
generating; do not hard-code a version from memory.

## Token mapping (block themes)

- `color.*` → `settings.color.palette` entries with stable slugs (`primary`, `secondary`,
  `accent`, `background`, `surface`, `text`, `muted-text`).
- `font.heading` / `font.body` → `settings.typography.fontFamilies` with local font files
  under `assets/fonts/` (`fontFace`), not a remote Google Fonts link.
- `typeScale` → `settings.typography.fontSizes` (small, medium, large, x-large, xx-large).
- `spacing.unit` → `settings.spacing.spacingSizes`.
- `radius` → `styles.elements.button.border.radius` and block-level styles.
- Global element styles (links, buttons, headings) in `styles.elements`.

## Child theme files

```
<client-slug>-refresh/
  style.css          Theme Name, Template: <parent slug>, Version, Description
  theme.json
  functions.php      only enqueue + pattern category registration; nothing else
  patterns/*.php     one per new section (hero, services, contact band, booking)
  assets/fonts/
  README.md          install, activate, rollback (re-activate parent theme)
  screenshot.png     1200×900 from the selected variant
```

## Rules

- Never modify the parent theme or plugin files. Child theme only, so rollback is one click.
- No PHP beyond enqueueing and pattern registration.
- Escape all output in patterns; text comes from the site model.
- Include a test checklist in README: homepage, a service page, contact page, phone tap,
  menu at phone width.
