# scoopaloo

a portrait-first ice cream rush game. prep cones and sundaes, triage the line,
collect tips, upgrade the stand, and climb Score Chase.

- free. no ads, no purchases, no accounts.
- designed for phone play, with readable order, timer, payout, and recipe guidance.
- drag anywhere to move, or use WASD/arrow keys; walk into dashed rings to interact.
- works offline once loaded and installs as a portrait-first PWA.
- sound is optional, and your save can move devices with the in-game QR rescue link.

built as one data-driven engine with an ice cream shop skin.

the full design is in [docs/SPEC.md](docs/SPEC.md).

## develop

```bash
npm ci
npm run dev     # local dev server
npm test        # engine tests
npm run check   # typecheck + unit tests + production build
npm run test:e2e # gameplay, offline, and frame-budget browser checks
```

pull requests must pass both commands before merge.

MIT.
