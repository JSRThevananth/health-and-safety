# Project handoff

Paste the block below as the first message in a new chat. It is written to be
self-contained: a fresh session should be able to continue without re-deriving
decisions or re-litigating settled ones.

---

## Continue building my airline catering health & safety inspection web app

**Repository:** `JSRThevananth/QA` — work on branch `claude/web-app-stack-setup-49z2df`
(not `main`). 30 commits of history are there; read `README.md`, `docs/appscript-setup.md`
and `appscript/README.md` before changing anything.

### What this is

A health & safety inspection platform for **gate gourmet** airline catering units.
Inspectors walk an area with a phone, work through a 303-point checklist, record
findings with photos, and a report goes to that unit's recipients. Eventually this
becomes a commercial product sold to other catering companies.

### Hard constraints

- **$0 running cost.** No paid hosting, no paid database, no subscriptions. If
  something requires money, say so before building it.
- Google account for everything: **yulfassembly@gmail.com**
- Email through **Brevo** (free tier, 300/day) — already set up and verified
- Photos in **Google Drive** (free 15 GB)
- Branding is **gate gourmet** green (`#00a651`); logo and hero images are in
  `web/public/brand/`

### Two builds exist. Apps Script is the one to continue

`appscript/` — **the active build.** Google Apps Script, data in Sheets, UI served
by HtmlService, Brevo via UrlFetchApp, photos via DriveApp. Chosen deliberately: no
hosting, no deployment pipeline, no cold starts, nothing to pay, and the data sits
in Drive where the QA team can see it. 74 tests.

`server/` + `web/` — the earlier Node/Express/SQLite build with a React frontend.
**Keep it.** The React UI in `web/` is not dead code: it is the actual interface for
both builds. `npm run build:appscript` compiles it and inlines it into
`appscript/html/Index.html`, and `web/src/lib/appsScriptBridge.js` routes its API
calls through `google.script.run` when it detects Apps Script. 85 + 8 tests.

### Decisions already made — please do not reopen these

These were each argued through at length. Reversing one needs a new reason, not a
restatement of the original one.

1. **Not a SQLite file in Drive.** Drive can only hand over a whole file, so two
   inspectors saving at once silently overwrite each other. This was measured, not
   assumed: five critical findings vanished with no error.
2. **Sheets via Apps Script is different** and is fine, because `LockService` gives
   real mutual exclusion. Every write goes through `dbTransaction`.
3. **Username sign-in, not Google sign-in.** Floor inspectors have no Google
   accounts. This is why the web app is `ANYONE_ANONYMOUS` and the app's own
   authentication is the only gate.
4. **Everything defaults to Satisfactory**; the inspector taps only exceptions. With
   303 items, anything else is unusable. Untouched items are counted and reported at
   sign-off so an inspection cannot silently assert checks nobody made.
5. **Only touched items are stored.** An untouched inspection costs zero rows.
6. **Records are kept; photos are purged.** Photos are ~4,000× the size of the
   record. Ratings, findings and CAPA history stay indefinitely — they are ~2 KB per
   inspection, and deleting them would destroy recurrence detection and probably
   breach statutory retention.
7. **A reworded checklist item keeps its library id**, which is what preserves
   cross-unit comparison and repeat-finding detection.
8. **Sign-off requires a different person** from the inspector.

### What works today

- Roles: `omni_admin` (all units), `unit_admin`, `inspector`, `viewer`, with
  per-user permission overrides and unit scoping
- Forced password change on first sign-in, enforced server-side
- Sign-in rate limiting; salted, stretched password hashing; HMAC session tokens
- The 303-item checklist library, per-unit versioned checklists (edit wording,
  enable/disable, reorder, add custom items)
- Inspections: autosaved drafts, resume, discard, submit, sign-off, all
  unit-scoped, with the template version pinned to each record
- Report email to that unit's recipients only, through Brevo
- Photo upload to Drive with type and size limits

### Not built yet

- **Corrective action (CAPA) tracking** — findings are recorded but not followed to
  closure with an owner, due date and escalation. This is the biggest gap.
- **Threshold alerts** when a unit records repeated or critical findings
- **Monthly PDF report** with charts — the trigger is scheduled, the report is not
  written
- **Messaging** between admins and unit H&S managers
- **Annual cycle** — an annual report was requested; whether the year's data is then
  archived or deleted was left undecided. Records are cheap and deleting them is
  probably a compliance problem, so archiving is the recommendation.
- Offline capture (cold rooms, apron, warehouse aisles have no signal)

### Where it is stuck right now

`clasp` is installed and logged in as yulfassembly@gmail.com, but
`clasp create` fails with *"User has not enabled the Apps Script API"*. The toggle
at `script.google.com/home/usersettings` needs turning on, and it takes several
minutes to propagate. `clasp push` needs it too, so it cannot be avoided while using
clasp.

A Drive folder is already created for the project:
`1ElqvFK_DFaBNVTKEN9Ikq2t1nxF8bRoJ` — use `--parentId` with it. An unrelated older
Apps Script project called *Airline Catering H&S Inspection* exists in the Drive and
must be left alone.

Once that works, `docs/appscript-setup.md` has the full deployment sequence.

### How I would like you to work

- **Test what you build.** `appscript/test/harness.js` runs `.gs` files under Node
  with stand-ins for the Google globals — use it. Apps Script cannot be executed
  outside Google, so say plainly what the tests do and do not prove.
- **Tell me when something is not built rather than making it look built.** A photo
  button that discards the photo is worse than no button.
- **Flag real problems once, then build what I asked for.** Do not re-argue a
  decision I have already made.
- Explain things simply — I am not a developer and I am working on Windows in
  PowerShell.
- Commit and push to `claude/web-app-stack-setup-49z2df` as you go.

### What I would like next

Get the Apps Script deployment working end to end so I can sign in and complete a
real inspection on my phone. Then build corrective action tracking.
