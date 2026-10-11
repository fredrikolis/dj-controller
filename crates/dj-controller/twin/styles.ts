// Concern: the twin's look as one stylesheet, themed by the --dj-twin-* tokens (theme.ts) and its parts | Non-concern: what is drawn (draw.ts), which state shows (paint.ts) | IO: none
import { tokens } from './theme.js'

export const styles = new CSSStyleSheet()

styles.replaceSync(`
  :host {
${Object.entries(tokens).map(([name, value]) => `    --${name}: var(--dj-twin-${name}, ${value});`).join('\n')}
    display: block;
    position: relative;
    color-scheme: light dark;
    background: var(--page);
    color: var(--ink);
    font: 14px/1.4 ui-monospace, monospace;
  }
  :host(:fullscreen) { display: flex; flex-direction: column; justify-content: center; }
  svg { display: block; width: 100%; max-height: 100vh; }
  button { position: absolute; inset: 0.25rem 0.5rem auto auto; font: inherit; background: none; border: 0; color: var(--ink); text-decoration: underline; cursor: pointer; }
  .part .body, .part .passive { fill: var(--panel); stroke: var(--line); stroke-width: 1.5; }
  .part .passive { fill: none; stroke-dasharray: 3 3; opacity: 0.6; }
  .part text { fill: var(--ink); text-anchor: middle; dominant-baseline: central; pointer-events: none; }
  .part text.above { opacity: 0.75; }
  .part .halo { fill: none; stroke: var(--down); stroke-width: 4; opacity: 0; pointer-events: none; }
  .part .halo.shift { stroke: var(--shift); }
  .part .slot { fill: var(--line); stroke: none; }
  .part .track { fill: none; stroke: var(--line); stroke-width: 1.5; }
  .part .cap, .part .mark { fill: var(--ink); }
  .part .pointer { stroke: var(--ink); stroke-width: 3; stroke-linecap: round; }
  .part .level { fill: var(--led); }
  .part .arc { fill: none; stroke: var(--down); stroke-width: 3; }
  .part.pad .body { fill: var(--pad); }
  .part.touch .body { fill: transparent; }
  .part.meter .body { fill: none; }
  .part.jog .body, .part.display .body { fill: var(--screen); }
  .part.jog, .part.display { pointer-events: none; }
  .part text.shown { fill: var(--on-screen); opacity: 1; }
  .part text.shown.dim { opacity: 0.7; }
  .part text.shown.big { font-weight: 700; }
  .part text.shown.flag { opacity: 0.25; }
  .part text.shown.flag.on { opacity: 1; fill: var(--lit); }
  .part .marker { stroke: var(--on-screen); stroke-width: 4; stroke-linecap: round; }
  .part .cue { stroke: var(--lit); stroke-width: 4; stroke-linecap: round; }
  .part .reach { fill: transparent; stroke: none; }
  .part text.told { fill: var(--on-screen); stroke: var(--screen); stroke-width: 2.5; paint-order: stroke; stroke-linejoin: round; font-weight: 700; }
  .part.played { cursor: pointer; touch-action: none; -webkit-user-select: none; user-select: none; }
  .part.played.fader, .part.played.knob, .part.played.spin, .part.played.encoder { cursor: grab; }
  .part.lit .body { fill: color-mix(in srgb, var(--led) 45%, var(--panel)); stroke: var(--led); }
  .part.jog.lit .body { stroke: var(--on-screen); fill: var(--screen); }
  .part.coloured .body { fill: var(--told-colour); }
  .part.held .body { stroke: var(--lit); stroke-width: 3; fill: color-mix(in srgb, var(--lit) 35%, var(--panel)); }
  .part.down .body { fill: var(--down); }
  .part.pad.down .body { opacity: calc(0.55 + 0.45 * var(--velocity)); }
  .part.down text.inside { fill: var(--on-down); }
  .part.touch.down .body { fill: color-mix(in srgb, var(--down) 18%, transparent); }
  .part.led { cursor: pointer; }
  .part.led:focus-visible { outline: none; }
  .part.led:focus-visible .body { stroke: var(--ink); stroke-width: 3; }
`)
