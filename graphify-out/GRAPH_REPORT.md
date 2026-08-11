# Graph Report - .  (2026-08-08)

## Corpus Check
- 25 files · ~50,371 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 214 nodes · 314 edges · 22 communities (19 shown, 3 thin omitted)
- Extraction: 93% EXTRACTED · 6% INFERRED · 1% AMBIGUOUS · INFERRED: 19 edges (avg confidence: 0.87)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Engine Loop|Engine Loop]]
- [[_COMMUNITY_Skin Data|Skin Data]]
- [[_COMMUNITY_Boot and Save State|Boot and Save State]]
- [[_COMMUNITY_Station Geometry|Station Geometry]]
- [[_COMMUNITY_Build Tooling|Build Tooling]]
- [[_COMMUNITY_Canvas Renderer|Canvas Renderer]]
- [[_COMMUNITY_Sprite Atlas|Sprite Atlas]]
- [[_COMMUNITY_TypeScript Config|TypeScript Config]]
- [[_COMMUNITY_Player Input|Player Input]]
- [[_COMMUNITY_Save Rescue Flow|Save Rescue Flow]]
- [[_COMMUNITY_Product Spec|Product Spec]]
- [[_COMMUNITY_Deployment Gates|Deployment Gates]]
- [[_COMMUNITY_Commit Guard|Commit Guard]]
- [[_COMMUNITY_Skin Progression Contract|Skin Progression Contract]]
- [[_COMMUNITY_Game Shell|Game Shell]]
- [[_COMMUNITY_Offline Contract|Offline Contract]]
- [[_COMMUNITY_Service Worker|Service Worker]]

## God Nodes (most connected - your core abstractions)
1. `Renderer` - 17 edges
2. `Scoopaloo Sprite Atlas` - 13 edges
3. `step()` - 11 edges
4. `GameState` - 10 edges
5. `compilerOptions` - 10 edges
6. `Controls` - 9 edges
7. `stationPoint()` - 9 edges
8. `GameSkin` - 8 edges
9. `scripts` - 7 edges
10. `Point` - 7 edges

## Surprising Connections (you probably didn't know these)
- `QR Save Transfer` --semantically_similar_to--> `Save Ticket`  [INFERRED] [semantically similar]
  README.md → docs/SPEC.md
- `Offline PWA` --semantically_similar_to--> `Offline PWA`  [INFERRED] [semantically similar]
  README.md → docs/SPEC.md
- `Zero-Text Gameplay` --semantically_similar_to--> `Zero-Text Contract`  [INFERRED] [semantically similar]
  README.md → docs/SPEC.md
- `Swappable Shop Skins` --semantically_similar_to--> `Engine Skin Contract`  [INFERRED] [semantically similar]
  README.md → docs/SPEC.md
- `Rescue Page` --implements--> `Save Ticket`  [INFERRED]
  public/rescue.html → docs/SPEC.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Save Ticket Roundtrip** — docs_spec_save_ticket, docs_spec_versioned_save_codec, index_save_export_dialog, public_rescue_rescue_page, public_rescue_restore_save_flow [INFERRED 0.95]
- **Skin-Driven Product Model** — readme_swappable_shop_skins, docs_spec_skin_as_data, docs_spec_engine_skin_contract, docs_spec_station_graph_progression [INFERRED 0.85]
- **Zero-Text Play Experience** — readme_zero_text_gameplay, docs_spec_zero_text_contract, index_scoopaloo_game_shell, public_rescue_visual_restore_interface [INFERRED 0.75]
- **Ice Cream Shop Scene** — assets_scoopaloo_atlas_ice_cream_shop_employee, assets_scoopaloo_atlas_customer_character_set, assets_scoopaloo_atlas_soft_serve_cone, assets_scoopaloo_atlas_soft_serve_machine, assets_scoopaloo_atlas_dessert_display_case, assets_scoopaloo_atlas_cash_register [INFERRED 0.85]
- **Game Feedback Assets** — assets_scoopaloo_atlas_star_coin_icon, assets_scoopaloo_atlas_heart_icon, assets_scoopaloo_atlas_sparkle_effect [INFERRED 0.75]

## Communities (22 total, 3 thin omitted)

