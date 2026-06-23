# Purpose
DOM UI overlay for the HUD, inventory modals, controls dialog, main menu, and run history.

# Ownership
Antigravity AI

# Local Contracts
- Float above the canvas using `pointer-events: none` on the overlay root and `pointer-events: auto` on interactive components.
- Do not modify core state directly; invoke world-owned callback triggers.
- Use styling from `style.css` matching pixel-perfect fonts and authentic 9-patched borders.

# Work Guidance
- Ensure mobile layout splits controls comfortably for thumb zones.
- Support keypress overrides (e.g. Escape closing menus).
- RTL and Hebrew UI support as per general preferences.
- Preserve existing main-menu actions during visual polish unless the user explicitly asks to add or remove entries.

# Verification
- Run type check with `tsc --noEmit`.
- Run local browser dev server to verify layout scaling and click interaction.

# Child DOX Index
- None (leaf folder).
