<!-- Concern: every frame of rekordbox's FLX10 connect traffic (LOU-INIT), parsed, grouped and explained with sources | Non-concern: the experiment that tests it (flx10-connect-run.md) | IO: none -->
# DDJ-FLX10: rekordbox's connect traffic, frame by frame

The frames are LOU-INIT, rekordbox's connect traffic as Loui1979 captured it (Unlicense),
committed unchanged as `crates/dj-controller-core/fixtures/ddj-flx10-rekordbox-connect.json`. Frame numbers
are 0-based. `dj-controller-cli capture DDJ-FLX10 <that file> [--only FRAMES]` prints each frame with its
group and the MML row it addresses; core tests (`crates/dj-controller-core/src/capture.rs`) hold the counts
below. Short names are in [flx10-sources.md](flx10-sources.md).

## Framing

- 324 frames: 0..322 on EP3 (USB-MIDI), 323 on EP5 (HID). Each EP3 frame is one transfer of
  4-byte event packets [MIDI10-USB §4], all on cable 0, and decodes to exactly one message.
- Code Index Numbers used: 4 (SysEx start or continue), 5/6/7 (SysEx end with 1/2/3 bytes),
  9 (note on), B (control change). Frames 73, 76, 79, 83, 85, 146 and 252 carry stale bytes
  (`69`, `49`) in a SysEx end packet's unused slot, where the spec pads with zero; a receiver
  ignores them, and a replay through ALSA rawmidi lets the kernel pack anew, so they never go out.
- The capture is a prefix. rekordbox's burst to a DDJ-1000 [NT-1000] follows the same order
  and goes on past deck 1's beat-jump pads; LOU-INIT stops at frame 322, then the EP5 report.

## Groups

| Group | Frames | What it is |
|---|---|---|
| (a) `sysex` + `hid` | 26 + 1 | SysEx no official list documents, and the one HID report. Hypothesis: the firmware and screen setup |
| (b) `outputs` | 253 | Plain MIDI at an output the MML lists: host state the driver models and its sync already sends |
| (c) `unlisted` | 44 | Plain MIDI at an address with no listed output: unknown |

## (a) SysEx, all `F0 00 40 05 00 00 04 01 00 … F7`

| Body | Frames | Meaning, source, confidence |
|---|---|---|
| `50 00` | 0, 19, 82, 140, 204, 270 | Keepalive: rekordbox sends it every ~200 ms [VZ-F; LOU-RB3]; the DDJ-1000 takes `50 01` the same way [RU-1000; NT-1000], the FLX4 `50 02` (flx10-sysex.md). High |
| `00 0B 31 00 00 00 00 00` | 2, 72, 145, 249, 251, 322 | Unknown. The DDJ-1000 gets the same layout with other values (`0B 2B 68 …`, `0B 34 …`, `0B 35 60 14 01`); NT-1000 sends `0B 2B 68` at every track load. Low |
| `00 0C 00 00 02 0E 0E 00 00 00` | 3, 73, 146, 252 | Byte for byte what rekordbox sends a DDJ-1000. NT-1000 reads the four bytes after `0C 00 00` as a 28-bit number in 7-bit groups, rekordbox's library row of the track loaded; here a constant (4425472) before any load. Low |
| `00 0A 00 28 00 26 00 28 49 0A 64 69 14` + 31 × `00` | 71, 75, 147, 250 | Unknown. The same 54 bytes go to a DDJ-1000 [JAN-1000, which files them under "jog screen enable"; NT-1000]; other DDJ-1000 captures differ only in the bytes after `00 26 00`. Not model data, as both models get it. Low |
| `03 01` | 74, 148 | State request: observed on this unit (flx10-observed.md); Mixxx's DDJ-400 script names it so. High |
| `1n 0F 0F 0F 0F 0F 0F`, n = 1..4 | 76, 79, 83, 85 | Per deck 1 to 4, unknown. Serato sends `1n 00 00 02 0E 0E 05` [VZ-R], `0C`'s value with a 5. The DDJ-1000's `11`..`15` are its login [RU-1000], which these are not: `0F` cannot be the length its arguments carry. Low |

