# Web Application Stack

Foundation for the new phase of development. This is **plumbing only** — there is no
application domain in it yet. The domain gets designed and built once we scope the app.

## Stack

| Layer     | Choice                    | Cost                                  |
| --------- | ------------------------- | ------------------------------------- |
| Frontend  | React 18 + Vite           | Free (open source)                    |
| Backend   | Node.js 20+ / Express     | Free (open source)                    |
| Database  | SQLite (`better-sqlite3`) | Free — a file on disk                 |
| Auth      | JWT (`jsonwebtoken`) + bcrypt | Free                              |
| Email     | Brevo transactional API   | Free tier: 300 emails/day             |
| Files     | Google Drive API          | Free tier: 15 GB                      |
| Validation| Zod                       | Free                                  |

Everything is a permissively licensed open-source package or a free-tier API, so
development runs at **$0**. Nothing here bills by usage or requires a card.

## Layout

```
server/            Node.js + Express API
  src/config.js      Env-driven config, with a production guard
  src/db/            SQLite connection, schema, seed
  src/middleware/    auth (JWT), validation (Zod), error handling
  src/routes/        auth, attachments, notifications
  src/services/      mailer (Brevo), drive (Google Drive), templates
  test/              API tests (node:test, no test framework needed)

web/               React + Vite frontend
  src/lib/api.js     fetch wrapper: token handling, JSON, error mapping
  src/lib/auth.jsx   session context (restore, sign in, sign out)
  src/pages/         LoginPage, StatusPage (placeholder)

frontend/, backend/, docs/, j512-sanitizer-automation/
                   Previous phase (FastAPI + React). Left untouched.
```

## Running it

```bash
# Terminal 1 — API on :8000
cd server
cp .env.example .env
npm install
npm run seed        # creates admin / admin123
npm run dev

# Terminal 2 — UI on :5173
cd web
npm install
npm run dev
```

Open http://localhost:5173 and sign in with `admin` / `admin123`.
In dev, Vite proxies `/api` to the backend, so there is no CORS setup to do.

```bash
cd server && npm test    # 14 tests
```

## The two integrations degrade gracefully

Both are **off by default**, so the whole stack runs before any account exists:

- **Brevo** — with `BREVO_ENABLED=false`, emails are written to the `email_log` table
  and logged to the console instead of being sent. No free-tier quota is consumed
  during development. Flip to `true` with an API key to go live; nothing else changes.
- **Google Drive** — with `GDRIVE_ENABLED=false`, uploads go to `server/data/uploads`
  on local disk. The `attachments` API is identical either way, so switching to Drive
  is a config change, not a code change.

`GET /health` reports which mode each one is in, and the status page surfaces it.

## API

| Method | Route                        | Purpose                                  |
| ------ | ---------------------------- | ---------------------------------------- |
| GET    | `/health`                    | Liveness + integration modes (public)    |
| POST   | `/auth/login`                | Exchange credentials for a JWT           |
| GET    | `/auth/me`                   | Current token holder                     |
| GET    | `/attachments`               | List files for `entity_type`/`entity_id` |
| POST   | `/attachments`               | Upload a file (multipart, field `file`)  |
| GET    | `/attachments/:id/download`  | Stream a file back                       |
| DELETE | `/attachments/:id`           | Delete from storage and index            |
| GET    | `/attachments/storage-status`| Which storage backend is active          |
| POST   | `/notifications/test`        | Send a test email (verifies Brevo)       |
| GET    | `/notifications/log`         | Recent send attempts, including skips    |

Every route except `/health` and `/auth/login` requires `Authorization: Bearer <token>`.

## Going live later

The zero-cost path continues into production:

- **Frontend** — Vercel, Netlify, or Cloudflare Pages free tier.
- **Backend** — Render, Fly.io, or Railway free/hobby tier.
- **Database** — SQLite is a single file and does not survive an ephemeral container
  restart. When we deploy, move to Neon or Supabase Postgres (both have free tiers).
  All SQL lives in `src/db/` and the route handlers, so this is a contained change.
- **Scheduled jobs** — GitHub Actions cron or cron-job.org, both free, calling an
  endpoint rather than running a timer inside the server.

## Security notes

- Passwords are bcrypt-hashed; login compares against a dummy hash for unknown users so
  response time does not reveal which usernames exist.
- The server refuses to boot in production with the development `JWT_SECRET`.
- Uploads are capped at 15 MB and restricted to an allowlist of image/PDF/CSV/XLSX MIME
  types. Stored filenames are randomised server-side.
- `server/.env`, `server/secrets/`, and `server/data/` are gitignored. **Never commit
  the Brevo API key or the Google service-account JSON.**
