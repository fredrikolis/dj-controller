// Concern: a deck's loop as plain state: its points, stored, active, a pending in, the point adjusted, and what a seek does to it | Non-concern: the loop rules (features/loops) | IO: none
export type LoopPoints = { readonly in: number; readonly out: number }

export type Loop = {
  /** Kept after an exit, for RELOOP. */
  readonly stored: LoopPoints | null
  readonly active: boolean
  readonly pending: number | null
  readonly adjust: 'in' | 'out' | null
}

export const NO_LOOP: Loop = { stored: null, active: false, pending: null, adjust: null }

/** `points` looping, any pending in or adjust ended. */
export const looping = (points: LoopPoints): Loop => ({ stored: points, active: true, pending: null, adjust: null })

export const activeLoop = (loop: Loop): LoopPoints | null => (loop.active ? loop.stored : null)

// ASSUMPTION: a seek out exits.
export function sought(loop: Loop, frame: number): Loop {
  const active = activeLoop(loop)
  return active && (frame < active.in || frame >= active.out) ? { ...loop, active: false, adjust: null } : loop
}
