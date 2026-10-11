// Concern: what the main thread and a render worker say to each other | Non-concern: rendering, looping (render.ts, render.worker.ts) | IO: none
/** The composition's nodes once, then each render of one of its targets at a tempo, or its abort. */
export type RenderMessage =
  | { readonly kind: 'nodes'; readonly nodes: readonly (readonly [path: string, text: string])[] }
  | { readonly kind: 'render'; readonly id: number; readonly target: string; readonly bpm: number; readonly rate: number }
  | { readonly kind: 'abort'; readonly id: number }

export type Rendered = { readonly id: number; readonly channels: Float32Array<ArrayBuffer>[] } | { readonly id: number; readonly error: Error }
