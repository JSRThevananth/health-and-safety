# The monthly spreadsheet

Every unit gets a Google Sheet in your Drive folder, one per month, rebuilt from
the database each night.

```
  D1 (the record)                  Drive
       │                             │
       │  03:10 UTC, nightly         │
       └──  rebuild from scratch  ──▶ Inspections YUL 2026-10
                                      (replaced, never appended to)
```

## Why it is a view and not the database

A spreadsheet is the obvious place to keep inspections, and the wrong one. It
has no constraints, no transactions and no audit trail: two inspectors
submitting at the same moment can silently overwrite each other's row, anyone
with the link can retype a rating, and nothing records that it happened. For a
food-safety record that may be read back in a dispute, those are the three
properties you cannot give up.

So the database stays authoritative and the sheet is generated from it. That
also means the two can never drift — there is no sync to go wrong, because
nothing is ever written to the sheet except a full rebuild.

**An edit made in the spreadsheet is overwritten by the next rebuild.** That is
the intended behaviour, not a limitation. To change a record, change the
inspection.

## What is in it

One row per recorded finding, which is the grain people filter and pivot on.

| | |
| --- | --- |
| Inspection, Date, Unit, Status | which visit this row belongs to |
| Inspector, Department, Shift | who and where |
| Section, Group, Item | the checklist line, worded as the pinned template had it |
| Rating, Note, Risk weight | the finding itself |
| Photos, Photos purged | how much evidence it carries, and how much has aged out |
| Signatures and their timestamps | who signed, and countersigned |

Only items an inspector actually touched are stored — everything else is
satisfactory by definition — so a 303-point inspection with two problems is two
rows, not 303. An inspection where nothing was flagged still gets one row,
marked *no exceptions recorded*: a clean inspection is a result, and it has to
be visible in the month rather than vanishing for having gone well.

Drafts are excluded. An unfinished inspection is not a record.

## When it is rebuilt

- **Nightly at 03:10 UTC**, for the current month.
- **On the 1st and 2nd of a month**, last month as well, so a late submission
  still lands in the month it belongs to before that file is left alone.
- **On demand**, from **Units → the unit → Monthly record → Rebuild in Drive**.

Up to five unit-months per night, ordered by least recently built. More units
than that and they rotate over consecutive nights — nothing is starved, it just
takes a few days to come round.

The file id is remembered, so a rebuild replaces the contents of the same file.
A link to "this month's sheet" stays valid all month, and Drive does not fill up
with one file per night. Delete the file and the next build makes a new one.

## Downloading instead

**Units → the unit → Monthly record → Download spreadsheet** gives the same data
as a CSV, without going near Drive. It opens in Excel directly.

## Two things worth knowing

**Month boundaries are UTC**, like every other timestamp the app stores. A
Montreal inspection submitted at 20:30 on the 31st is in that month; one at
20:30 UTC-4 on the 31st at 21:00 local may land in the next. If that ever
matters for a report, say so and the boundary can follow the unit's own
timezone, which the units table already carries.

**Free text is neutralised against formula injection.** A note beginning `=`,
`+`, `-` or `@` is a formula to Excel and to Sheets, so a finding typed as
`=HYPERLINK(...)` would otherwise become live code the moment a manager opens
the file. Every cell that starts with one of those characters is written with a
leading apostrophe, which makes the spreadsheet treat it as text.

## The nightly budget

The cron is one Worker invocation, and the free plan allows 50 subrequests per
invocation. The purge and the sheet rebuild share them: 20 photos and 5
unit-months, measured at 38 subrequests with both running flat out
(`test/subrequests.test.js` asserts it). Raise either cap without lowering the
other and that test fails — which is the point, because a blown budget means the
whole nightly run does nothing at all.