### Community 0 - "Engine Loop"
Cohesion: 0.17
Nodes (21): clamp(), createGame(), Customer, distance(), emit(), EventKind, FlyingCoin, GameEvent (+13 more)

### Community 1 - "Skin Data"
Cohesion: 0.08
Nodes (23): id, palette, cocoa, cream, mint, strawberry, sunshine, waffle (+15 more)

### Community 2 - "Boot and Save State"
Cohesion: 0.13
Nodes (21): defaultSave(), SaveV1, canvas, controls, dialog, frame(), link, previous (+13 more)

### Community 3 - "Station Geometry"
Cohesion: 0.10
Nodes (21): depth, draw, interaction, sprite, depth, draw, interaction, sprite (+13 more)

### Community 4 - "Build Tooling"
Cohesion: 0.10
Nodes (19): dependencies, qrcode, devDependencies, @playwright/test, @types/qrcode, typescript, vite, vitest (+11 more)

### Community 5 - "Canvas Renderer"
Cohesion: 0.27
Nodes (3): GameState, Renderer, rounded()

### Community 6 - "Sprite Atlas"
Cohesion: 0.24
Nodes (14): Cash Register, Customer Character Set, Dessert Display Case, Employee Movement Frames, Employee Service Frame, Heart Icon, Ice Cream Shop Employee, Ice Cream Shop Game Asset Set (+6 more)

### Community 7 - "TypeScript Config"
Cohesion: 0.17
Nodes (11): compilerOptions, lib, module, moduleResolution, noEmit, resolveJsonModule, strict, target (+3 more)

### Community 8 - "Player Input"
Cohesion: 0.27
Nodes (4): Input, Point, Controls, Window

### Community 9 - "Save Rescue Flow"
Cohesion: 0.24
Nodes (10): Fragment Locality Privacy, Save Ticket, Versioned Save Codec, Rescue Link, Save Export Dialog, Decode, Rescue Page, Restore Save Flow (+2 more)

### Community 10 - "Product Spec"
Cohesion: 0.22
Nodes (9): Animation as Product, Animation Spec, Kid-Safe by Construction, Scoopaloo Spec, Skin as Data, Zero-Text Contract, Visual Restore Interface, Scoopaloo (+1 more)

### Community 11 - "Deployment Gates"
Cohesion: 0.25
Nodes (8): Quality Gates, Static Cloudflare Deployment, Build Artifact Validation, Cloudflare Deployment, Deploy Concurrency, Isolated Game Origin, Scoopaloo Deployment, Self-Deploying Game

### Community 12 - "Commit Guard"
Cohesion: 0.50
Nodes (4): CI-Enforced Issue References, Commit Message Guard, Commit Range Selection, Exempt Commit Types

### Community 13 - "Skin Progression Contract"
Cohesion: 0.67
Nodes (3): Engine Skin Contract, Station Graph Progression, Swappable Shop Skins

## Ambiguous Edges - Review These
- `Rescue Link` → `Rescue Page`  [AMBIGUOUS]
  index.html · relation: conceptually_related_to
- `Waffle Platform` → `Ice Cream Shop Game Asset Set`  [AMBIGUOUS]
  public/assets/scoopaloo-atlas.png · relation: conceptually_related_to

## Knowledge Gaps
- **97 isolated node(s):** `name`, `private`, `version`, `type`, `dev` (+92 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Rescue Link` and `Rescue Page`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Waffle Platform` and `Ice Cream Shop Game Asset Set`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `stations` connect `Station Geometry` to `Skin Data`?**
  _High betweenness centrality (0.097) - this node is a cross-community bridge._
- **Why does `Renderer` connect `Canvas Renderer` to `Engine Loop`, `Boot and Save State`?**
  _High betweenness centrality (0.047) - this node is a cross-community bridge._
- **What connects `name`, `private`, `version` to the rest of the system?**
  _103 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Skin Data` be split into smaller, more focused modules?**
  _Cohesion score 0.08333333333333333 - nodes in this community are weakly interconnected._
- **Should `Boot and Save State` be split into smaller, more focused modules?**
  _Cohesion score 0.13405797101449277 - nodes in this community are weakly interconnected._