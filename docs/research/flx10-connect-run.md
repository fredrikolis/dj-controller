<!-- Concern: the smallest part of rekordbox's connect traffic believed to make the FLX10 draw waveforms, and the runs that test it | Non-concern: what each frame is (flx10-connect.md) | IO: none -->
# DDJ-FLX10: which connect frames the waveforms need

Frames, groups and sources: [flx10-connect.md](flx10-connect.md). Nothing here has been sent yet.

## What the observations narrow it to

On 2026-10-08 (flx10-observed.md), after `wake`, the `handshake` step (each of the 9 distinct
SysEx once, first-seen order) and the keepalive, the HID init, deck state and waveform test drew
nothing. Replaying LOU-INIT's 323 MIDI frames (not frame 323, the HID one) and the keepalive then
showed waveforms. The SysEx are the same set in both, so what made the difference is in what
the replay adds: the SysEx repeats and their order, or the plain messages.

## The set believed necessary: 71 frames

- All 26 SysEx, in capture order with their repeats: the once-each handshake was not enough,
  and order and repeats are where the two differ.
- The 42 unlisted frames other than MASTER CUE (1, 17, 18, 20, 23, 24, 36-67, 101, 138, 151, 156):
  their meaning is unknown, they come from the settings rekordbox writes, and nothing rules them out.
- Frames 21 and 22 (`BF 46 30`, `BF 3E 20`): listed as deck 3 display values, but sent within
  those settings, as rekordbox sends `BF 46 30` to a DDJ-1000 as jog ring brightness [NT-1000].
- Frame 323, the HID report rekordbox ends with (the model's `init` step).

Left out:
- The other 251 listed outputs: LEDs, pad colours and meters set mostly to off, the state the
  driver's sync sends anyway; on 2026-10-08 plain LED and channel-16 output changed nothing
  about what mode the screens were in.
- MASTER CUE (292, 293): the firmware lights it itself.

## Runs

Each run: power-cycle the FLX10 (USB and power out, 10 s) [LOU-JOG], then one command, leaving
it running. Look at both jog screens for 10 s. If nothing shows, send the page's waveform test
(deck 1) as on 2026-10-08 and look again. `F` is `crates/dj-controller-core/fixtures/ddj-flx10-rekordbox-connect.json`.
Before a run, `dj-controller-cli capture DDJ-FLX10 F --only <frames>` lists what it will send.

1. Confirmation, the set above:
   `dj-controller-cli hid wake --replay F --only sysex,1,17-24,36-67,101,138,151,156,hid keepalive`

If waveforms show, tighten, one hypothesis per run, to send no more than needed:

2. SysEx order alone: `dj-controller-cli hid wake --replay F --only sysex,hid keepalive`.
3. If 2 shows nothing, the settings without the per-deck notes:
   `dj-controller-cli hid wake --replay F --only sysex,1,17-24,101,138,151,156,hid keepalive`.
4. If 2 shows waveforms, the SysEx up to the per-deck ones, without the later repeats:
   `dj-controller-cli hid wake --replay F --only 0,2,3,19,71-76,79,82,83,85,hid keepalive`.

Each answer removes a named part; continue the same way until every frame left is one whose
removal stops the waveforms.

## If the confirmation fails

5. Control, the whole capture: `dj-controller-cli hid wake --replay F keepalive`.
6. If 5 also fails, the 2026-10-08 success leaned on what came before the replay. Repeat that
   order: `dj-controller-cli hid wake handshake keepalive`, the page's init, deck state and waveform test,
   Ctrl-C, then `dj-controller-cli hid --replay F keepalive`.
7. If 5 shows waveforms, something left out matters: add half of the outputs at a time,
   `dj-controller-cli hid wake --replay F --only sysex,unlisted,hid,0-160 keepalive`, then `161-322`,
   halving the half that works (about 8 runs for 251 frames).
