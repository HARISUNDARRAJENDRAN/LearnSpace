# LearnSpace design system

One visual language for every LearnSpace surface: landing page, authentication, onboarding and the app. The reference is aside.com: white canvas, near-black ink, one sky-blue accent, hairline frames, soft pastel illustration panels, and a single sans typeface.

Tokens live in [`app/globals.css`](app/globals.css) under `:root` as `--ls-*` variables. The landing page implementation is [`styles/marketing.css`](styles/marketing.css) with components in [`components/marketing`](components/marketing). New screens use these tokens. Do not add hex values to page styles when a token covers the role.

## Principles

- **Quiet canvas, loud content.** The page is white and the text is ink. Color appears only in the brand accent, in illustration panels and in status.
- **Hairline frames.** Every content band sits inside a centered column with 1px side rules (`--ls-line`), bands are separated by full-width 1px rules, and sub-blocks are separated by dashed rules. The frame is the page's texture.
- **Two-tone sentences.** Lead with a short phrase in ink, then continue in muted grey.
- **Alive, not busy.** Motion explains the product (a loop that turns, a panel that fills in) and always yields to the visitor: it pauses on hover, focus and off screen.
- **Short page, deep tabs.** Detail lives behind tabs instead of in long scrolling sections.
- **Real UI as illustration.** Feature panels show small, honest slices of the product (a prompt bubble over a UI card on a pastel wash) instead of stock art or invented metrics.
- **One family.** Geist Serif (the Regular shape) for headlines, Geist Sans for body and UI, Geist Mono only for code.

## Color

| Token | Value | Role |
| --- | --- | --- |
| `--ls-bg` | `#ffffff` | Canvas |
| `--ls-surface` | `#fafafa` | Alternate band background, card wash |
| `--ls-muted` | `#f5f5f5` | Secondary buttons, segmented controls, art panels, chat bubbles |
| `--ls-ink` | `#090b0c` | Headlines, primary text, primary button |
| `--ls-ink-soft` | `#171717` | Text inside UI mockups |
| `--ls-ink-muted` | `#737373` | Body copy, captions, secondary text |
| `--ls-ink-subtle` | `#a1a1a1` | Placeholder and meta text |
| `--ls-ink-faint` | `#d0d6d8` | Muted word inside a headline |
| `--ls-line` | `rgb(0 0 0 / 6%)` | Frame rules, row dividers, section borders |
| `--ls-line-strong` | `rgb(10 10 10 / 15%)` | 0.5px rings around raised UI cards |
| `--ls-brand` | `#00a5ef` | Accent fills, dots, active bars, link underline |
| `--ls-brand-ink` | `#0084cc` | Eyebrow links and inline links |
| `--ls-dark` | `#22292b` | Dark showcase panel |
| `--ls-on-dark` | `#fafafa` | Text on `--ls-ink` or `--ls-dark` |

Status colors for product UI: success `#00c758`, warning `#f99c00`, danger `#fb2c36`. Window controls use `#ff6568`, `#fcbb00` and `#00c758`.

Pastel washes for illustration panels are gradients of the sky, lilac, mint and peach families. Keep them very light so the UI card on top carries the contrast.

## Typography

Family: `--ls-font-serif` (Geist Serif Regular, a single 400 weight, from the `geist` package) for Display, Heading 2, Heading 3 and page titles; `--ls-font` (Geist Sans, variable 100–900) for everything else; `--ls-font-mono` (Geist Mono, falling back to the system monospace) for code. Never set the serif above 400: it has no bold and the browser would fake one.

| Style | Size / line height | Weight | Tracking | Used for |
| --- | --- | --- | --- | --- |
| Display (serif) | 36/40 → md 44/48 → xl 48/52 | 400 | -0.02em | Hero headline |
| Heading 2 (serif) | 30/36 → sm 36/44 → xl 44/48 | 400 | -0.02em | Section headline |
| Heading 3 (serif) | 24/32 → xl 30/40 | 400 | -0.015em | Sub-block headline |
| Lead | 16/24 → sm 18/28 → xl 20/30 | 400 | 0 | Introduction statements |
| Body | 16/24 → xl 18/28 | 400 | 0 | Section descriptions |
| Caption | 14/20 → xl 16/24 | 400 | 0 | Card captions, footer links (500) |
| Eyebrow | 14/20 → md 16/24 | 500 | 0 | Section label links in `--ls-brand-ink` |
| UI | 13–14/20 | 450–500 | 0 | Text inside product mockups |
| Badge | 12/16 | 550 | 0.01em | Pill above the hero headline |

Headlines are ink. Body and captions are muted, with a lead phrase in ink at weight 500.

## Layout

- Breakpoints: `sm` 640, `md` 768, `lg` 1024, `xl` 1280, `2xl` 1536.
- **Container** (`.ls-container`): max width 1536px, side gutters 16 → sm 24 → lg 48 → xl 96.
- **Frame** (`.ls-frame`): 1px side rules, padding 48/24 → sm 64/32 → md 96/56 → xl 96/144.
- **Band** (`.ls-band`): full-width wrapper with a bottom rule. Alternate bands may use `--ls-surface` or a white-to-surface gradient.
- **Card row** (`.ls-cards`): horizontal snap scroller of 320px cards on small screens, a 3 column grid from `lg`, 24px gaps.
- Spacing scale is 4px based: 4, 8, 12, 16, 24, 32, 48, 64, 96, 144.

## Shape and depth

Radii follow a squircle feel: `--ls-radius-sm` 6px, `--ls-radius-md` 8px, `--ls-radius-lg` 11px, `--ls-radius-xl` 16px, `--ls-radius-2xl` 22px, `--ls-radius-3xl` 32px, `--ls-radius-full` for pills.

