<!-- Concern: what this repo's FLX10 unit did with pad colours across pad modes and pages, by date | Non-concern: the colour palette itself (the model file) | IO: none -->
# DDJ-FLX10: pad colours observed on hardware

## 2026-10-09, per mode and page
- With the unit connected (after a replug), every pad showed a neutral purple in every pad
  mode before any colour was sent (owner).
- `97 00 01` (deck 1 pad 1, HOT CUE page 1, colour 1; the address is the model row
  `deck1.pad1` / `hot-cue page-1`, from the official list) turned that pad blue. Switching
  to SAMPLER showed the neutral purple; switching back to HOT CUE showed pad 1 blue again
  (owner). Changing HOT CUE to page 2 also hid the blue (owner).
- Seen for this one pad only: HOT CUE page 1 kept its colour across a SAMPLER round trip.
  That the unit keeps every mode and page's colours, so a host never repaints on a mode or
  page change, is a hypothesis; page 2 back to page 1, other modes and decks are untested.
