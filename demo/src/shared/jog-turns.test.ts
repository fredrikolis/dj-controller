// Concern: checks a jog's ticks become playhead turns by its model's revolution, the side's by the platter's | Non-concern: what a turn does to the playhead | IO: none
import assert from 'node:assert/strict'
import test from 'node:test'
import { followJog, jogRevolutions, type Jog } from './jog-turns.ts'

function jog<R extends number | undefined>(revolution: R, ticks: number[] = []): Jog & { readonly revolution: R } {
  const positions = async function* () {
    for (const t of ticks) yield { ticks: t }
  }
  return { position: { ticks: 0 }, revolution, positions }
}

async function turned(control: Jog, revolution: number): Promise<number> {
  let turns = 0
  await followJog(control, revolution, (t) => (turns += t), new AbortController().signal)
  return turns
}

// Deck 2's hand-marked slow lap (docs/research/flx10-observed-jog.md).
test("a lap of the platter's model revolution turns the playhead once, and the side, stating none, turns by the platter's", async () => {
  const deck = { platter: jog(12884, [6000, 12884]), side: jog(undefined, [12884]) }
  const revolutions = jogRevolutions(deck)
  assert.deepEqual(revolutions, { platter: 12884, side: 12884 })
  assert.ok(Math.abs((await turned(deck.platter, revolutions.platter)) - 1) < 1e-12)
  assert.ok(Math.abs((await turned(deck.side, revolutions.side)) - 1) < 1e-12)
})
