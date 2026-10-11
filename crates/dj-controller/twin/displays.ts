// Concern: checks the text a host shows on a twin's display against what each field carries | Non-concern: the fields' types (index.d.ts), drawing (screens.ts) | IO: (display, text) -> checked text
import type { BeatFxText, JogText, TwinDisplays } from '../index.js'

const ascii = (text: unknown, max: number): boolean => typeof text === 'string' && text.length <= max && /^[\x20-\x7e]*$/.test(text)
const isBeatFx = (text: BeatFxText | JogText): text is BeatFxText => 'name' in text

export function checkedText<D extends keyof TwinDisplays>(display: D, text: TwinDisplays[D]): TwinDisplays[D] {
  const refuse = (field: string, takes: string, given: unknown): never => {
    throw new RangeError(`${display}.${field} takes ${takes}, not ${JSON.stringify(given)}`)
  }
  const given: BeatFxText | JogText = text
  if (isBeatFx(given)) {
    // SysEx `00 0A` holds 32 characters, `00 0B` 5 (ddj-flx10-rekordbox-connect.json frames 71, 72; unprobed).
    if (display !== 'beatFx') refuse('name', 'no name: a jog display takes a range', given.name)
    if (!ascii(given.name, 32)) refuse('name', 'up to 32 printable ASCII characters', given.name)
    if (!ascii(given.beat, 5)) refuse('beat', 'up to 5 printable ASCII characters', given.beat)
    if (given.bpm !== undefined && !(Number.isFinite(given.bpm) && given.bpm >= 0 && given.bpm < 1000)) refuse('bpm', 'a BPM from 0 to under 1000, or undefined', given.bpm)
    if (typeof given.tap !== 'boolean') refuse('tap', 'true or false', given.tap)
    return text
  }
  if (display === 'beatFx') refuse('name', 'up to 32 printable ASCII characters', undefined)
  if (typeof given.range !== 'string' || given.range.length > 6 || /[\u0000-\u001f\u007f]/.test(given.range)) refuse('range', 'up to 6 characters', given.range)
  return text
}
