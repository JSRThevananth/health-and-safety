---
name: web-design-inspiration
description: A studied catalogue of modern website design styles (bento grids, editorial/Swiss, dark developer-tool, neo-brutalism, kinetic type, glass, organic, retro, immersive 3D and more) with real reference sites, galleries, layout patterns and type/colour pairings, plus a workflow for researching what is current. Use this whenever the user is about to design, build, redesign or restyle a website, landing page, portfolio, marketing page or web app UI and would benefit from design directions — including when they say "make it look modern", "give me design ideas", "what style should this be", "inspiration", "moodboard", "make it less boring/generic", or start a site with no visual direction stated. Also use when they ask what is trending in web design or which sites to study.
---

# Web design inspiration

The goal is to stop every site looking like the same default template. When someone is building a site, offer them a few **distinct, well-reasoned design directions** grounded in real sites, then carry the chosen one through into concrete tokens and components.

The catalogue in `references/` is durable knowledge — styles change slowly. Specific showcase sites change fast (they redesign, award lists turn over), so treat named examples as leads and refresh them with a quick search when you can.

## Reference files

Read only what the moment needs:

- `references/styles.md` — the style catalogue: ~18 styles, each with its visual signature, how to build it in CSS, type and colour, what it suits and where it fails, and reference sites. **Read this for almost every use.**
- `references/patterns.md` — section-level patterns (heroes, navigation, feature sections, social proof, pricing, footers, motion) to mix within any style.
- `references/type-and-color.md` — free font pairings and palette recipes per mood, with ready CSS tokens.
- `references/galleries.md` — where to look for fresh inspiration and how to search them.

## Workflow

### 1. Read the brief before suggesting anything

Work out — from the conversation, the codebase, or a short question if truly unclear:

- **What the site is and who it's for** (developer tool, restaurant, portfolio, NGO, internal dashboard…). Audience decides more than taste does.
- **The one feeling it should leave** (trustworthy, playful, premium, fast, calm, rebellious).
- **Constraints**: existing brand colours/fonts, stack (plain HTML, React + Tailwind, a CMS), performance or accessibility needs, how much motion the team can build and maintain.

If the user already named a style or reference site, skip straight to step 3 with that.

### 2. Propose 3 distinct directions

Pick three styles from `references/styles.md` that each fit the brief but differ from one another — one safe-and-sharp, one more distinctive, one bold stretch is a good spread. Three near-identical minimalist options isn't a choice.

For each direction give:

- **Name + one-line pitch** — why it fits *this* site.
- **Look**: layout, type, colour, imagery, motion in 3–5 bullets.
- **2–3 reference sites** to open and study (say which part to look at — "Linear's homepage hero glow", not just "Linear").
- **Trade-off**: what it costs (build effort, motion budget, content needs) or risks.

End with a recommendation and why. Keep it scannable; the user is choosing, not reading an essay.

When a quick search is possible, run one or two (e.g. `"<industry> website design" site:awwwards.com`, or `<style name> website examples <current year>`) to swap in fresher references. Mention any reference you couldn't verify is still live in that style — the most-cited examples are often years out of date.

### 3. Turn the chosen direction into something buildable

Once a direction is picked (or if they want you to just go), translate it into:

- **Design tokens** — colour, type scale, spacing, radius, shadow — as CSS custom properties (or Tailwind theme config if the project uses Tailwind). Start from the recipe in `type-and-color.md` and adapt to any existing brand.
- **Section plan** — the page's sections in order, each mapped to a pattern from `patterns.md`.
- **Signature details** — the 2–3 specific moves that make the style recognisable (e.g. hard 4px offset shadows and thick borders for neo-brutalism). These are what make it not look generic, so don't drop them during implementation.

Then build, if building is the task.

### 4. Keep the basics non-negotiable

Bold style never excuses a broken site. Whatever the direction:

- Text contrast meets WCAG AA (4.5:1 body, 3:1 large text) — check light *and* dark mode.
- Respect `prefers-reduced-motion`; motion is enhancement, never the only way to see content.
- Works at phone width with no horizontal scroll; tap targets ≥ 44px.
- Hero content is real HTML text, not text baked into an image or canvas.
- Heavy effects (WebGL, video, big blur) get a static fallback and are lazy-loaded.

## Being a good design partner

- Explain choices in terms of the user's goal ("dark UI with a single bright accent reads as 'serious developer tool'"), so they learn the reasoning and can steer.
- Mixing is fine — e.g. an editorial layout with a bento feature section. Say which style leads.
- If the user asks "what's trending", give the honest picture: a few big currents (see the trend notes in `styles.md`) and the caveat that trend lists are mostly vendor blogs.
- Don't copy a reference site's assets, copy, or exact layout — study the *principles* and make something original.
