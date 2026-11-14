---
name: ui-review
description: Review UI components for accessibility, security, and runtime errors.
---

# UI Review Skill

Apply these checks to changed UI files (`.tsx`, `.jsx`, `.vue`, components, pages).

## Security
- `dangerouslySetInnerHTML` / `v-html` / `innerHTML` with non-constant data (XSS). BLOCKER.
- Links with `target="_blank"` and no `rel="noopener noreferrer"`. WARNING.

## Accessibility
- `<img>` without `alt`. WARNING.
- Click handlers on non-interactive elements (`div`, `span`) without role, tabindex, and keyboard handling. WARNING.
- Form inputs without an associated label. WARNING.

## Runtime correctness
- Missing `key` on list items, state updates during render, effects without cleanup for subscriptions or timers. WARNING.
- Leftover `console.log`/`debugger` (see AGENTS.md). WARNING.
