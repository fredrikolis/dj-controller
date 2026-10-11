// Concern: the sampler's SVA nodes, one file each in demo/samples, as a composition's paths and texts | Non-concern: which slot plays which, rendering | IO: (demo/samples/*.sva) -> nodes
const FILES: Readonly<Record<string, string>> = import.meta.glob('../../../samples/*.sva', { eager: true, query: '?raw', import: 'default' })

const PATH = /\/([a-z0-9-]+)\.sva$/

export const SAMPLE_NODES: readonly (readonly [path: string, text: string])[] = Object.entries(FILES).map(([file, text]) => {
  const path = PATH.exec(file)?.[1]
  if (path === undefined) throw new Error(`${file} is no sampler node: a node file is named in lowercase letters, digits and dashes, ending .sva`)
  return [path, text]
})
