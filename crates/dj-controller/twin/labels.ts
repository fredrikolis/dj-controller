// Concern: a host's label as the lines a part draws: wrapped, shrunk to fit, cut with an ellipsis past that | Non-concern: whose label shows (tree.ts), drawing | IO: (text, width) -> size, lines
const GLYPH = 0.6
const ELLIPSIS = '…'

export type Fitted = { readonly size: number; readonly lines: readonly string[] }

const cut = (line: string, chars: number): string => (line.length <= chars ? line : `${line.slice(0, Math.max(1, chars - 1))}${ELLIPSIS}`)

function wrap(words: readonly string[], chars: number, rows: number): string[] {
  const lines: string[] = []
  for (const word of words) {
    const last = lines.at(-1)
    if (last !== undefined && (`${last} ${word}`.length <= chars || lines.length === rows)) lines[lines.length - 1] = `${last} ${word}`
    else lines.push(word)
  }
  return lines
}

/** The largest size from `max` down to `min` at which every line fits, words whole; at `min` a longer line is cut to an ellipsis. */
export function fit(text: string, width: number, rows: number, max: number, min: number): Fitted {
  const words = text.trim().split(/\s+/)
  const chars = (size: number) => Math.max(1, Math.floor(width / (GLYPH * size)))
  for (let size = max; size > min; size--) {
    const lines = wrap(words, chars(size), rows)
    if (lines.every((line) => line.length <= chars(size))) return { size, lines }
  }
  return { size: min, lines: wrap(words, chars(min), rows).map((line) => cut(line, chars(min))) }
}

export function checked(text: string): string {
  if (typeof text !== 'string' || text.trim().length === 0 || text.length > 32 || /[\u0000-\u001f\u007f]/.test(text)) {
    throw new RangeError(`a label is 1 to 32 characters with no control character, not ${JSON.stringify(text)}; pass undefined to clear one`)
  }
  return text
}
