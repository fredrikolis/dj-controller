// Concern: an on-screen button acting at a primary pointer's press or an Enter or Space key's, with the event's time and Shift | Non-concern: what a press does | IO: (button, act, signal) -> listeners
/** Acts at a primary pointer's press or an Enter or Space key's, with the event's time and whether Shift was held, until `signal` aborts. */
export function pressable(button: HTMLButtonElement, act: (time: number, shift: boolean) => void, signal: AbortSignal): void {
  const press = (e: PointerEvent | KeyboardEvent) => !button.disabled && act(e.timeStamp, e.shiftKey)
  button.addEventListener('pointerdown', (e) => e.button === 0 && press(e), { signal })
  button.addEventListener('keydown', (e) => (e.key === ' ' || e.key === 'Enter') && !e.repeat && press(e), { signal })
}
