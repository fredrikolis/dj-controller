// Concern: an element found as its type, or a TypeError naming what the page lacks | Non-concern: what any element does | IO: (selector, type) -> element
type Constructor<T> = abstract new (...args: never[]) => T

export function find<T extends Element>(selector: string, type: Constructor<T>, root: ParentNode): T {
  const found = root.querySelector(selector)
  if (!(found instanceof type)) throw new TypeError(`the page has no ${type.name} at ${selector}`)
  return found
}
