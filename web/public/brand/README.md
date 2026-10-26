# Brand assets

Save the three supplied files here with these exact names. The app picks them up
automatically — no code change needed. Until a file exists, a styled placeholder
renders, so nothing looks broken.

| Save as | Which one | Notes |
|---|---|---|
| `logo.png` | The gate gourmet wordmark | Also accepts `logo.svg` or `logo.webp`. Shown 22px tall on a white plate, so its white background is deliberate rather than an artefact. |
| `hero-1.jpg` | Inspector with the clipboard | Also accepts `.webp`, `.jpeg` or `.png`. Shown at 4:3. |
| `hero-2.webp` | The PPE laid out on the bench | Also accepts `.jpg`, `.jpeg` or `.png`. Shown at 1:1, inset over the first image. |

Each slot tries `.webp`, `.jpg`, `.jpeg` then `.png` in turn, so whatever format you
save is picked up without a code change.

**Compress `hero-2` before saving it.** As supplied it is **1,064 KB** — roughly
fifteen times the size of `hero-1` (71 KB) for a picture shown smaller on the page.
Run it through [squoosh.app](https://squoosh.app) and aim for under 200 KB. Every
visitor downloads it before the page finishes, so on airport wifi this one file is
the difference between a fast landing page and a sluggish one.

These are served as static files rather than fetched from Google Drive at runtime:
Drive links require authentication, are rate limited, and would leave the page
without a logo whenever Drive is unreachable.

## Note on branding and the commercial plan

These assets are gate gourmet's. That is fine for an internal tool, but the branding
must not ship inside a product sold to other catering companies. Per-tenant branding
is already in the build plan for exactly this reason — the logo becomes a tenant
setting rather than a file baked into the app.
