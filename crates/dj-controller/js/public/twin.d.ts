// Concern: the dj-controller/twin entry's public types: the <dj-controller-twin> element and its theme | Non-concern: what a host shows on it (TwinHost, index.d.ts), the controller types | IO: none
import type { Controllers, ModelName, TwinHost, TwinOptions, Virtual } from './index.js'

export type { BeatFxText, DdjFlx10Displays, DdjFlx10Panel, DdjFlx10Section, JogText, TwinDisplays, TwinHost, TwinLabelled, TwinOptions, TwinPanel, TwinSection, TwinSelector } from './index.js'

/** `<dj-controller-twin>`: `TwinHost` states what it draws, plays, shows and is styled by. */
export declare class Twin extends HTMLElement {
  constructor(options?: TwinOptions);
  controller: Controllers[ModelName] | Virtual<Controllers[ModelName]> | null;
}
export interface Twin extends Omit<TwinHost, 'controller'> {}

export declare const theme: CSSStyleSheet;

declare global {
  interface HTMLElementTagNameMap {
    "dj-controller-twin": Twin;
  }
}
