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

/** A connected controller: its session's model and its palette, `closed` and `close`. */
export interface Controller<Model extends string = string> {
  readonly model: Model;
  readonly palette: Palette | undefined;
  readonly closed: Promise<CloseReason>;
  close(): Promise<void>;
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

/** The core's `Shown<M, P>`: pad mode and page where the device has told them, and shift. */
export type Shown<Mode, Page> = { readonly mode: Mode | undefined; readonly page: Page | undefined; readonly shift: boolean };

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
