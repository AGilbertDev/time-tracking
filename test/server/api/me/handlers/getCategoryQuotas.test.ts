import type { Client } from '@libsql/client'

import { loadResolvedCategoryQuotas } from '~~/server/utils/loadCategoryQuotas'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_CATEGORIES } from '#shared/categories'

import type { NitroRecorder } from '../../../../helpers/nitroGlobals'
import type { TaskTestDb } from '../../../../helpers/taskTestDb'

import { installNitroGlobals } from '../../../../helpers/nitroGlobals'
import {
  createTaskTestDb,
  OTHER_USER_ID,
  OWNER_ID,
  seedCategoryQuota
} from '../../../../helpers/taskTestDb'

// getCategoryQuotas, the handler behind GET /api/me/category-quotas.
//
// Derived from AC6 of docs/specs/planning/per-category-quotas.md:
//
//   "Returns one entry per trackable category, in contract order, each already resolved to the
//   figure currently in force."
//
//   "Non-trackable categories are absent rather than present with a null quota. That is AC1
//   expressed as absence, and it means the client renders what it is handed instead of filtering on
//   trackable itself."
//
//   "source says whether the figure came from a stored row or from the shipped default. It exists so
//   the client never infers it."
//
//   "The read is always scoped to the session user, never to an id from the request, matching
//   getWorkSchedule. An unauthenticated request is a 401."
//
// THIS HANDLER IS TWO LINES AND BOTH OF THEM ARE AN AUTHORISATION DECISION, so every case runs
// against a second seeded account holding a quota figure the session user does not, and one
// account's figure appearing in the other's answer is what the scoping cases are looking for.
//
// The expected sets are built from DEFAULT_CATEGORIES rather than retyped, because "in contract
// order" and "one entry per trackable category" are properties of that contract. A hand-typed list
// of four ids and four numbers would be a second copy of it, and adding a trackable category would
// leave this suite green while the endpoint's answer had changed shape.
//
// The seam is useDb. loadResolvedCategoryQuotas is Nuxt-auto-imported by the handler and is put on
// the global as the REAL implementation reading through the mocked useDb, so the resolution and the
// trackable gate both run for real.

const { dbRef } = vi.hoisted(() => ({ dbRef: { current: null as unknown } }))

vi.mock('~~/server/db/index', () => ({ useDb: () => dbRef.current }))

const { getCategoryQuotas } = await import('~~/server/api/me/handlers/getCategoryQuotas')

const event = { __event: true } as never

const SMUGGLED = {
  context: { params: { id: OTHER_USER_ID, userId: OTHER_USER_ID } },
  node: { req: { url: `/api/me/category-quotas?userId=${OTHER_USER_ID}` } },
  path: `/api/me/category-quotas?userId=${OTHER_USER_ID}`
} as never

// The trackable half of the contract, in contract order, read from the contract itself.
const TRACKABLE = DEFAULT_CATEGORIES.filter((category) => category.trackable)
const NON_TRACKABLE_IDS = DEFAULT_CATEGORIES.filter((c) => !c.trackable).map((c) => c.id)

// What an account with no stored row of its own must be handed: every trackable category at its
// shipped figure, each labelled as coming from the default rather than from the user.
const ALL_DEFAULTS = TRACKABLE.map((category) => ({
  categoryId: category.id,
  quotaWph: category.defaultQuotaWph,
  source: 'default'
}))

// The category the fixtures store a figure for, taken as the first trackable one in contract order
// so nothing here hardcodes an id.
const STORED_CATEGORY = TRACKABLE[0]!

// Two figures that are neither account's shipped default and are not each other, so a figure
// appearing in the wrong account's answer is unmistakable.
const OWNER_QUOTA = 321
const OTHER_QUOTA = 987

let harness: TaskTestDb
let client: Client
let recorder: NitroRecorder

beforeEach(async () => {
  harness = await createTaskTestDb()
  client = harness.client
  dbRef.current = harness.db
  recorder = installNitroGlobals()
  recorder.setSession({ email: 'owner@example.com', id: OWNER_ID })

  vi.stubGlobal('loadResolvedCategoryQuotas', loadResolvedCategoryQuotas)
})

