# Purpose
DOM UI overlay for the HUD, inventory modals, controls dialog, main menu, and run history.

# Ownership
Antigravity AI

# Local Contracts
- Float above the canvas using `pointer-events: none` on the overlay root and `pointer-events: auto` on interactive components.
- Keep `.ui-log` visual-only: no `data-ui-panel`, no click interception, and no pointer events on log rows.
- Do not modify core state directly; invoke world-owned callback triggers.
- Use styling from `style.css` matching pixel-perfect fonts and authentic 9-patched borders.

# Work Guidance
- Render log tone prefixes from core (`++`, `--`, `**`, `@@`) as color classes, not visible text.
- Keep the main HUD faithful to upstream SPD `StatusPane` and `Toolbar` geometry: status pane shows portrait, level, HP, EXP, and compass/depth only; bottom actions use `toolbar.png` frame coordinates, pack quickslots/tools as one strip, and use SPD's 4/5/6 visible quickslot width thresholds.
- Use `public/assets/icon_game.png` for visible main-menu game branding; do not substitute generic text-only logos when the icon asset is available.
- Treat **Blood and Steel** as the main game title in UI. Prefer blood-red primary actions, cold-steel surfaces, and rare gold accents over the old green/mint menu palette.
- Keep the magnifier faithful to SPD: first activation enters examine/look targeting, activating it again while examining performs intentional search through the world action.
- Ensure mobile layout splits controls comfortably for thumb zones.
- Support keypress overrides (e.g. Escape closing menus).
- RTL and Hebrew UI support as per general preferences.
- Preserve existing main-menu actions during visual polish unless the user explicitly asks to add or remove entries.

# Verification
- Run type check with `tsc --noEmit`.
- Run local browser dev server to verify layout scaling and click interaction.

# Child DOX Index
- None (leaf folder).
