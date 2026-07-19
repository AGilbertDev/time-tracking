# Manage users table: server-side sort and search

## Intent

The admin manage-users table needs sortable column headers and a search box, with sorting, searching, and pagination all done on the server against the full merged dataset. This builds on the existing feature specified in `docs/specs/admin/manage-users.md`. It changes only how the list endpoint and the list UI behave. Invite, deactivate, reactivate, retention, auth gating, and the derived-status model are unchanged and stay authoritative in `manage-users.md`.

This spec supersedes two narrow parts of `manage-users.md`: the default page size (was 20, now 12) and the list ordering contract (was fixed date-descending, now a whitelisted server sort that defaults to date-descending). Where the two specs describe the list endpoint, this one wins.

## Motivation

Today the list endpoint (`server/api/admin/users/handlers/list.ts`) sorts the full merged set in memory then slices the page, which is correct, but the table headers are not sortable and there is no search. Any sort or filter added on the client would only reorder or hide the rows already loaded for the current page. That silently breaks the moment the list spans more than one page, because the "top" row after a client sort is only the top of the twelve rows on screen, not the top of the whole dataset. The fix is the backend convention in `.recipes/skills/my-backend-conventions/SKILL.md` under "List endpoints": paginate, sort, and search on the server, and return the page rows plus a total count. This feature brings the endpoint and the page in line with that convention.

## Scope

In scope:

- Default page size changes from 20 to 12. Both the backend `ListQuerySchema` default and the client `PAGE_SIZE` constant become 12.
- A search box above the table that filters by email or name, case-insensitive substring match, trimmed, debounced on the client, and applied on the server.
- Sortable column headers for firstName, lastName, email, role, status, and date, sorted on the server against the full filtered dataset before the page is sliced.
- An extended request contract adding `sort`, `order`, and `search` query params, with the sortable columns whitelisted by a Zod enum.
- New pure, unit-testable filter and sort helpers in `server/utils/manage-users.ts`.
- A no-results empty state distinct from the no-users-at-all empty state, with a way to clear the search and recover the full list.
- New `adminUsers.search.*` i18n keys and a no-results empty state key, in both FR and EN.

Out of scope (do not build):

- Any change to invite, deactivate, reactivate, retention, the derived-status rules, or the admin gating. Those stay as specified in `manage-users.md`.
- Multi-column sort, or a sort on the actions column.
- Column show/hide controls, column reordering, or persisting the chosen sort and search across reloads.
- Full-text ranking, fuzzy matching, or searching on role, status, or date. Search is name and email only.
- Any new stored data or new personal data. This is a read-only view over fields the admin already sees.

## Inputs

Query params on `GET /api/admin/users`:

- `page` — 1-based page number. `z.coerce.number().int().min(1)`, default 1.
- `pageSize` — rows per page. `z.coerce.number().int().min(1).max(100)`, default 12.
- `sort` — the column to sort by. A Zod enum of the whitelisted columns (see below), default `date`.
- `order` — sort direction. `z.enum(['asc', 'desc'])`, default `desc`.
- `search` — optional filter term. Trimmed string, empty or absent means no filter. Cap the length (for example max 200) so a caller cannot pass an unbounded term.

Client-initiated actions on the page:

- Typing in the search box (debounced) sets `search` and resets `page` to 1.
- Clicking a sortable header sets `sort` and toggles `order`, and resets `page` to 1.
- Clicking the pager sets `page`.

The page keeps forwarding the session cookie on SSR through `requestHeaders`, exactly as it does today, so a hard reload with any sort or search in flight still authenticates.

## Request and response contract

Request:

```
GET /api/admin/users?page=<n>&pageSize=<n>&sort=<col>&order=<asc|desc>&search=<term>
```

Response (shape unchanged from today, `total` now reflects the filtered count):

```json
{
  "page": 1,
  "pageSize": 12,
  "rows": [
    {
      "firstName": "…|null",
      "lastName": "…|null",
      "email": "…",
      "role": "…|null",
      "status": "invited|active|deactivated",
      "date": "<iso>"
    }
  ],
  "total": 0,
  "totalPages": 1
}
```

- `total` is the count of rows after search filtering, across the whole merged dataset, not the page length.
- `totalPages` is `max(1, ceil(total / pageSize))`.
- A `page` beyond `totalPages` returns an empty `rows` array with an accurate `total` and `totalPages` rather than an error.

## Server processing order

The list stays the in-memory union of `allowed_emails` and `users`, keyed by lowercased email, because the dataset is tiny and reading both tables fully is intentional. Because `status` is derived and the rows are merged in memory, filtering and sorting must run on the shaped rows before the page is sliced. The fixed order is:

