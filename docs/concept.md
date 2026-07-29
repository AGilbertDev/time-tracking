# Planning de traduction — Concept Document

Captures what the original `planning` app **did** as a product. Treat as background only — the rebuild picks its own stack, styling, and architecture.

---

## What it is

A personal planning tool for a freelance translator. The user uses it to log their translation tasks day by day, track how long each job takes, and see the user's productivity (words per hour) over time. The original was a single-user, browser-only app with no backend — data lived in `localStorage` and was backed up by exporting / importing a JSON file manually.

The UI is entirely in **French**.

---

## Data model

### Task

The single entity. One task = one piece of work for one client on one day.

- `client` — client company name
- `pm` — project manager contact
- `project` — project number / name (the key used to group tasks across days)
- `task` — type of work (translation, revision, etc.)
- `delivery` — due date
- `time` — delivery time
- `wordCount` — total words for the project
- `ratePerHour` — productivity target (default **450 words/hour**)
- `estimatedDuration` — auto-calculated from `wordCount / ratePerHour`
- `actualDuration` — how long it actually took
- `status` — `Accepté` | `En cours` | `Terminé`
- `instructions` — free-text notes
- `excludeFromStats` — opt this task out of the WPH calculation

Tasks are grouped **by date** (one bucket per calendar day in **America/Toronto** time).

---

## Core business logic

### Estimated duration

`wordCount / ratePerHour`, rounded to the nearest **5 minutes**.

Examples:
- 900 words ÷ 450 wph → 2h00
- 700 words ÷ 450 wph → 1h35 (93.3 min rounded up to 95 min)

Actual duration defaults to a copy of estimated. As soon as the user edits actual manually, it decouples and stays independent.

### Work-day target

**7 hours 30 minutes** per day. Each day header shows:
- `Planifié` — actual time logged / 7h30 target
- `Restant` — how much is left to reach target
- `Excédant` — how much over target

### Corrected words-per-hour stats

The WPH stat is "corrected" so a project that spans multiple tasks/days isn't double-counted:

1. Skip tasks marked `excludeFromStats`, with no project, or with zero actual time.
2. Group remaining tasks by **project name** (case-insensitive, trimmed).
3. For each project: take the **max wordCount** across its tasks (the project's true total), and sum all actual minutes spent on it.
4. Final WPH = (sum of project max-words) / (sum of project minutes) × 60.

Shown for three periods: **current week** (Mon–Fri), **current month**, **current year**.

---

## UX patterns

### Week view

- Always shows **Monday to Friday** of the selected week.
- Each day is its own block with its own task list.
- Navigation: previous week · "Aujourd'hui" (snaps back to current week and scrolls today into view) · next week.
- Header label is French: `Semaine du 23 juin au 27 juin 2025`.
- Today's day block is visually distinguished from the rest.

### Task list (per day)

- Always shows at least **3 rows**, padded with empty placeholders. Empty rows are NOT saved; they vanish on save.
- Add, duplicate, delete, reorder via drag-and-drop.
- Drag works **within a day** and **across days** in the same week view.

### Task row

- Compact by default: client · project · delivery date/time · word count · estimated duration · actual duration · status · row actions.
- Clicking a cell expands the row inline to a full edit form. Clicking outside collapses it.
- Status is a colored badge that **cycles on click**: `Accepté` → `En cours` → `Terminé` → back.
- Daily totals at the top of each day update as actual durations change.

### Expanded edit form

Adds editors for the fields not shown in the compact row:
- Project manager (`pm`)
- Task type
- Quota override (`ratePerHour`)
- Exclure des stats toggle
- Free-text instructions (resizable)
- Recurrence widget (start, end, weekday picker) — Mon–Fri only

### Stats bar

Collapsible accordion at the top showing the three WPH numbers (week / month / year) for the period currently in view.

### Import / Export

- **Export** downloads a JSON file with all tasks, filename `planning_YYYY-MM-DD.json`.
- **Import** loads a JSON file and replaces all data. Tolerates older exports that used French month names in the date keys.

---

## What was missing or broken (user-facing)

- **Recurring tasks never worked.** The recurrence widget existed in the expanded edit form (toggle, start/end dates, weekday checkboxes) but nothing was ever saved or repeated — UI only.
- **PM and task-type fields were invisible** in the compact row even though they existed in the data and the edit form.
- **No search or filter** — no way to find a task by client or project across dates.
- **No monthly / yearly summary view** — only the one-week view existed.
- **Daily target was hard-coded** at 7h30; not user-configurable.
- **No real backup** beyond manual JSON export — clearing browser storage wiped everything.
- **No validation** — any value could be typed into any field.

---

## What worked well (worth preserving in spirit)

- The **corrected WPH algorithm** (group by project, max-words per project) is the smart core of the app.
- **Inline row expansion** (click to edit, click outside to collapse) felt natural for fast daily entry.
- **Auto-syncing actual duration from estimated** saved clicks on days that went as planned.
- **Excluding tasks from stats** is a useful escape hatch for non-translation work (admin, training, etc.).
- **Status cycling on click** is fast and obvious.
- **Drag-and-drop across days** matched how the user actually rearranges their week.
- **JSON import/export** is a simple, portable backup mechanism for a solo user.
