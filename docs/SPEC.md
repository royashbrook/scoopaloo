# scoopaloo - spec

a kawaii restaurant-rush game for kids 8+ and adults. free pwa, no ads, no purchases,
no accounts. one engine, many shop skins; ice cream is skin one.

## pillars (the non-negotiables)

1. **kid-safe by construction.** no ads, no lives, no timers, nothing to buy, no accounts, no
   cookies, nothing sold or shared. no notifications. the game itself makes no network requests
   after load; the host serves a cookieless analytics beacon that measures page paint and
   nothing else. there is no identifier, so there is nothing to collect and nothing to disclose.
2. **readable pressure.** icons teach spatial actions; concise labels and real numbers explain
   goals, orders, time, value, and performance. text is ON and functional. the player should
   always know what to make, how long is left, what it pays, and why a shift succeeded or failed.
3. **animation is the product.** the art is deliberately simple; the slickness comes from motion.
   every interaction has a response (see animation spec). 60fps on a 2018 ipad is the budget.
4. **a skin is data, not code.** the engine never mentions ice cream. if skin two (candy shop)
   needs an engine change, that is an engine bug.

## the view

3/4 view with real depth cues, like the arcade-idle games it's honoring:

- portrait phones are the primary play surface. the `390×844` gate keeps hud/ticket/control
  chrome in the upper wall and right rail so the full-height floor remains a clear movement lane.
- objects draw with a front face and a top face; the world y-sorts so near things overlap far.
- soft elliptical drop shadows under everything that stands or floats.
- floor is a warm tile with subtle pattern variation, never flat-flood.

## art direction

toca-boca-adjacent kawaii, from the approved concept board:

- characters: big round heads (head ≈ body height), dot eyes, blush circles, small arc smile.
  **hair sits on top of the head as a cap/wig shape** — it never clips behind the crown.
- everything chunky and rounded; no hard corners, no outlines thinner than 3px if outlined.
- palette (skin one): strawberry `#FF8FAB`, mint `#63CDB4`, sunshine `#FFD45E`,
  waffle `#FFD9B8`, cream ground `#FFF3E6`, cocoa ink `#4A3B45` (never pure black).
- carrying: items ride a **tray held in front with both arms**, not on the head. the stack
  wobbles and lags as the character walks.

## the loop

day 1 teaches the payoff before the production puzzle: the first machine dispenses a finished
vanilla cone to carry straight to the customer. the first three serves have no clock, patience
loss, or second customer; then a visible sundae source opens and normal shift pressure begins.
the compact hud shows only the goal, current order, guidance, and pause during that lesson.

1. from day 2 onward, four sources produce vanilla or chocolate scoops, cone shells, and sundae
   cups over time. the chocolate machine and its room corner are a saved day 2 unlock. the first
   naturally reached day 2 order has one customer and no clock or patience loss, so the standard
   recipe checklist can teach source → vessel → prep → counter before normal pressure begins.
2. player reads the current ticket and two-order preview, then collects the requested flavor plus
   the correct vessel shown in the recipe checklist.
3. carry both components to the prep station and hold in its ring. an exact recipe consumes
   atomically, visibly fills a short progress ring, and buffers the finished item for pickup.
   incomplete or wrong ingredients remain recoverable; raw components cannot be sold.
4. carry the finished cone or sundae to the counter; it slides into the display.
5. customers walk in with readable order tickets and patience, queue at the counter, and get
   served only by matching stock. the next two orders stay visible for batching and planning.
   the live ticket exposes whole seconds, tip, next-service combo, and the maximum payout at
   current patience. a walkout is visible and resets the service streak.
6. payment: base price plus a remaining-patience tip and explicit streak bonus appears as a
   number; flat bonuses unlock at 2/4/6 consecutive serves. coins fountain out and
   lie on the floor near the register. the player collects by
   walking near (small magnet radius, coins fly to the player with a pop).
7. a timed shift shows its cash goal, clock, served, missed, and streak. results show revenue,
   goal, best streak, and 1-3 stars before retry, upgrade, or next day.
8. spend between shifts to choose: faster prep, faster movement, bigger tray, or more patience.
9. helpers arrive only after the related bottleneck is visible. Pip makes the front order at prep;
   Mel moves a finished prep output to the shared counter after the second service lane is built.
   the player is always strictly faster than a helper, so playing beats watching.