describe('getCategoryQuotas', () => {
  describe('AC6: one resolved entry per trackable category, in contract order', () => {
    it('returns the shipped figure for every trackable category when nothing is stored', async () => {
      await expect(getCategoryQuotas(event)).resolves.toEqual(ALL_DEFAULTS)
    })

    it('returns exactly as many entries as the contract has trackable categories', async () => {
      await expect(getCategoryQuotas(event)).resolves.toHaveLength(TRACKABLE.length)
    })

    it('lists the categories in contract order', async () => {
      const entries = await getCategoryQuotas(event)

      expect(entries.map((entry) => entry.categoryId)).toEqual(
        TRACKABLE.map((category) => category.id)
      )
    })

    // "Non-trackable categories are absent rather than present with a null quota."
    it('omits every non-trackable category rather than returning it with no figure', async () => {
      const entries = await getCategoryQuotas(event)

      // The positive half sits alongside the absence, because an endpoint that returned nothing at
      // all would satisfy the absence on its own.
      expect(entries.map((entry) => entry.categoryId)).toEqual(
        TRACKABLE.map((category) => category.id)
      )
      expect(entries.filter((entry) => NON_TRACKABLE_IDS.includes(entry.categoryId))).toEqual([])
    })

    // "source says whether the figure came from a stored row or from the shipped default."
    it("labels the user own stored figure as 'user' and leaves the rest on 'default'", async () => {
      await seedCategoryQuota(client, OWNER_ID, STORED_CATEGORY.id, OWNER_QUOTA)

      const entries = await getCategoryQuotas(event)

      expect(entries).toContainEqual({
        categoryId: STORED_CATEGORY.id,
        quotaWph: OWNER_QUOTA,
        source: 'user'
      })
      expect(entries.filter((entry) => entry.source === 'user')).toHaveLength(1)
    })

    // A row naming a category the contract no longer has must not become an entry. It is left in
    // place rather than deleted, per the resolver's contract, so it has to be harmless.
    it('ignores a stored row for a category id the contract does not have', async () => {
      await seedCategoryQuota(client, OWNER_ID, 'a-retired-category', 4242)

      await expect(getCategoryQuotas(event)).resolves.toEqual(ALL_DEFAULTS)
    })
  })

  describe('AC6: the read is scoped to the session user, never an id from the request', () => {
    it('returns the session user figure while another account holds a different one', async () => {
      await seedCategoryQuota(client, OWNER_ID, STORED_CATEGORY.id, OWNER_QUOTA)
      await seedCategoryQuota(client, OTHER_USER_ID, STORED_CATEGORY.id, OTHER_QUOTA)

      const entries = await getCategoryQuotas(event)

      // Both halves in one case: the other account's figure being absent proves nothing unless the
      // session user's own figure is shown arriving.
      expect(entries).toContainEqual({
        categoryId: STORED_CATEGORY.id,
        quotaWph: OWNER_QUOTA,
        source: 'user'
      })
      expect(entries.map((entry) => entry.quotaWph)).not.toContain(OTHER_QUOTA)
    })

    // The failure mode of a read whose WHERE clause went missing: the session user, who stored
    // nothing, would inherit the other account's figure and be told it was their own.
    it('falls back to the shipped defaults when only another account has stored figures', async () => {
      await seedCategoryQuota(client, OTHER_USER_ID, STORED_CATEGORY.id, OTHER_QUOTA)

      await expect(getCategoryQuotas(event)).resolves.toEqual(ALL_DEFAULTS)
    })

    it('ignores another account id smuggled into the request', async () => {
      await seedCategoryQuota(client, OWNER_ID, STORED_CATEGORY.id, OWNER_QUOTA)
      await seedCategoryQuota(client, OTHER_USER_ID, STORED_CATEGORY.id, OTHER_QUOTA)

      const entries = await getCategoryQuotas(SMUGGLED)

      expect(entries).toContainEqual({
        categoryId: STORED_CATEGORY.id,
        quotaWph: OWNER_QUOTA,
        source: 'user'
      })
    })

    it('answers as whichever account the session names', async () => {
      await seedCategoryQuota(client, OWNER_ID, STORED_CATEGORY.id, OWNER_QUOTA)
      await seedCategoryQuota(client, OTHER_USER_ID, STORED_CATEGORY.id, OTHER_QUOTA)

      const asOwner = await getCategoryQuotas(event)
      recorder.setSession({ email: 'other@example.com', id: OTHER_USER_ID })
      const asOther = await getCategoryQuotas(event)

      expect([
        asOwner.find((entry) => entry.categoryId === STORED_CATEGORY.id)?.quotaWph,
        asOther.find((entry) => entry.categoryId === STORED_CATEGORY.id)?.quotaWph
      ]).toEqual([OWNER_QUOTA, OTHER_QUOTA])
    })
  })

  describe('AC6: an unauthenticated request', () => {
    it('is refused with exactly a 401 while the same call answers under a session', async () => {
      expect.assertions(2)

      recorder.setSession(null)

      await expect(getCategoryQuotas(event)).rejects.toMatchObject({ statusCode: 401 })

      recorder.setSession({ email: 'owner@example.com', id: OWNER_ID })
      await expect(getCategoryQuotas(event)).resolves.toEqual(ALL_DEFAULTS)
    })
  })
})
