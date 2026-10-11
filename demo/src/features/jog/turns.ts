// Concern: playhead turns as frames scratched or nudged, and the platter's marker turn | Non-concern: where turns come from (shared/jog-turns.ts) | IO: turns -> frames
// A 33 1/3 rpm record.
const SECS_PER_TURN = 1.8

const NUDGE = 0.1

export const framesOf = (turns: number, touched: boolean, sampleRate: number): number => turns * SECS_PER_TURN * sampleRate * (touched ? 1 : NUDGE)

export function turnOf(frames: number, sampleRate: number): number {
  const turns = frames / sampleRate / SECS_PER_TURN
  return turns - Math.floor(turns)
}
