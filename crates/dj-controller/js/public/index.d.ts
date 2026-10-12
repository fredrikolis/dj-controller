// Concern: the main entry's public types: connect, virtual, palette, every controller type | Non-concern: the diagnostics entry | IO: none
import type { ConnectOptions, Controllers, ModelName, Palettes, Virtual } from './dj_controller.js'

export type * from './dj_controller.js'

export type {
  Absolute,
  Button,
  Clock,
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
  Reading,
  Relative,
  Shown,
  Stepping,
  Switch,
  SwitchChange,
  Telling,
  Tick,
  Time,
  ValueOut,
} from './dj_controller.js'

/** Resolves once the device has answered its state request, every output told its rest state. */
export declare function connect<M extends ModelName>(model: M, options?: ConnectOptions): Promise<Controllers[M]>

export declare function virtual<M extends ModelName>(model: M, options?: ConnectOptions): Promise<Virtual<Controllers[M]>>

export declare function palette<M extends ModelName>(model: M): Promise<Palettes[M]>
