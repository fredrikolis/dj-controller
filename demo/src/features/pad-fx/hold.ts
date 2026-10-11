// Concern: PAD FX holds as rekordbox plays them: on while held, the same effect's last press alone, a Release FX clearing the rest, BEAT steps | Non-concern: the banks | IO: (holding, press) -> holding
import { BEATS } from '../../shared/fx/beats.ts'
import type { BufferEffect } from '../../shared/fx/messages.ts'
import { isBufferEffect, RELEASE_FX, slotOf, type Effect, type Timing } from './banks.ts'

export type Held = { readonly id: number; readonly slot: number; readonly timing: Timing; readonly on: boolean }

export type Holding = readonly Held[]

export type Active = { readonly effect: Effect; readonly timing: Timing; readonly slot: number }

export const NOTHING_HELD: Holding = []

const effectOf = (held: Held): Effect => slotOf(held.slot).effect

// MAN p.81 steps 2-3; RB p.189.
export function pressed(holding: Holding, id: number, slot: number): Holding {
  if (holding.some((h) => h.id === id)) throw new Error(`PAD FX press ${id} is already held; each press is let go before its id comes again`)
  const { effect, timing } = slotOf(slot)
  const release = RELEASE_FX.has(effect)
  // ASSUMPTION: a press turned off stays off while held.
  const kept = holding.map((h) => (h.on && (release || effectOf(h) === effect) ? { ...h, on: false } : h))
  return [...kept, { id, slot, timing, on: true }]
}

export const letGo = (holding: Holding, id: number): Holding => (holding.some((h) => h.id === id) ? holding.filter((h) => h.id !== id) : holding)

function step(timing: Timing, direction: -1 | 1): Timing {
  if (timing === null || !('beats' in timing)) return timing
  const at = BEATS.indexOf(timing.beats)
  if (at < 0) throw new RangeError(`${timing.beats} beats is not on the Beat FX list (MAN p.94)`)
  return { beats: BEATS[Math.min(BEATS.length - 1, Math.max(0, at + direction))] }
}

// RB p.189. ASSUMPTION: a size stays.
export const stepped = (holding: Holding, direction: -1 | 1): Holding => holding.map((h) => (h.on ? { ...h, timing: step(h.timing, direction) } : h))

export const activeOf = (holding: Holding): readonly Active[] => holding.filter((h) => h.on).map((h) => ({ effect: effectOf(h), timing: h.timing, slot: h.slot }))

/** The buffer effect playing, the newest held: one at a time (ASSUMPTION). */
export function bufferOf(active: readonly Active[]): { readonly effect: BufferEffect; readonly beats: number } | null {
  const newest = active.findLast((a) => isBufferEffect(a.effect))
  if (!newest || !isBufferEffect(newest.effect)) return null
  if (newest.timing === null || !('beats' in newest.timing)) throw new Error(`${newest.effect} is timed in beats, not ${JSON.stringify(newest.timing)}`)
  return { effect: newest.effect, beats: newest.timing.beats }
}

export const isOn = (holding: Holding, slot: number): boolean => holding.some((h) => h.on && h.slot === slot)
