// Concern: the sampler from page or controller: presses, Gate releases, PAGE, BANK, BPM, SYNC, Q, GAIN, volume; a press before its sound refused | Non-concern: the rules, the audio | IO: press -> state
import { logger } from '../../shared/logger.ts'
import { slotAt } from '../../shared/sampler/banks.ts'
import { clampedGain, steppedBpm } from '../../shared/sampler/clock.ts'
import { withoutVoice, type SamplerState } from '../../shared/sampler/sampler-state.ts'
import type { Watched } from '../../shared/store.ts'
import type { SamplerStart } from '../../shared/view.ts'
import { banked, paged, pressed, stopped } from './players.ts'

export class SamplerRefused extends Error {
  override name = 'SamplerRefused'
}

/** `act`, or null where it was refused, the refusal logged; any other failure thrown. */
export function unlessRefused<T>(act: () => T): T | null {
  try {
    return act()
  } catch (err) {
    if (!(err instanceof SamplerRefused)) throw err
    logger.error('the sampler press was refused', err)
    return null
  }
}

/** What presses need of the sampler deck (shared/sampler/sampler-deck.ts). */
export type SamplerControls = {
  readonly state: Watched<SamplerState>
  readonly sounds: Watched<ReadonlyMap<string, unknown>>
  update(change: (s: SamplerState) => SamplerState): void
  newId(): number
}

export type Sampler<D extends SamplerControls = SamplerControls> = {
  readonly deck: D
  /** The Gate release, or null where the press holds nothing. */
  press(position: number, shift: boolean): (() => void) | null
  page(direction: -1 | 1): void
  bank(bank: number): void
  step(direction: -1 | 1): void
  sync(on: boolean): void
  quantize(on: boolean): void
  gain(db: number): void
  volume(position: number): void
}

export function samplerOf<D extends SamplerControls>(deck: D): Sampler<D> {
  const { update } = deck
  return {
    deck,
    press(position, shift) {
      if (shift) {
        update((s) => stopped(s, position))
        return null
      }
      const { bank } = deck.state.state
      const slot = slotAt(bank, position)
      if (slot === null) return null
      if (!deck.sounds.state.has(slot.node)) throw new SamplerRefused(`bank ${bank + 1} slot ${position + 1}, ${slot.name}, has not finished rendering from demo/samples/${slot.node}.sva; it plays once rendered`)
      const id = deck.newId()
      update((s) => pressed(s, position, id))
      return slot.mode === 'gate' ? () => update((s) => withoutVoice(s, id)) : null
    },
    page: (direction) => update((s) => paged(s, direction)),
    bank: (bank) => update((s) => banked(s, bank)),
    step: (direction) => update((s) => steppedBpm(s, direction)),
    sync: (on) => update((s) => (s.sync === on ? s : { ...s, sync: on })),
    quantize: (on) => update((s) => (s.quantize === on ? s : { ...s, quantize: on })),
    gain: (db) => update((s) => (s.gain === clampedGain(db) ? s : { ...s, gain: clampedGain(db) })),
    volume(position) {
      const volume = Math.min(1, Math.max(0, position))
      update((s) => (s.volume === volume ? s : { ...s, volume }))
    },
  }
}

export const startSampler = (deck: SamplerControls, start: SamplerStart): void => deck.update((s) => ({ ...s, ...start }))
