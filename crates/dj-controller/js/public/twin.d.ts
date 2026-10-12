// Concern: the dj-controller/twin entry's public types: the <dj-controller-twin> element and its theme | Non-concern: what a host shows on it (TwinHost, index.d.ts), the controller types | IO: none
import type { Controllers, ModelName, TwinHost, Virtual } from './index.js'

export type { BeatFxText, DdjFlx10Displays, JogText, TwinDisplays, TwinHost, TwinLabelled, TwinSelector } from './index.js'

/** `<dj-controller-twin>`: `TwinHost` states what it draws, plays and shows. Attribute `layout`, `wide` or `narrow`, overrides the width's choice. Themed by `--dj-twin-*` custom properties, `::part(panel)` and `::part(fullscreen)`. */
export declare class Twin extends HTMLElement {
  controller: Controllers[ModelName] | Virtual<Controllers[ModelName]> | null;
}
export interface Twin extends Omit<TwinHost, 'controller'> {}

export declare const theme: CSSStyleSheet;

declare global {
  interface HTMLElementTagNameMap {
    "dj-controller-twin": Twin;
  }
}
