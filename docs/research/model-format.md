<!-- Concern: why a model is a small JSON file of its own, which standards were weighed and why each falls short | Non-concern: any one model's numbers (crates/dj-controller-model/models/) | IO: none -->
# The model format

Researched 2026-10-08. Each controller model is one JSON file in `crates/dj-controller-model/models/`, embedded at build time; the core holds no model-specific code. Why no standard was adopted, and the file.

## Standards weighed

A model file must say, per message: which physical control sends it, what kind of input it is
(button, switch position, 7- or 14-bit absolute, relative around a centre, pad velocity), how a
14-bit value splits over two CCs, what the device takes back (LED, colour number, value range),
and where the official list documents it.

| Candidate | What it describes | Why it does not fit |
|---|---|---|
| MMA MIDI Name Document (MIDNAM) [MIDNAM] | Patch banks, note names, and per-channel `ControlNameList`s whose `Control` has `Type` 7bit, 14bit, RPN or NRPN, a number and a name | Names what a synth receives. No input kinds (button, relative, switch), no Note On as a control, no output or LED, no layers, no citation field. XML. |
| MIDI-CI Property Exchange `ChCtrlList` (M2-117) [PE-SCHEMA] | A device's controllers as JSON: `title`, `ctrlType` (cc, chPress, pPress, nrpn, rpn, pBend, per-note kinds), `ctrlIndex`, `channel`, `numSigBits`, `paramPath`, `typeHint` (continuous, momentary, toggle, relative, valueSelect), `minMax` | Closest in spirit, and its vocabulary informs ours. But it has no Note On, so no buttons or pads; `relative` means MIDI 2.0 relative controllers, not a MIDI 1.0 CC around 0x40; values are 32-bit, with no MSB/LSB CC pair; it lists what the device recognizes, not what it sends; and a device serves it over MIDI-CI, which no DDJ does. |
| MIDI 2.0 Profiles [PROFILES] | Agreed behaviours a device switches on: Default Control Change Mapping (M2-113), GM, MPE, Drawbar Organ, Rotary Speaker, Orchestral Articulation (M2-123) | A profile fixes what controllers mean, the opposite of naming a given surface. None covers DJ controllers. |
| pencilresearch/midi (CC-BY-SA-4.0) [PENCIL] | A CSV per synth: `section`, `parameter_name`, `cc_msb`, `cc_lsb`, min/max, `orientation` (0-based or centred), NRPN | Has the 14-bit pair and the centre, but only CCs a synth receives: no notes, no feedback outputs, no layers. |
| Mixxx controller XML | Maps controls to Mixxx functions | Application semantics; out of scope by the driver's goal. |

None names a physical control with its kind, layer, feedback and citation, so the model file is
the smallest self-describing format that does, borrowing `ChCtrlList`'s ideas in plain words.

## The file

```json
{
  "model": "DDJ-FLX10",
  "usb": {"vendor": "2b73", "product": "0041", "source": "where these come from", "out-endpoints": {"03": "midi", "05": "hid"}},
  "hardware": "what has been checked on a real unit, or unverified",
  "sources": {"MML": "the official list the rows cite"},
  "state-request": {"bytes": "F0 00 40 05 00 00 04 01 00 03 01 F7", "source": "…", "observed": "…"},
  "controls": [
    {"control": "deck1.play-pause", "layer": "shift", "in": "button", "out": "led", "midi": "90 47", "source": "MML p.2 D1"},
    {"control": "mixer.channel1.fader", "in": "absolute", "midi": "B0 13", "lsb": "B0 33", "source": "MML p.2 M2"},
    {"control": "deck1.jog.side", "in": "relative", "centre": 64, "midi": "B0 21", "source": "MML p.2 D3"},
    {"control": "deck1.display.bpm", "out": "value", "midi": "BF 14", "lsb": "BF 34", "range": [0, 9999], "source": "MML p.7 BPM", "observed": "…", "shows": {"divide": 10, "decimals": 2}}
  ]
}
```

