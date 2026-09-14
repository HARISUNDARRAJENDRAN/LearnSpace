# Frozen target specification: LearnSpace hero at 1365 × 646

This section is the authoritative implementation brief for the attached screenshot. The earlier LearnSpace reconstruction log remains below as historical project context; it is not a specification for the current hero.

## Measurement basis

- Screenshot: `C:\Users\HARI\AppData\Local\Temp\codex-clipboard-cpXYvP.png`
- Raster size: `1365 × 646px`; aspect ratio `2.113:1`.
- The screenshot includes a dark `4px` browser/window edge at the far left and a scrollbar occupying approximately `19px` at the far right. CSS measurements below describe the page viewport between those browser artifacts.
- Live reference inspection: `https://www.craft.do/`. When the live page and screenshot disagree, the screenshot wins.
- The original reconstruction assets in `apps/web/public/assets/craft/` were historical-only and have been removed; the current hero uses authored LearnSpace artwork.

## Canvas and hero frame

| Item | Measured / inferred value |
| --- | --- |
| Page background | `#fcf9f7` warm off-white |
| Browser-edge artifact | `#24273a` at the screenshot's far-left edge; do not treat as page color |
| Effective page content width | approximately `1346px` after the scrollbar |
| Hero frame | approximately `x:20px, y:15px, w:1306px, h:600px` |
| Visible anti-aliased bounds | blue begins near `x:25px` at the straight sides; top curve reaches `x:43px` at `y:15px` |
| Hero radius | `24px` |
| Hero overflow | hidden; every collage layer and the media window clips to the rounded frame |
| Hero surface | vertical sky gradient, approximately `#9ed4ef` at the top to `#d1eef9` below, with a low-opacity paper/noise texture |
| Hero shadow | very soft product-panel shadow: `0 50px 40px #00000003, 0 20px 40px #0000000d, 0 3px 10px #00000014` |

## Floating navigation

| Item | Measured / inferred value |
| --- | --- |
| Bounds | approximately `x:215px, y:27px, w:921px, h:53px` |
| Position | centered over the hero; about `12px` below the hero top |
| Shape | white translucent pill, `26px` radius |
| Surface | glass white with subtle backdrop blur; low-opacity gradient border |
| Shadow | `0 12px 12px 2px #0000001a, 0 2px 4px -1px #0000000f` |
| Inner layout | `52px` high flex row, about `16px` left padding and `8px` right padding |
| Logo | standalone LearnSpace mark from `apps/web/public/assets/learnspace-mark.svg`, left edge `x:236px`, top `y:43px` |
| Primary nav | `Features`, `Community`, `Pricing`, `Learn`; 16px sans, compact 16px gaps |
| Account action | `Login` black pill |
| Black CTA | about `135 × 36px`, `18px` radius, medium sans, white label |

## Hero type and action

| Item | Measured / inferred value |
| --- | --- |
| Headline text | `Your space to learn, research, and remember.` |
| Line break | exactly after `learn,`: line 1 `Your space to learn,`; line 2 `research, and remember.` |
| Headline visual bounds | approximately `x:403–944px, y:94–207px`; centered on the hero, slightly above the geometric center |
| Display family | Craft `UntitledSerifFont`; source font is publicly referenced by Craft's CSS as `ba1b003af64f15ce-s.p.woff2` |
| Display fallback | `Source Serif 4`, then `Georgia`, then serif |
| Size / weight | `66px / 400` on the target desktop viewport |
| Line-height | `1` (`66px`) |
| Letter-spacing | approximately `-0.03em` |
| Alignment | centered; no optical re-centering of either line |
| Hero CTA | `Start Learning`, approximately `x:590px, y:271px, w:171px, h:49px`; glass white pill, `24px` radius |
| Hero CTA typography | 16px sans, 500 weight, near-black |
| Hero CTA shadow | soft downward shadow matching the navigation glass treatment |

## Media window

