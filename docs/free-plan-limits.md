# What the free plan allows, and what that changed

Cloudflare's free plan is generous about the things people check first — 100,000
requests a day, gigabytes of database — and strict about two that are easy to
miss. Both bit this app in production, so they are written down here.

| Limit | Free plan | What it means here |
| --- | --- | --- |
| **CPU per request** | **10 ms** | Not wall-clock. Waiting on the database or on Google does not count; actual computation does. |
| **Subrequests per request** | **50** | Every D1 query is one. So is every call to Drive or Brevo. |

Going over either does not slow a request down. It kills it.

## How we found out

The first production setup created the organisation and the unit, then stopped.
No error reached the browser, no admin account existed, and the setup route then
refused to run again because an organisation was already there — a dead end
needing database surgery to escape.

The cause was password hashing. OWASP's figure for PBKDF2-HMAC-SHA256 is 210,000
iterations, which is what the code used. Measured on the Workers runtime:

| PBKDF2 iterations | CPU |
| --- | --- |
| 10,000 | 4 ms |
| 25,000 | 12 ms |
| 50,000 | 22 ms |
| 100,000 | 44 ms |
| 210,000 | **92 ms** |

Against a 10 ms budget, hashing at OWASP strength cannot work. Worse, it would
have failed the same way at every single sign-in.

Looking for the same mistake elsewhere turned up a second one: installing the
checklist did a lookup and an insert per section, per group and per item — about
**140 database calls** against a limit of 50. It had never run in production,
so it had never failed, but it never would have worked either.

## What changed

**Hashing is 10,000 iterations** (4 ms measured), against OWASP's figure of
210,000. A stolen database is therefore about 20× cheaper to attack than at
OWASP strength. Every hash records the cost that produced it, so raising the
default later re-secures new passwords without invalidating old ones — on the
paid plan, where the budget is 30 seconds rather than 10 ms,
`PASSWORD_ITERATIONS` can simply go back to 210,000.

**The minimum password is 6 characters, and there is no maximum.** Short, at
the operator's request, because the people typing it are wearing gloves on a
warehouse floor and a rule they cannot satisfy gets written on a shelf. Online
guessing is handled by the sign-in throttle — ten failures in fifteen minutes
(`LOGIN_MAX_FAILURES`) — so the real exposure is an offline attack on a stolen
hash, where six characters and 10,000 iterations are both weak. Worth revisiting
together if the database ever holds more than one customer.

**Setup is two requests, and resumable.** Creating the account and installing a
303-point checklist do not fit in one 10 ms budget, so they are separate calls.
And "already set up" now means *an administrator exists*, not *a row exists* —
so an interrupted run is finished by running it again, rather than by hand.

**The checklist install reads a whole level at a time** and inserts the missing
rows in one batch: eight database calls instead of 140, whatever the library's
size.

**The nightly cron shares one 50-subrequest budget** between the photo purge and
the monthly sheet rebuild, because a cron trigger is a single invocation. The
purge takes at most 20 photos, with every tombstone written in one batch; the
rebuild takes at most 5 unit-months, least recently built first. Both carry over
to the next night rather than exceeding the budget, which would mean the whole
run does nothing at all — and retention is a policy measured in weeks, so a
night's delay costs nothing.

## Keeping it that way

`worker/test/subrequests.test.js` counts the database calls each request makes
and fails if any single one approaches 50. It prints the heaviest request in the
app on every run — currently `POST /inspections/draft` at 14.

**One report fetches at most 30 photos.** A second budget, and it binds before
the 12 MB one does: every photo costs a subrequest to retrieve, and sending a
report already spends about 17 on the database, the Drive token and Brevo.
Measured under load — 32 photos came to 48 subrequests, 40 came to 56, and the
platform refuses the request rather than degrading, losing the whole report.
Photos past the cap are listed with their link, so the report still accounts for
every one.

It measures the nightly cron the same way, outbound Drive calls included:
currently 38 with the purge and the rebuild both running at their caps. Raising
either cap without lowering the other fails there rather than at 03:10 in
production.

There is no equivalent test for CPU, because it cannot be measured faithfully
outside the real runtime. The rule of thumb instead: **be suspicious of anything
that computes rather than waits.** Hashing, encryption, image work, parsing
something large. A request that only queries the database and shapes the result
uses almost nothing.

## If you ever move to the paid plan

$5/month lifts CPU to 30 seconds and subrequests to 10,000, and none of the
above would be forced any more. The two worth reversing are the hashing
iterations and the purge batch size. Everything else — fewer queries, resumable
setup — is simply better, and should stay.
