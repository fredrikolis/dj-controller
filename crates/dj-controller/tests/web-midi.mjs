// Concern: a stand-in Web MIDI for the package's boundary tests: one FLX10 that answers the state request with the recorded reply, can be held by another program, unplugged and plugged back | Non-concern: what the driver does with it (the tests) | IO: (sends) -> recorded bytes; (test calls) -> messages, statechange
import { readFileSync } from 'node:fs'

const REPLY = new URL('../../dj-controller-core/fixtures/ddj-flx10-state-2026-10-08.hex', import.meta.url)
// The FLX10's state request (models/ddj-flx10.json `state-request`).
const STATE_REQUEST = 'F0 00 40 05 00 00 04 01 00 03 01 F7'

const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ')
const bytesOf = (text) => text.split(' ').map((b) => parseInt(b, 16))

// Port names in a form Model::owns_port accepts (the forms reported for other models); none yet read from an FLX10.
class Port extends EventTarget {
  connection = 'closed'
  state = 'connected'
  held = false
  constructor(type, id, name) {
    super()
    Object.assign(this, { type, id, name, manufacturer: 'Pioneer DJ', version: '1.13' })
  }
  async open() {
    if (this.held) throw new DOMException('the port is held by another program', 'InvalidAccessError')
    this.connection = 'open'
  }
  async close() {
    this.connection = 'closed'
  }
}

class Input extends Port {
  onmidimessage = null
  receive(text, timeStamp = performance.now()) {
    this.onmidimessage?.({ data: Uint8Array.from(bytesOf(text)), timeStamp })
  }
}

class Output extends Port {
  sent = []
  broken = false
  #waiters = []
  send(data) {
    if (this.state === 'disconnected' || this.broken) throw new DOMException('the port is gone', 'InvalidStateError')
    const text = hex(data)
    this.sent.push(text)
    for (const w of [...this.#waiters]) if (w.text === text) {
      this.#waiters.splice(this.#waiters.indexOf(w), 1)
      w.resolve()
    }
    this.onsend?.(text)
  }
  next(text) {
    return new Promise((resolve) => this.#waiters.push({ text, resolve }))
  }
}

/** `target`, keeping each type's listeners in `listening`, as a test reads what is left on it. */
export function listened(target) {
  const listening = new Map()
  const [add, remove] = [target.addEventListener.bind(target), target.removeEventListener.bind(target)]
  target.addEventListener = (type, listener, options) => {
    listening.set(type, (listening.get(type) ?? new Set()).add(listener))
    add(type, listener, options)
  }
  target.removeEventListener = (type, listener, options) => {
    listening.get(type)?.delete(listener)
    remove(type, listener, options)
  }
  target.listening = (type) => listening.get(type)?.size ?? 0
  return target
}

export class Device {
  input = new Input('input', 'in-1', 'DDJ-FLX10 MIDI 1')
  output = new Output('output', 'out-1', 'DDJ-FLX10 MIDI 1')
  access = listened(Object.assign(new EventTarget(), { inputs: new Map(), outputs: new Map(), sysexEnabled: true }))
  answers = true
  constructor({ plugged = true } = {}) {
    this.output.onsend = (text) => text === STATE_REQUEST && this.answers && queueMicrotask(() => this.reply())
    if (plugged) this.plug()
  }
  reply() {
    for (const line of readFileSync(REPLY, 'utf8').split('\n')) if (line) this.input.receive(line)
  }
  plug() {
    for (const port of [this.input, this.output]) {
      port.state = 'connected'
      this.access[port.type === 'input' ? 'inputs' : 'outputs'].set(port.id, port)
      this.#changed(port)
    }
  }
  unplug() {
    for (const port of [this.input, this.output]) {
      port.state = 'disconnected'
      port.connection = 'closed'
      this.access[port.type === 'input' ? 'inputs' : 'outputs'].delete(port.id)
      this.#changed(port)
    }
  }
  #changed(port) {
    this.access.dispatchEvent(Object.assign(new Event('statechange'), { port }))
  }
  install({ refuse = false } = {}) {
    const requestMIDIAccess = async () => {
      if (refuse) throw new DOMException('denied', 'NotAllowedError')
      return this.access
    }
    Object.defineProperty(globalThis, 'navigator', { value: { requestMIDIAccess }, configurable: true })
    return this
  }
}
