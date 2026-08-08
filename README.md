# scoopaloo

a tiny kawaii ice cream stand game for kids. run the stand: make cones, carry the tray,
serve the line, collect the coins, grow the shop.

- free. no ads, no purchases, no accounts.
- works offline once loaded (it's a pwa, add it to the home screen).
- nothing to read: the whole game is playable before you can.
- your save can hop devices with a QR code from the settings drawer.

built as one engine with swappable shop skins; the candy shop comes next.

the full design is in [docs/SPEC.md](docs/SPEC.md).

## develop

```bash
npm ci
npm run dev     # local dev server
npm test        # engine tests
npm run check   # typecheck + tests + build, the merge gate
npm run test:e2e # gameplay, offline, and frame-budget browser checks
```

MIT.
