# Landing asset audit

The landing page uses one organic raster and native browser-rendered
interface artwork. The Playwright audit in
`apps/web/scripts/audit-marketing-assets.mjs` checks the actual selected
`srcset` candidate at DPR 1 and DPR 2.

| Asset | Source dimensions | Used by | Maximum CSS width | Screenshot-derived | Baked-in text/UI | Decision |
| --- | ---: | --- | ---: | --- | --- | --- |
| `/assets/marketing/alpine.webp` | 3840 × 1280 WebP | `Landscape` (hero, CTA, starter plan, footer), `EditorPreview` background | 1680px (`EditorPreview`: 1180px) | No; standalone alpine artwork | No | Keep as organic artwork |
| `/assets/learnspace-mark.svg` | 32 × 32 SVG viewBox | `LearnSpaceLogo` | 18px | No | No | Keep as vector |

The former screenshot crops were removed from the production asset directory:
the old `alpine.webp` (679 × 200), `android.webp` (278 × 190),
`desktop.webp` (278 × 190), `editor.webp` (586 × 328), `ios.webp` (278 × 190),
`organization.webp` (234 × 228), and `web.webp` (278 × 190). They contained
complete UI fragments and were not large enough for their CSS render sizes;
the `alpine.webp` path now points to the standalone 3840 × 1280 artwork above.

The editor surface is now `EditorPreview` DOM/CSS. iOS, Web, Windows/Linux,
Android, and the feature illustration are CSS/SVG components; their labels,
controls, borders, and geometry are not rasterized.
