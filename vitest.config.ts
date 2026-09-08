import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { configDefaults, coverageConfigDefaults, defineConfig } from 'vitest/config'

// The exclusions file is the one source of truth. The pull request report reads
// it to list what was left out and why, and this config reads it so the totals
// on the pull request agree with the numbers here.
const exclusions = JSON.parse(
  readFileSync(new URL('./.github/test-exclusions.json', import.meta.url), 'utf8')
)

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
    exclude: [...configDefaults.exclude, '**/.claude/**'],
    coverage: {
      include: ['app/**', 'server/**', 'shared/**'],
      exclude: [...coverageConfigDefaults.exclude, ...exclusions.files.map((f) => f.path)],
      reportOnFailure: true
    }
  },
  resolve: {
    alias: {
      '#shared': fileURLToPath(new URL('./shared', import.meta.url)),
      '~~': fileURLToPath(new URL('.', import.meta.url))
    }
  }
})
