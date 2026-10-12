// Concern: checks the sampler spec's T2-T3: PAGE steps the bank, a press plays or restarts, SHIFT+press stops, a press before its render refused, a Gate release | Non-concern: the audio | IO: none
import assert from 'node:assert/strict'
import test from 'node:test'
import { slotAt } from '../../shared/sampler/banks.ts'
import { SAMPLER_START, withoutVoice, type SamplerState } from '../../shared/sampler/sampler-state.ts'
import { createStore } from '../../shared/store.ts'
import { SamplerRefused, samplerOf, type SamplerControls } from './actions.ts'
import { elsewhereAt, paged, playingAt, pressed, stopped } from './players.ts'

const ids = (s: SamplerState) => s.voices.map((v) => v?.id ?? null)

test('T2: PAGE ▶ and ◀ step the one bank both decks show, stopping at banks 1 and 4 (MAN p.83 step 2)', () => {
  let s = paged(SAMPLER_START, -1)
  assert.equal(s, SAMPLER_START)
  for (const want of [1, 2, 3, 3]) assert.equal((s = paged(s, 1)).bank, want)
  assert.equal(paged(s, -1).bank, 2)
})

test('T3: a press plays its slot, a second restarts it, SHIFT+press stops it; silence and an empty slot do nothing (MAN p.84 steps 4-6)', () => {
  const one = pressed(SAMPLER_START, 3, 1)
  assert.deepEqual(one.voices[3], { id: 1, bank: 0, position: 3 })
  assert.ok(playingAt(one, 3))
  assert.equal(pressed(one, 3, 2).voices[3]?.id, 2, 'a restart is a new voice')
  assert.equal(stopped(one, 3).voices[3], null)
  assert.equal(stopped(SAMPLER_START, 3), SAMPLER_START)
  const empty = { ...SAMPLER_START, bank: 3 }
  assert.equal(pressed(empty, 0, 9), empty)
})

test('T3: switching banks keeps sounds; a press where another bank\'s slot plays replaces it; SHIFT+press stops either (RB p.195)', () => {
  const drums = pressed(pressed(SAMPLER_START, 0, 1), 1, 2)
  const loops = paged(paged(drums, 1), 1)
  assert.deepEqual(ids(loops).slice(0, 3), [1, 2, null])
  assert.ok(elsewhereAt(loops, 0) && !playingAt(loops, 0))
  const replaced = pressed(loops, 0, 3)
  assert.deepEqual(replaced.voices[0], { id: 3, bank: 2, position: 0 })
  assert.equal(stopped(loops, 1).voices[1], null)
})

test('T3: a sound\'s end frees its position, a restart since keeps the new one', () => {
  const s = pressed(pressed(SAMPLER_START, 0, 1), 0, 2)
  assert.equal(withoutVoice(s, 1), s)
  assert.equal(withoutVoice(s, 2).voices[0], null)
})

const fakeDeck = (rendered: readonly string[]): SamplerControls => {
  const state = createStore(SAMPLER_START)
  let id = 0
  return { state, sounds: createStore(new Map(rendered.map((node) => [node, null]))), update: state.update, newId: () => ++id }
}

test('T3: a press before its sound is rendered is refused; a Gate press plays until its release', () => {
  const riser = slotAt(1, 8)
  assert.equal(riser?.mode, 'gate')
  const deck = fakeDeck(['kick', riser?.node ?? ''])
  const sampler = samplerOf(deck)
  assert.throws(() => sampler.press(1, false), SamplerRefused)
  assert.equal(sampler.press(0, false), null, 'a one-shot holds nothing')
  sampler.page(1)
  const letGo = sampler.press(8, false)
  assert.ok(playingAt(deck.state.state, 8) && letGo)
  letGo()
  assert.equal(deck.state.state.voices[8], null)
  assert.ok(deck.state.state.voices[0], 'bank 1\'s kick plays on')
  assert.equal(sampler.press(0, true), null)
  assert.equal(deck.state.state.voices[0], null, 'SHIFT+press stops another bank\'s slot at its position')
})