- The hero card is `--ls-radius-xl` → md `2xl` → lg `3xl` with `--ls-shadow-xl` and an inset 1px `--ls-line` ring.
- Raised UI cards use a 0.5px `--ls-line-strong` ring and `--ls-shadow-md`. Glass surfaces add an inset 1px white ring at 80%.
- Illustration panels are flat (`--ls-radius-lg`, no shadow).

## Components

- **Primary button**: ink fill, white text, 36px tall (40px from md), 10px radius in navigation and a full pill in the hero and banner, 14px → md 16px text. Pressed state scales to 0.95.
- **Secondary button**: `--ls-muted` fill, ink text, same sizes.
- **Eyebrow link**: brand ink, weight 500, trailing chevron, dotted 2px underline on hover with 4px offset.
- **Badge**: 24px pill, 1px border at 20% ink, ink text at 70%, trailing chevron at 50% opacity.
- **Feature tabs**: `--ls-muted` track with 4px padding and 14px radius; 36px tabs with an icon and label; the active tab is white with `--ls-shadow-sm` and a brand icon. Each panel is a two-column intro (h3, body) above a card row. Tabs advance every 7s, shown by a 2px brand progress line, until the visitor picks one; deep links such as `#tutor` open their tab.
- **Learning loop**: nine glass step pills on a dashed ring over the sky, with a brand comet tail trailing into the active step and a glass core describing it. Advances every 2.4s and follows the pointer; on phones only step numbers sit on the ring.
- **Navigation**: 56px tall. Logo left, links centered (14px, 500, 40px gaps), actions right. Inside the hero it floats on the sky, 5px below its box. After the hero scrolls away, a white sticky copy slides in over 150ms.
- **Feature card**: illustration panel (288 → md 256 → lg 320 → 2xl 384 tall) plus a caption with 16/20 padding.

## Authentication

Login, register, password reset and email verification share one shell ([`components/auth/AuthShell.tsx`](components/auth/AuthShell.tsx), styles in [`styles/auth.css`](styles/auth.css)): the hero's sky fills the viewport inside an 8px white margin, the logo sits where the landing nav puts it, and a single white card holds the form.

- **Card**: max 400px wide, `--ls-radius-2xl`, 0.5px `--ls-line-strong` ring and `--ls-shadow-xl`. Heading 24 → sm 28 at weight 500, then a muted one-line subtitle.
- **Fields**: visible 13px labels above 44px inputs (40px from `sm`) with an inset 1px `--ls-line-strong` ring; focus swaps it for `--ls-brand` plus a 3px brand halo. Inputs use 16px text on phones so iOS does not zoom.
- **Actions**: Google is a white button with a hairline ring, then an "or" divider, then the ink submit button. Secondary links (forgot password) sit at the end of the label row in brand ink.
- **Messages**: success and error notes are soft tinted blocks above the form, announced with `role="status"` and `role="alert"`.

## Onboarding

The five-step profile ([`components/onboarding/OnboardingFlow.tsx`](components/onboarding/OnboardingFlow.tsx), styles in [`styles/onboarding.css`](styles/onboarding.css)) is monochrome on plain white: no frame rules, no sky and no brand blue. The logo sits where the landing nav puts it, beside "Step N of 5" and five short dashes that fill in ink.

- **Heading**: muted eyebrow, Heading 2 (Display on the welcome step), muted body subtitle, all centered.
- **Choices**: 52px `--ls-muted` tiles with `--ls-radius-lg` and no ring; a selected tile turns ink with white text and a white check. Topic chips are muted pills that turn ink the same way. Two columns from `sm`, one on phones.
- **Duration**: a segmented control styled like the feature tabs track, four across from `sm` and two by two on phones.
- **Actions**: muted Back on the left, the ink primary button on the right; each step rises in on entry.
- **Phones**: questions start at the top instead of the middle, the actions stick to the bottom edge with Continue filling the row, the topic list scrolls with the page instead of in its own box, and below 380px the header keeps only the progress dashes.

## Phones

Below 640px: headline line breaks are dropped so text flows, the hero headline is 32/38, inactive feature tabs show only their icon (the label stays for screen readers), and use-case cells tighten to 16px gaps.

## Motion

- Durations: 150ms for hover and press, 300ms for tab indicators, 600ms for reveal-on-scroll and panel entrances (10–12px rise with a fade).
- Panel entrances stagger: cards 80ms apart, then their contents; meters grow, calendar days pop in, hints arrive one rung at a time.
- Hover: arrows nudge 2px forward; card art lifts 4–8px using `translate`, so it never fights the `transform` an entrance animation holds.
- Ambient: the demo play button and the active loop step pulse. Never animate anything underneath a `backdrop-filter` surface: the blur is then recomputed every frame and scrolling drops frames.
- Scrolling: Lenis smooths wheel scrolling on the landing page (touch stays native). In-page links scroll through it and land below the sticky nav via `scroll-margin-top`.
- Autoplay (feature tabs, learning loop) pauses on hover, focus and off screen, and never runs under reduced motion.
- Easing: `cubic-bezier(0.2, 0, 0, 1)`.
- Respect `prefers-reduced-motion`: every animation and transition on the landing page is switched off and everything shows in its final state.

## Accessibility

- Body text on white meets AA (`--ls-ink-muted` is 4.7:1). Never use `--ls-ink-subtle` or `--ls-ink-faint` for essential text.
- Visible focus: 3px ring at `--ls-brand` 50%.
- Decorative mockups are `aria-hidden`, and every icon-only control has an accessible name.

## Verification

With a server running, check the landing page at five viewport widths for horizontal overflow, broken in-page links and browser errors. The script also saves full-page screenshots:

```sh
cd apps/web
MARKETING_URL=http://127.0.0.1:3000 pnpm exec tsx scripts/verify-marketing.mjs
```
