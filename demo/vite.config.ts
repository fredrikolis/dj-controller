// Concern: the demo's build: both pages, relative paths for any Pages base, workers as ES modules | Non-concern: what the pages do (src/) | IO: (index.html, basics.html, src/) -> dist/
import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  worker: { format: 'es' },
  build: { target: 'es2023', rolldownOptions: { input: { main: 'index.html', basics: 'basics.html' } } },
})