- `control`: a dotted path by physical identity: `deck1.…`, `mixer.channel3.…`, `browser.…`.
- `layer`: which of a control's messages this is, as the device tells them apart by address
  (`shift`, `long-press`, a pad mode and page). Empty for the plain one.
- `in`: `button`, `switch`, `absolute`, `relative` (`centre`) or `pad`; `out`: `led`, `colour`, `value` (`range`, `values`).
- `midi`: status and data 1 in hex, as the official lists print them. `lsb`: the CC carrying
  a 14-bit value's low 7 bits; `midi` then carries the high 7.
- `source` cites the list by page and figure, and says how a list error was read.
  `observed` records what a unit did, by date. `"listed": false` marks an address the list
  does not show, which `source` explains. `firmware` marks a control whose LED a unit was seen to
  light itself, by date: where the list gives it an output, the driver keeps what it sends there
  in its history but claims no state for it, since what was told need not be what shows.
- `state-request`, optional: one whole MIDI message, in hex, that makes the device report every
  control's position as ordinary input, with `source` and `observed`: the only raw MIDI a file holds.
- `start-bank`, optional: the `layer` (pad mode and page) owners show at a session's start, for a device that reports none; `source`, `observed`.
- `hid`, optional: the vendor HID interface (`usage-page`, `input`/`output` sizes) and named
  setup `steps`, sent only when asked: `via` `midi` (whole MIDI messages), `hid` (reports,
  zero-padded) or `control` (USB control transfers OUT, no data stage, written `bmRequestType
  bRequest wValue wIndex`, e.g. `40 03 0100 C028`, never repeated); `every-ms`, `observed`.
- `palette`, optional: `source`, `colours`: `number` or `numbers` `[from, to]` (each once), `name`, `rgb`/`hue` where known, `source`, `verified`.
- `usb.out-endpoints`, optional: each OUT endpoint (hex) as `midi` or `hid`, to replay captures.
- `shows`, on a `value` output whose `observed` cites it: how a unit showed it, `value / divide + add` with `decimals` and `unit`; the output's method takes the shown number, raw sends stay raw. Else `labels`, one per value of `range` from its low end: what each stands for as `source` states it (a key name); writes stay raw.
- `selects` `{bank, source}`, on a button: the pad mode, and page where given, a press of the row shows; with no page, a changed mode's page is unknown and a kept mode keeps its page.
- `revolution` `{ticks, laps: [least, most]}` and `least-step` (fewest ticks a report carried), on a `relative` input whose `observed` cites them.

The core checks every file at test time: well formed, no two controls sharing a name or an
address, and every row of the official list (`<model>.mml`, cut from the PDF by
`scripts/mml-extract.py rows`) decoding to a named control or round-tripping as an output. How
paths and layers become the object tree a page uses is [model-surface.md](model-surface.md).

## Adding a model

Model files are embedded at build time, never loaded at run time; adding one takes no code:

1. Fetch its official "List of MIDI messages" PDF.
2. `scripts/mml-extract.py rows LIST.pdf > crates/dj-controller-model/models/<model>.mml`.
3. `scripts/mml-extract.py draft LIST.pdf <MODEL> > crates/dj-controller-model/models/<model>.json`, then
   review it against the PDF: the draft guesses each control's path and layer from the labels
   nearest each row. Fill in the USB ids and their source.
4. `cargo test -p dj-controller-core` checks the file against the list; `scripts/mml_extract_test.py` checks
   the script on excerpts of both page layouts seen so far (DDJ-FLX10, DDJ-FLX4).

## Sources

- **MIDNAM**: MMA, MIDI Name Document DTD 1.0, as Ardour ships it:
  https://raw.githubusercontent.com/Ardour/ardour/master/share/patchfiles/MIDINameDocument10.dtd
- **PE-SCHEMA**: MMA, M2-117-S ChCtrlList JSON schema, and its resource overview:
  https://schema.midi.org/property-exchange/M2-117-S_v1-0_ChCtrlList.json, https://midi.org/midi-ci-property-exchange-controller-resources
- **PROFILES**: MIDI Association, adopted profiles: https://midi.org/profiles
- **PENCIL**: https://github.com/pencilresearch/midi
