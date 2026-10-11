// Concern: a deck's key lock: whether it holds, the BPM and semitones to render, the slowest render, what is pending | Non-concern: rendering | IO: (deck, song BPM) -> lock
import type { DeckState, Lock } from './deck-state.ts'
import { rateOf } from './tempo.ts'

export type Tempo = Pick<DeckState, 'tempo' | 'tempoRange' | 'masterTempo' | 'keyShift' | 'keySync' | 'locked'>

// RB p.131 item 13: KEY RESET replaces MASTER TEMPO; ASSUMPTION: sync too.
const keyHeld = (deck: Tempo): boolean => deck.masterTempo || deck.keyShift !== 0 || deck.keySync

export const lockedBpm = (deck: Pick<Tempo, 'tempo' | 'tempoRange'>, bpm: number): number => Math.round(bpm * rateOf(deck.tempo, deck.tempoRange) * 10) / 10

export const lockedAt = (deck: Tempo, bpm: number, semitones: number): Lock | null => (keyHeld(deck) ? { bpm: lockedBpm(deck, bpm), semitones } : null)

export const sameLock = (a: Lock | null, b: Lock | null): boolean => a === b || (a !== null && b !== null && a.bpm === b.bpm && a.semitones === b.semitones)

// ASSUMPTION: renders stop at half tempo.
const SLOWEST = 0.5

export const renderedAt = (locked: number, bpm: number): number => Math.max(locked, bpm * SLOWEST)

export const pendingBpm = (deck: Tempo, bpm: number): number | null => (keyHeld(deck) && lockedBpm(deck, bpm) !== deck.locked?.bpm ? lockedBpm(deck, bpm) : null)

export const pendingShift = (deck: Tempo, semitones: number): number | null => (keyHeld(deck) && semitones !== deck.locked?.semitones ? semitones : null)