| Item | Measured / inferred value |
| --- | --- |
| Visible top edge | approximately `x:236px, y:337px` |
| Width | approximately `880px`; centered in the hero |
| Full frame | continues below the screenshot and is clipped by the hero bottom |
| Positioning model | bottom-anchored inside the hero; target top is about `322px` from the hero's top |
| Frame surface | pale application chrome, 1px cool-gray border, darkened top edge, soft shadow |
| Radius | approximately `16px` at the top corners |
| App layout | left sidebar about `196px`; main All Docs workspace to the right |
| Visible chrome | macOS red/yellow/green dots, `New Note`, `LearnSpace`, selected `All Notes`, `Study Plan`, `Calendar`, `Research Log`, `Course Notes`, `Collections`, and the main `My Learning` title |
| Visible cards | four-column row: pink `Research Notes`, white `Study Plan`, pale yellow `Reading Queue`, pale green `Course Notes` |
| Play control | centered in the full media frame; only the upper/cropped portion may appear at this viewport |

## Artwork map and stacking

The background is a set of individually positioned collage layers, not a single gradient or generic blob.

1. The sky gradient and paper texture are the backmost surface.
2. Thin blue-gray geometric line art spans the upper half from around `y:67px`, including rectangular guides and large circular arcs.
3. A white torn-paper strip runs diagonally from the left edge around `y:260px` toward the center, with repeated blue cut-out/shred shapes along its upper edge.
4. A large white/gray torn mountain occupies the center-right. The light gray inner sheet is visible behind the media window.
5. A black torn-paper fragment sits behind the right side of the mountain around `x:1070–1260px, y:240–320px`.
6. A halftone white/blue cloud occupies the upper-right around `x:1125–1325px, y:135–300px`; a smaller cloud/texture is visible near the left horizon.
7. A periwinkle-blue torn sheet rises from the lower-left corner and reaches behind the media window around `x:25–470px, y:315px`.
8. A yellow ruled-paper sheet enters from the lower-right around `x:1115px, y:310px`, slanting down and right; the rules are thin green-gray horizontals with a warm vertical margin.
9. The media window is above all paper layers and below the headline/CTA. The headline and both navigation/button surfaces are the highest visible content layers.

## Responsive behavior to preserve

- Desktop navigation remains a centered glass pill; collapse secondary links below the desktop breakpoint and keep the primary CTA reachable.
- Keep the hero artwork clipped inside the rounded frame at every width. Scale the collage as a composition rather than replacing it with a plain gradient.
- Maintain the serif headline's natural wrapping with a measured max width; on narrow screens let it wrap without hard-coded desktop line breaks.
- Keep the media window centered and bottom-anchored so its top edge moves with hero height and its lower content remains clipped.
- Source typography findings from the live page: sans is `UntitledSansFont` and serif is `UntitledSerifFont`; the live desktop h1 uses `66px`, `100%` line-height, and `-0.03em` tracking. These findings inform the reconstruction only where they do not conflict with the frozen screenshot.

# LearnSpace landing reconstruction log

## Reference capture

- Source: `https://www.craft.do/`, captured 2026-08-29 after font hydration and with reduced motion.
- Viewports captured locally: 1440 x 1100, 1280 x 1000, 1024 x 900, 768 x 900, and 390 x 844.
- Local reference captures are intentionally kept outside version control at `artifacts/craft-reconstruction/reference/`; they are visual research material, not LearnSpace assets.
- Primary reference: 1440px wide.

## Global visual spec

| Token | Measured / observed value |
| --- | --- |
| Canvas | warm paper `#fcf9f7` |
| Primary ink | near-black `#030302` |
| Desktop outer gutter | 20px |
| Main content width | 1080px (at 1440px) |
| Desktop section rhythm | 120px between major regions; 60px inside them |
| Display face | Craft `UntitledSerifFont`; LearnSpace substitute: Source Serif 4 |
| UI face | Craft `UntitledSansFont`; LearnSpace substitute: DM Sans |
| Hero display | 66px / 66px / 400 / `-1.98px` tracking |
| Section display | 54px / 59.4px / 400 / `-1.08px` tracking |
| Feature display | 36px / 43.92px / 400 / `-1.08px` tracking |
| Card radius | 24px main cards, 14px secondary tiles, full-pill actions |
| Primary action | black rounded-full, 36px high, compact horizontal padding |
| Shadows | very soft, short, low-opacity product-panel shadows |
| Pastel surfaces | sky `#9ed4ef`, mint `#9bd8a9`, amber `#fde99b`, periwinkle `#b8caf5`, peach `#ffdbc5` |