1. Read both tables and merge into one record per distinct email (unchanged).
2. Shape each record into a `UserListRow` with `shapeUserListRow` (unchanged).
3. Filter the shaped rows by `search`.
4. Sort the filtered rows by `sort` and `order`.
5. Set `total` to the filtered, pre-slice length.
6. Slice the page with `getPageBounds`.

Steps 3 and 4 are new pure functions in `server/utils/manage-users.ts`, kept database-free and total over their inputs so the unit-test stage covers them without a database. Suggested shapes, the backend stage may refine names:

- `filterUserRows(rows: UserListRow[], search: string): UserListRow[]`
- `sortUserRows(rows: UserListRow[], sort: SortColumn, order: SortOrder): UserListRow[]`

`SortColumn` and `SortOrder` types live alongside these helpers, and the Zod enum in `server/models/admin.ts` is derived from the same source of truth so the whitelist and the type cannot drift.

## Sortable column whitelist

Only these columns may be sorted. The `sort` param is a Zod enum over exactly this set. A raw column name from the query string is never used to sort.

| `sort` value | Sort key      | Comparison                                            |
| ------------ | ------------- | ----------------------------------------------------- |
| `firstName`  | row.firstName | case-insensitive string compare, nulls last           |
| `lastName`   | row.lastName  | case-insensitive string compare, nulls last           |
| `email`      | row.email     | case-insensitive string compare (`localeCompare`)     |
| `role`       | row.role      | case-insensitive string compare, nulls last           |
| `status`     | row.status    | canonical enum value compare, not the localized label |
| `date`       | row.date      | timestamp compare                                     |

Sorting rules:

- Direction is applied per `order`. `asc` is natural ascending, `desc` reverses it.
- Null `firstName`, `lastName`, and `role` (invited-only rows have no name or role) always sort to the end regardless of `order`, so invited-only rows never crowd the top just because their fields are empty.
- `status` sorts by the canonical value (`active`, `deactivated`, `invited`), never by the translated label, so the order is stable and locale-independent on the server. The frontend header indicator must reflect that this is a status grouping, not an alphabetical sort of the visible French or English words.
- Every sort is tie-broken by email ascending, so pages stay stable across requests even when the primary key ties.

Default sort is `sort=date`, `order=desc`, which reproduces today's behaviour exactly: newest effective date first, ties broken by email ascending. The effective date is `users.createdAt` for accounts and `allowed_emails.invitedAt` for invited-only rows, as already defined by `shapeUserListRow`.

Because the default sort is a real sort, the date column header shows its active descending indicator on first paint, before the admin clicks any header. The header must tell the truth about the order the rows are already in.

## Search behaviour

- The term is trimmed. Empty or whitespace-only means no filter, and all rows pass.
- Match is case-insensitive and diacritic-insensitive substring. A row matches when the folded term is a substring of its folded email, firstName, or lastName. Invited-only rows have null name fields, so they match on email only.
- Folding is required, not optional. This is a French-first translator product, so "Genevieve" must match "Geneviève" and "francois" must match "François". Before the substring test, both the search term and each field are normalized with `String.prototype.normalize('NFD')`, stripped of combining diacritic marks (the `̀`-`ͯ` range), and lowercased. Both sides go through the same fold so the comparison is symmetric.
- Null name fields are treated as no text for matching, never as a match.
- Filtering happens on the server against the full merged set before pagination, so a match on page five is found from page one.
- The fold-and-match logic lives inside the pure `filterUserRows` helper in `server/utils/manage-users.ts` so it stays database-free and unit-testable, including the accent cases.
- On the client the input is debounced (around 250 to 300 ms) before it updates the query, and updating the term resets `page` to 1.

## Acceptance criteria

