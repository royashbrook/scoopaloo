# Scoopaloo logo concept

Archived reference for [Scoopaloo issue #23](https://github.com/royashbrook/scoopaloo/issues/23), not production masters. The editable production artwork lives in [public/assets/brand](../../../public/assets/brand). These concepts stay outside `public/` so they are not shipped to players.

- Generated with the built-in image-generation tool on 2026-08-08.
- Style reference: `public/assets/scoopaloo-atlas.png`.
- Transparent concept: `scoopaloo-logo-concept.png` (1774x887 RGBA).
- Chroma-key removal used the installed `remove_chroma_key.py` helper with border sampling, soft matte, and despill. Corners validate alpha 0.

## Prompt

```text
Use case: logo-brand
Asset type: master logo concept for a mobile restaurant-management game
Primary request: create an original, polished logo for the game "SCOOPALOO". It must feel like a real arcade management game for ages 8 through adult, energetic and competitive, not preschool or nursery branding.
Input image: the supplied Scoopaloo sprite atlas is a STYLE AND PALETTE REFERENCE ONLY. Reuse its visual language and colors, but do not copy a character, sprite, sheet layout, or existing object verbatim.
Subject: a horizontal wordmark reading exactly "SCOOPALOO" in heavy condensed rounded uppercase letters, shaped like a compact ice-cream shop marquee. Include a standalone emblem to the left: a bold S-shaped soft-serve swirl seated in a simple waffle cone, with one small star-coin glint signaling score and economy.
Style/medium: vector-friendly flat logo design, crisp bold cocoa outline, strawberry letter faces, cream highlights, short mint offset shadow, restrained sunshine accent. Conventional, instantly readable letterforms.
Composition/framing: centered horizontal lockup, about 3:1 overall, generous clear space. Strong silhouette and balanced negative space. Every essential icon detail must remain legible at phone-launcher size.
Color palette: strawberry #FF8FAB, mint #63CDB4, sunshine #FFD45E, waffle #FFD9B8, cream #FFF3E6, cocoa #4A3B45.
Text (verbatim): "SCOOPALOO". Spell S-C-O-O-P-A-L-O-O exactly once. No other text.
Background: perfectly flat solid #00FF00 chroma-key background for later removal. One uniform color only, with no shadow, gradient, texture, reflection, floor plane, lighting variation, or border. Do not use #00FF00 anywhere in the logo.
Constraints: original design only; no mascot face; no character portrait; no loose baby-bubble lettering; no thin strokes; no 3D mockup; no photorealism; no watermark; no extra symbols or words. Keep all logo edges crisp with generous padding.
```

## Launcher mark

`scoopaloo-mark-concept.png` is the companion 1254x1254 opaque launcher-mark direction. Its generated background is softly graded, so it is reference only; the production maskable SVG/PNG must use the issue's flat full-bleed mint field and safe zone.

```text
Use case: logo-brand
Asset type: square mobile game launcher icon concept
Primary request: create the standalone Scoopaloo emblem as a professional phone-game app icon for ages 8 through adult.
Input images: Image 1 is the Scoopaloo sprite atlas, STYLE AND PALETTE REFERENCE ONLY. Image 2 is the approved generated horizontal logo direction; preserve its bold outline, cream keyline, mint offset-shadow language, and S-shaped soft-serve idea, but do not include or crop its wordmark.
Subject: one bold S-shaped strawberry-and-cream soft-serve swirl seated in a simple waffle cone, plus one small sunshine star-coin glint at the lower right. No face, no character, no letters, no words.
Style/medium: vector-friendly flat icon, heavy cocoa outline, cream keyline, minimal interior detail, strong unmistakable silhouette, polished arcade restaurant-management identity rather than a nursery sticker.
Composition/framing: exact 1:1 square. Emblem centered and large. All essential swirl, cone tip, and coin detail stays inside a centered circular safe zone with radius 40% of the canvas. Surrounding field fills the entire square for maskable use.
Color palette: mint #63CDB4 full-bleed background, strawberry #FF8FAB, cream #FFF3E6, sunshine #FFD45E, waffle #FFD9B8, cocoa #4A3B45.
Constraints: opaque full-bleed background; no transparency; no gradients; no mockup; no device frame; no 3D; no photorealism; no text; no mascot face; no character portrait; no extra scoops, symbols, border, shadow outside the safe zone, watermark, or trademarks. Must remain recognizable at 32px.
```
