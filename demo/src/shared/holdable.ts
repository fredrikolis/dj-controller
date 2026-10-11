// Concern: an on-screen button held by a primary pointer, Enter or Space, from press to letting go, with the press's time and Shift | Non-concern: what a hold does | IO: (button, signal) -> listeners
/** Held by a primary pointer, Enter or Space, `held` told the event's time and whether Shift was. */
export function holdable(button: HTMLButtonElement, held: (time: number, shiftKey: boolean) => void, letGo: () => void, signal: AbortSignal): void {
  let holding = false
  const down = (e: PointerEvent | KeyboardEvent) => {
    if (holding) return
    holding = true
    held(e.timeStamp, e.shiftKey)
  }
  const up = () => {
    if (!holding) return
    holding = false
    letGo()
  }
  const isPress = (e: KeyboardEvent) => e.key === ' ' || e.key === 'Enter'
  const on = { signal }
  button.addEventListener(
    'pointerdown',
    (e) => {
      if (e.button !== 0) return
      button.setPointerCapture(e.pointerId)
      down(e)
    },
    on,
  )
  for (const end of ['pointerup', 'pointercancel', 'blur'] as const) button.addEventListener(end, up, on)
  button.addEventListener('keydown', (e) => isPress(e) && !e.repeat && down(e), on)
  button.addEventListener('keyup', (e) => isPress(e) && up(), on)
}
