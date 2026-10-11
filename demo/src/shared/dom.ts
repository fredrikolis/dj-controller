// Concern: elements found as their type, made with their properties, and mounted for a signal's life | Non-concern: what any element does | IO: (tag, props, signal) -> DOM
type Constructor<T> = abstract new (...args: never[]) => T

export function find<T extends Element>(selector: string, type: Constructor<T>, root: ParentNode): T {
  const found = root.querySelector(selector)
  if (!(found instanceof type)) throw new TypeError(`the page has no ${type.name} at ${selector}`)
  return found
}

type Props<K extends keyof HTMLElementTagNameMap> = Partial<Omit<HTMLElementTagNameMap[K], 'style' | 'dataset'>>

export function make<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props<K> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const element = Object.assign(document.createElement(tag), props)
  element.append(...children)
  return element
}

export function mount(parent: Element, signal: AbortSignal, ...nodes: Element[]): void {
  if (signal.aborted) return
  parent.append(...nodes)
  signal.addEventListener('abort', () => nodes.forEach((n) => n.remove()), { once: true })
}
