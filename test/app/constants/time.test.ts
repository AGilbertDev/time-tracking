import { DAY_IN_SECONDS, MINUTE_IN_MILLISECONDS } from '~~/app/constants/time'
import * as serverTime from '~~/server/utils/constants/time'
import { describe, expect, it } from 'vitest'

describe('time constants', () => {
  it('MINUTE_IN_MILLISECONDS is 60 000', () => {
    expect(MINUTE_IN_MILLISECONDS).toBe(60_000)
  })

  it('DAY_IN_SECONDS is 86 400', () => {
    expect(DAY_IN_SECONDS).toBe(86_400)
  })

  // server/utils/constants/time.ts duplicates these two, because the client bundle and the Nitro
  // bundle cannot import across each other's alias boundaries. Two copies of one fact is one
  // chance for them to drift, and nothing else in the suite would notice if they did.
  // SESSION_MAX_AGE exists in both files with deliberately different values and is not compared
  // here.
  it('agrees with the server copy of the same constants', () => {
    expect(serverTime.MINUTE_IN_MILLISECONDS).toBe(MINUTE_IN_MILLISECONDS)
    expect(serverTime.DAY_IN_SECONDS).toBe(DAY_IN_SECONDS)
  })
})
