// Concern: the dj-controller wasm package: the core's typed controllers projected into JS with their TypeScript, the diagnostics, the HID experiment | Non-concern: decoding, state, the tree | IO: none
//! js/index.js re-exports what this exports without the `diagnostics` feature, js/diagnostics.js
//! what it exports with it, each loading its own wasm first.

mod connect;
#[cfg(feature = "diagnostics")]
mod events;
mod glue;
#[cfg(feature = "diagnostics")]
mod inspect;
mod js;
mod virtual_unit;

// web-sys binds WebHID and WebUSB only under this cfg, which .cargo/config.toml sets for wasm32 alone.
#[cfg(all(feature = "diagnostics", web_sys_unstable_apis))]
mod hid;
#[cfg(all(feature = "diagnostics", web_sys_unstable_apis))]
mod usb;

/// Each model's tree as JS, generated from the same source as its typed Rust.
mod projection {
    use dj_controller_core as djc;
    use wasm_bindgen::JsValue;

    use crate::glue::{AsJs, Moded, group};

    include!(concat!(env!("OUT_DIR"), "/projection.rs"));
}

use wasm_bindgen::prelude::*;

#[wasm_bindgen(typescript_custom_section)]
const CONTROLS: &str = r#"
/** Every stream and wait takes one: once it aborts, the stream or wait rejects with its reason. */
export type Listen = { readonly signal?: AbortSignal };

/**
 * The core's `Feed<T>`: a stream from its creation on, ending when the controller closes, delivering
 * as its control's type states. One that yields every event holds at most 4096 unread (`MAX_QUEUED`),
 * dropping the oldest past that, counted in `dropped`.
 */
export interface Feed<T> extends AsyncIterable<T> {
  readonly dropped: number;
}

/** Its `signal` cancels the connect, and once connected closes the controller when it aborts. */
export type ConnectOptions = { readonly signal?: AbortSignal };

/** The model's `Colour`: what colour `numbers`, lowest to highest, show, as a source measured it. */
export type PaletteColour = { readonly numbers: readonly [number, number]; readonly name: string; readonly rgb?: string; readonly hue?: number; readonly source: string; readonly verified: boolean };

/** The model's `Palette`: what each colour number shows, where a source measured it; `colour` finds a number's entry, throwing a `refused` ControllerError for a number that is no colour number. */
export interface Palette {
  readonly source: string;
  readonly colours: readonly PaletteColour[];
  colour(number: number): PaletteColour | undefined;
}

/** A connected controller: its session's model and its palette, `closed` and `close`. `connect` asks for MIDI access, waits for the model's ports and opens them; the controller lives until closed, unplugged or its signal aborts, and never reconnects: a new connect after an unplug gives a new controller. */
export interface Controller<Model extends string = string> {
  readonly model: Model;
  readonly palette: Palette | undefined;
  readonly closed: Promise<CloseReason>;
  close(): Promise<void>;
}

/** A gesture's layer beyond SHIFT, pad mode and page, which a virtual controller follows itself: `layer` one of the control's other layer words as its events' `layer` carries them (`long-press`, `vinyl-on`), `""` where left out; `index` the 0-based member a shared control's press names, as a browser press its `deck`. */
export type GestureLayer = { readonly layer?: string; readonly index?: number };

/**
 * A virtual controller's hands: each gesture on a physical control of its own tree arrives as the
 * message the model sends for it, on the layer a device would send: its owner's SHIFT where held,
 * the pad mode and page its pad mode and PAGE presses chose, each pad mode keeping its page. A
 * selector's switch flipped on leaves the position it was at; a button the model file ties to a
 * selector steps it. It does nothing a hand did not: a long press or a jog's vinyl mode is a gesture
 * naming that layer, and it sends no fader start. Every gesture is done when it returns and throws a `refused`
 * ControllerError, with why, for a bank view, another controller's control, a value or layer the
 * control does not take.
 */
