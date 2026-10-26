# Style catalogue

Last studied: October 2026. Reference sites are leads: open them and check they still use the style, because sites redesign often.

## Contents

1. Dark developer-tool / "Linear style"
2. Gradient-mesh SaaS / "Stripe style"
3. Bento grid
4. Swiss / International editorial
5. Magazine editorial / serif revival
6. Refined minimalism (2026 minimalism)
7. Neo-brutalism
8. Anti-grid / raw brutalism
9. Kinetic & expressive typography
10. Glass & depth (glassmorphism, "liquid glass")
11. Organic / soft & natural
12. Bold colour / maximalism
13. Retro revival (Y2K, 80s, early web)
14. Hand-made / scribble / human touch
15. Immersive 3D & WebGL
16. Scroll storytelling
17. Luxury / premium quiet
18. Playful / illustrated / mascot
Trend notes (2025–26)

Each entry: **Signature** (what makes it recognisable) · **Build it** (CSS/technique) · **Type & colour** · **Suits / Avoid** · **Study**.

---

## 1. Dark developer-tool ("Linear style")

- **Signature:** a near-black canvas (not pure #000), soft radial glows behind the hero, crisp 1px hairline borders at about 8% white, product UI screenshots tilted or masked by gradient fades, tight letter-spacing on large sans headlines, and quiet monochrome icons.
- **Build it:** `background: radial-gradient(ellipse at top, rgb(120 100 255 / .25), transparent 60%), #08090a;` with borders `1px solid rgb(255 255 255 / .08)`. Headline text gets a gradient via `background-clip: text` (white to 60% white). Use `mask-image: linear-gradient(to bottom, #000 60%, transparent)` on screenshots. Add a subtle grain or grid in a background SVG.
- **Type & colour:** Inter, Geist or Satoshi in large sizes with `letter-spacing: -0.03em`. Mostly grey, with one accent (violet, blue or lime).
- **Suits:** dev tools, AI products, B2B SaaS, fintech infrastructure. **Avoid:** consumer brands that need warmth, and older audiences, because low contrast on dark is hard to read.
- **Study:** linear.app (hero glow, changelog), vercel.com (Geist type, grid lines), raycast.com (glossy 3D icons on dark), resend.com, cursor.com.

## 2. Gradient-mesh SaaS ("Stripe style")

- **Signature:** animated, flowing multi-colour gradient blobs, a diagonal or skewed section edge, white cards floating over colour, and live code or product snippets right in the hero.
- **Build it:** use a `<canvas>` with a WebGL gradient (e.g. the Stripe "minigl" approach) or stacked blurred radial-gradients with a slow `@keyframes` hue shift. Use `clip-path: polygon(...)` for slanted sections.
- **Type & colour:** a geometric sans (Söhne-like, so use Inter Display or General Sans for free). Use a saturated multi-hue gradient with a navy text colour.
- **Suits:** payments, APIs, platforms that need to look both trustworthy and innovative. **Avoid:** content-heavy sites, where the gradient fights the text.
- **Study:** stripe.com (homepage gradient, docs), stripe.com/sessions.

## 3. Bento grid

- **Signature:** a modular grid of rounded tiles in mixed sizes. Each tile shows one feature or stat, often with a mini-illustration or a live micro-demo. Apple popularised it in its keynotes. It is now the default pattern for feature sections.
- **Build it:** `display: grid; grid-template-columns: repeat(4, 1fr); grid-auto-rows: 180px; gap: 12px;` and spanning tiles with `grid-column: span 2; grid-row: span 2`. Give tiles a radius of 16–28px and a subtle border or surface tint. It collapses to one column on mobile.
- **Type & colour:** works in any palette. Keep tile copy to one headline plus one line.
- **Suits:** feature overviews, portfolios, product pages, personal "link-in-bio" sites. **Avoid:** using it for a whole site, where it reads as template-y. Use it as one section.
- **Study:** apple.com product pages ("Get the highlights"), linear.app features, framer.com templates, bento.me.

## 4. Swiss / International editorial

- **Signature:** a strict, visible grid, flush-left ragged-right text, huge grotesque headlines, lots of white space, numbered sections, thin rules and almost no decoration. Precision is the aesthetic.
- **Build it:** use a 12-column CSS grid that is visible in the alignment, with `hr` rules at `1px solid currentColor`. Use a type scale with dramatic jumps (14 / 18 / 64 / 160px) and small uppercase labels with `letter-spacing: .08em`.
- **Type & colour:** Helvetica Now, Neue Haas, or free alternatives (Inter Tight, Archivo, Host Grotesk). Black on off-white plus one primary accent (red #ff3b00, klein blue).
- **Suits:** studios, architecture, design agencies, cultural institutions, documentation. **Avoid:** brands that need warmth or playfulness.
- **Study:** pentagram.com, experimental-jetset.nl, many studio sites on siteinspire.com (filter "Minimal" or "Typographic").

## 5. Magazine editorial / serif revival

- **Signature:** a big expressive serif display face, a column layout like a printed magazine, drop caps, pull quotes, captions, and full-bleed photography mixed with a text measure of about 65ch.
- **Build it:** use CSS `columns`, `::first-letter` drop caps, `font-variation-settings` for optical size, and `text-wrap: balance` on headlines and `pretty` on body text.
- **Type & colour:** a serif display (Fraunces, Instrument Serif, PP Editorial, GT Super) with a clean sans for UI. Use a warm off-white paper colour (#f5f1ea) and ink-black text.
- **Suits:** publications, blogs, food and hospitality, AI companies wanting a "human" feel, nonprofits. **Avoid:** dense dashboards.
- **Study:** anthropic.com (serif plus warm neutrals), the New York Times Magazine features, itsnicethat.com, every.to.

## 6. Refined minimalism (2026 minimalism)

- **Signature:** not 2019's empty white. It has fewer elements, but each one is crafted: one strong typeface, generous space, one signature interaction or texture, and real personality in the details (cursor, hover, a single colour).
- **Build it:** use a restrained token set (2 greys, 1 accent), large spacing tokens (96–160px between sections), and one high-quality hover or micro-interaction repeated consistently.
- **Type & colour:** one family in 2–3 weights. Use a near-monochrome palette with one accent.
- **Suits:** almost anything, especially portfolios, premium products and apps. **Avoid:** going so minimal there is nothing memorable. Pick a signature.
- **Study:** rauno.me, emilkowal.ski, paco.me (crafted personal sites), teenage.engineering.

## 7. Neo-brutalism

- **Signature:** thick black borders (2–4px), hard zero-blur offset shadows, flat saturated fills (yellow, pink, mint), chunky buttons that "press" on hover, and visible structure.
- **Build it:** `border: 3px solid #000; box-shadow: 6px 6px 0 #000;` with hover `transform: translate(3px,3px); box-shadow: 3px 3px 0 #000;`. Radius is either 0 or a playful 12px, but stay consistent.
- **Type & colour:** a bold grotesk (Space Grotesk, Archivo Black, Lexend Mega) with black, white and 2–3 candy colours.
- **Suits:** indie products, creator tools, Gen-Z brands, hackathons. **Avoid:** finance, health and enterprise. As a whole-page style it is cooling in 2026, but it still works well for a single bold CTA or card set inside a calmer layout.
- **Study:** gumroad.com, neobrutalism.dev (component kit), figma.com/community neo-brutalism UI kits.

## 8. Anti-grid / raw brutalism

- **Signature:** deliberately broken layouts, overlapping elements, monospace everywhere, raw HTML-looking links and buttons, and "unstyled" honesty. It is a reaction against polished bento sameness.
- **Build it:** use absolute or `grid-area` overlaps, `font-family: ui-monospace`, default-blue underlined links, visible `outline`s, and text that runs off the edge.
- **Type & colour:** monospace (JetBrains Mono, IBM Plex Mono, Berkeley Mono) with system defaults or high-contrast black and white plus a single neon.
- **Suits:** artists, experimental studios, underground music, dev-culture brands. **Avoid:** anything that needs trust or easy scanning, and anything with a wide audience.
- **Study:** brutalistwebsites.com (archive), v0.dev and arc.net/thebrowsercompany pages (check they are current), cargo.site portfolios.

## 9. Kinetic & expressive typography

- **Signature:** type is the hero. Headlines that change weight and width on scroll or hover, letters that animate in, oversized words that run edge to edge, and variable fonts doing the work an image would.
- **Build it:** variable fonts with `font-variation-settings: 'wght' var(--w)` driven by scroll (CSS scroll-driven animations `animation-timeline: view()` or GSAP ScrollTrigger). Use SplitType or GSAP SplitText for per-letter motion and `clamp()` for fluid giant sizes (`font-size: clamp(3rem, 12vw, 14rem)`).
- **Type & colour:** a variable family with a wide axis range (Roboto Flex, Anybody, Bricolage Grotesque, Recursive). Colour is usually minimal so the type carries the page.
- **Suits:** agencies, events, launches, music, fashion. **Avoid:** long-read content, and audiences sensitive to motion (always honour reduced-motion).
- **Study:** Awwwards "Typography" category, many recent Sites of the Day (agency portfolios), typewolf.com site-of-the-day.

## 10. Glass & depth (glassmorphism, "liquid glass")

- **Signature:** frosted translucent panels over colourful or photographic backgrounds, soft inner highlights and layered depth. Since Apple's "Liquid Glass" (2025) it often adds refraction-like edge highlights.
- **Build it:** `background: rgb(255 255 255 / .12); backdrop-filter: blur(16px) saturate(160%); border: 1px solid rgb(255 255 255 / .25);` with an inner highlight via `box-shadow: inset 0 1px 0 rgb(255 255 255 / .4)`. Its most durable use is a sticky blurred header.
- **Type & colour:** a clean sans (SF-like: Inter, Geist) over vivid gradients or imagery.
- **Suits:** app marketing, music, weather, crypto, overlays and navs. **Avoid:** text-heavy panels, because contrast on busy backgrounds fails. It is also expensive on low-end mobiles.
- **Study:** apple.com (iOS 26 pages, navigation bar), vision OS marketing, many Framer templates.

## 11. Organic / soft & natural

- **Signature:** soft blob shapes, rounded everything, grain or paper texture, earthy or pastel palettes, flowing section dividers (SVG waves) and gentle slow motion. It is the opposite of rigid grids.
- **Build it:** SVG blob paths (or `border-radius: 60% 40% 30% 70% / 60% 30% 70% 40%`), an SVG `feTurbulence` noise overlay at low opacity, and large radii (24–40px).
- **Type & colour:** a rounded or humanist sans (Nunito, Figtree, Outfit) or a soft serif. Use sage, clay, sand and terracotta, or pastels.
- **Suits:** wellness, food, sustainability, family, D2C products. **Avoid:** technical or enterprise products that want to look precise.
- **Study:** oatly.com (hand-made plus organic), headspace.com, calm.com, many Shopify D2C stores.

## 12. Bold colour / maximalism

- **Signature:** saturated, high-contrast colour blocks, neon gradients, clashing pairings used on purpose, stickers, layered collage, and "more is more" with control.
- **Build it:** section-by-section background colour swaps (each section owns a colour), `mix-blend-mode` on type over imagery, and large CSS gradient fills.
- **Type & colour:** a heavy display face plus a neutral body font. Choose 4–6 vivid colours, each paired with a guaranteed-contrast text colour.
- **Suits:** youth and lifestyle brands, entertainment, festivals, consumer apps. **Avoid:** serious B2B. Check contrast on every colour pair.
- **Study:** spotify.com Wrapped campaign pages, duolingo.com, mailchimp.com (Cavendish yellow era), liquid death.

## 13. Retro revival (Y2K, 80s, early web)

- **Signature:** chrome type, pixel or bitmap fonts, OS-window chrome (title bars and close buttons), CRT scanlines, stickers, early-web marquee energy. In 2026 the 80s look has matured from pastiche to a refined, editorial treatment.
- **Build it:** window components with title bars, `image-rendering: pixelated`, a scanline overlay via `repeating-linear-gradient`, and chunky bevels via `box-shadow` inset pairs.
- **Type & colour:** pixel fonts (Press Start 2P, Silkscreen, VT323), chrome gradients, and 80s neon (magenta, cyan) on dark, or Windows-95 grey.
- **Suits:** games, music, creative tools, nostalgic consumer brands. **Avoid:** using it all over a serious product. Use it as an accent or campaign.
- **Study:** poolsuite.net (retro OS), playdate.com, many indie game sites.

## 14. Hand-made / scribble / human touch

- **Signature:** hand-drawn doodles, scribbled underlines and circles over headlines, sketch overlays on photos, imperfect marker strokes. It is a deliberate counter to polished, machine-generated sameness.
- **Build it:** SVG strokes animated with `stroke-dasharray`/`stroke-dashoffset` to "draw on", hand-drawn SVG assets, and rotated sticker-like elements with `rotate: -3deg`.
- **Type & colour:** a handwriting accent font (Caveat, Gochi Hand, Kalam) used sparingly beside a clean sans. Use paper tones plus marker colours.
- **Suits:** education, creators, community, small businesses, anything wanting warmth and authenticity. **Avoid:** overuse. Two or three hand-made moments per page is enough.
- **Study:** tldraw.com, excalidraw.com, oatly.com, notion.com (illustration-driven).

## 15. Immersive 3D & WebGL

- **Signature:** a real-time 3D scene as the hero, objects reacting to cursor and scroll, shader effects (distortion, fluid, particles) and camera moves tied to scroll. This is award-site territory.
- **Build it:** Three.js or React Three Fiber, Spline (no-code 3D embeds), OGL for light shaders, GSAP plus Lenis smooth scroll. Always lazy-load it and have a static poster image fallback.
- **Type & colour:** usually minimal UI overlay type so the scene leads. Colour comes from the lighting and materials.
- **Suits:** product launches, automotive, luxury, studios, games, F1-style brand experiences. **Avoid:** limited build time, weak devices, SEO-critical content and accessibility-critical flows.
- **Study:** Awwwards Site of the Year 2025: landonorris.com (OFF+BRAND.) and Messenger by abeto. Also spline.design community, igloo.inc, bruno-simon.com.

## 16. Scroll storytelling

- **Signature:** the page is a narrative. Sections pin while content changes, an image sequence scrubs with scroll, numbers count up and chapters reveal.
- **Build it:** CSS `position: sticky` stages, CSS scroll-driven animations (`animation-timeline: scroll()` / `view()`) or GSAP ScrollTrigger, and `<video>` or image-sequence scrubbing on canvas.
- **Type & colour:** follows the brand. Keep each step to one idea and one sentence.
- **Suits:** product launches, annual reports, data journalism, nonprofits' impact stories. **Avoid:** pages people come to scan quickly (pricing, docs).
- **Study:** apple.com product launch pages (AirPods, iPhone), NYT and The Pudding data stories (pudding.cool).

## 17. Luxury / premium quiet

- **Signature:** a lot of empty space, large immersive photography, thin elegant serif or wide-tracked uppercase sans, slow fades, few words, muted palette and small UI.
- **Build it:** full-bleed `object-fit: cover` imagery, `letter-spacing: .2em` uppercase labels, 600–1000ms easing on fades, and restrained hover (underline grows, image scales 1.03).
- **Type & colour:** a high-contrast Didone-style serif (Playfair Display, Bodoni Moda, Cormorant) or a wide sans (Syne, Unbounded light). Use black, cream and stone with maybe gold.
- **Suits:** fashion, hotels, real estate, jewellery, fine dining, wine. **Avoid:** budget brands and conversion-heavy funnels.
- **Study:** aesop.com, Hermès, aman.com, Bottega Veneta (often deliberately anti-UX).

## 18. Playful / illustrated / mascot

- **Signature:** custom illustration system, a mascot or character, bouncy spring animations, friendly rounded UI, and humour in the microcopy.
- **Build it:** spring physics (Framer Motion / Motion One), Lottie or Rive for character animation, and generous rounded buttons with a press effect.
- **Type & colour:** a rounded, chunky sans (Nunito, Baloo, Fredoka, DM Sans) with bright cheerful primaries.
- **Suits:** consumer apps, education, kids, gaming, onboarding flows. **Avoid:** premium or serious contexts.
- **Study:** duolingo.com, rive.app showcases, headspace.com, mailchimp.com.

---

## Trend notes (2025–26)

The big currents, noting that trend lists are mostly vendor and agency blogs that overlap but disagree:

- **Expressive and kinetic type** is the strongest signal. Variable fonts react to scroll and hover, and headlines are oversized.
- **Visual personality is back** after years of "clean SaaS sameness": bold saturated colour, hand-drawn touches and retro done with taste.
- **Bento grids** are now the default feature-section pattern. Use them, but add a signature so they don't look like a template.
- **Broken and organic layouts** are pushing back against rigid grids.
- **Purposeful micro-interactions** matter more than decorative motion. Native CSS scroll-driven animations and View Transitions make this cheaper than before.
- **Dark mode is expected.** Design both themes from the start.
- **Glass** is back via Apple's Liquid Glass. Its most durable form is the blurred sticky header.
- **Neo-brutalism** is cooling as a full-page style but still lives on in bold CTAs and cards.
- **Accessibility-first** is a quality bar, not a trend.
