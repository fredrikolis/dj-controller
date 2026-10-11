// Concern: the main entry's public types: connect, palette, and every controller type, each model's among them | Non-concern: the diagnostics entry | IO: none
import type { ConnectOptions, Controllers, ModelName, Palettes } from './dj_controller.js'

export type * from './dj_controller.js'

export type {
  Absolute,
  Button,
  CloseReason,
  ColourOut,
  ColourPad,
  ConnectOptions,
  Controller,
  ControllerError,
  Controllers,
  Feed,
  Hit,
  Lease,
  LedButton,
  LedOut,
  Listen,
  ModelName,
  Moded,
  Pad,
  Palette,
  Palettes,
  Pattern,
  Play,
  PaletteColour,
  Position,
  Press,
  Relative,
  Shown,
  Switch,
  SwitchChange,
  Telling,
  Tick,
  Time,
  ValueOut,
} from './dj_controller.js'

/**
 * Asks for MIDI access, waits for the model's ports, opens them, tells every output its rest state
 * and resolves once the device has answered its state request. Lives until closed, unplugged or the
 * signal aborts; never reconnects: a new connect after an unplug gives a new controller.
 */
export declare function connect<M extends ModelName>(model: M, options?: ConnectOptions): Promise<Controllers[M]>

export declare function palette<M extends ModelName>(model: M): Promise<Palettes[M]>
