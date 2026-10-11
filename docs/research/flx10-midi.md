<!-- Concern: where the FLX10's official MIDI list lives in code, and what the list leaves open or gets wrong | Non-concern: the wire numbers (crates/dj-controller-model/models/ddj-flx10.json) | IO: none -->
# DDJ-FLX10: the official MIDI list

The MML (see [flx10-sources.md](flx10-sources.md)) is transcribed, row by row with page and
figure citations, in `crates/dj-controller-model/models/`:

- `ddj-flx10.json`: which channel, note or CC carries each control, LED and channel-16
  jog-display item, its kind, and its source; rows seen on hardware say so under `observed`.
- `ddj-flx10.mml`: every message row of the MML, cut from the PDF's text by
  `scripts/mml-extract.py rows`. A test (`crates/dj-controller-core/src/mml.rs`) checks the model file against it.

The model file is the reference for the tables; this note keeps only what the MML does not settle.

## Left open by the MML

- **14-bit send order.** Faders and knobs send an MSB CC and an LSB CC (LSB = MSB + 0x20);
  the MML does not say which comes first. Veezuhz's capture of an EQ sweep shows MSB and LSB
  events in equal numbers (1,279 each) [VZ-S, "MIDI input/output"] **[unverified order]**.
- **Jog resolution.** No counts per revolution. Mixxx mappings use `RESOLUTION: 5760` for
  scratching [LOU-JS, `JOG_CONFIG`] **[unverified, measure it]**. The vendor HID IN stream
  may carry higher-resolution jog data ([flx10-displays.md](flx10-displays.md)) **[unverified]**.
- **CROSSFADER ASSIGN channel.** M11 labels the channel column "1" but the status `9n`;
  assumed per-deck **[unverified]**.
- **CH LEVEL METER range** (`Bn 02 vv`, M22). No range given; Mixxx sends
  `round(level × 127)` [LOU-JS l.833] **[unverified range]**.
- **BEAT FX SELECT / CH SELECT values** (F13/F14). The Data-2 column is garbled (`ON=0x8F`,
  `0x9F`, `0x10F` … `0x27F`, not valid 7-bit values). Assumed: the selected position sends
  `7F`, the one left sends `00` **[unverified]**.
- **Pad colour palette.** Pad LEDs take colour numbers 1–127, `0x00` = off (dimmer); which
  number gives which colour is not in the MML. Probe by sending 1..127 and photographing
  the result **[unverified]**.
- **Jog-display playing speed** (ch16, −100.0 %..+100.0 %, max `4E 0F`). The mapping of the
  range onto 0..9999 is not stated **[unverified: likely (pct+100)·10·… needs a test]**.
- **Fader start** (M1/M2: `9n 66` and `9n 5D` Zero → not Zero, `9n 52` Not Zero → Zero). The
  `+SHIFT` and `slide` cells are printed once, merged over the three rows, and MAN p.91 and
  p.108 start a deck only while SHIFT is held: all three are sent with SHIFT held. The list
  does not say what tells `5D` from `66`; MAN p.162 gives the unit a "Sync function when using
  Fader Start" option, which may be it. The model files `5D` as the SHIFT layer of `66`, the
  line the list prints `+SHIFT` on. No capture holds any of the three: unobserved.

## Inconsistencies in the MML

- F13/F14 Data-2 values garbled (above).
- Jog ring illumination and CH LEVEL METER marked "NOTE" but listed with CC status.
- CROSSFADER ASSIGN channel column versus status (above).
- Key display format (`9F 5B`): channel listed "1/2/3/4" but status `9F`.

## What needs no handshake

Every input, LED and the ch16 jog-display scalars (BPM, time, rotating marker, cue marker,
key, sync, jog ring) are in the MML, and plain MIDI needs no SysEx first
([flx10-sysex.md](flx10-sysex.md)). Pad mode and page live on the controller: the pad notes
change with them, so the current mode is read from which pad note arrives (MML pp.3–6).