Frame 323 (EP5) is the model's `init` step byte for byte: `30 21 00 00 20 01 00 00 80 10`,
`18 FC` at bytes 23-24 [LOU-RB3]. Meaning unknown.

## (b) Outputs the MML lists (253 frames)

Off unless a value is given; every address is a row of `crates/dj-controller-model/models/ddj-flx10.json`.

| Frames | Outputs |
|---|---|
| 4-16, 25-35 | PLAY, SHIFT+PLAY, CUE LEDs, decks 1 to 4 (twice) |
| 21, 22 | `BF 46 30`: deck 3 time, minutes = 48; `BF 3E 20`: deck 3 cue point, a lone LSB = 32. rekordbox sends the DDJ-1000 `BF 46 30` at the same point, and its own DDJ-1000 mapping file names BF 46 jog ring brightness [NT-1000]: likely a setting, unverified on the FLX10 |
| 68-70, 77 | CH1 to CH4 SHIFT+CUE LEDs |
| 78, 80, 81, 84, 86-93 | Active part INST, VOCAL, DRUMS on (`7F`), decks 1 to 4 |
| 94-99, 100 | BEAT FX part INST, VOCAL, DRUMS and their SHIFT layer on; SAMPLER CUE off |
| 102-105, 157-160, 202, 203, 205, 243-245 | PLAY, SHIFT+PLAY, CUE, SHIFT+BEAT SYNC LEDs per deck |
| 106-137, 161-180, 185-196, 206-237, 246-248, 253-269, 271-282 | Hot cue pads, pages 1-2, plain and SHIFT, colour `00`, decks 1 to 4 |
| 139, 141-144, 149, 150, 152-155 | Deck 1: 4 BEAT/EXIT (both layers), BEAT SYNC, SHIFT+LOOP OUT off; QUANTIZE, LOOP IN, LOOP OUT on; KEY SYNC (both), SLIP off; SHIFT+SLIP on |
| 181-184 | CH1 to CH4 level meters 0 |
| 197-201, 238-242, 283-287 | Decks 2 to 4: 4 BEAT/EXIT (both layers), KEY SYNC, SLIP off; QUANTIZE on |
| 288-291 | CH1 to CH4 CUE LEDs |
| 294-321 | Deck 1 beat-jump pads, pages 1-2, plain and SHIFT: colours `6A` and `65` |

## (c) Unlisted (44 frames)

| Frames | Messages | What is known |
|---|---|---|
| 1 | `9F 70 00` | rekordbox's first plain message. Nothing found |
| 17, 18, 20 | `9F 40 7F`, `9F 41 00`, `9F 42 7F` | rekordbox sends the DDJ-1000 the same three, with `BF 46 30`, at the same point [NT-1000]; JAN-1000 replays them as "browser startup". Unnamed |
| 23, 24 | `9F 3F 7F`, `BF 0D 00` | FLX10 only; the DDJ-1000 gets its own `BF 41`..`BF 4A` and `9F 45`..`9F 4E` later in the burst [NT-1000]. Settings, guessed |
| 36-67 | `9n 21 20`, `9n 6A 20`, `9n 6E 00`, `9n 75 00/10`, `9n 63 20`, `9n 6C 20`, `9n 74 20`, `9n 76 00`, n = 0..3 | Identical values go to the DDJ-1000 [NT-1000], so rekordbox's own, not the FLX10's. NT-1000 resends `9n 21 20` as if it asked for the panel state again, unverified |
| 101, 156 | `9F 00 00`, `9F 01 00` | NT-1000 sends `9F <deck - 1> 00` when a deck empties and `7F` once a track is loaded: a deck-loaded flag, unverified here |
| 138, 151 | `9F 24 00`, `9F 04 00` | Also sent to the DDJ-1000 at the same points [NT-1000]. Nothing found |
| 292, 293 | `96 63 00`, `96 62 00` | MASTER CUE and SHIFT+MASTER CUE: listed as inputs only, and the firmware lights it itself (flx10-observed.md) |

What each frame is for on screen is tested in [flx10-connect-run.md](flx10-connect-run.md).
