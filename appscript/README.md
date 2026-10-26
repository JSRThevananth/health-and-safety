# Apps Script build

The platform rebuilt on Google Apps Script: the UI is served by HtmlService, data
lives in Google Sheets, photos in Drive, and report email goes out through Brevo.

Nothing to host, nothing to deploy, no cold starts, no monthly bill.

## How the pieces map

| Node version | Apps Script version |
|---|---|
| Express routes | `google.script.run` calls into `Api.gs` |
| Postgres / SQLite | Sheets tabs, one per table, via `Db.gs` |
| bcrypt | PBKDF2-style hashing in `Crypto.gs` |
| JWT sessions | Signed tokens in `Auth.gs`, kept in `CacheService` |
| Drive REST API | `DriveApp`, native |
| Brevo over fetch | Brevo over `UrlFetchApp`, same API |
| Transactions | `LockService`, one writer at a time |

## The UI is the same React app

The existing interface is not rewritten. It is built by Vite and inlined into
`html/Index.html`, with one change: `web/src/lib/api.js` detects it is running
inside Apps Script and routes calls through `google.script.run` instead of
`fetch`. The same components, styling and themes are used in both.

Run `npm run build:appscript` from `web/` to regenerate.

## Layout

```
src/
  Config.gs        Spreadsheet id, Brevo keys, tunables
  Db.gs            Sheets-as-tables: read, append, update, locking
  Schema.gs        Tab definitions and first-run bootstrap
  Crypto.gs        Password hashing and token signing
  Auth.gs          Sign in, sessions, forced password change
  Permissions.gs   Roles, per-user grants, unit scoping
  Library.gs       The 303-item checklist library
  Templates.gs     Per-unit versioned checklists
  Inspections.gs   Drafts, autosave, submit, sign-off
  Mailer.gs        Brevo
  Storage.gs       Photo evidence in Drive
  Api.gs           The single entry point the UI calls
  WebApp.gs        doGet, serves the UI
html/
  Index.html       Generated - do not edit by hand
```

## Setting it up

See `docs/appscript-setup.md`.

## Testing

Apps Script cannot run outside Google, so `test/harness.js` executes the `.gs`
files under Node with stand-ins for the Apps Script globals. The fakes are
deliberately faithful about the things that cause real bugs — Sheets handing back
`Date` objects and blank strings, `appendRow` semantics, row numbers shifting when
a row is deleted, the script lock being genuinely exclusive — rather than being
convenient.

```bash
cd appscript && npm test
```

This proves the logic. It does not prove the Apps Script bindings behave as
assumed, which only running it in Google can. Treat a green suite as necessary,
not sufficient, and check the real thing in the editor before trusting it.

## Why the app creates its own Drive folder

`drive.file` is the narrowest Drive scope: it grants access only to files this app
creates, not to the rest of your Drive. Handing the script an existing folder id
would not work under it, and widening to full `drive` scope would give the script
read and write access to everything in the account — far more than storing photos
needs.

So `setUp()` creates its own folder and records the id. Least privilege, and if the
script were ever compromised the blast radius is its own folder.

## The web app is publicly reachable by design

`access: ANYONE_ANONYMOUS` is deliberate: floor inspectors do not have Google
accounts, which is the same reason the Node build kept username sign-in rather than
using email.

The consequence is that **the app's own authentication is the only gate**. Anyone
who finds the URL reaches the sign-in screen. That raises the stakes on the password
hashing and session handling in `Crypto.gs` and `Auth.gs`, and it is why those are
written and reviewed more carefully than anything else here.

If every user did have a Google Workspace account, switching `access` to
`DOMAIN` and letting Google handle sign-in would be stronger than anything
hand-rolled. Worth revisiting if that ever becomes true.

---

## Superseded

The app now runs on Cloudflare — see
[docs/cloudflare-setup.md](../docs/cloudflare-setup.md). This build still works
and is kept for reference, but changes go to `worker/` and will not be mirrored
here.
