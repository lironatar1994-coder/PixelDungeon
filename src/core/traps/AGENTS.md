# Purpose
Headless trap definitions and behavior data shared by procedural generation and the turn runtime.

# Ownership
Antigravity AI

# Local Contracts
- Keep trap data pure and serializable; do not import rendering, DOM, browser storage, audio, UI, or event-bus code.
- Preserve Shattered Pixel Dungeon sewer trap identities, flags, and placement weights while using local Mulberry32 RNG streams.
- Treat runtime trap metadata as backward-compatible: missing optional fields must hydrate from the registry.

# Work Guidance
- Put durable trap flags and weights in the registry so procgen and `GameWorld` cannot drift.
- Gateway traps are persistent and must not disarm on activation.
- Worn dart traps cannot be hidden and should avoid hallway placement.

# Verification
- Run focused trap and procgen tests with `npm test -- src/core`.
- Run type check with `npx tsc --noEmit`.

# Child DOX Index
- None.
