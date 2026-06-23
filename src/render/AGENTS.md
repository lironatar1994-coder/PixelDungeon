# Purpose
Dungeon and entity visual rendering layer using the HTML5 Canvas API and loaded image assets.

# Ownership
Antigravity AI

# Local Contracts
- Interfaces with the canvas drawing surface.
- Camera calculation and screen-to-tile coordinate mappings live here.
- Completely decoupled from direct game state mutation; uses event handlers or query properties from the composition root.

# Work Guidance
- Implement camera center focus clamped to map boundaries.
- Support responsive viewport scale/zoom.
- Keep camera panning render-only, but re-lock follow to the hero when the hero participates in combat.
- Support real-time actor idle squashing and tween animations.

# Verification
- Run type check with `tsc --noEmit`.
- Verify graphics layout in a local browser environment.

# Child DOX Index
- None (leaf folder).
