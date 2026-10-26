# Food safety & quality performance platform

A health & safety inspection app for airline catering units: a 303-point
checklist that defaults to satisfactory, per-unit customisation, photo evidence,
and emailed reports.

**It runs on Cloudflare.** One Worker serves the React app and the API, D1 holds
the data, and pushing to GitHub deploys it.

**Setting it up for the first time?** → **[docs/START-HERE.md](docs/START-HERE.md)**

Three phases, each ending with something that visibly works:
**1.** the app is online · **2.** photos go to Drive · **3.** reports arrive by email.

Reference, once it is running:
[docs/cloudflare-setup.md](docs/cloudflare-setup.md) ·
[docs/photos-and-reports.md](docs/photos-and-reports.md) ·
[docs/free-plan-limits.md](docs/free-plan-limits.md)

## Layout

| Path | What it is |
| --- | --- |
| `web/` | The React app. Built to `web/dist`, served by the Worker. |
| `worker/` | The Cloudflare Worker: API, database, storage, nightly jobs. |
| `docs/` | Setup and operations guides. |
| `appscript/` | The Google Apps Script build. Superseded — see below. |
| `server/` | The Node/Express build. Superseded — see below. |
| `backend/`, `frontend/`, `j512-sanitizer-automation/` | Earlier projects, kept for reference. Not part of this app. |

## The two older builds

The same app was built twice before, and both still work:

- **`server/`** — Node, Express, SQLite or Postgres. The Cloudflare worker is a
  port of this: same schema, same rules, same tests. Kept because it is the
  easiest version to read and to run on a laptop.
- **`appscript/`** — Google Apps Script with the data in a Google Sheet. Built
  when the plan was to stay inside Google. Kept because it needs no account
  anywhere but Google, and because a spreadsheet you can open is a real
  advantage for a small deployment.

Neither is maintained alongside the Worker. If you change the app, change the
Worker; the others will drift.

## Tests

```
npm test --prefix worker    # 120 tests, the deployed build
npm test --prefix web       #  8 tests
npm test --prefix server    # 85 tests, the superseded Node build
```
