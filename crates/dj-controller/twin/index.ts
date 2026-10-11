// Concern: the dj-controller/twin entry: defines <dj-controller-twin> once and exports its class and theme | Non-concern: the element itself (element.ts) | IO: none
import { Twin } from './element.js'

if (!customElements.get('dj-controller-twin')) customElements.define('dj-controller-twin', Twin)

export { Twin }
export { theme } from './theme.js'