export interface VirtualGestures {
  /** Holds a button down until `release`. */
  press(control: Button<unknown>, layer?: GestureLayer): void;
  release(control: Button<unknown>): void;
  /** Holds a pad down at `velocity`, 1 to 127, until `lift`. */
  hit(control: Pad<unknown>, velocity: number): void;
  lift(control: Pad<unknown>): void;
  /** A fader or knob to `value`, a whole 0 to its `max`. */
  move(control: Absolute, value: number): void;
  /** A jog or encoder by `ticks`, signed and whole. */
  turn(control: Relative<unknown>, ticks: number, layer?: GestureLayer): void;
  /** One position of a selector on, or a lone switch on or off. */
  flip(control: Switch, on: boolean): void;
  /** How a hand moves a switch: `selector`, one position of several, flipped on only; `toggle`, flipped alone; undefined for a state the unit reports itself, which `flip` refuses. */
  flips(control: Switch): "selector" | "toggle" | undefined;
  /** Every layer word a gesture on `control` may name. */
  layers(control: Button<unknown> | Relative<unknown>): readonly string[];
}

/** A controller no device is behind, played through `virtual`: everything else as a connected one, its outputs told to nothing but what reads them back. `virtual(model)` resolves to one with every output told its rest state and every control reported where the model file rests it; no Web MIDI is asked for; it lives until closed or its signal aborts. */
export type Virtual<C extends Controller> = C & { readonly virtual: VirtualGestures };

/**
 * The Beat FX display's text, in the shape the unit's SysEx carries it: `name` up to 32 printable
 * ASCII characters, `beat` the beat or parameter text, up to 5, `bpm` from 0 to under 1000, shown to
 * a tenth, undefined for none, `tap` whether that BPM is tapped, AUTO otherwise. The channel is the
 * unit's own: the twin draws it from the Beat FX channel selector. The twin alone shows it; nothing
 * is sent to a device.
 */
export type BeatFxText = { readonly name: string; readonly beat: string; readonly bpm: number | undefined; readonly tap: boolean };

/** A jog display's text the model's MIDI has no output for: `range`, its playing speed adjustment range, up to 6 characters, as `±10%`. */
export type JogText = { readonly range: string };

/** The DDJ-FLX10's displays a host shows text on, by id: the Beat FX display and each deck's jog display. */
export type DdjFlx10Displays = { readonly beatFx: BeatFxText; readonly jog1: JogText; readonly jog2: JogText; readonly jog3: JogText; readonly jog4: JogText };

/** Every display `<dj-controller-twin>` shows a host's text on, by id. */
export type TwinDisplays = DdjFlx10Displays;

/** A selector's positions as its controller groups them: `effect.beatFxSelect`, `effect.beatFxChSelect`. */
export type TwinSelector = { readonly [position: string]: Switch | readonly Switch[] };
/** What a host can label on the twin: a button, a pad, a knob or fader, an encoder or jog, a selector. */
export type TwinLabelled = Button<unknown> | Pad<unknown> | Absolute | Relative<unknown> | TwinSelector;

/**
 * What a host gives `<dj-controller-twin>` to show, as data: the element's own properties.
 *
 * The twin draws a controller's panel, every control moving as the device reports it, each LED and
 * pad colour as the driver last told it, each jog display showing the display outputs it was told.
 * A connected controller's part, held, lights its LED. A virtual controller's parts are its
 * controls: a press holds a button or pad (Enter or Space on a focused one), a drag moves a fader,
 * turns a knob (a double click centres it), a jog's top or side, an encoder (also the wheel); arrow
 * keys step a focused one; a click sets a selector's position; SHIFT latches on a click, and the
 * keyboard's Shift held with any gesture holds the part's SHIFT for it; a button with a `long-press`
 * layer held for 1 s presses that layer too.
 */
