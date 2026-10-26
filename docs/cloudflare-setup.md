# Running the app on Cloudflare

> **New to this?** Use **[START-HERE.md](START-HERE.md)** instead — same steps,
> written out one at a time with nothing assumed. This page is the reference
> version, and the place to come back to afterwards.

Everything lives in one place: one Worker serves the React app *and* the API,
D1 holds the database, and a push to GitHub deploys the lot. No server to keep
awake, no second domain, no CORS.

```
  your phone ──▶ qa-platform.<your-subdomain>.workers.dev
                   │
                   ├── /            the React app      (static assets)
                   ├── /api/*       the API            (the Worker)
                   ├── D1           the database       (SQLite, Cloudflare's)
                   ├── R2 or Drive  photo evidence
                   └── (email removed — not needed for single-unit)
```

## What it costs

Nothing, on the free plan, at your volume. The limits that matter:

| | Free allowance | What you would use |
| --- | --- | --- |
| Worker requests | 100,000 / day | a busy unit is a few hundred |
| D1 storage | gigabytes | an inspection is about 2 KB |
| D1 rows written | a daily cap, **enforced since 1 Sep 2026** | an inspection writes a handful |
| R2 | 10 GB — but **asks for a card on file** | see *Where photos go* below |

Check the current D1 numbers on Cloudflare's own limits page before you rely on
them; the free tier was tightened in 2026 and may move again. Over the daily row
cap, queries fail until midnight UTC — they do not silently start costing money.

## Where photos go

Two choices, and this is the one decision worth making deliberately:

- **R2** is faster and simpler, but Cloudflare asks for a payment method on file
  before it will enable R2, even at zero usage. If a card on file is acceptable,
  use this.
- **Google Drive** keeps your `$0 and no card anywhere` rule intact. The Worker
  uploads through a service account. Slower, and bound by Google's API quotas,
  but photos are write-once and read-rarely, so neither matters much here.

`STORAGE_BACKEND` in `worker/wrangler.jsonc` picks one: `r2`, `drive`, or `none`.
It ships as `none`, which means uploads are refused and everything else works.

---

# Setting it up

## 1. Install the tool and sign in

