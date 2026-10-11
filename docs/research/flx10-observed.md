<!-- Concern: what this repo's FLX10 unit actually sent and did, by date, settling what the official list leaves open | Non-concern: the map itself (models/ddj-flx10.json) | IO: none -->
# DDJ-FLX10: observed on hardware

Unit: USB `2b73:0041`, bcdDevice 1.13, Linux ALSA rawmidi `/dev/snd/midiC1D0`, read with
`dj-controller-cli` (crates/dj-controller-cli). No sysex handshake or keepalive was sent before any of this.

## 2026-10-08, input session (9,935 messages, owner moving controls)
- Every message decoded to a named control; none was unmapped.
- 14-bit pairs arrive MSB then LSB, always adjacent: CH1 and CH3 faders, CH1 EQ HI,
  crossfader. No lone half was seen.
- Range is the full 0..16383: CH1 fader, EQ HI and crossfader reached 16383; EQ HI and the
  crossfader reached 0. EQ HI rested at 8142 before it was moved.
- Mixer order on the panel is CH3, CH1, CH2, CH4 left to right.

Deck 1 controls; jog, SHIFT and PLAY are on MIDI ch1, the pads on ch8.
- Jog touch: note 0x36, 0x7F touched, 0x00 released.
- Jog platter (CC 0x22): relative around 0x40, -6..+6 per message in this session.
- Jog wheel side (CC 0x21): +1..+9 per message in this session.
- Those ranges are what one session showed, not measured limits. A rough turn by the side summed
  +13,334, a messy platter turn +25,772: not revolutions, measured since ([flx10-observed-jog.md](flx10-observed-jog.md)).
- SHIFT + PLAY: SHIFT on (note 0x3F), PLAY+SHIFT on (note 0x47), then both off. PLAY alone is
  note 0x0B.
- Pads in the mode the unit started in: deck 1 on ch8 (status 0x97), notes 0x00..0x07 for pads 1..8,
  velocity always 0x7F on press, 0x00 on release.

## 2026-10-08, first output
- `90 0B 7F` sent with no handshake or keepalive: deck 1 PLAY lit (owner saw it).
  `90 0B 00` turned it off. Plain MIDI LED output needs no sysex.

## 2026-10-08, audio output
- The unit is USB Audio Class 2 (bInterfaceProtocol 0x20): playback 4 ch, capture 10 ch,
  S24_3LE, 44.1 kHz only (`/proc/asound/card1/stream0`).
- A 440 Hz tone at -26 dBFS on channels 1-2, played with `aplay -D hw:1,0` through the stock
  Linux `snd-usb-audio` driver, was heard on the master output (owner). No vendor control
  transfers, sysex or Pioneer driver were used, while the jog screens showed "no audio
  driver". Channels 3-4 (headphones) are not confirmed yet.

## 2026-10-08, LEDs the firmware drives (owner, no host software; preliminary)
A quick look, not a sweep: a full pass over every FLX10 function is planned and supersedes it.
- At rest nothing is lit, and pressing ordinary buttons (PLAY, CUE, SHIFT, pads, SYNC) lights
  nothing: those LEDs follow only what the host sends.
- Changing pad mode, and the BEAT FX part select, does change LEDs on its own: the firmware
  lights the selected mode/part and turns the others off. Exactly which LEDs, and whether a
  host message overrides them, is not observed yet.
- MASTER CUE lights by itself when pressed. The mixer channels' CUE buttons and each deck's
  round CUE button do not.

## 2026-10-08, state request
- Sending `F0 00 40 05 00 00 04 01 00 03 01 F7` once (with `amidi`, no other sysex, no
  keepalive) made the unit answer within 4 s with ordinary MIDI messages giving the
  current position of every fader, knob and switch, untouched: per deck tempo, trim, EQ,
  filter, channel faders, crossfader, switches as notes, all 14-bit pairs MSB then LSB.
  So it is a state request, as Mixxx's DDJ-400 script calls the same opcode.
- The reply, as `amidi -d` printed it, is `crates/dj-controller-core/fixtures/ddj-flx10-state-2026-10-08.hex`:
  104 messages (an earlier count said 103: the file opens with a blank line and ends without a
  newline). A core test decodes it: 58 named controls, 33 of them whole 14-bit pairs, no
  lone half. A multi-position selector sends only its current position, as `7F`; a
  two-way switch (LINE/PHONO, deck select) sends `00` or `7F`.
- 13 messages name addresses in neither the MML (E1) nor the community Mixxx maps (Veezuhz,
  Loui1979, marco-zis): `9n 3A 00` and `9n 3B 00` for n = 0..3, `94 46 00`, `94 60 00`, the CC
  pair `B4 50 09` / `B4 70 30`, and `92 4E 7F`. They stay unmapped until a unit shows what
  moves them. Unverified guess: the pair reads 1200, perhaps the Beat FX tempo of 120.0 BPM.
- Not in the reply: MASTER LEVEL, BOOTH LEVEL, HEADPHONES LEVEL and MIX, the SHIFT layer
  of each TEMPO (SHIFT was not held), the MIC OFF/ON/TALKOVER switch, and the fader-start notes.
- Sent again with `dj-controller-cli --state` (crates/dj-controller-cli), nothing else written: 104 messages again,
  the same 13 unmapped, every pair whole. The order differs: deck 1's TEMPO pair came last
  instead of deck 2's. BEAT FX select now reported TRANS (`94 25`), the knob having moved.

## 2026-10-08, channel-16 jog display output
- The test page's channel-16 demo (120.0 BPM, ring on, running clock, rotating marker),
  sent over Web MIDI with no sysex handshake or keepalive, lit the jog ring (owner). The jog
  screens kept showing "no audio driver"; none of the BPM, time or marker values appeared.

## 2026-10-08, screens leave "no audio driver"
- Handshake + 30 s keepalive over MIDI alone left the screens on "no audio driver".
- The 7 vendor control transfers `40 03` listed in flx10-displays.md ("Gating and setup", from
  the LOU-RB3 rekordbox capture), sent through usbfs, then the same handshake and keepalive,
  took both screens out of it: the left showed a rekordbox loading spinner, the right a Pioneer
  DJ one, and both then read 120.00, -100% and 00:00 (owner). So the vendor transfers are what
  clear "no audio driver"; the screens' own content is still to be driven.
- After that, with no keepalive running, plain channel-16 MIDI drew on deck 1's screen (owner):
  BPM `BF 14 0A` / `BF 34 00` (1280) showed 128.00; time minutes `BF 42 03` and seconds
  `BF 43 19` showed 03:25; playing speed `BF 18 07` / `BF 38 68` (1000) showed 0.00%, and the
  unset value showed -100%. So percent = value / 10 - 100, and BPM's 0..9999 is tenths. The
  screens kept this state after the keepalive stopped.
- Waveforms: with the screens awake (vendor transfers earlier, no power cycle since), the page's
  HID init, deck state and waveform test reports (WebHID, report id 0) drew nothing and no HID
  input report ever arrived. Then LOU-INIT's 323 MIDI frames (rekordbox's connect traffic,
  Loui1979, Unlicense) were replayed over ALSA rawmidi and the keepalive started: waveforms then
  showed on the jog screens (owner). Which are needed: [flx10-connect-run.md](flx10-connect-run.md).
