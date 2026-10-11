<!-- Concern: the owner's goal for this repo and its boundary | Non-concern: how any piece is built | IO: none -->
# The goal

A free, open source browser driver for Pioneer DJ controllers, DDJ-FLX10 first: the
device's full functionality in any web page. Every input, at full resolution, comes in as
a typed event; every output the device can show (LEDs, pad colours, meters, the jog
displays) can be sent back.

## A driver, not an application
The driver reports what the hardware does, never what an application should do with it.
A jog wheel is touch and signed rotation ticks, not scratching; a pad is an index and a
velocity, not a hot cue. People build DJ software, samplers, sequencers or DAW surfaces
on top of it, each in its own repo. Nothing application-specific, scalable vector audio
included, lives in the driver or is depended on by it. The one consumer here is `demo/`, a
static page on GitHub Pages that plays two SVA songs through the published package; other
application ideas happen in scratch work or a consumer repo.

## How it reaches the browser
- Controls and LEDs: Web MIDI (with sysex), behind Chrome's permission prompt, on desktop
  and Android.
- Displays and whatever MIDI does not carry: the vendor HID interface over WebHID, desktop
  only. Android Chrome has no WebHID and WebUSB may not claim HID-class interfaces, so on
  Android the driver offers what MIDI carries, including the channel-16 jog display info.
- All Rust: a platform-free protocol core, browser transports over wasm-bindgen/web-sys
  compiled to WebAssembly, and a native CLI over the same core for testing from a terminal.

## Layers, each complete on its own
1. MIDI: every control in, every LED, pad colour and channel-16 jog info out. Needs no
   install anywhere Web MIDI exists, and is the driver's baseline.
2. Displays over HID: an optional capability a page gets where the platform allows it,
   detected at connect time and absent, not faked, where it does not. How the screens are
   unlocked (and on which platforms that needs nothing installed) is open and decided by
   experiment; it changes nothing in layer 1. Displays are only offered where they work
   without installing anything (no WinUSB/Zadig, no vendor driver required); platforms
   that would need one simply do not get them. A one-time step that is not a driver, such
   as a Linux udev rule, is fine, because layer 1 never needs it.

## Learning the undocumented parts
Pioneer's display protocol is not open, but owners may study the hardware they own: capture
rekordbox's USB traffic, and later point a camera at the jog displays to confirm what a
packet draws.

## Hardware as seen from Linux (2026-10-08)
DDJ-FLX10, USB `2b73:0041` (AlphaTheta), bcdDevice 1.13: UAC1 audio (iso out 84 B, in
210 B), class MIDI (bulk 512 B, ALSA `hw:1,0,0`), and a vendor HID (page `0xFFA0`,
interrupt in 64 B / out 128 B, no report IDs, `/dev/hidraw2`, root-only until a udev rule).
