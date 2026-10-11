<!-- Concern: which way this repo's FLX10 unit's TEMPO sliders run, by date | Non-concern: the map itself (models/ddj-flx10.json), the first input session (flx10-observed.md) | IO: none -->
# DDJ-FLX10: TEMPO direction, observed

## 2026-10-10, owner, demo page and twin
- The value (`Bn 00` / `Bn 20`) rises as the slider moves toward the player (bottom of the
  panel) and falls away from the player (owner).
- The demo page's mapping, a higher value playing faster, plays in the expected direction on
  decks 1 and 2: toward the player plays faster, as on a CDJ (owner).
- The twin had drawn the slider inverted: its cap rose up the panel as the value rose, against
  the physical slider moving down. Its TEMPO fader is now drawn `reversed`.
- A first record the same day (commit 714c04f) read the value as rising away from the player
  and inverted the demo's mapping; the owner, on the unit, corrected it to the above.
- The MML (p.2 D4) names the ends only as the "−" side (min) and the "+" side (max), and the
  deck section drawing in the Operating Instructions (p.14) marks neither on the panel. Read
  with this observation, the MML's "+" side is the bottom, toward the player: an inference, not
  seen printed.
- Not tried: the SHIFT layer (`Bn 05` / `Bn 25`) and decks 3 and 4 on the same sliders.
