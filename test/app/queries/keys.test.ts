import { queryKeys } from '~~/app/queries/keys'
import { describe, expect, it } from 'vitest'

import { code, sourceFiles } from '../../helpers/sourceScan'

// The central query-key factory, from its own declared contract:
//
//   "Central query-key factory. Every query and mutation reads its keys from here so the keys a
//   mutation invalidates always match the queries that produced them. Add one function per key."
//
// It is pure data, so importing it is most of the coverage. What earns the rest is the failure mode
// this module exists to prevent, which nothing else in the suite can catch. A TanStack Query cache
// is addressed by a hashed key, and `invalidateQueries` matches a query by prefix on that hash. So a
// renamed key, a duplicated key, or a key retyped as a literal at one call site out of six does not
// throw, does not fail a type check, and does not fail any test of the composables. It silently
// stops invalidating: the mutation reports success, the cache keeps the stale row, and the profile
// page shows the old name until a hard reload. That is an invisible bug with no other guard, and it
// is the reason the assertions below are about identity and stability rather than about values.
//
// Five mutations invalidate `queryKeys.me()` (upload avatar, remove avatar, update profile, complete
// onboarding, reset onboarding) and `useMeQuery` reads with it. Six call sites, one key.

// Every key factory the module exposes, so the scans below are total rather than a list of the keys
// that happened to exist when this file was written. A factory added without a case here still gets
// checked for stability and distinctness.
const factories = Object.entries(queryKeys)

// The subset that can be called with no arguments. Every key is parameterless today; a future key
// taking an id would be excluded here rather than called with nothing and made to throw.
const parameterless = factories.filter(([, factory]) => factory.length === 0)

describe('the shape of the factory', () => {
  // "Add one function per key." A key exposed as a bare array rather than a function would be a
  // shared mutable object every call site holds a reference to.
  it('exposes every key as a function', () => {
    expect(factories.length).toBeGreaterThan(0)
    for (const [name, factory] of factories) {
      expect(typeof factory, `queryKeys.${name} must be a function`).toBe('function')
    }
  })

  // TanStack Query requires an array key; a bare string is not a valid query key and would not
  // match a prefix invalidation the way the call sites assume.
  it('returns an array from every key', () => {
    expect(parameterless.length).toBeGreaterThan(0)
    for (const [name, factory] of parameterless) {
      expect(Array.isArray(factory()), `queryKeys.${name}() must return an array`).toBe(true)
    }
  })

  // The key is hashed to address the cache, so every segment has to be deterministically
  // serializable. A function, a symbol, or a Date in a key hashes to something that does not survive
  // a round trip and would not match itself between a query and an invalidation.
  it('returns only serializable primitive segments', () => {
    for (const [name, factory] of parameterless) {
      for (const segment of factory()) {
        expect(
          ['boolean', 'number', 'string'],
          `queryKeys.${name}() segment ${String(segment)} must be a primitive`
        ).toContain(typeof segment)
      }
    }
  })

  it('returns a non-empty key from every factory', () => {
    for (const [name, factory] of parameterless) {
      expect(factory().length, `queryKeys.${name}() must not be empty`).toBeGreaterThan(0)
    }
  })
})

describe('the keys are stable', () => {
  // The whole mechanism rests on this. A mutation calls the factory in `onSuccess` and the query
  // called it at setup, so if the two calls do not hash identically the invalidation matches nothing
  // and the stale row stays in the cache.
  it('hashes identically on every call', () => {
    for (const [name, factory] of parameterless) {
      expect(JSON.stringify(factory()), `queryKeys.${name}() must be stable`).toBe(
        JSON.stringify(factory())
      )
    }
  })

  // The exact serialized form of the one key that exists, pinned. Six call sites read it and a
  // rename is invisible to every one of them, so this is the case that turns a silent
  // stop-invalidating into a red test.
  it("addresses the current user under exactly ['me']", () => {
    expect(queryKeys.me()).toEqual(['me'])
    expect(JSON.stringify(queryKeys.me())).toBe('["me"]')
  })
})

describe('the keys are distinct', () => {
  // Two factories hashing to the same key would make one resource's mutation invalidate the other's
  // query and leave its own stale, and neither side would report anything. With one key today this
  // is trivially satisfied, which is the point of scanning the module rather than naming pairs: the
  // second key added is the one that can collide.
  it('no two factories produce the same key', () => {
    const hashed = parameterless.map(([, factory]) => JSON.stringify(factory()))

    expect(new Set(hashed).size).toBe(hashed.length)
  })

  // A key that is a prefix of another is not a collision but it is not neutral either, because
  // invalidateQueries matches by prefix, so invalidating the shorter one silently invalidates the
  // longer one too. That is sometimes wanted and sometimes a surprise, so it is surfaced here rather
  // than discovered later.
  it('no key is a prefix of another', () => {
    const keys = parameterless.map(([, factory]) => factory() as readonly unknown[])

    for (const [index, key] of keys.entries()) {
      for (const [otherIndex, other] of keys.entries()) {
        if (index === otherIndex) continue
        const isPrefix =
          key.length < other.length && key.every((segment, position) => segment === other[position])
        expect(
          isPrefix,
          `${JSON.stringify(key)} must not be a prefix of ${JSON.stringify(other)}`
        ).toBe(false)
      }
    }
  })
})

// The guard that makes the module central rather than merely available. Everything above holds only
// if every call site goes through it, and a single retyped `['me']` at one of the six would not
// break the build, would not fail a type check, and would keep working right up until the key
// changed here. This concludes from an absence, so it reads the sources with comments stripped
// through the shared scanner: a search that never saw the code reports the same clean result as one
// that saw it and found nothing.
describe('every call site reads its key from here', () => {
  const callSites = sourceFiles('app', ['.ts', '.vue'])
    .filter((path) => path !== 'app/queries/keys.ts')
    .map((path) => ({ path, source: code(path) }))
    .filter(({ source }) => source.includes('queryKey'))

  it('finds the call sites at all, before concluding anything from an absence', () => {
    // The positive control. Without this, deleting every call site or breaking the scanner would
    // make the case below pass for the wrong reason.
    expect(callSites.length).toBeGreaterThan(0)
  })

  it('passes no literal array as a queryKey anywhere in app/', () => {
    for (const { path, source } of callSites) {
      for (const match of source.matchAll(/queryKey\s*:\s*([^,\n}]+)/g)) {
        expect(match[1]?.trim(), `${path} must build its queryKey from queryKeys`).toContain(
          'queryKeys.'
        )
      }
    }
  })
})