export interface TwinHost {
  /** The controller drawn, connected or virtual; null draws nothing. */
  controller: Controller | null;
  /** Settles once it stops following: disconnected, given another controller, the controller closed, or a stream failed, logged and dispatched as an `error` ErrorEvent. */
  readonly running: Promise<void>;
  /**
   * The labels a host shows on controls, in place, by control, declared whole: assign a new map to
   * change any. A text is 1 to 32 characters, none a control character. A key is a bank view
   * (`decks[0].modes.sampler.pages[1].pads[3]`, `decks[0].shifted.cue`), labelling the bank it is,
   * shown only while the device shows that pad mode and page, or a control with no bank per pad
   * mode (`decks[0].cue`, `mixer.channels[2].eq.hi`, `mixer.crossfader`, `decks[0].tempo`), or a
   * selector's group of positions (`effect.beatFxSelect`); a SHIFT bank's label shows while SHIFT
   * is held, the unshifted one where it has none. A label is plain state, as a colour's base: it
   * takes no lease. The map outlives a controller: a key that is no control of the one drawn
   * labels nothing. A pad draws its label in up to two lines, words kept whole, at the largest
   * size that fits; past the smallest, a line is cut and ends in an ellipsis. A button draws it on
   * one line in place of its printed name. A knob, fader or encoder draws it above itself in place
   * of its printed legend, in up to two lines clear of its neighbours (12 characters a line at the
   * smallest size, a longer word broken), a selector in one line; a labelled one is drawn in the accent
   * colour (`--dj-twin-lit`), so the controls a host assigns stand out from the rest. Assigning
   * throws a RangeError, nothing changed, for a text it does not take or a pad with a bank per pad
   * mode and page, which names no one bank.
   */
  labels: ReadonlyMap<TwinLabelled, string>;
  /** The text a host shows on displays, by id, declared whole: assign a new object to change any; a display left out shows none. The Beat FX display draws its name in up to two lines, all 32 characters it carries. Assigning throws a RangeError naming the field that does not fit what its display carries, nothing changed. */
  texts: { readonly [D in keyof TwinDisplays]?: TwinDisplays[D] };
}

/** A time in ms on the controller's clock, the one its MIDI events are stamped on: `performance.now()` in a page. Every event's `time` is one; a lease's steps fall due on it. */
export type Time = number;

/** The core's `Press<I>`: `time` the MIDI event's timeStamp; `released` resolves with the release's, or with the close's time where the controller closes first. */
export type Press<Id> = Id & { readonly time: Time; readonly released: Promise<Time> };
/** The core's `Hit<I>`: `velocity` 1 to 127, `time` and `released` as a `Press`'s. */
export type Hit<Id> = Id & { readonly velocity: number; readonly time: Time; readonly released: Promise<Time> };
/** The core's `SwitchChange`: what a switch reported, `time` as a `Press`'s. */
export type SwitchChange = { readonly on: boolean; readonly time: Time };
/** The core's `Position<I>`: every tick the layers a relative control or view reads reported since connect, summed exactly, so 0 is where it was at connect; and its latest tick, undefined before the first. */
export type Position<Id> = { readonly ticks: number; readonly latest: Tick<Id> | undefined };
/** The core's `Tick<I>`: a relative control's latest tick, the identity it came with and its `time`, the MIDI event's timeStamp. */
export type Tick<Id> = Id & { readonly time: Time };

/** The core's `Pattern<T>`: each step's value shown for its `ms`, a whole number of milliseconds from 1, in order; once through, or over and over where `repeat` is set. A blink is two steps repeating: `{ steps: [[true, 250], [false, 250]], repeat: true }`. A repeating pattern with an `origin` starts at the step it would show had it run since then, so leases sharing an origin stay in phase however apart they start; one run once with an `origin` is refused. */
export type Pattern<T> = { readonly steps: readonly (readonly [value: T, ms: number])[]; readonly repeat?: boolean; readonly origin?: Time };
/** The core's `Lease`: a pattern running on one output until disposed, the controller closes, the signal `play` took aborts, a send fails, or a pattern that does not repeat runs past its last step; `ended` resolves then. Disposing rejects where telling the output what shows next fails to send; a send failing as it runs only ends it, the next write rejecting with it. */
export interface Lease extends AsyncDisposable {
  readonly ended: Promise<void>;
}

