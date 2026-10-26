# Corrective actions

An inspection records that a fire door was wedged open. This records that
somebody closed it, who, and when — which is the first thing an auditor asks
for after the finding itself.

```
  finding on an inspection
        │  "Raise corrective actions" at sign-off
        ▼
  open ──assign──▶ owner, due date, priority
        │
        │  closing note required
        ▼
  done  (or cancelled, kept rather than deleted)
```

## Raise → assign → close, and no further

Containment, root cause, effectiveness checks and sign-off gates are what the
standards describe. They are also what people stop filling in by the second
week, and an action log nobody fills in is worse than none because it looks
like coverage. This shape is small enough to use on a phone next to the thing
that is wrong, which is the only version that produces real data.

If you later need the full BRC/SQF workflow, the tables take it: the history is
already event-based, so adding states is additive.

## Two decisions worth knowing

**Closing requires a note.** A tick is not evidence. An auditor asking what was
actually done should not be shown a checkbox, so the API refuses a close
without one.

**The history is append-only.** `capas` says where an action stands; `capa_events`
says how it got there. The audit question is rarely "is it closed" — it is "when
was it raised, how long did it sit unassigned, who signed it off", and none of
that survives a row updated in place. Reopening adds to that history; it does
not erase the close that happened.

## Raising them from an inspection

At sign-off, **Raise corrective actions** lists what was flagged, everything
ticked. Each becomes an action carrying the checklist wording and the
inspector's note. A finding that already has one is skipped, so pressing it
again after adding one more finding does not duplicate the rest.

Default due dates, which whoever raises it can always change:

| Priority | Due in | Set automatically for |
| --- | --- | --- |
| High | 3 days | a **critical** finding |
| Normal | 14 days | everything else |
| Low | 30 days | — |

Short on purpose. A due date everyone ignores is worse than no due date, and a
high-priority corrective action in a food unit is a this-week problem.

## Who can do what

| | Raise | Assign | Close |
| --- | --- | --- | --- |
| Inspector | ✅ | — | — |
| Unit admin | ✅ | ✅ | ✅ |
| Omni admin | ✅ | ✅ | ✅ |

An inspector raising and closing their own finding is the one combination worth
preventing by default. Any of it can be granted to one person under
**Users → Fine-tune individual permissions** without inventing a new role.

# The morning digest

Weekdays at **11:45 UTC** — quarter to eight in Montreal, before the first shift
settles — everyone with something outstanding gets one email.

- **Owners** get their own open actions: overdue first, then due in the next
  seven days, across every unit they work in.
- **Unit admins** get everything outstanding in their units, *including the
  actions nobody has been assigned* — which are the ones that quietly rot. An
  admin asked to chase what they cannot see is being asked to do nothing.
- **Omni admins** get the whole tenant.

**Nothing outstanding, nothing sent.** No "you have 0 actions" email, ever. A
digest that arrives every morning regardless is one people filter into a folder
they never open — and then the one that matters goes there too.

Weekdays only: an overdue action chased on a Sunday is read on Monday anyway,
and a weekend email nobody can act on is how people learn to ignore the weekday
ones.

## Switching it off

Set `DIGEST_ENABLED` to `"false"` in `worker/wrangler.jsonc`. Reports still send;
only the chasing stops. There is no per-person unsubscribe — with a handful of
people in one unit, that is a conversation rather than a feature.

## Checking it without waiting until Monday

`POST /api/notifications/digest` (omni admin) previews it: exactly who would be
written to and what they would read, sending nothing. Add `?send=true` to
actually send it — for the morning the cron did not fire.

## Why it has its own cron trigger

A Worker gets 50 subrequests per invocation, and a cron firing is one
invocation. The nightly sweep already uses 38 of them (the photo purge and the
monthly sheets), so bolting the digest on would have meant one of the two
silently doing nothing on a busy day. Separate triggers get separate budgets.

The digest itself measures **43 subrequests** at its cap — two per message, for
the send and its row in `email_log`, plus three queries. That is why a run sends
at most 20 messages, most-overdue first; `worker/test/subrequests.test.js`
asserts both numbers stay in step. Beyond 20 recipients the overflow waits for
the next morning, and the report says how many it did not reach.

Brevo's free tier is 300 emails a day, which the cap also keeps well clear of —
a run that tried to send 40 digests plus the day's inspection reports would
start losing both.
