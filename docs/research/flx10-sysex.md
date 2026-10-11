<!-- Concern: the SysEx host software sends the FLX10, and whether the device needs it | Non-concern: the MIDI map (crates/dj-controller-model/models/ddj-flx10.json), the HID display protocol | IO: none -->
# DDJ-FLX10: SysEx and handshake

The MML documents **no SysEx**. Everything here comes from community USB captures; source
short names are in [flx10-sources.md](flx10-sources.md).

## Framing

`F0 00 40 05 00 00 <model> 00 <op> <args…> F7`. `00 40 05` is AlphaTheta/Pioneer DJ [VZ-F,
"MIDI SysEx — three flavors"]. Model bytes: `04 01` FLX10 [VZ-F], `04 05` FLX4, `02 06`
DDJ-400 (Mixxx upstream:
https://github.com/mixxxdj/mixxx/blob/main/res/controllers/Pioneer-DDJ-FLX4-script.js l.175,
https://github.com/mixxxdj/mixxx/blob/main/res/controllers/Pioneer-DDJ-400-script.js l.202).

## Messages seen (FLX10)

| Message | Who sends it | Meaning (claimed) | Source |
|---|---|---|---|
| `F0 00 40 05 00 00 04 01 00 50 00 F7` | rekordbox, every ~200 ms all session | keepalive / "host present" | VZ-F table; LOU-RB3 (281 times in one capture) |
| `F0 00 40 05 00 00 04 01 00 50 31 F7` | Serato, every ~250 ms | Serato-flavour keepalive | VZ-F |
| `F0 00 40 05 00 00 04 01 00 03 01 F7` | VirtualDJ and Serato once; LOU-RB3 also sees rekordbox send it twice | On the DDJ-400 the same opcode is commented "query the controller for current control positions on startup" (Mixxx DDJ-400 script l.201–202). LOU-JS calls it `_SYSEX_ENTER_HID`. Observed 2026-10-08: sent alone, it made this unit report every control's position ([flx10-observed.md](flx10-observed.md)); whether it also does anything for HID is unverified | VZ-F, LOU-RB3, LOU-JS l.907 |
| `F0 00 40 05 00 00 04 01 00 00 0B 31 00 00 00 00 00 F7` | rekordbox and Serato, at connect and track load | "init/config A" | LOU-RB3, VZ-F; bytes as LOU-INIT holds them |
| `F0 00 40 05 00 00 04 01 00 00 0C 00 00 02 0E 0E 00 00 00 F7` (variants) | rekordbox and Serato, at connect and track load | "init/config B" | LOU-RB3, VZ-R; bytes as LOU-INIT |
| `F0 00 40 05 00 00 04 01 00 00 0A 00 28 00 26 00 28 49 0A 64 69 14`, 31 × `00`, `F7` (54 bytes) | rekordbox | "display/state blob" | LOU-RB3, LOU-JS l.928; bytes as LOU-INIT |
| `F0 00 40 05 00 00 04 01 00 1x 0F 0F 0F 0F 0F 0F F7`, x = 1..4 | rekordbox (Serato: `… 00 1x 00 00 02 0E 0E 05`) | per-deck init | LOU-RB3, VZ-R |
| `F0 00 20 7F 01 02 01 01 22 0F 0C …` | Serato once | Serato app identification | VZ-F |

An earlier copy of this table dropped the `00` before `0B`, `0C` and `0A` in the three rows
above; LOU-INIT's USB-MIDI packets and LOU-RB3's hex both carry it. The model file's `hid`
steps send these in LOU-RB3's first-seen order (`crates/dj-controller-model/models/ddj-flx10.json`).
Every one of them in rekordbox's connect traffic, against what rekordbox sends a DDJ-1000:
[flx10-connect.md](flx10-connect.md).

## Does the device need it?

- **Not for plain MIDI.** Veezuhz's "most stable" non-HID Mixxx mapping sends no SysEx
  (https://github.com/Veezuhz/Mixxx_FLX10_Controller_Mapping/tree/main/NON-HID%20FLX10%20Controller%20(working)(most%20stable),
  `grep sysex` finds nothing). VZ-S: the channel-16 display CCs "work without any special
  session — just open the MIDI device and send".
- **For the jog screens, yes:** the SysEx plus keepalive moves them out of the rekordbox
  splash into "live HID display mode" [LOU-JOG, "What already works"].
- The Mixxx FLX4 mapping sends its `50 02` keepalive every 200 ms; "the query seems to
  double as a keep alive message" (Mixxx FLX4 script l.315–318). The FLX10 may behave the
  same **[unverified]**.
- Worth testing on hardware: whether the `00 50 00` keepalive changes anything over plain
  MIDI. The `00 03 01` query is settled: it is the model file's `state-request`.

## "No audio driver" on the jog displays

On Linux without Pioneer's driver, the jog displays reportedly show a "no audio driver"
message until the vendor control transfers ([flx10-displays.md](flx10-displays.md)) are
sent (https://github.com/Loui1979/MIXXX-FLX10/blob/main/CREDITS.md). VirtualDJ users report
the same message on Windows when the driver is missing
(https://virtualdj.com/forums/255066/German_Forum/Pioneer_DDJ_FLX10_-_Jogwheels_Display.html)
**[unverified on this unit]**.
