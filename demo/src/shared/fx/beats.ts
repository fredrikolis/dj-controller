// Concern: the beats rekordbox's effects step through and how a display writes them | Non-concern: what an effect does with them | IO: (beats) -> text
// MAN p.94: delay times and cycles from 1/16 to 16 beats; 3/4 as rekordbox's echo offers it.
export const BEATS: readonly number[] = [1 / 16, 1 / 8, 1 / 4, 1 / 2, 3 / 4, 1, 2, 4, 8, 16]

/** "1/16", "3/4", "1", "16": as a fraction under one beat, whole above. */
export const beatsText = (beats: number): string => (beats >= 1 ? String(beats) : beats === 3 / 4 ? '3/4' : `1/${Math.round(1 / beats)}`)
