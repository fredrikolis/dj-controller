<!-- Concern: the FLX10's USB interfaces and how host software drives its jog displays over vendor HID | Non-concern: the SysEx, what a browser may open | IO: none -->
# DDJ-FLX10: USB interfaces, jog displays and HID

Source short names are in [flx10-sources.md](flx10-sources.md).

## USB interface map (community)

From VZ-F "USB device layout" and VZ-S "Interface map"; endpoints also from LOU-RELAY
constants and LOU-JOG.

| Iface | Class | Endpoints | Role |
|---|---|---|---|
| 0 | Audio Control | ep0 | clock / sample rate |
| 1 | Audio Streaming OUT | EP1 OUT iso | **4 ch S24_3LE @ 44.1 kHz** [VZ-F] |
| 2 | Audio Streaming IN | EP1 IN iso | **10 ch S24_3LE @ 44.1 kHz** [VZ-F] |
| 3 | Vendor | (small bulk, "unused") | unknown |
| 4 | USB-MIDI | EP2 IN bulk (0x82), EP3 OUT bulk (0x03) | all MML traffic, plain USB-MIDI 4-byte event packets |
| 5 | HID, usage page 0xFFA0, no report IDs | EP4 IN int 64 B (0x84), EP5 OUT int 128 B (0x05), bInterval 4 | jog screens |

vision.md's iso sizes agree: OUT 84 B = 7 frames × 4 ch × 3 B, IN 210 B = 7 × 10 × 3 B
(arithmetic, high speed). vision.md says UAC1, VZ-F says UAC2; check with `lsusb -v`
**[unverified]**.

## How the jog displays are driven

**Not a framebuffer.** The firmware renders the deck UI (rings, digits, waveform, labels);
the host feeds it structured data in three layers [VZ-S "Display protocol: three layers";
VZ-F; LOU-JOG]:

1. **MIDI channel 16 scalars** (BPM, time, marker, key, sync; `crates/dj-controller-model/models/ddj-flx10.json`).
   Documented in the MML; no handshake.
2. **Vendor HID OUT reports** (EP5, 128 B; byte0 = deck `0x10/0x20/0x30/0x40` or `0x00`
   global, byte1 = command):

   | Cmd | From | Meaning (community decode) | Source |
   |---|---|---|---|
   | `21` | rekordbox, continuous (~50 Hz) | per-deck display state | LOU-JOG, VZ-F |
   | `37` | rekordbox at track load, 30 packets | overview waveform: 3-byte columns `[HIGH, LOW, MID]`, ~1186 columns | LOU-JOG "DECODED" |
   | `38` | rekordbox at track load, ~609 packets | full waveform at **150 columns/s of audio**, 3 B per column; uploaded once, the firmware scrolls it from the playhead | LOU-JOG |
   | `2C`/`2E` | rekordbox (older capture) | overview / PWV5 colour waveform (2 B LE per entry; Pioneer's ANLZ PWV5, https://djl-analysis.deepsymmetry.org/rekordbox-export-analysis/anlz.html) | VZ-F |
   | `27` | Serato, continuous | per-deck state: playhead BE24 at 128 units/s, time, BPM; sub-second field ms 0–999 | VZ-F banner, VZ-R |
   | `36` | Serato | PWV5 waveform trickle, 19 entries per packet, LE32 position | VZ-F |
   | `30`, `2F`, `35`, `39`, `3B`, `3D`, `2D`, `2B`, `3E` | both | track length, beat grid/cues, counts, **ASCII pad-mode labels** ("HOT CUE"), display-mode select `00 3D <mode>`, heartbeat | VZ-F, LOU-JOG, LOU-RELAY `send_xx3d_display_mode` |
   | `33` | rekordbox/Serato | "JPEG-wrapped album-art-sized image" (artwork) **[unverified]** | VZ-F "Other commands" |
   | `D0`/`D1`/`D7` | Setting Utility "Image Transfer Tool" | upload / commit / delete the **DJ Logo**: JPEG, reportedly **240×240, greyscale**, ~600–1,100 B, slot byte 1/2 | VZ-S "Layer 2", VZ-F |
   | `D8` (EP4 IN) | device | ACK | VZ-F |

   EP4 IN: LOU-RB3 reports **30-byte** reports at high rate (113k packets) that look like
   live jog/analog state; VZ-F reports `D8` ACKs. Not decoded **[unverified]**.
3. **Gating and setup**, best-known working recipe [LOU-JOG "What already works", 2026-09]:
   (a) 7 vendor control transfers on ep0, `bmRequestType 0x40, bRequest 0x03, wLength 0`,
   (wValue, wIndex) = (0100,C028) (0000,C029) (0200,C013) (0000,C02B) (0100,C026)
   (0000,C01D) (0100,C027), byte-for-byte as rekordbox [LOU-RB3; VZ-F "Vendor unlock"],
   **kernel drivers still bound**; (b) the rekordbox SysEx handshake and `00 50 00`
   keepalive over ALSA MIDI ([flx10-sysex.md](flx10-sysex.md)); (c) hidraw writes with a
   `0x00` report-ID prefix (129 B for a 128 B report). The `xx27` digits then render live;
   `37/38` waveform paint is decoded but "Paint+scroll still UNVERIFIED on hardware".

Contradictions:
- VZ-F calls the 7 transfers an "audio unlock" that does not unlock the screen; Loui's
  `flx10_modeswitch.py` calls them the "MIDI→HID mode switch"
  (https://github.com/Loui1979/MIXXX-FLX10/blob/main/HID/flx10_modeswitch.py). LOU-HID: the
  mode "does not survive a kernel-driver rebind", so its relay daemon owns the device via libusb.
- VZ-S describes an audio-class "state gate" (SET_CUR 44.1 kHz plus alt-setting toggles)
  before Setting Utility uploads; later notes render without it.
- The controller "wedges" after repeated claim/unlock cycling and needs a full power cycle
  (unplug USB and power ~10 s) [LOU-JOG]. Never hammer ep0; keep the MIDI path independent
  so a display failure never breaks control or audio [LOU-HID; Mixar issue].

## What the user sees

MAN pp.33–48 "On Jog Display": four modes, cycled with SHIFT plus a button. rekordbox: Deck
Info, Waveform (zoomed, two decks), Artwork, DJ Logo. Serato: Virtual Deck, Waveform,
Artwork, DJ Logo. The DJ Logo is set with the Setting Utility's "DDJ-FLX10 Image Transfer
Tool" (bmp/jpeg/png/gif; MAN "Setting the image for DJ Logo", p.163). 3-band waveforms are
rekordbox-only per retailers
(https://www.boullard.ch/en/product/dj/dj-controllers/200214-pioneer-ddj-flx10/).
**Panel resolution and size are not published**; 240×240 is the community-observed logo
size [VZ-S], and nothing confirms the native pixel count **[unverified]**.

So the host pushes **data**, not bitmaps: waveform columns (3 bands, 150 columns/s), state
digits, ASCII labels, and two JPEG paths (artwork `33`, DJ logo `D0/D1/D7`). The JPEG slots
are the only arbitrary-image routes, and the logo route may be too slow or flash-backed for
animation **[unverified]**.

What the driver sends from all this, and the first hardware experiment: [flx10-hid.md](flx10-hid.md).