10. clearing day 3 unlocks score chase: repeatable 120-second full-menu rush levels rotate the
    deck, raise the cash goal, tighten arrivals/patience to fixed floors, and preserve a best score.

progression = shifts, score-chase rules, order deck, goals, station graph, and upgrade values defined by the skin.
missing a goal means retry, never punishment or lost purchases.

## animation spec (build these, in this order)

| # | moment | motion |
|---|--------|--------|
| 1 | walk | four-direction leg/arm gait driven by distance traveled, slight lean, feet patter, shadow tracks |
| 2 | carry | tray items wobble with spring lag; big stacks wobble more |
| 3 | pickup / drop | item squash-stretch hop with a little arc, tray dips |
| 4 | machine pour | swirl builds up in 3 ellipse layers, tiny wiggle at the end |
| 5 | pay | coin fountain arc, coins settle with bounce, magnet-fly to player |
| 6 | served | heart pop + 3 sparkles, customer happy-hop, waddle out |
| 7 | idle | characters blink every few seconds; machines rest between production actions |
| 8 | buttons / shop cards | squish on press; affordable choices use the sunshine action color |

easing: everything springs or ease-out-backs. nothing moves linearly. respect
`prefers-reduced-motion` by damping (not removing) the springs.

## controls

- one thumb: touch-drag anywhere = virtual joystick (the floating ring in the reference games).
- keyboard (desktop dev/testing): wasd/arrows.
- no other gestures. taps start shifts and operate results/shop menus.

## sound

- short procedural cues confirm start, production, pickup/drop, prep start/ready, blocked raw
  delivery, payment, wrong items, one ten-second hurry threshold, results, upgrades, and day
  changes. cues support the
  numeric/visual feedback; they never replace it.
- web audio unlocks on the first tap for mobile autoplay rules. sound defaults on; one fixed
  button outside the portrait play lane mutes it, and that choice persists across reloads.
- no streamed audio or sound asset requests. sound failure is silent and never blocks play.

## tech

- vite + typescript. canvas 2d for the world; plain dom for menus/settings. no framework in
  the render path.
- pwa: manifest + service worker; fully offline after first load.
- deploy: static, cloudflare (same shape as the other games). no worker logic needed.
- tests: vitest for engine logic (economy, station graph, save codec); a playwright smoke that
  boots the game, runs the loop, and asserts coins increase. ci gate = typecheck + tests + build.

## save + migration

- save = versioned json in localStorage (`scoopaloo_save_v1`): coins, unlocked stations,
  upgrade levels, current day, rush level/best, stars/best revenue, and skin id. small on purpose. old saves with
  the retired text toggle still import safely.
- **save ticket**: settings drawer (not front and center) shows the save as a QR. the QR carries
  a LINK to `rescue.html` with the save compressed into the url fragment (deflate-raw +
  base64url, prefix `sc1.`), because ios cameras scan links natively: no camera permission, no
  in-app scanner, and the fragment never reaches a server.
- `rescue.html` is a SINGLE static file with the decoder inlined; it shows the save summary and
  a "load into game" button. importing always confirms before overwriting a newer-looking save.
- copy-code / paste-code text fallback next to the QR for devices where scanning is awkward.
- codec is versioned (`sc1.`); a newer prefix fails with a plain-words message, never silent loss.

## engine / skin contract

skin = `skins/<name>.json` + one sprite sheet. the json declares:

- palette (the named colors above)
- station graph: producers, transformers, sinks, their rates, prices, unlock order
- item definitions (what rides the tray, what customers want)
- text strings for tickets, hud, results, upgrades, and day challenges

engine owns: grid + movement, carrying, station scheduling, customers + queueing, economy,
helpers, save, input, render, animation. skin two (candy shop) is the contract's proof and is
not started until skin one is fun.

## quality gates (definition of done, per slice)

1. ci green (typecheck + vitest + build).
2. a first-time player can read the shift goal, order, timer, payout, result, and next choice.
3. 60fps on the oldest device on hand; no frame budget regressions in the perf smoke.
4. save survives: reload, offline reload, export → rescue → import roundtrip.
5. reviewed by the second pair of eyes before merge. no self-merges.
