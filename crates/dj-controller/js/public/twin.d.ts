// Concern: the dj-controller/twin entry's public types: the <dj-controller-twin> element and its theme | Non-concern: the controller types (index.d.ts) | IO: none
import type { Controllers, ModelName } from './index.js'

/**
 * `<dj-controller-twin>`: a controller's panel, every control moving as the device reports it, each
 * LED and pad colour as the driver last told it; holding a part lights its LED. Attribute `layout`, `wide` or `narrow`, overrides the width's choice. Themed by
 * `--dj-twin-*` custom properties, `::part(panel)` and `::part(fullscreen)`.
 */
export declare class Twin extends HTMLElement {
  controller: Controllers[ModelName] | null;
  /** Settles once it stops following: disconnected, given another controller, the controller closed, or a stream failed, logged and dispatched as an `error` ErrorEvent. */
  readonly running: Promise<void>;
}

/** The twin's default `--dj-twin-*` tokens on `:root`, for a page to adopt and style itself by; the twin needs none of it. */
export declare const theme: CSSStyleSheet;

declare global {
  interface HTMLElementTagNameMap {
    "dj-controller-twin": Twin;
  }
}
