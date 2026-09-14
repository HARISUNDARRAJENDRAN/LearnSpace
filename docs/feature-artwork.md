# Feature artwork

Generated with the built-in image-generation tool using the supplied Notely screenshot as a visual reference. These are close reproductions, not pixel-identical source assets.

Assets live in `apps/web/public/assets/marketing/`: `features-reference-v2.webp` (four-panel board), `feature-tutor-v2.webp`, and `feature-discovery-v2.webp`. The SVG viewports in `FeatureIllustration.tsx` select the four board panels without duplicating the bitmap. WebP encoding uses quality 90.

Prompt briefs:

- Reference board: reproduce the four source compositions, mint and powder-blue colors, white rounded surfaces, subtle shading, icons, labels, cropping, curved arrows, wavy monitor, and circular hub. Remove the outer feature headings and descriptions; retain a two-by-two illustration board.
- Tutor: a powder-blue landscape with a white cropped lesson screen, mint-highlighted equation, green underline and pen, a “Right here” label, and a microphone control; match the reference's soft pastel shading.
- Discovery: a mint landscape with overlapping white video and paper resource covers, a smaller cover behind, a blue bookmark, and “Picked for you”; match the reference's soft rounded surfaces and shadows.

Card headings, descriptions, and the six-card layout remain in `FeatureGrid.tsx`.
