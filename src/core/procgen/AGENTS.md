# Purpose
Seeded, headless procedural generation for dungeon floors and map metadata.

# Ownership
Antigravity AI

# Local Contracts
- Keep all generation deterministic from explicit `RNG` instances and serializable generation plans.
- For regular levels, derive scoped RNG streams for builder, terrain paint, stair placement, traps, and loot so decoration changes do not perturb entity or loot decisions.
- Do not import rendering, DOM, browser storage, audio, UI, or event-bus code.
- Preserve legacy `generateLevel(width, height, rng)` behavior for regions that have not been ported to regular-level plans.
- Sewer depths `1-5` use the regular room/list/build/paint pipeline; deeper regions stay on the legacy generator until ported.
- Save-facing metadata must remain optional and backward-compatible.

# Work Guidance
- Model original Shattered Pixel Dungeon generation as data flow: plan rooms, build a connected graph, paint rooms/doors/decor, then place stairs, traps, and loot.
- Doors belong to room connections and must be shifted with room normalization.
- Decorative water, grass, and room patterns must not overwrite doors, stairs, trap cells, required loot, or block the generated room graph.
- Angle-placed rooms must reject padded collisions against non-connected rooms; guaranteed fallback layouts must reject actual overlap and unconnected door seams.

# Verification
- Run focused procgen tests with `npm test -- src/core/procgen`.
- Run type check with `npx tsc --noEmit`.

# Child DOX Index
- None.