## Measured desktop map (1440px)

| Region | Top | Measured form |
| --- | ---: | --- |
| Header / hero | 20px | 1,012px high, 1,400px wide sky panel |
| Hero heading | 276px | 666px wide, centered |
| Capability row | 1,152px | centered editorial heading then five compact icon categories |
| Stories | 1,711px | 1,080px heading and five narrow portrait cards |
| Periwinkle product story | ~2,500px | 1,080px x ~665px pastel panel, mockup left / story right |
| Mint connections | ~3,900px | equally sized product panel, copy left / interface right |
| Amber planning | ~5,500px | equally sized product panel, copy left / calendar UI right |
| Structure | 6,522px | centered heading plus three overlapping pastel UI tiles |
| Customization | 7,631px | centered display / action in a tall airy region |
| Community | 8,606px | centered copy and four compact branded social cards |
| Pricing | 9,343px | centered heading with a two-card comparison grid |
| CTA / footer | 10,300px | mint rounded CTA followed by dense dark footer |

## Content mapping

| Reference role | LearnSpace equivalent |
| --- | --- |
| Notes / tasks / ideas hero | Learn, research, and understand |
| Product categories | Discover, Learn, Research, Tutor, Study |
| User stories | Learning rhythms and research styles |
| Writing showcase | Study workspace: reader, notes, transcript, tutor |
| Connections showcase | Research links: papers, sources, concept graph |
| Planning showcase | Focus session and spaced review |
| Structure showcase | Second Brain: spaces, concepts, collections |
| Customization | A workspace shaped around one learner's method |
| Community | Study groups, field notes, open learning sessions |

## Iteration 01

- Implemented direction: faithfully reproduce Craft's editorial paper-and-pastel visual grammar, while using original LearnSpace code-built product screens and learning-specific copy.
- Intentional differences: no Craft brand, copy, illustrations, portraits, or screenshots; product UI is authored LearnSpace content.
- QA artifacts will be captured to `artifacts/craft-reconstruction/final/` after implementation.

## Iteration 02 — final measured pass

- Desktop section coordinates match the live reference at 1440px from the hero through the CTA: hero `20 / 1012`, intro `1152 / 379`, stories `1651 / 860`, first showcase `2631 / 732`, structure `6522 / 665`, pricing `9343 / 853`, CTA `10316 / 230`.
- Mobile section coordinates match the live reference at 390px from the hero through the CTA: hero `16 / 776`, intro `872 / 627`, stories `1579 / 763`, first showcase `2422 / 1447`, structure `7529 / 1293`, pricing `12055 / 1102`, CTA `13237 / 354`.
- Local full-page heights: 11,225px at 1440px and 14,746px at 390px. Reference heights: 11,241px and 14,575px respectively.
- Generated artifacts: `final/learnspace-1440-full.png`, `final/learnspace-390-full.png`, and matching `craft-vs-learnspace-{1440,390}-{overlay,diff}.png` files.
- Desktop comparison metrics for the intentionally content-substituted page: mean absolute similarity `0.9341`, global SSIM `0.8306`. Mobile: mean absolute similarity `0.8753`, global SSIM `0.6873`. These are not semantic equivalence scores because LearnSpace copy and product surfaces replace Craft content by requirement.
- Browser QA: no console errors, no horizontal overflow at 390px or 1024px, local fonts loaded from the build, and primary navigation/CTA links are keyboard- and pointer-addressable.
