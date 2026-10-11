// Concern: the twin's default theme: each --dj-twin-* token's value, for its own stylesheet and for a page to style itself by | Non-concern: where a token is used (styles.ts) | IO: none
export const tokens = {
  page: 'light-dark(#f4f4f5, #0e0e10)',
  panel: 'light-dark(#e2e2e5, #1b1b1f)',
  line: 'light-dark(#86868e, #5c5c66)',
  ink: 'light-dark(#2a2a30, #c9c9d1)',
  // Pressed or on as the device reports it; a shift press; a part held to light its LED.
  down: 'light-dark(#0a66c2, #4da3ff)',
  shift: 'light-dark(#8b3fd1, #c39bff)',
  lit: 'light-dark(#c77700, #ffb340)',
  // An LED as the driver last told it: on.
  led: 'light-dark(#d93025, #ff6b5e)',
  // A pad's face, a screen's glass, and ink on a part shown down.
  pad: 'light-dark(#3a3a40, #2a2a30)',
  screen: '#141418',
  'on-down': 'light-dark(#fff, #0e0e10)',
} as const

/** The tokens as `--dj-twin-*` on `:root`, for a page to adopt and style itself by. */
export const theme = new CSSStyleSheet()

theme.replaceSync(`:root { ${Object.entries(tokens).map(([name, value]) => `--dj-twin-${name}: ${value};`).join(' ')} }`)
