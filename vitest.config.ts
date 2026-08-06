import { fileURLToPath } from 'node:url'
import { configDefaults, defineConfig } from 'vitest/config'

// Minimal Vitest setup for pure-logic unit tests only. The node environment is
// deliberate, since these tests never touch a Nuxt runtime, a browser DOM, or a
// live database. Tests live in a dedicated top-level test/ folder that mirrors the
// source tree, so they resolve modules through the same aliases the app and server
// use rather than relative paths. #shared mirrors the Nuxt shared auto-import, and
// ~~ points at the project root so a test can import ~~/server/... the Nuxt way.
export default defineConfig({
  test: {
    environment: 'node',
    // .claude/worktrees holds throwaway copies of the repository that agents
    // create while they work, so collecting their tests was never meaningful.
    // Vitest replaces its default exclude list rather than extending it, so the
    // defaults are spread back in here.
    exclude: [...configDefaults.exclude, '**/.claude/**']
  },
  resolve: {
    alias: {
      '#shared': fileURLToPath(new URL('./shared', import.meta.url)),
      '~~': fileURLToPath(new URL('.', import.meta.url))
    }
  }
})
