# Section patterns

These are building blocks that work inside any style. Plan a page as a list of these, then apply the chosen style's tokens and signature details.

## Heroes

| Pattern | What it is | Works for | Example |
| --- | --- | --- | --- |
| **Product-forward** | Headline + subline + CTA above a large real product screenshot or video, often masked by a fade | SaaS, apps | linear.app, cursor.com |
| **Giant type** | One huge headline fills the viewport, with minimal else | Agencies, portfolios, launches | Studio sites on Awwwards |
| **Split** | Copy on the left, visual on the right, stacked on mobile | Almost anything. A safe default | Most B2B sites |
| **Full-bleed media** | Photo or video behind short overlaid copy | Hospitality, luxury, events | aman.com |
| **Interactive / 3D** | A live scene or demo is the hero | Launches, award-chasing | landonorris.com |
| **Code-first** | A real code snippet or terminal in the hero | Dev tools, APIs | stripe.com, resend.com |
| **Search / input-first** | The hero is the product's input box | AI tools, marketplaces | perplexity.ai, airbnb.com |

Hero copy rule: state **what it is and who it's for** in one sentence, then give one primary CTA, plus one secondary at most. Show proof (logos, a metric) within the first screen or just below it.

## Navigation

- **Floating pill nav:** a centred rounded bar detached from the edges, often glass-blurred. It is very current.
- **Sticky blurred header:** `position: sticky; backdrop-filter: blur(12px)`, which hides on scroll-down and shows on scroll-up.
- **Mega menu** for big product suites (stripe.com).
- **Full-screen overlay menu** with giant type links, for portfolios and agencies.
- **Command palette (⌘K)** as a secondary nav for docs and dev tools.

## Feature sections

- **Bento grid**: see styles.md #3.
- **Alternating rows**: image left/text right, then swapped. Classic and easy to scan.
- **Sticky scroll tabs**: the feature list pins on one side while visuals change on the other (scroll storytelling lite).
- **Tabbed showcase**: tabs switch a large product visual.
- **Icon grid**: 3×2 small features with icon, title and one line. Use it for secondary features only.
- **Interactive demo**: let the user actually try the thing inline. This is the strongest proof.

## Social proof

- Logo strip (greyscale, with an optional infinite marquee).
- A single big testimonial with photo, name and role, which beats ten small ones.
- Metrics band ("3M users · 99.99% uptime") with count-up on view.
- Wall of tweets or posts (masonry) for community products.
- Case-study cards with a specific outcome number.

## Pricing

- 3 tiers with the middle highlighted ("Most popular"), a monthly/annual toggle that shows the savings, and a feature comparison table below.
- Usage-based pricing: show a slider or calculator.
- Put the FAQ right under pricing so objections are answered where they come up.

## Calls to action and closing sections

- Repeat the primary CTA in a full-width closing band before the footer.
- Use a style-specific signature CTA (e.g. a neo-brutal pressed button inside an otherwise calm page) to concentrate personality where it converts.

## Footers

- **Fat footer**: sitemap columns, newsletter signup, socials and legal.
- **Giant wordmark footer**: the brand name set enormous across the full width at the bottom. This is very current.
- **Minimal**: one line, for portfolios.

## Motion vocabulary

Use few kinds of motion, applied consistently:

- **Reveal on scroll**: fade plus 16–24px rise, staggered 60–80ms. Use `animation-timeline: view()` where supported and IntersectionObserver otherwise.
- **Hover**: scale 1.02–1.04, an underline that grows, a tilt on cards, or a magnetic button.
- **Page transitions**: the View Transitions API (`document.startViewTransition`, or cross-document `@view-transition { navigation: auto; }`).
- **Smooth scroll**: Lenis. Use it sparingly, because it can feel laggy and hurts accessibility if misconfigured.
- **Marquee**: an infinite logo or text ticker, paused on hover.
- **Custom cursor**: only on portfolio and creative sites, and never on touch devices.

Wrap all of it in `@media (prefers-reduced-motion: no-preference) { ... }`.
