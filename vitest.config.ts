import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Minimal Vitest setup for pure-logic unit tests only. The node environment is
// deliberate, since these tests never touch a Nuxt runtime, a browser DOM, or a
// live database. The #shared alias mirrors the Nuxt auto-import so modules under
// test can resolve #shared/theme the same way they do in the app and server.
export default defineConfig({
  test: {
    environment: 'node'
  },
  resolve: {
    alias: {
      '#shared': fileURLToPath(new URL('./shared', import.meta.url))
    }
  }
})
