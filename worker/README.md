# worker/ — the Cloudflare build

One Worker serves both halves of the app: `/api/*` is this code, everything else
is the React build in `../web/dist`, with unmatched paths falling back to
`index.html` so client-side routes resolve.

Setup and deployment: [docs/cloudflare-setup.md](../docs/cloudflare-setup.md).

## Layout

```
src/
  index.js        fetch + scheduled entry points
  app.js          the Hono app: routing, health, auth gates
  db.js           the D1 data layer
  crypto.js       PBKDF2 passwords and HS256 tokens, on WebCrypto
  config.js       env -> config, and what a deployment is still missing
  routes/         one file per resource
  services/       the logic the routes call
  library/        the 303-point master checklist
migrations/       D1 schema, applied with "wrangler d1 migrations apply"
test/             node:test against the real app, over a D1 shim
```

## Running it locally

```
npm install
npm run migrate:local
npm run dev
```

`.dev.vars` holds local secrets and is gitignored. `npm test` needs none of
this — it builds its own in-memory database.

## Three things that are different from an ordinary Node API

**There are no transactions.** D1 cannot hold `BEGIN` open across an `await`, so
a multi-statement write is a `db.batch([...])`, which D1 runs atomically. Where
code needs an id before inserting children — opening a draft, creating a user —
it cannot be one batch, and those two places say so and clean up after
themselves.

**A statement may bind 100 parameters.** Bulk inserts are chunked into several
multi-row statements submitted as one batch, which stays atomic under the cap.
Lists of ids are inlined instead of bound, through `db.idList()`, which forces
every value through `Number()` first.

**No Node crypto.** bcrypt is a native addon and `jsonwebtoken` wants Node's
crypto module; neither runs here. Passwords are PBKDF2-SHA256 at 210,000
rounds and sessions are HS256, both on WebCrypto. A bcrypt hash written by the
old Node build verifies as false rather than erroring — that account needs a
reset, not a quietly accepted sign-in.