/** The core's `Shown<M, P>`: pad mode and page, and shift. The device tells neither mode nor page but by its presses, so `pageAssumed` says where the page is taken, not told: at connect the model file's start bank, and after a pad mode button the page that mode was last seen on, page 1 if never (an ASSUMPTION about the firmware, unobserved on any unit). A pad or PAGE press tells the page and clears it; a wrong one is corrected then. A virtual controller is its own device and assumes none. A write to a control lands on the bank assumed. `mode` and `page` are undefined only after a press that names no bank. */
export type Shown<Mode, Page> = { readonly mode: Mode | undefined; readonly page: Page | undefined; readonly pageAssumed: boolean; readonly shift: boolean };

"#;

#[wasm_bindgen(typescript_custom_section)]
const MODELS: &str = include_str!(concat!(env!("OUT_DIR"), "/models.d.ts"));

#[cfg(feature = "diagnostics")]
#[wasm_bindgen(typescript_custom_section)]
const DIAGNOSTICS: &str = r#"
/** One message from the controller; `channel` is 0-based, `bytes` as received, `time` the event's timeStamp in ms. `controls` are the control events it completed: none while it holds half a 14-bit pair. */
export type DeckEvent = { bytes: Uint8Array; time: number; controls: ControlEvent[] } & (
  | { type: "noteOff" | "noteOn"; channel: number; note: number; velocity: number }
  | { type: "polyPressure"; channel: number; note: number; pressure: number }
  | { type: "controlChange"; channel: number; control: number; value: number }
  | { type: "programChange"; channel: number; program: number }
  | { type: "channelPressure"; channel: number; pressure: number }
  | { type: "pitchBend"; channel: number; value: number }
  | { type: "sysex"; body: Uint8Array }
  | { type: "system"; status: number; data: Uint8Array }
  | { type: "malformed"; error: string }
);

/** A control as its model file names it: `control`, its path (`deck1.jog.platter`), `layer` (`""`, `"shift"`, `"hot-cue page-1"` …), `source`, where the official list documents it, `bytes`, the message or messages it came from, and `text`, all of it as one line. An absolute `value` has the control's `bits`; `msb` or `lsb` alone is a 14-bit half that arrived without its partner. */
export type ControlEvent =
  | ({ control: string; layer: string; source: string; bytes: Uint8Array; text: string } & (
      | { kind: "button"; pressed: boolean }
      | { kind: "switch"; on: boolean }
      | { kind: "absolute"; bits: 7 | 14; value: number }
      | { kind: "absolute"; bits: 14; msb: number }
      | { kind: "absolute"; bits: 14; lsb: number }
      | { kind: "relative"; step: number }
      | { kind: "pad"; velocity: number }
    ))
  | { kind: "unmapped"; text: string };

/** One output by its model file's name (`layer` defaults to `""`), as raw as the device takes it. */
export type Output = { control: string; layer?: string } & (
  | { kind: "led"; on: boolean }
  | { kind: "colour"; colour: number }
  | { kind: "value"; value: number }
);

/** The core's `Turn<I>`: one report of a relative control, `ticks` signed, as the device counts them. */
export type Turn<Id> = Id & { readonly ticks: number };

/** One telling of an output: `seq` orders tellings, `at` is `performance.now()` when sent or scheduled, `via` which way. What the device was told, not what it shows. */
export type Told = Output & { layer: string; seq: number; at: number; via: "show" | "send" | "sync" | "lease" };

export type SyncReport = { outputs: number; gapMs: number; spanMs: number };

/** An output the controller takes, unlit or at 0, with where it is documented and what was seen of it. */
export type OutputInfo = Output & { layer: string; name: string; source: string; range?: [number, number]; values?: number[]; firmware?: string; observed?: string };
"#;
