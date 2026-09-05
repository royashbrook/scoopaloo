# a shop worth playing

Status: the continuous-shop preview is a design experiment, not a replacement for the campaign yet. Track implementation and receipts in #77. Open `/shop-floor.html`; the campaign remains at `/`. The preview stores progress separately and never migrates or resets a campaign save.

## the experiment

Can a child understand the action from the scene, enjoy repeating it, and see why growing the shop and hiring help are useful? The change is a continuous floor with finished cones, direct service, visible cash, a patio purchase and a worker who takes over a demonstrated job. It is not a recipe puzzle with a shorter tutorial.

The current slice stops adding content after the patio/helper. Do not disguise that ceiling as a finished progression system. More machines, areas, skins or engine work wait until the basic interaction is worth repeating.

## before inviting anyone to test

- Record the exact build and hosted preview URL. Check it on the actual phone/tablet viewport, with browser controls/safe areas present. Do not test a stale installed shortcut.
- Run `npm run check` and the focused browser suite: `PLAYWRIGHT_PORT=4199 npm run test:e2e -- tests/shop-floor.spec.ts tests/pause-dock.spec.ts tests/input.spec.ts tests/storage.spec.ts`.
- Prove storage failures and background/foreground interruption ourselves. Never ask a child to diagnose our infrastructure.
- Use separate fresh browser contexts for the experiment. Never clear someone's existing app data to arrange a test.

## one sitting, no coaching

Use at least five cold players if available. Record anonymous observations, not names or other personal data. Let each try the current campaign and this preview; alternate which comes first so familiarity does not decide the comparison.

Say only: “Here is an ice-cream shop. Have a go.” Do not point to the rings, name the next action, explain the helper, or rescue the first hesitation. If help is needed, record what caused it, then help; do not count the assisted action as uncoached success.

Watch:

| Moment | Proposed target | What to record |
|---|---|---|
| First input | Meaningful response within 5 seconds | Did they know what they controlled? Any missed touch or invisible action? |
| First customer | Paid service within 10 seconds | Could they find cones and the customer without reading a recipe? |
| First growth | Patio within 60 seconds | Did earning cash visibly change the place? Did they understand what spending would do? |
| First helper | Complete-job role understood | Ask “What is Pip doing?” after they watch. Accept their own explanation. |
| After two minutes | A real choice to continue | Offer continuing this game, the old one, or stopping. Record the choice without praise or pressure. |

Four out of five moving/serving uncoached and explaining the helper is the provisional comprehension gate. It is not a retention study or proof of commercial success. A fast scripted route passing in CI is not this gate. If comprehension passes but children still stop voluntarily, change the loop/feedback rather than adding a longer tutorial.

## motion receipts

Capture short clips on the phone and tablet for: starting/stopping, turning through all directions, empty/loaded walking, pickup, serving/payment, opening the patio and a complete helper trip. Repeat with reduced motion enabled.

- Feet meet the floor; character footprint does not jump when direction or pose changes.
- The sprite responds on the first movement frame. The camera does not jerk on direction changes.
- Cones travel between the visible source, tray and customer. Cash is credited once and the payment is readable.
- Building changes the world in frame; the second counter is usable, not decoration.
- The helper visibly collects and delivers. No remote invisible production masquerading as help.
- Decorative effects may be reduced, but item motion and state changes remain understandable.
- Opening pause, changing apps and returning do not advance the shop or leave the thumbstick held.

## decision

Record the observed failures, the smallest next design change, and whether this is actually preferable to the old opening. Only then decide on default entry, transfer/migration of preview progress, further world expansion and the optional legacy Rush mode. Preserve existing saves throughout.
