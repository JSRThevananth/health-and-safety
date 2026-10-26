# Keeping the API awake

Free hosting suspends a service that has been idle. Nothing is lost when that
happens — the database is separate, and the service restarts on the next request —
but the person who makes that request waits while it wakes up.

| Host | Idles out after | Cold start |
|---|---|---|
| Render (free) | ~15 minutes | ~50 seconds |
| Fly.io (free) | configurable | ~1–3 seconds |

Fly.io is the better choice for this reason alone. Use both layers below regardless.

## Layer 1 — an external monitor (primary)

Something outside your own infrastructure has to do the poking, because the app
cannot wake itself.

**[cron-job.org](https://cron-job.org)** — free, no card required:

1. Sign up and choose **Create cronjob**
2. URL: `https://your-api-address/health`
3. Schedule: **every 10 minutes**
4. Save

**[UptimeRobot](https://uptimerobot.com)** is an equally good alternative and also
emails you when the API is genuinely down, which is worth having on its own.

Either takes about two minutes to set up and costs nothing.

## Layer 2 — the bundled GitHub Action (backup)

`.github/workflows/keep-awake.yml` pings the same endpoint every 10 minutes.

To enable it: **Settings → Secrets and variables → Actions → New repository secret**,
named `API_URL`, set to your deployed API address (no trailing slash).

Two caveats, which is why this is the backup rather than the primary:

- GitHub **disables scheduled workflows on a repository with no activity for 60
  days**. If you stop committing, the pings stop silently.
- Its scheduler runs late under load, so "every 10 minutes" is approximate.

A private repository gets 2,000 free Actions minutes a month; this job uses roughly
720, so it fits — but it does consume most of your allowance.

## Layer 3 — warm it up before the user needs it

The app pings `/health` as soon as the landing or sign-in page loads, then again on
sign-in. A person spends fifteen to twenty seconds reading the page and typing their
password, and the API wakes during that time rather than after they press the button.

This is in `web/src/lib/warmup.js` and needs no configuration.

## What happens if all of this fails

The service still wakes on the first real request. The user waits, once. Beyond that:

- **No data is lost.** Records are in Postgres, which is a separate service.
- **In-progress inspections are safe.** Autosave retries with backoff and flushes
  again when the tab regains focus or the browser regains network.
- **Nothing needs restarting by hand.**

A sleeping service is a slow first request, not an outage.
