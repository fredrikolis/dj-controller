// Concern: checks the Beat FX spec's T2, T3, T5, T6, T8 display and T9: steps, ON, targets, FX BPM, AUTO/TAP, Release FX, refusals, BEAT with PAD FX held | Non-concern: the audio | IO: none
import assert from 'node:assert/strict'
import test from 'node:test'
import { KINDS, LISTS, NAMES, paramText, TARGET_LABELS } from './effects.ts'
import { automatic, beatPressed, depthSet, displayOf, fxBpm, NO_TRACK_BPM, phaseOf, refusal, releaseHeld, selected, START, stepped, tappedAt, targeted, toggled, type BpmSources } from './unit-state.ts'

const from: BpmSources = { decks: [140, 150], sampler: 128, master: 1 }

test('T2: a select keeps the unit on and each effect its own parameter', () => {
  const s = stepped(stepped(toggled(selected(START, 'echo')), 1), 1)
  assert.equal(s.params.echo, 4)
  const r = selected(s, 'reverb')
  assert.equal(r.on, true)
  assert.equal(r.params.reverb, 50)
  assert.equal(selected(r, 'echo').params.echo, 4)
})

test('T2: BEAT steps along the list and stops at its ends; ON toggles; a target and depth set', () => {
  let s = selected(START, 'flanger')
  for (let i = 0; i < 20; i++) s = stepped(s, 1)
  assert.equal(s.params.flanger, 64)
  assert.equal(stepped(s, 1), s)
  for (let i = 0; i < 20; i++) s = stepped(s, -1)
  assert.equal(s.params.flanger, 1 / 16)
  let j = selected(START, 'enigmaJet')
  j = stepped(j, -1)
  assert.equal(j.params.enigmaJet, LISTS.signed[LISTS.signed.indexOf(1) - 1])
  assert.equal(toggled(toggled(START)).on, false)
  assert.equal(targeted(START, 'channel2').target, 'channel2')
  assert.equal(depthSet(START, 0.25).depth, 0.25)
})

test('T3: AUTO follows the target deck\'s BPM, the master deck for MST, the sampler for SP, else 120', () => {
  assert.equal(fxBpm(targeted(START, 'channel1'), from), 140)
  assert.equal(fxBpm(targeted(START, 'channel2'), from), 150)
  assert.equal(fxBpm(targeted(START, 'master'), from), 150)
  assert.equal(fxBpm(targeted(START, 'sampler'), from), 128)
  for (const t of ['channel3', 'channel4', 'mic'] as const) assert.equal(fxBpm(targeted(START, t), from), NO_TRACK_BPM)
  assert.equal(fxBpm(targeted(START, 'channel1'), { ...from, decks: [null, 150] }), NO_TRACK_BPM)
  assert.deepEqual([phaseOf(targeted(START, 'channel1'), 1), phaseOf(targeted(START, 'sampler'), 1), phaseOf(targeted(START, 'mic'), 1)], [0, 1, null])
})

test('T3: SHIFT+BEAT ▶ enters TAP keeping the BPM, taps set it, SHIFT+BEAT ◀ returns AUTO', () => {
  let s = beatPressed(targeted(START, 'channel1'), 1, true, 1000, 140, 0)
  assert.equal(s.mode, 'tap')
  assert.equal(fxBpm(s, from), 140)
  for (const time of [1500, 2000, 2500]) s = beatPressed(s, 1, true, time, fxBpm(s, from), 0)
  assert.equal(fxBpm(s, from), 120)
  assert.equal(phaseOf(s, 0), 'tap')
  s = beatPressed(s, -1, true, 3000, 120, 0)
  assert.equal(s.mode, 'auto')
  assert.equal(fxBpm(s, from), 140)
  assert.equal(automatic(START), START)
  assert.equal(tappedAt(s, 9000, 100).tapBpm, 100)
})

test('T5: the Release FX held turns the unit off and acts; let go, neither', () => {
  const held = releaseHeld(toggled(START), true)
  assert.deepEqual([held.on, held.release.held], [false, true])
  const free = releaseHeld(held, false)
  assert.deepEqual([free.on, free.release.held], [false, false])
})

test('T6: a parameter past the 32 s ring or the 20 s delay at the FX BPM is refused', () => {
  const roll16 = { ...selected(START, 'roll'), params: { ...START.params, roll: 16 } }
  assert.equal(refusal(roll16, 30), null)
  assert.notEqual(refusal(roll16, 29), null)
  const echo16 = { ...selected(START, 'echo'), params: { ...START.params, echo: 16 } }
  assert.equal(refusal(echo16, 48), null)
  assert.notEqual(refusal(echo16, 47), null)
  assert.equal(refusal({ ...selected(START, 'mtDelay'), params: { ...START.params, mtDelay: 16 } }, 47), null)
  assert.equal(refusal({ ...selected(START, 'flanger'), params: { ...START.params, flanger: 64 } }, 20), null)
  assert.notEqual(refusal({ ...START, release: { type: 'vBrake', beats: 16, held: false } }, 29), null)
  assert.equal(refusal({ ...START, release: { type: 'vBrake', beats: 16, held: false } }, 30), null)
  assert.equal(refusal(roll16, 0), null)
})

test('T8: the display carries the name, the parameter as written, the BPM in hundredths, the mode, the channel', () => {
  const s = stepped(targeted(selected(START, 'enigmaJet'), 'master'), 1)
  assert.deepEqual(displayOf(s, 128.004), { name: NAMES.enigmaJet, parameter: paramText(KINDS.enigmaJet, 2), bpm: 12800, mode: 'AUTO', channel: TARGET_LABELS.master })
  assert.equal(displayOf(tappedAt(START, 0, 99.5), 99.5).mode, 'TAP')
})

test('T9: with a PAD FX pad held, BEAT leaves the unit\'s parameter; with none it steps; SHIFT acts either way', () => {
  const s = selected(START, 'echo')
  assert.equal(beatPressed(s, 1, false, 0, 120, 1), s)
  assert.equal(beatPressed(s, 1, false, 0, 120, 0).params.echo, 2)
  assert.equal(beatPressed(s, 1, true, 0, 120, 2).mode, 'tap')
})
