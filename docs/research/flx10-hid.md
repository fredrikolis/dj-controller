<!-- Concern: what the driver can send the FLX10 over vendor HID and setup MIDI, from which source, and the first hardware experiment | Non-concern: the protocol as decoded (flx10-displays.md) | IO: none -->
# DDJ-FLX10: the driver's HID layer and its first experiment

Source short names are in [flx10-sources.md](flx10-sources.md); the protocol they decode is
[flx10-displays.md](flx10-displays.md).

## What it can send (experimental, 2026-10-08)

Nothing is sent unless asked. `wake`, `handshake` and `keepalive` have been tried on this repo's
unit ([flx10-observed.md](flx10-observed.md), and each step's `observed`); the rest is untried.
The setup steps are data in the model file's `hid` (`crates/dj-controller-model/models/ddj-flx10.json`); the
reports with fields are `crates/dj-controller-core/src/hid.rs`. `dj-controller-cli hid <step>...` sends
each from a terminal; a page sends them through the package's `dj-controller/diagnostics` entry.

To wake the screens on Linux, once: `sudo dj-controller-cli udev --install` (the udev rule for hidraw and
usbfs). Then `dj-controller-cli hid wake handshake keepalive` (keepalive repeats until Ctrl-C).

| Step or report | Via | Bytes | Source |
|---|---|---|---|
| `wake` | WebUSB, usbfs | the 7 ep0 vendor control transfers `40 03` (wValue, wIndex) of [flx10-displays.md](flx10-displays.md) "Gating and setup", once | LOU-RB3, VZ-F |
| `handshake` | Web MIDI | the 9 distinct SysEx of [flx10-sysex.md](flx10-sysex.md), first-seen order | LOU-RB3 order, LOU-INIT bytes |
| `keepalive` | Web MIDI | `F0 00 40 05 00 00 04 01 00 50 00 F7` every 200 ms until stopped | VZ-F, LOU-RB3 |
| `init` | HID | `30 21 00 00 20 01 00 00 80 10`, `00` × 13, `18 FC`, zero-padded | LOU-RB3 frame 132675, LOU-INIT's last frame |
| deck state `xx 27` | HID | deck, `27 B4 80 01`, playhead BE24 at [5..8] in 1/128 s, remaining min [9], s [10], ms LE16 [11..13], whole BPM [13], tenths << 4 [14], `0E` [20], `80` [25], `92` loaded or `80` empty [29], `0D` [30], `02 01 04 03` by deck [31], `E0 01` [32..34] | LOU-RELAY `build_xx27`; LOU-JOG saw `xx 27` render BPM and a playhead |
| display page | HID | `00 3D <1..5> 00 05` | LOU-RELAY `send_xx3d_display_mode`; VZ-F calls it a heartbeat |
| pad label `xx 39` | HID | deck, `39 01 00 03 00 00`, ASCII, `00` | LOU-JOG's one sample (`"HOT CUE"`) |
| waveform test | HID | `xx 37` overview (1186 columns) then `xx 38` detail (150 columns/s), header and columns as [flx10-displays.md](flx10-displays.md) decodes them, a ramp/pulse/rise pattern within `00..B0` | LOU-JOG "DECODED" |

Input reports are logged raw; one whose second byte is `D8` is named an ack [VZ-F].

The 7 ep0 vendor control transfers go over WebUSB, not WebHID, which sends only reports: a
vendor request to the device needs no claimed interface ([flx10-browser.md](flx10-browser.md)
"WebUSB control transfers"). Linux needs the usbfs udev rule; Windows has no WinUSB driver bound
to the device, so the browser cannot open it there and the step fails. On 2026-10-08 the
transfers were what took the screens out of "no audio driver" (flx10-observed.md), against
VZ-F's reading that they only unlock audio.

Contradictions met while encoding: VZ-F's `xx 27` table puts the `0E` and `0D` constants 4
bytes earlier than LOU-RELAY, wants `FF FF` at [32..34] when loaded, and its 2026-05-29 note
reads milliseconds from [7..9]; the driver follows LOU-RELAY, the newer recipe said to render.
The `xx 39` bytes 2 to 6 are undecoded; VZ-F says rekordbox sends three segments with `02 3F`
markers, of which the driver sends only the sampled first.

## First hardware experiment: do the screens wake with SysEx and HID alone?

Run on 2026-10-08 ([flx10-observed.md](flx10-observed.md)): SysEx and HID alone left the screens
on "no audio driver"; `wake` took them out; waveforms showed only after rekordbox's connect MIDI
was replayed. Which of its frames are needed: [flx10-connect-run.md](flx10-connect-run.md), sent
with `dj-controller-cli hid --replay`. The plan as it stood, run from the demo's debug view of the
time (since removed; `dj-controller-cli hid` sends the same steps):

Linux, desktop Chrome, the udev rule from [flx10-browser.md](flx10-browser.md) in place, no
rekordbox or other host software running. One step at a time; note what each jog screen shows
after each, and stop at the first step that changes something.

1. Power-cycle the FLX10: unplug USB and power, wait 10 s, replug [LOU-JOG]. Note what the
   screens show (expected: "no audio driver" or the rekordbox splash).
2. Open the demo with `?view=debug`, click Connect (Web MIDI: the sync and state request the page
   already does, nothing on channel 16 beyond the sync's zeros, nothing HID).
3. Open "experimental: screens over HID", click `handshake (MIDI)`. Look.
4. Click `keepalive every 200 ms (MIDI)` and leave it on. Look for 10 s: does the splash or
   "no audio driver" go away? (LOU-JOG: handshake plus keepalive left the splash, after the
   vendor transfers.)
5. Click "choose HID device", pick the DDJ-FLX10. Look at the log: do input reports arrive
   unasked?
6. Click `init (HID)`. Look at the screens and the log (an `ack`?).
7. Deck 1, loaded, 120.0 BPM, 3:00 remaining, position 0: click "send deck state". Do the
   digits on jog 1 change?
8. Only if 7 drew: display page 1, then the pad label, then the waveform test.
9. If anything stops responding (MIDI included), stop the keepalive and power-cycle before
   anything else.

The terminal equivalent of 3 to 6, with the input reports printed: `dj-controller-cli hid handshake
keepalive init` (keepalive repeats until Ctrl-C). If nothing wakes, the next experiment adds
the vendor transfers from outside the browser (a one-time native step or a udev `RUN`), which
the browser layer cannot send.
