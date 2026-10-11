// Concern: the diagnostics entry's public types: its connect and inspect, the HID screens and WebUSB steps | Non-concern: the main entry (index.d.ts) | IO: none
import type { DeckEvent, Feed, HidDeckState, HidInterface, HidReport, Listen, Output, OutputInfo, PaletteColour, SyncReport, Told, Turn } from './diagnostics/dj_controller.js'
import type { ConnectOptions, Controllers, ModelName, Relative } from './index.js'

export type { ControlEvent, DeckEvent, HidDeckState, HidInterface, HidReport, HidStep, Output, OutputInfo, PaletteColour, SyncReport, Told, Turn } from './diagnostics/dj_controller.js'

/** Only a controller this resolves to can be inspected. */
export declare function connect<M extends ModelName>(model: M, options?: ConnectOptions): Promise<Controllers[M]>

export interface Inspector {
  readonly inputName: string | undefined;
  readonly outputName: string | undefined;
  readonly hid: HidInterface | undefined;
  messages(options?: Listen): Feed<DeckEvent>;
  told(options?: Listen): Feed<Told>;
  turns<Id>(control: Relative<Id>, options?: Listen): Feed<Turn<Id>>;
  send(bytes: Uint8Array): Promise<void>;
  show(output: Output): Promise<void>;
  sync(fill?: Output[], gapMs?: number): Promise<SyncReport>;
  /** Runs until the signal aborts (rejecting with its reason), a send fails or the controller closes. */
  repeat(name: string, options?: Listen): Promise<void>;
  outputState(control?: string): Told[];
  history(): Told[];
  outputs(): OutputInfo[];
  colour(colour: number): PaletteColour | undefined;
  displayed(control: string, value: number): string | undefined;
}

export declare function inspect(controller: object): Inspector;

export interface Screens {
  readonly productName: string;
  reports(options?: Listen): Feed<HidReport>;
  step(name: string): Promise<number>;
  deckState(state: HidDeckState): Promise<number>;
  displayPage(page: number): Promise<number>;
  padLabel(deck: number, text: string): Promise<number>;
  waveform(deck: number, kind: "overview" | "detail", columns: Uint8Array): Promise<number>;
  close(): Promise<void>;
}

/** From a click: the HID device chooser, then the model's vendor interface, opened; sends nothing. */
export declare function openScreens(model: string): Promise<Screens>;

export declare function controlStep(model: string, name: string): Promise<number>;
