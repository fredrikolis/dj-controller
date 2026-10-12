// Concern: checks the effect maths: PAD FX spec T5 (beats, TRANS, rolls, brakes, spins), Beat FX spec T7 (balance, cut, slip roll, stretch, jet, MOBIUS) | Non-concern: the nodes, the tuning | IO: none
import assert from 'node:assert/strict'
import test from 'node:test'
import { balanceOf, beatSeconds, brakeOffset, grainStart, grainWeight, jetMs, JET_MS, jetWeight, keepsStart, MOBIUS_PARTIALS, mobiusHz, mobiusLevel, rollOffset, slewed, spinOffset, stopGain, stretchRead, transCutOf, transOpen, waveAt } from './dsp.ts'

const times = (n: number, end: number) => Array.from({ length: n + 1 }, (_, i) => (i * end) / n)

test('T5: a beat lasts 60 / BPM seconds', () => {
  assert.equal(beatSeconds(120), 0.5)
})

test('T5: TRANS opens at the start of each cycle of its beats, counted from the grid, and cuts within it', () => {
  for (const beats of [1 / 8, 1 / 4, 1 / 2]) {
    for (const cycle of [-2, 0, 3]) {
      const start = cycle * beats
      assert.equal(transOpen(start, beats), true)
      assert.ok(times(64, beats).some((t) => !transOpen(start + t, beats)), `${beats} beats cut within cycle ${cycle}`)
    }
  }
})

test('T5: a roll plays live for its length from the press, then repeats that length; REV ROLL repeats it backwards', () => {
  for (const t of times(50, 99)) assert.equal(rollOffset(t, 100, false), t)
  for (const t of times(50, 500)) assert.equal(rollOffset(t + 100, 100, false), rollOffset(t + 200, 100, false))
  for (const t of times(50, 98)) assert.ok(rollOffset(100 + t + 1, 100, true) < rollOffset(100 + t, 100, true))
})

test('T5: a brake never reads ahead of the live sound, slows down, and is still and silent from its length on', () => {
  const offsets = times(100, 2000).map((t) => brakeOffset(t, 1000))
  times(100, 2000).forEach((t, i) => assert.ok(offsets[i] <= t))
  for (let i = 2; i < 51; i++) assert.ok(offsets[i] - offsets[i - 1] <= offsets[i - 1] - offsets[i - 2] + 1e-9)
  assert.equal(brakeOffset(1000, 1000), brakeOffset(2000, 1000))
  assert.equal(stopGain(0, 1000), 1)
  assert.equal(stopGain(1000, 1000), 0)
})

test('T5: a spin reads backwards from the press and is still from its length on', () => {
  const offsets = times(100, 1000).map((t) => spinOffset(t, 1000))
  for (let i = 1; i < offsets.length; i++) assert.ok(offsets[i] <= offsets[i - 1])
  assert.ok(offsets[50] < 0)
  assert.equal(spinOffset(1000, 1000), spinOffset(3000, 1000))
})

test('T5: the processor clock moves toward a told beat, and jumps to one far off, as after a seek', () => {
  const eased = slewed(10, 10.1)
  assert.ok(eased > 10 && eased <= 10.1)
  assert.equal(slewed(10, 20), 20)
})

const near = (a: number, b: number, message?: string) => assert.ok(Math.abs(a - b) < 1e-9, message ?? `${a} is not ${b}`)

test('Beat FX T7: LEVEL/DEPTH as a balance: the original alone at 0, both full at the middle, the effect alone at 1', () => {
  assert.deepEqual([balanceOf(0), balanceOf(0.5), balanceOf(1)], [{ dry: 1, wet: 0 }, { dry: 1, wet: 1 }, { dry: 0, wet: 1 }])
})

test('Beat FX T7: TRANS cuts nothing at 0, deepens to silence by the middle over half a cycle, then cuts three quarters at 1', () => {
  assert.deepEqual([transCutOf(0), transCutOf(0.25), transCutOf(0.5), transCutOf(1)], [{ cut: 0, open: 0.5 }, { cut: 0.5, open: 0.5 }, { cut: 1, open: 0.5 }, { cut: 1, open: 0.25 }])
  const open = times(400, 4).filter((beat) => transOpen(beat, 1, 0.25)).length / 401
  assert.ok(Math.abs(open - 0.25) < 0.01, `${open} of the cycle open`)
  assert.equal(transOpen(2, 1, 0.25), true)
  assert.equal(transOpen(2.3, 1, 0.25), false)
})

