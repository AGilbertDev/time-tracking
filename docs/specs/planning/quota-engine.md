# The quota calculation engine

## Intent

This turns recorded tasks into the throughput figures the work is reviewed and priced against, a row
per kind of work per period for the day, week, month and year. It also reports how much of each
scheduled day no task accounts for, which warns that the logging is incomplete rather than measuring
idle time. It is pure server-side calculation plus one authenticated read, so PLAN-23's bar is a view
with no arithmetic.

## Prior art

memoQ's editing time report divides source words by the actual editing time recorded per segment,
which is the same words-over-time shape used here and the industry precedent for measuring throughput
per kind of work rather than against a scheduled day. Toggl and Clockify report time by category and
stop there, a general tracker having no output target to compare against, and Harvest computes a
billable figure as an amount over hours, so the arithmetic is ordinary bookkeeping.

Where this differs is that the target is per category, which no general tracker does because none of
them knows revising runs four times faster than translating. That is deliberate and it is most of the
reason the product exists.

Three things in [overview.md](overview.md) are superseded, annotated here rather than rewritten there,
following that document's own practice of marking a record instead of editing it. Its research note
saying the headline "divides by scheduled hours" is the availability model the buckets decision
replaced on 2026-07-29, so scheduled hours now reach only AC10's leftover, and its PLAN-22 entry
carries an AC3 naming the dropped `words_done` plus an AC6 pricing overtime against that same
denominator.

## Inputs

`GET /api/stats`. Session required, no body, no writes. One optional `date` query param,
`YYYY-MM-DD`, the anchor the four periods derive from, defaulting to today in the user's own timezone.
Every read is scoped to the session user and covers tasks over the union of the four ranges, the
user's `category_quotas` rows, the `day_settings` rows in range, and the `work_schedule` history.

## Outputs and acceptance criteria

Every criterion below is proved by the `describe` block carrying its own number in
`test/server/utils/computeQuotaStats.test.ts`, except where one names its own test. The two range
helpers AC1 needs are proved in `test/shared/planning.test.ts`.

AC1. One anchor date resolves four periods, the day, the week through the shipped `getWeekRange`, the
month, and the year. Each period carries a row for every trackable category holding at least one task
in range, and no row for a category holding none. The row keys on a task being present rather than on
one contributing, so a category whose every task is excluded under AC6 still gets a row of zeroes and
null ratios. Hiding a zero row is presentation and belongs to PLAN-23.

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

AC11. A task **in a trackable category** whose quota resolves to `null` reports its words and minutes
with a null target and attainment, so no target is invented for work nobody has described. The
trackable qualifier matters, since `resolveTaskQuota` returns null for a non-trackable task too and
AC5 puts that one in no bucket at all. A missing quota anywhere in a bucket nulls the whole bucket's
target rather than pricing a partial one, which is fail-closed and is what separates it from AC9's
real zero. **The branch is unreachable today**, an unknown id coercing to the non-trackable `other`
while all four trackable defaults carry a figure, so PLAN-30 reaches it and the exported fold tests it.

AC12. A period is computed only from tasks dated inside it, nothing being cached or stored, so editing
a past task restates that period and reaches no other. A settings change reaches no past period at
all, which is what the day settings snapshot guarantees.

AC13. The engine is pure and database-free, taking tasks, quota records, day rows and schedule
records as arguments.

AC14. The endpoint requires a session and scopes every read to the session user, never to an id from
the request, so one user can never read another's figures. A malformed `date` returns 422 through the
shipped `sendZodError`, that being the code the helper throws for every validation failure in the app.
An earlier draft said 400, which was wrong about the shipped helper. Test
`test/server/api/stats/handlers/getStats.test.ts`.

## Edge cases and interrupted paths

There are no interrupted paths. One authenticated read, no multi-step flow, no token and no write, so
it either answers or fails and the caller asks again.

- A week crossing a month or year boundary, and 29 February. The union range above covers the first
  and each period counts only its own dates; month and year ranges are derived, never fixed lengths.
- A task on a non-work day. It joins its bucket normally and the day contributes no scheduled minutes,
  so the work reads as negative unaccounted time.
- An empty period. Zero category rows, its scheduled minutes intact and a leftover equal to them.
- A stored category id the contract no longer knows. `coerceCategory` resolves it to the non-trackable
  fallback, so it reaches consumed time and no bucket. A null `projectWordCount` reads as zero words.
- A zero or negative stored quota. `resolveTaskQuota` guarded the task's own `quota_wph_override` while
  `resolveCategoryQuota` returned a stored figure untouched, so a zero row there reached the division
  unguarded. An earlier draft claimed the guard covered both, which was wrong, and a one-line ride-along
  fix makes the category figure fall through as the override does. No such row can exist today, the write
  boundary flooring the field at 1, so this was latent rather than live.
- A date with no day settings row, which is every day worked before this shipped. It resolves through
  the snapshot spec's AC6 chain, and existing days are not backfilled for want of an honest value.

## Out of scope

- The stats bar and every visible string, which is PLAN-23. No French or English copy ships here.
- The performance history view and export, PLAN-24, and the category charts, PLAN-31. Any change to how
  `estimated_minutes` is produced or to the capacity bar reading it. Caching, every figure being
  computed per request.

## Verification

- `bun run test` and `bun run lint` both exit 0, run unpiped. The `workflow:unit-test` agent derived
  the fixtures for AC1 through AC13 from this document before the engine existed, arriving failing.
- Against the real dev database, one category row is checked by hand, its figure worked out separately
  from the stored words and minutes, and the engine has to match exactly. The same run proves AC8 on a
  period with no tasks and AC7 on one with no actual minutes.
- A work-settings change is saved and a past period re-read, confirming its figures do not move, which
  is the point of the snapshot and so is checked rather than trusted. No browser verification, the
  feature shipping no interface.
- At code review, one range query per table covers all four periods over the union of their ranges, so
  a week crossing a year boundary stays one indexed scan over `(user_id, date)`. That counts queries
  rather than describing behaviour, so it is read in the diff rather than faked with a spy.

## Open questions

None.