On your computer (don't type the `$`):

```
npm install --global wrangler
wrangler login
```

A browser opens; sign in as **yulfassembly@gmail.com** and allow access.

## 2. Create the database

```
cd QA\worker
wrangler d1 create qa-platform
```

It prints something like:

```
[[d1_databases]]
binding = "DB"
database_name = "qa-platform"
database_id = "a1b2c3d4-...."
```

Open `worker/wrangler.jsonc`, find `REPLACE_WITH_YOUR_D1_DATABASE_ID`, and put
that id in its place. **Commit that change** — the id is not a secret, it only
names the database, which still needs your account to reach.

## 3. Create the tables

```
wrangler d1 migrations apply qa-platform --remote
```

## 4. Set the signing secret

This one is not optional. Without it the app refuses to issue any session at
all, which is deliberate: a missing secret would otherwise mean tokens signed
with an empty key, which anyone could forge.

```
wrangler secret put JWT_SECRET
```

Paste a long random string when it asks. To generate one:

```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## 5. Deploy

```
cd ..\web
npm install
npm run build
cd ..\worker
npm install
wrangler deploy
```

It prints your URL: `https://qa-platform.<your-subdomain>.workers.dev`.

Open `<that URL>/api/health`. It should say `"status":"ok"` with an empty
`problems` list. If something is missing, that list names it.

## 6. Create your organisation and admin account

Once, over the open internet, and only while no account exists yet:

```
curl -X POST https://qa-platform.<your-subdomain>.workers.dev/api/setup ^
  -H "content-type: application/json" ^
  -d "{\"organisation\":\"Gate Gourmet Montreal\",\"slug\":\"yul\",\"admin_email\":\"you@example.com\",\"admin_name\":\"Your Name\",\"unit_name\":\"Montreal Catering Unit\",\"unit_code\":\"YUL\"}"
```

It replies with a one-time password. **Write it down** — it is not stored
anywhere you can read it back, and there is no other admin to reset it. Sign in
with it; the app will make you choose your own immediately.

After this, `/api/setup` refuses forever. The 303-point checklist is installed
and published for that unit.

## 7. Turn on photo storage

**With R2** (needs a card on file at Cloudflare):

```
wrangler r2 bucket create qa-platform-evidence
```

Then in `wrangler.jsonc`, uncomment the `r2_buckets` line and set
`"STORAGE_BACKEND": "r2"`.

**With Google Drive** (the default, no card anywhere):

Not a service account — Google gives those no storage of their own and refuses
every upload to a personal My Drive. The Worker acts as the account owner
instead. From `worker/`:

```
node scripts/google-auth.mjs
```

It walks through the consent screen and prints the three values to set:

```
wrangler secret put GDRIVE_CLIENT_ID
wrangler secret put GDRIVE_CLIENT_SECRET
wrangler secret put GDRIVE_REFRESH_TOKEN
wrangler secret put GDRIVE_FOLDER_ID
```

[START-HERE.md](START-HERE.md) Part 3 covers creating the Google Cloud project
and folder. [photos-and-reports.md](photos-and-reports.md) explains why it has
to work this way.

(If you *do* have a paid Workspace shared drive, a service account still works:
set `GDRIVE_CREDENTIALS_JSON` instead of the three above.)

---

# Deploying from GitHub instead

Once set up, you never run `wrangler deploy` again: pushing to the branch does
it. Two secrets, in Settings → Secrets and variables → Actions:

| Secret | Where to get it |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare dashboard → the sidebar, under your account name |
| `CLOUDFLARE_API_TOKEN` | My Profile → API Tokens → Create Token → **Edit Cloudflare Workers** template, then add **D1: Edit** (and **R2: Edit** if you use R2) |

Optionally add an `APP_URL` repository *variable* with your workers.dev URL, and
each deploy finishes by checking `/api/health` and telling you what is missing.

The workflow (`.github/workflows/deploy-cloudflare.yml`) runs the tests, builds
the React app, applies any new migrations, then deploys. A failing test stops
the deploy.

Cloudflare can also watch the repository itself (Workers → your Worker →
Settings → Builds → Connect to Git). That skips the API token, but it does not
run the tests or the migrations, so the workflow here is the one to use.

---

# Everyday things

**Look at the data**

```
wrangler d1 execute qa-platform --remote --command "SELECT code, name FROM units"
```

**Someone forgot their PIN** — an admin resets it in the app under
Users. The new PIN is temporary; they must choose their own at sign-in.

**Watch it live** — `wrangler tail` streams every request and every
`console.log` from the deployed Worker.

**The nightly job** — photos past their retention window are deleted at 03:10
UTC and their rows marked as purged. Ratings and inspection history are never
purged.

**Back it up**

```
wrangler d1 export qa-platform --remote --output backup.sql
```

Worth doing before anything structural. D1's own point-in-time recovery covers
the last 30 days, but a file you hold is a file you hold.

---

# When it goes wrong

**`/api/health` says `degraded`.** Its `problems` list names exactly what is
missing. That is the first thing to read, always.

**Every request fails with "no such table".** The migrations have not been
applied to the remote database: step 3.

**Sign-in returns 503.** `JWT_SECRET` is not set: step 4.

**"This deployment is already set up".** `/api/setup` has been used. If that was
a mistake and you need to start over:
`wrangler d1 execute qa-platform --remote --command "DELETE FROM tenants"` —
which deletes everything that hangs off it. Do not do this to a live system.

**Uploads fail with a 500.** `STORAGE_BACKEND` is still `none`, or it says `r2`
with no bucket bound: step 8.

**A deploy succeeded but the site is unchanged.** Hard-refresh. Static assets
are cached at the edge and your browser holds the old page.