test('Beat FX T7: ROLL keeps its recording when its length changes; SLIP ROLL records again; another effect starts afresh', () => {
  assert.equal(keepsStart({ mode: 'roll', frames: 100 }, 'roll', 200), true)
  assert.equal(keepsStart({ mode: 'revRoll', frames: 100 }, 'revRoll', 200), true)
  assert.equal(keepsStart({ mode: 'stretch', frames: 100 }, 'stretch', 200), true)
  assert.equal(keepsStart({ mode: 'slipRoll', frames: 100 }, 'slipRoll', 200), false)
  assert.equal(keepsStart({ mode: 'slipRoll', frames: 100 }, 'slipRoll', 100), true)
  assert.equal(keepsStart({ mode: 'roll', frames: 100 }, 'slipRoll', 100), false)
  assert.equal(keepsStart({ mode: 'vBrake', frames: 100 }, 'vBrake', 200), false)
})

test('Beat FX T7: STRETCH reads each cycle from its start, slower by its factor, never ahead of the live sound; 1x is the live sound', () => {
  const cycle = 1000
  for (const slow of [1, 2, 8]) {
    for (const start of times(40, 3990)) {
      const read = stretchRead(start + 50, start, cycle, slow)
      assert.ok(read <= start + 50 + 1e-9, `${read} ahead of ${start + 50}`)
      const from = Math.floor(start / cycle) * cycle
      near(read - 50, from + (start - from) / slow)
    }
  }
  near(stretchRead(1730, 1700, cycle, 1), 1730)
  assert.equal(stretchRead(20, -500, cycle, 4), 20)
  for (const elapsed of times(30, 5000)) {
    const starts = [0, 1].map((voice) => grainStart(elapsed, 200, voice))
    starts.forEach((start) => assert.ok(start <= elapsed && elapsed - start < 200))
    near(grainWeight(elapsed, starts[0], 200) + grainWeight(elapsed, starts[1], 200), 1)
  }
})

test('Beat FX T7: ENIGMA JET\'s two taps sum to one and their delays fall as the sweep rises (+), rise as it falls (-)', () => {
  for (const phase of times(37, 3)) near(jetWeight(phase, 0) + jetWeight(phase, 1), 1)
  for (const voice of [0, 1]) {
    assert.ok(jetMs(0.3, voice) < jetMs(0.2, voice), 'falls as the sweep rises')
    assert.ok(jetMs(0.3, voice) >= JET_MS[0] && jetMs(0.3, voice) <= JET_MS[1])
  }
})

test('Beat FX T7: MOBIUS partials sit an octave apart, rise an octave a turn, and are silent where they wrap', () => {
  for (const octaves of [0.2, 1.7, -2.4]) {
    const partials = Array.from({ length: MOBIUS_PARTIALS }, (_, k) => mobiusHz(octaves, k)).sort((a, b) => a - b)
    for (let k = 1; k < partials.length; k++) near(partials[k] / partials[k - 1], 2)
    assert.ok(mobiusHz(octaves + 0.25, 3) > mobiusHz(octaves, 3) || mobiusLevel(octaves + 0.25, 3) < 0.2, 'a partial rises unless it wrapped')
  }
  near(mobiusLevel(0, 0), 0)
  near(mobiusLevel(0, MOBIUS_PARTIALS / 2), 1)
  near(mobiusHz(1.5, 0), mobiusHz(0.5, 1))
})

test('Beat FX T7: MOBIUS waves run from -1 to 1: a triangle at its ends and middle, a saw rising through its cycle', () => {
  assert.deepEqual([waveAt('tri', 0, 0.01), waveAt('tri', 0.5, 0.01), waveAt('tri', 1, 0.01)], [1, -1, 1])
  near(waveAt('saw', 0.5, 0.01), 0)
  assert.ok(waveAt('saw', 0.3, 0.01) < waveAt('saw', 0.7, 0.01))
  for (const phase of times(50, 1)) assert.ok(Math.abs(waveAt('saw', phase, 0.02)) <= 1 + 1e-9)
})
