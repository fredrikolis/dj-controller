<!-- Concern: the SysEx that write the FLX10's Beat FX display, what captures confirm of them, what no unit has been seen to do | Non-concern: the jog displays, the other SysEx (flx10-sysex.md) | IO: none -->
# DDJ-FLX10: writing the Beat FX display

The effects section's display shows the effect name, AUTO/TAP, a BPM, the selected channel and a
parameter (beats or %) [MAN p.92]. The unit draws it. The MML lists no output for it, and the
state reply holds no beat value ([flx10-observed.md](flx10-observed.md)): a host cannot read the
unit's Beat FX state, and its own drifts from it. Captures show the host writing the display
instead. Source short names are in [flx10-sources.md](flx10-sources.md).

**No agent can test on hardware. Nothing below has been seen on a unit's display.** The driver
sends the bytes rekordbox was captured sending; whether this unit draws them is the owner's check.

## The three messages

All open with `F0 00 40 05 00 00 04 01 00` ([flx10-sysex.md](flx10-sysex.md), "Framing") and end
with `F7`.

| Then | Writes | Layout |
|---|---|---|
| `00 0A 00 28 00 26` + 38 bytes | effect name | `00 28` = 40 and `00 26` = 38 count the bytes after each. The 38 bytes carry 33: a `00`, then the name in ASCII, NUL-padded to 32 |
| `00 0B` + 6 bytes | beat or parameter text | the 6 bytes carry 5: the text in ASCII, NUL-padded |
| `00 0C` + 6 bytes + `00 00` | BPM | BPM × 100 as 6 hex digits, the highest first, one a byte: `00 00 02 0E 0E 00` = 0x2EE0 = 120.00 |

Text is one bit stream, least significant bit first, cut into 7-bit bytes: `00 'T' 'R' 'A' 'N' 'S'` is `00 28 49 0A 64 69 14`.

## Confirmed from captures

Confirmed means: the layout reads the captured bytes as the text or number given, no bit left over,
and the encoder (`crates/dj-controller-model/src/beat_fx.rs`) gives those bytes back, as its tests hold.

| Captured | Reads as | Source |
|---|---|---|
| rekordbox to an FLX10 at connect, frames 71, 72, 73 | TRANS, 1, 120.00 | LOU-INIT, in the repo as `crates/dj-controller-core/fixtures/ddj-flx10-rekordbox-connect.json` |
| a 54-byte blob in a Mixxx mapping for the FLX10 | LOW CUT ECHO | LOU-JS l.928 |
| rekordbox to a DDJ-1000 | ENIGMA JET with +4; REVERB with 50%; 140.00, 145.00, 150.00 | NT-1000 (`PRELUDE`, `JOGSCREEN_ENABLE`, l.183-187) |

Each is a real Beat FX name with a parameter the manual lists for it [MAN pp.94-98], or a plausible BPM.

## Unverified

- **Whether the unit draws a host's text at all.** 2026-10-08: TRANS, 1 and 120.00 reached this
  repo's unit inside the `handshake` step, the keepalive following each time, and the unit kept
  answering ([flx10-observed.md](flx10-observed.md)). Nobody looked at the effects display. No
  other value has been sent to any unit by this repo, and none without the keepalive.
- **Whether it needs a rekordbox session.** rekordbox sends `50 00` every 200 ms all session
  ([flx10-sysex.md](flx10-sysex.md)); `connect` sends none. The display may ignore a host that
  sends no keepalive.
- **Who owns the beat field afterwards.** The owner has seen "TRANS 1/4" with no host, so the
  firmware keeps a beat of its own. A BEAT press on the unit may redraw the firmware's value
  over the host's.
- **Which BPM shows.** rekordbox also sends each deck's BPM (`11`..`14`, the same hex digits). The
  display may show `00 0C`'s, or the BPM of the deck its channel selector names.
- **The BPM's last two bytes and the name's leading `00`.** Meaning unknown. The last two are
  `00 00` from rekordbox, which the driver sends, and reported as `00 01` from Serato (Loui1979
  `HID/README-SCREEN.md` l.186, a transcription, not a capture).
- **Characters and lengths beyond the captures.** The longest name captured is 12 characters; the
  message carries 32. The letters captured are those of these names and of FLANGER and DELAY
  (NT-1000, RU-1000 §2); the beat characters captured are `0 1 4 5 + %`. The driver also takes `P ( )` in a name and the other
  digits, `/` and `-` in a beat, which only the manual's names and parameters show [MAN
  pp.94-98]. The model file's `beat-fx-display` lists both sets with these sources. Anything
  else is refused.
- **AUTO/TAP and the channel.** No message is known to set either.
- **How fast it may be written.** rekordbox was captured sending these back to back at connect
  and at track load. No rate is known to be safe or unsafe.

## Safety

- A SysEx sent without its `F7` left a DDJ-400's parser open until a power cycle (MrNorm
  rekordbox-wine, `docs/investigation/THEMES/T05-controller.md` Phase 21b). The driver sends
  each of these as one whole message in one send.
- These are messages rekordbox sends this model at every connect, only their values changed. The worst
  outcome expected is wrong text on the display. If the unit stops responding: USB and DC out, 10 s, back in [LOU-JOG].
- `9F 09 xx` is never sent: on a DDJ-1000, `9F 09 00` resets the USB connection (RU-1000). The
  model file lists no output there, so no typed write can send it.

## What to look for

The driver's `controller.beatFxDisplay` sends each field as one message and nothing at connect;
the demo writes all three whenever its Beat FX changes. With the unit on the demo:

1. Press BEAT ◀ or ▶ on the unit several times. The parameter on its display should be the one
   on the page's twin each time. If the two part, the firmware draws its own beat over the host's.
2. Turn BEAT FX SELECT through its positions. The unit's name should be the twin's at each.
3. Play a deck and move its TEMPO: the unit's BPM should follow the twin's. Then turn BEAT FX CH
   SELECT and note whether the unit's BPM changes with it.
4. If the unit's display never follows the page, it wants the keepalive or ignores a host outside
   rekordbox: the next experiment is the same writes with the keepalive running.

What was seen goes, dated, into [flx10-observed.md](flx10-observed.md) and the model file's
`beat-fx-display` `observed`.
