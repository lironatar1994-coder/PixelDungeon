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
- Keep the desktop game canvas width-capped and centered on the black page stage; derive render buffer size from the canvas CSS bounds, not the full browser window.
- Support responsive viewport scale/zoom.
- Keep camera panning render-only, but re-lock follow to the hero when the hero participates in combat.
- Render hidden secrets as their undiscovered terrain: `SECRET_DOOR` as wall and `SECRET_TRAP` as floor until core search reveals them. `INACTIVE_TRAP` is a visible safe floor-like trap state.
- Draw fog as an SPD-style overlay: visible is transparent, explored is black at `0x99/0xff` opacity, unseen is full black, and wall fog uses half-tile side rules to prevent hidden wall edges leaking.
- Support real-time actor idle squashing and tween animations.

# Verification
- Run type check with `tsc --noEmit`.
- Verify graphics layout in a local browser environment.

# Child DOX Index
- None (leaf folder).
