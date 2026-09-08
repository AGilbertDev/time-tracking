# The quota calculation engine

## Intent

This turns recorded tasks into the throughput figures the work is reviewed and priced against, one
row per kind of work per period, for the day, the week, the month and the year. It also reports how
much of each scheduled day no task accounts for, which is a warning that the logging is incomplete
rather than a measure of idle time. It is pure server-side calculation plus one authenticated read,
so the stats bar that follows in PLAN-23 is a view with no arithmetic of its own.

## Prior art

memoQ's editing time report divides source words by the actual editing time recorded per segment.
That is the same words-over-time shape used here, and it is the industry precedent for measuring
throughput per kind of work rather than against a scheduled day. Toggl and Clockify both report time
by category for a period and stop there, because a general tracker has no output target to compare
against. Harvest computes a billable figure as an amount over hours, so the arithmetic pattern is
ordinary bookkeeping rather than anything invented here.

Where this differs is that the target is per category. No general tracker does that, because none of
them knows that revising runs four times faster than translating. The difference is deliberate and it
is most of the reason the product exists.

Three corrections to the record, made here rather than left to mislead the next reader. The research
note in [overview.md](overview.md) says the headline quota "divides by scheduled hours", which
described the availability model the buckets decision superseded on 2026-07-29. This feature divides
by scheduled hours nowhere. Scheduled hours reach only the leftover in AC10. The overview's own
PLAN-22 entry then carries two stale criteria that this document replaces. Its AC3 names `words_done`,
which migration 0008 dropped. Its AC6 describes overtime raising the quota over a fixed scheduled
denominator, which is availability arithmetic the per-category buckets removed.

## Inputs

`GET /api/stats`. Session required, no body, no writes.

- `date`, optional, `YYYY-MM-DD`. The anchor the four periods derive from. Defaults to today in the
  user's own timezone.

Reads, every one scoped to the session user. Tasks over the union of the four ranges, the user's
`category_quotas` rows, the `day_settings` rows in range, and the `work_schedule` history.

## Outputs and acceptance criteria

AC1. One anchor date resolves four periods, the day, the week through the shipped `getWeekRange`, the
month, and the year. Each period carries a row for every trackable category holding at least one task
in range, and no row for a category holding none.

AC2. A category row reports `words`, `minutes`, `achievedWph`, `targetWph` and `attainment`.
`achievedWph` is words over minutes expressed in hours. `attainment` is summed target minutes over
summed effective minutes. `targetWph` is words over the summed target minutes in hours, which is the
hours-weighted target rather than any single stored figure.

AC3. A task's target minutes are recomputed as its words over its own resolved quota, read through the
shipped `resolveTaskQuota`. The engine never reads `estimated_minutes` as the target.
`server/api/tasks/handlers/write.ts` copies that column straight from the request body and no server
path derives it, so a hand-edited estimate would otherwise rewrite the attainment silently.

AC4. The period headline is the same arithmetic with the category filter removed, so it is summed
target minutes over summed effective minutes across every trackable, non-excluded task in the period.
There is no separate blending rule, which settles the fold the overview left open.

AC5. A non-trackable task contributes no words and no minutes to any category row. Its effective
duration still counts as consumed time under AC10, because a meeting still eats the day.

AC6. A task flagged `exclude_from_stats` contributes neither words nor minutes to its category row,
and its effective duration still counts as consumed. Keeping its minutes while dropping its words
would drag its category's figure down, which is the opposite of what the flag is for.

AC7. The denominator is the shipped `effectiveDuration`, so a task with no actual minutes falls back
to its estimate, per the owner's decision of 2026-07-29. Every row reports `measuredMinutes` and
`assumedMinutes` separately. A period nobody measured reports an attainment of roughly 1 by
construction, and the split is what lets a caller mark that figure as assumed rather than achieved.

AC8. Zero minutes in a bucket yields `null` for `achievedWph` and `null` for `attainment`. No path
returns `Infinity`, `NaN`, or a division by zero.

AC9. Zero words against non-zero minutes yields `achievedWph` 0 and `attainment` 0, which is a real
reading rather than a missing one.

AC10. Each period reports `scheduledMinutes`, `consumedMinutes` and `unaccountedMinutes`. Scheduled
minutes sum the work minutes resolved per date through the day settings snapshot, counting only dates
that are work days under the settings resolved for them. Consumed sums the effective duration of every
task in range, trackable or not, excluded or not. Unaccounted is scheduled minus consumed, and it may
be negative, which reads as working past the schedule.

AC11. A trackable category whose quota resolves to `null` reports its words and minutes with a null
target and a null attainment. That is a user-created category from PLAN-30 carrying no figure, so the
time is never lost and no target is invented for work nobody has described yet.

AC12. A period is computed only from tasks dated inside it. Nothing is cached and nothing is stored,
so editing a past task restates that period and reaches no other. A settings change reaches no past
period at all, which is what the day settings snapshot guarantees.

AC13. The engine is pure and database-free, taking tasks, quota records, day rows and schedule records
as arguments, so every criterion above is unit-testable against fixtures with no database.

AC14. The endpoint requires a session and scopes every read to the session user, never to an id from
the request, so one user can never read another's figures. A malformed `date` returns 400 through the
shipped `sendZodError`.

AC15. One range query per table covers all four periods, over the union of their ranges, so a week
crossing a year boundary is still a single indexed scan over `(user_id, date)`.

## Edge cases and interrupted paths

There are no interrupted paths. This is one authenticated read with no multi-step flow, no token and
no write, so it either answers or it fails and the caller asks again.

- A week crossing a month or a year boundary. The union range in AC15 covers it and each period counts
  only its own dates.
- 29 February and a leap year. Month and year ranges are derived rather than assumed to be fixed
  lengths.
- A task on a non-work day. It joins its category bucket normally. The day contributes no scheduled
  minutes, so the work shows up as negative unaccounted time.
- An empty period. Zero category rows rather than a row of zeroes for every category, with its
  scheduled minutes intact and a leftover equal to them.
- A stored category id the contract no longer knows. `coerceCategory` resolves it to the non-trackable
  fallback, so it reaches consumed time and no bucket.
- `projectWordCount` null. Reads as zero words.
- A zero or negative stored quota. Already guarded inside `resolveTaskQuota`, which treats it as no
  figure at all and falls through to the category.
- A date with no day settings row, which is every day worked before this feature shipped. It resolves
  through the fallback chain in the snapshot spec's AC6, so the figure is the effective-dated schedule
  or `DEFAULT_SCHEDULE`. Existing days are deliberately not backfilled, because there is no honest
  value to backfill them with.

## Out of scope

- The stats bar and every visible string, which is PLAN-23. No French or English copy ships here.
- The performance history view and the export, PLAN-24. The category charts, PLAN-31.
- Any change to how `estimated_minutes` is produced, or to the capacity bar that reads it.
- Caching. Every figure is computed per request.

## Verification

- `bun run test` exits 0, run unpiped. The `workflow:unit-test` agent derives fixtures for AC1 through
  AC13 from this document before the engine exists, and they arrive failing.
- `bun run lint` exits 0, run unpiped.
- Against the seeded dev database, one category row is checked by hand. Words and minutes are read off
  the seeded tasks, the figure is worked out separately, and the endpoint has to match it exactly.
- A period with no tasks and a period whose tasks carry no actual minutes are both requested, proving
  AC8 and AC7 on real data rather than only in fixtures.
- A work-settings change is saved and a past period is re-requested, confirming its figures do not
  move. That is the whole point of the snapshot and it is checked end to end rather than trusted.
- No browser verification, because the feature ships no interface.

## Open questions

None.