- [ ] The list endpoint accepts `page`, `pageSize`, `sort`, `order`, and `search`, validated by Zod at the route boundary, and rejects nothing that today's contract accepted.
- [ ] `pageSize` defaults to 12 on the server, and the client requests 12 per page. `UPagination` uses 12 items per page.
- [ ] With no `sort`, `order`, or `search`, the response is identical in order and contents to the pre-change endpoint (date descending, ties by email ascending).
- [ ] `sort` only accepts the whitelisted columns. Sorting is never performed against a raw column name from the query string.
- [ ] Sorting by each whitelisted column, in each direction, orders the full filtered dataset and returns the correct page of that order, not a re-order of one page.
- [ ] Invited-only rows (null firstName, lastName, role) sort to the end for name and role sorts in both directions, and every sort is deterministically tie-broken by email ascending.
- [ ] `status` sorts by canonical value and produces the same order regardless of the request or user locale.
- [ ] Search filters by email or name, case-insensitive and diacritic-insensitive, substring, trimmed, and an empty or whitespace-only term returns all rows. "Genevieve" matches "Geneviève".
- [ ] The date column header shows its active descending sort indicator on first paint, reflecting the real default sort.
- [ ] `total` reflects the filtered count, and `totalPages` is `max(1, ceil(total / pageSize))`.
- [ ] Changing the search term or the sort resets the client to page 1.
- [ ] A search that matches nothing returns `total: 0`, `totalPages: 1`, and an empty `rows` array, and the UI shows a no-results state with a control that clears the search and restores the full list.
- [ ] A `page` beyond `totalPages`, for the current filter, returns empty `rows` with an accurate `total` and `totalPages` rather than an error.
- [ ] The filter and sort logic lives in pure, database-free functions in `server/utils/manage-users.ts` and is unit-tested.
- [ ] New `adminUsers.search.*` keys and the no-results empty-state key exist in both `i18n/locales/fr.json` and `i18n/locales/en.json`, with FR respecting the space before `? ! : ;`.
- [ ] Sortable headers expose their sort state accessibly (for example `aria-sort`) and are operable by keyboard, and reuse the existing `adminUsers.table.*` labels.

## i18n keys to add

Under the existing `adminUsers` namespace, FR default then EN, all proposed and owner-verified before ship. Sort affordances reuse the existing `adminUsers.table.*` header labels, so no new keys are needed for sorting itself.

| Key                               | FR (proposed)                                      | EN (proposed)                |
| --------------------------------- | -------------------------------------------------- | ---------------------------- |
| `adminUsers.search.placeholder`   | Rechercher par nom ou courriel                     | Search by name or email      |
| `adminUsers.search.label`         | Rechercher un utilisateur                          | Search users                 |
| `adminUsers.search.clear`         | Effacer la recherche                               | Clear search                 |
| `adminUsers.empty.noResultsTitle` | Aucun résultat                                     | No results                   |
| `adminUsers.empty.noResultsHint`  | Aucun utilisateur ne correspond à votre recherche. | No user matches your search. |

`adminUsers.search.label` and `adminUsers.search.clear` are the accessible names for the input and its clear control. The existing `adminUsers.empty.title` and `adminUsers.empty.hint` stay for the no-users-at-all case, and the new no-results keys cover the searched-but-empty case, so the two empty states never share wording. None of the proposed strings above carry `? ! : ;`. Any string the owner rewrites to include one takes the French space before it.

## Edge cases

- **Search matches nothing.** Server returns an empty page with `total: 0`. The UI shows the no-results empty state, not the no-users empty state, and offers a clear-search control so the admin recovers the full list without reloading. A filter that hides every row and cannot be undone would be a dead end, so the clear affordance is required, not optional.
- **Search narrows the result while on a later page.** Changing the term resets the client to page 1, so the admin never lands on an out-of-range page after filtering. If a stale or hand-edited request still asks for an out-of-range page, the server returns empty `rows` with an accurate `total`, and the pager lets the admin step back to a valid page.
- **Sort change while on a later page.** Changing the sort resets the client to page 1 for the same reason.
- **Whitespace-only or absent search.** Treated as no filter. All rows pass.
- **Invalid or stale `sort` or `order` value.** These come only from the client, but a bad or stale value must not strand the admin on an error page. Prefer degrading a bad enum value to the default (`sort=date`, `order=desc`) rather than returning 400, so a stale bookmarked query still renders the list. The backend stage decides between a Zod `.catch(default)` and returning `sendZodError`, and this spec prefers the fail-safe degrade.
- **Invited-only rows under name and role sorts.** Their null fields sort last in both directions, and they still sort among themselves by the email tie-break, so the order is deterministic.
- **A mutation while a filter is active.** After an invite, deactivate, or reactivate the list is refreshed with the current `page`, `sort`, `order`, and `search` still applied, so the admin stays in the same view. If the acted-on row no longer matches the active filter, it simply drops out of the filtered result, which is expected.
- **Long search term.** Capped by the schema max length, so an oversized term is rejected or truncated rather than processed unbounded.

## Resolved decisions

Both prior open questions are decided and folded into the sections above.

1. **Accent-insensitive search.** Yes, implemented in this pass. Search is diacritic-insensitive as well as case-insensitive, so "Genevieve" matches "Geneviève". Both the term and each field are normalized with `normalize('NFD')`, stripped of combining marks, and lowercased before the substring test, inside the pure `filterUserRows` helper so the accent cases are unit-testable. See "Search behaviour".
2. **Default sort indicator on first paint.** Yes. The date column header shows its active descending indicator on initial load, reflecting the real default sort. See "Sortable column whitelist".
