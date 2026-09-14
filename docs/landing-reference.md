# LearnSpace landing page

The supplied 1592 × 2048 reference is a presentation collage of one continuous
landing page. The implementation is a real, single-column responsive page;
the collage dimensions are not used as CSS coordinates.

## Width systems

- Scenic surfaces (`.wide-container`) use `width: calc(100% - 48px)`, a
  `1600px` maximum, and auto side margins. The immersive hero intentionally
  raises that cap to `1680px`; at mobile widths the gutter becomes
  `16px` per side.
- Text-heavy sections (`.content-container`) use the same gutters with a
  `1180px` maximum.
- The page shell is viewport width, has no transform/zoom/translation, and
  does not hide horizontal overflow.

## Artwork

`apps/web/public/assets/marketing/alpine.webp` is the only marketing raster:
it is standalone alpine scenery with no embedded copy or interface. The
editor mockup, platform illustrations, and organization illustration are
React/CSS/SVG. Page headings, descriptions, controls, card shells, pricing,
calls to action, and footer navigation are HTML/React.

## Browser geometry verification

With a production or development server running:

```sh
cd apps/web
MARKETING_URL=http://127.0.0.1:3001 pnpm exec tsx scripts/verify-marketing.mjs
```

The Playwright check captures 390×844, 768×1024, 1024×768, 1440×1000,
1536×1000, and 1920×1080 screenshots. It reports ancestor computed styles,
section geometry, image decode status, anchor targets, browser errors, and
horizontal overflow. Desktop acceptance includes a centered 1392px hero at
1440px, a 976px hero at 1024px, and a 358px hero at 390px.
