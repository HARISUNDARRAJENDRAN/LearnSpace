# LearnSpace application design

**Status:** Proposal, based on the current Home dashboard and shared application styles. Use it as a starting point when building or refreshing app screens; not every existing screen follows it yet.

## Direction

Make LearnSpace feel calm, clear, and useful for focused study. Give learning content the most space. Use color to show state, category, and progress; keep decoration quiet. Show real activity and useful empty states instead of invented metrics.

Home is the visual reference for app surfaces and data displays: [home.css](styles/home.css). Shared shell colors and motion live in [application.css](styles/application.css).

## Foundations

| Role | Current value | Use |
| --- | --- | --- |
| App canvas | `#fff` | Main workspace |
| Sidebar | `#f7f7f5` | Primary navigation |
| Warm content surface | `#fbfbfa` | Quiet page backgrounds |
| Card | `#fff` | Focused content groups |
| Control | `#f5f5f4` | Inputs and secondary controls |
| Divider | `rgba(0, 0, 0, .045)` | Subtle separation |
| Main text | `#17171a` to `#262625` | Headings and content |
| Secondary text | `#68656f` to `#77767d` | Supporting information |
| Focus | `#9b8ad7` on Home | Visible keyboard focus |

These are existing reference values, not a single enforced token palette. Reuse the shared CSS variables where available. Keep accents local to their purpose: Home uses muted chart colors (lavender, green, pink, and yellow), while other areas may use their own accent for a meaningful action or state.

### Type

- Use the application’s Geist Sans as the default UI face. The shared header also has an Inter stack; follow the surrounding surface rather than adding another font.
- Keep dashboard copy compact: Home uses a 12px base, card titles around 15px, and the page title around 22px.
- Use weight and spacing to create hierarchy before adding more colors or text styles. Keep long titles readable and allow them to wrap where truncation would hide useful information.

### Spacing and shape

- Follow Home’s compact rhythm: 8px, 12px, and 16px are common gaps; use 4px steps where they fit.
- Home uses 14px outer padding, 16px card padding, 12px grid gaps, 16px card corners, and 1px quiet borders. Reuse those proportions for similar dashboard layouts.
- Use tighter corners for small controls and larger corners for grouped panels. Reserve pills for compact choices or status labels.
- Prefer a border and a near-white surface over a strong shadow. Add elevation only when it helps distinguish a menu, dialog, or floating control.

## Layout

- Keep the app navigation distinct from the working canvas. Let the active page use the remaining width and avoid nesting a card inside another card without a clear reason.
- Build dashboards from a small number of aligned panels. Home uses a three-column grid on wide screens, two columns at tablet widths, and a single column below 768px. Its grid is container-aware so it can respond to the available app width.
- Let the main content determine page height. On smaller screens, stack panels and controls in reading order and keep important actions within reach.
- Use compact rows for ordered resources and dense tables; use cards when each item needs its own preview or description. Preserve the same heading, spacing, and control patterns in both layouts.

## Components and interaction

- Cards use a quiet surface, subtle border, 16px radius, and consistent internal padding. Align their headings and controls along one top edge.
- Keep actions visually distinct: filled controls for the main action, neutral bordered or text controls for secondary actions, and restrained semantic color for destructive actions.
- Use familiar icons at a consistent size and stroke. Pair an icon-only control with an accessible name.
- Show focus clearly for keyboard users. Home uses a 2px lavender outline with a 3px offset; controls elsewhere should follow the same visible-focus principle.
- Make charts and selectable visualizations understandable without color alone. Include labels, keyboard interaction, and a useful empty state when data is unavailable.
- Keep motion brief and purposeful. Shared timings are 120ms, 160ms, and 350ms. Respect `prefers-reduced-motion` and make sure motion never carries essential information.

## When adding a screen

Start with the application shell and the closest existing page pattern. Reuse its CSS tokens and components; add a new value only when the current palette or spacing does not communicate the intended role. Keep page-specific styles scoped to that page, and update this proposal when a pattern is adopted across the app.
