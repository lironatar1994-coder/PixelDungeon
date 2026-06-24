# Purpose
Pure, headless game logic, math, state management, and algorithmic ports from Shattered Pixel Dungeon.

# Ownership
Antigravity AI

# Local Contracts
- Completely decoupled from UI, browser window, DOM, and rendering.
- No imports from browser APIs or other non-headless environments.
- All game rules, equations, turn schedules, and grid coordinates reside here.
- Must be fully unit testable under Vitest.
- Procedural generation must remain deterministic from explicit seeds and save-compatible snapshots.
- Shattered Pixel Dungeon algorithm ports must preserve local public contracts and use Mulberry32 seeds rather than upstream Java seed parity.

# Work Guidance
- Use Mulberry32 for all seeded RNG operations.
- Use SPD-style log tone prefixes for player-facing log entries: `++` positive, `--` negative, `**` warning, and `@@` highlight. Keep ordinary door open/close actions out of the log.
- Ensure proper object lifecycles with `.destroy()` or `.dispose()` to avoid event bus and queue leaks.
- Keep components small and focused following the Lego Brick Strategy.

# Verification
- Run type check with `tsc --noEmit`.
- Run unit tests with `npm test`.

# Child DOX Index
- [procgen/AGENTS.md](file:///c:/Users/liron/Pixel%20Dungeon/src/core/procgen/AGENTS.md): Seeded dungeon generation, regular-level plans, builders, painters, and map metadata.
