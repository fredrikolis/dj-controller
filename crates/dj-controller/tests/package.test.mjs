// Concern: the package as npm ships it: its tarball holds exactly what its exports map reaches, and each entry imports by name from the installed tarball | Non-concern: what the entries do (connect, twin tests) | IO: (build, installed copy) -> assertions
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, normalize } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'

const build = process.env.DJ_CONTROLLER_BUILD
const installed = process.env.DJ_CONTROLLER_PKG
const consumer = createRequire(join(installed, '../../package.json'))
const load = (name) => import(pathToFileURL(consumer.resolve(name)))

// Static and dynamic imports, re-exports, and the wasm the glue fetches beside itself.
const SPECIFIER = /(?:\bfrom|\bimport)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]|new URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url/g

/** `file` and every file it reaches; a type import of `x.js` names `x.d.ts`. */
function reach(file, seen = new Set()) {
  if (seen.has(file)) return seen
  seen.add(file)
  if (!file.endsWith('.js') && !file.endsWith('.ts')) return seen
  for (const [, relative, url] of readFileSync(join(build, file), 'utf8').matchAll(SPECIFIER)) {
    const target = normalize(join(dirname(file), relative ?? url))
    reach(file.endsWith('.d.ts') ? target.replace(/\.js$/, '.d.ts') : target, seen)
  }
  return seen
}

test('the tarball holds exactly what the exports map reaches, with the manifest and licence', () => {
  const manifest = JSON.parse(readFileSync(join(build, 'package.json'), 'utf8'))
  const reached = new Set(['package.json', 'LICENSE'])
  for (const entry of Object.values(manifest.exports)) {
    for (const file of [entry.types, entry.default]) reach(normalize(file), reached)
  }
  const [packed] = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', build], { encoding: 'utf8' }))
  assert.deepEqual(packed.files.map((f) => f.path).sort(), [...reached].sort())
})

test('no entry\'s types name the glue\'s init types, so none needs the DOM lib', () => {
  const manifest = JSON.parse(readFileSync(join(build, 'package.json'), 'utf8'))
  for (const entry of Object.values(manifest.exports)) {
    for (const file of [...reach(normalize(entry.types))].filter((f) => f.endsWith('.d.ts'))) {
      assert.doesNotMatch(readFileSync(join(build, file), 'utf8'), /\b(InitInput|RequestInfo|WebAssembly)\b/, file)
    }
  }
})

test('the main entry imports by name from the installed tarball', async () => {
  assert.deepEqual(Object.keys(await load('dj-controller')).sort(), ['connect', 'palette', 'virtual'])
})

test('the diagnostics entry imports by name from the installed tarball', async () => {
  assert.deepEqual(Object.keys(await load('dj-controller/diagnostics')).sort(), ['connect', 'controlStep', 'inspect', 'openScreens'])
})

test('the twin entry imports by name from the installed tarball and defines its element', async () => {
  // The browser globals the entry touches as it loads; Node has none.
  const defined = new Map()
  globalThis.HTMLElement = class {}
  globalThis.CSSStyleSheet = class {
    replaceSync() {}
  }
  globalThis.customElements = { get: (name) => defined.get(name), define: (name, element) => defined.set(name, element) }
  const twin = await load('dj-controller/twin')
  assert.deepEqual(Object.keys(twin).sort(), ['Twin', 'theme'])
  assert.equal(defined.get('dj-controller-twin'), twin.Twin)
  assert.ok(twin.theme instanceof CSSStyleSheet)
})
