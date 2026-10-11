// Concern: checks a deck's kept renders: made once, a copy each, another BPM aborting them, a failure made again, one no one waits for stopped | Non-concern: rendering | IO: none
import assert from 'node:assert/strict'
import test from 'node:test'
import { keptRenders, type Channels } from './kept-renders.ts'

/** Renders that resolve when told, each recorded with its signal. */
function maker() {
  const made: { bpm: number; semitones: number; signal: AbortSignal; resolve: (c: Channels) => void; reject: (e: Error) => void }[] = []
  const make = (bpm: number, semitones: number, signal: AbortSignal) =>
    new Promise<Channels>((resolve, reject) => {
      made.push({ bpm, semitones, signal, resolve, reject })
    })
  return { made, render: keptRenders(make) }
}

const channels = (value: number): Channels => [Float32Array.from([value])]
const never = new AbortController().signal

test('a render asked again is made once, and each caller gets its own copy', async () => {
  const { made, render } = maker()
  const first = render(144, 3, never)
  const second = render(144, 3, never)
  made[0]?.resolve(channels(1))
  const [a, b] = await Promise.all([first, second])
  assert.equal(made.length, 1)
  assert.deepEqual([a?.[0]?.[0], b?.[0]?.[0]], [1, 1])
  assert.notEqual(a?.[0], b?.[0])
  assert.deepEqual((await render(144, 3, never))[0]?.[0], 1, 'kept')
  assert.equal(made.length, 1)
})

test('another BPM drops what was kept, aborting renders still being made', async () => {
  const { made, render } = maker()
  void render(144, 3, never).catch(() => {})
  void render(150, 3, never).catch(() => {})
  assert.equal(made[0]?.signal.aborted, true)
  assert.match(String(made[0]?.signal.reason), /renders at 144 BPM dropped for 150 BPM/)
  assert.equal(made[1]?.signal.aborted, false)
})

test('a failed render is made again when asked again', async () => {
  const { made, render } = maker()
  const failing = render(144, 0, never)
  made[0]?.reject(new Error('no'))
  await assert.rejects(failing, /no/)
  void render(144, 0, never)
  assert.equal(made.length, 2)
})

test('a caller’s abort stops its wait, and the render goes on for another still waiting', async () => {
  const { made, render } = maker()
  const stop = new AbortController()
  const waiting = render(144, 5, stop.signal)
  const next = render(144, 5, never)
  stop.abort(new Error('stale'))
  await assert.rejects(waiting, /stale/)
  assert.equal(made[0]?.signal.aborted, false)
  made[0]?.resolve(channels(2))
  assert.equal((await next)[0]?.[0], 2)
  assert.equal(made.length, 1)
})

test('a render no one waits for any more, as a key stepped past, is stopped and not kept', async () => {
  const { made, render } = maker()
  const stop = new AbortController()
  const passed = render(144, 1, stop.signal)
  stop.abort(new Error('stepped on'))
  await assert.rejects(passed, /stepped on/)
  assert.equal(made[0]?.signal.aborted, true)
  void render(144, 1, never)
  assert.equal(made.length, 2, 'made again')
})
