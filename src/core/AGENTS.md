# Purpose
Pure, headless game logic, math, state management, and algorithms inspired by Shattered Pixel Dungeon.

# Ownership
Antigravity AI

# Local Contracts
- Completely decoupled from UI, browser window, DOM, and rendering.
- No imports from browser APIs or other non-headless environments.
- All game rules, equations, turn schedules, and grid coordinates reside here.
- Must be fully unit testable under Vitest.

# Work Guidance
- Use Mulberry32 for all seeded RNG operations.
- Use SPD-style log tone prefixes for player-facing log entries: `++` positive, `--` negative, `**` warning, and `@@` highlight. Keep ordinary door open/close actions out of the log.
- Ensure proper object lifecycles with `.destroy()` or `.dispose()` to avoid event bus and queue leaks.
- Keep components small and focused following the Lego Brick Strategy.

# Verification
- Run type check with `tsc --noEmit`.
- Run unit tests with `npm test`.

# Child DOX Index
- None (leaf folder with no sub-agent DOX contracts).
