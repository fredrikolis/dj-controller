<!-- Concern: how this repo's FLX10 unit reports a jog's revolution, platter and side, by date | Non-concern: the map itself (models/ddj-flx10.json), the first input session (flx10-observed.md) | IO: none -->
# DDJ-FLX10: jog revolutions, observed

## 2026-10-10, owner, deck 2, raw MIDI
The capture, as `amidi -d` printed it, is
`crates/dj-controller-core/fixtures/ddj-flx10-jog-laps-2026-10-10.hex`; a core test sums it.
- Top platter, touched, vinyl mode off (`B1 23`): one slow lap, marked by hand, summed 12,884
  ticks over 4,628 messages; one normal-speed lap 13,266 over 3,026. So about 13,000 ticks a
  revolution whatever the speed; the hand marking is good to a few percent. The model states
  `revolution` 13,000 with those laps. Decks 1, 3 and 4, and the platter's other layers, were not
  measured; the model takes decks 1, 3 and 4 as deck 2 (the same platter hardware, unobserved).
- Side (`B1 21`): one lap summed 1,081 ticks over 295 messages, every one +3, +4 or +5, never +1
  or +2; a very slow quarter turn sent nothing. The firmware reports the side only above a speed
  threshold, in steps of 3 or more, so a lap's sum depends on its speed: the model states
  `least-step` 3 and no revolution, on deck 2's row as observed there.
- Open question: on 2026-10-08 deck 1's side sent +1 and +2 steps (+1..+9, flx10-observed.md),
  so the threshold may depend on the controller's state (mode, firmware state, something set
  since) rather than on the deck. The least step is a note on the row it was seen on, not a
  per-deck fact, and the generated types give all four decks one type whatever their rows' notes.
- By design: Algoriddim staff (Slak_Jaw, 2025-09-25 and 09-30) say the firmware ignores rim
  movement below a certain speed, built with Serato's behaviour in mind, so subwoofers rattling
  the controller do not read as movement, and that the edge sends its own MIDI with this "lower
  speed limit" baked in
  (https://community.algoriddim.com/t/flx10-jogwheel-fine-adjustment-not-possible-in-pause-mode/38423).
  That thread's user ran firmware 1.14; this unit reports 1.13 (bcdDevice). Nothing there says
  1.14 changed it.
- What the owner saw before: the twin's platter turned half a lap per real lap (it divided by
  2026-10-08's messy +25,772, about two revolutions), and slow side moves did not move the
  twin, as the firmware sends nothing for them.
