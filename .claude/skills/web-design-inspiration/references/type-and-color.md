# Type pairings and palette recipes

All fonts below are free (Google Fonts or open licence) unless marked. Check contrast for every text/background pair you actually use.

## Font pairings by mood

| Mood | Display / headings | Body / UI | Notes |
| --- | --- | --- | --- |
| Precise tech | Geist / Inter Tight | Geist / Inter | Tight tracking on display, -0.02 to -0.04em |
| Friendly tech | Plus Jakarta Sans | Plus Jakarta Sans | One family, weights 400/600/800 |
| Editorial warm | Fraunces / Instrument Serif | Inter / Source Sans 3 | Serif headlines, sans UI |
| Literary | Newsreader | Newsreader | Text-optimised serif with optical sizes |
| Swiss | Inter Tight / Archivo | Inter | Black on off-white, big size jumps |
| Bold grotesk | Space Grotesk / Bricolage Grotesque | DM Sans | Good for neo-brutal and playful |
| Expressive variable | Roboto Flex / Anybody | Inter | For kinetic type. Animate wght and wdth |
| Luxury | Cormorant / Bodoni Moda / Playfair Display | Jost / Montserrat (light, tracked caps) | Use lots of white space |
| Wide / futuristic | Syne / Unbounded / Clash Display (Fontshare) | Satoshi (Fontshare) / Inter | Fontshare fonts are free to use too |
| Rounded friendly | Fredoka / Nunito | Nunito Sans | Kids, education, consumer |
| Mono / raw | JetBrains Mono / IBM Plex Mono | IBM Plex Sans | Anti-grid, dev culture |
| Retro | Silkscreen / VT323 (accents only) | Space Mono / Inter | Keep pixel fonts for short labels |
| Hand-made accent | Caveat / Kalam (accent only) | Figtree | One or two scribbled words per section |

Fluid type scale starter:

```css
:root {
  --step--1: clamp(0.83rem, 0.8rem + 0.15vw, 0.9rem);
  --step-0:  clamp(1rem, 0.95rem + 0.25vw, 1.125rem);
  --step-1:  clamp(1.25rem, 1.1rem + 0.6vw, 1.6rem);
  --step-2:  clamp(1.6rem, 1.3rem + 1.4vw, 2.4rem);
  --step-3:  clamp(2.2rem, 1.6rem + 3vw, 4rem);
  --step-4:  clamp(3rem, 1.8rem + 6vw, 7.5rem);   /* hero */
}
h1, h2 { text-wrap: balance; } p { text-wrap: pretty; max-width: 65ch; }
```

## Palette recipes

Each recipe is light, then dark. Define the colours as tokens and redefine them in `@media (prefers-color-scheme: dark)`.

**Dark dev-tool** (dark-first)
```css
--bg: #08090a; --surface: #111214; --border: rgb(255 255 255 / .08);
--text: #f7f8f8; --muted: #8a8f98; --accent: #7170ff;
/* light: --bg:#fcfcfd; --surface:#fff; --border:rgb(0 0 0 / .08); --text:#0b0c0e; --muted:#5d6068 */
```

**Warm editorial**
```css
--bg: #f5f1ea; --surface: #fffdf8; --border: #e4ddd0;
--text: #1f1d1a; --muted: #6b655c; --accent: #c8553d;
/* dark: --bg:#1a1816; --surface:#22201d; --text:#efe9df; --muted:#a39c90; --accent:#e07a5f */
```

**Swiss**
```css
--bg: #f2f2f0; --text: #111; --muted: #666; --accent: #ff3b00; --rule: #111;
/* dark: --bg:#111; --text:#f2f2f0; --rule:#f2f2f0 */
```

**Neo-brutal**
```css
--bg: #fffdf5; --ink: #000; --yellow: #ffd23f; --pink: #ff6b9d; --mint: #3ddc97; --blue: #5b8cff;
--shadow: 5px 5px 0 var(--ink); --border: 3px solid var(--ink);
```

**Organic soft**
```css
--bg: #f4f1ea; --surface: #fbf9f4; --text: #2d332b; --muted: #6f7769;
--sage: #9caf88; --clay: #c97b5a; --sand: #e7d8bf;
```

**Luxury quiet**
```css
--bg: #faf8f5; --text: #1a1a1a; --muted: #8c8579; --line: #d8d2c7; --accent: #8b6f47;
/* dark: --bg:#0e0d0c; --text:#ece7df; --line:#2e2b27 */
```

**Bold maximal**: give each section its own pair and check every pair for contrast.
```css
--s1-bg: #1d1bff; --s1-fg: #ffffff;
--s2-bg: #ff5c00; --s2-fg: #1a0a00;
--s3-bg: #c6ff3d; --s3-fg: #0d1300;
--s4-bg: #ff3fa4; --s4-fg: #1a0010;
```

## Colour rules of thumb

- One accent colour does most of the work. More than two accents usually means none of them stands out.
- Avoid pure #000 on pure #fff for long reading. Use slightly softened values (#111 on #fafafa).
- In dark mode, raise surfaces with lighter greys instead of shadows, and reduce accent saturation slightly.
- Use `oklch()` to build tints and shades that look evenly spaced, e.g. `oklch(65% 0.18 265)`.
- Tools: realtimecolors.com (preview a palette on a real layout), coolors.co, huemint.com, and the contrast checker at webaim.org/resources/contrastchecker.
