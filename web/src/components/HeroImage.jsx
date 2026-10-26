/*
 * Landing-page imagery.
 *
 * Save the photographs into web/public/brand/ as hero-1 and hero-2. Any of the
 * extensions in CANDIDATES works, so a WebP straight off Drive needs no conversion.
 * Until a file exists a branded placeholder renders at the right aspect ratio, so
 * the layout is final and adding the file changes nothing but the picture.
 */
import { useState } from 'react'

// Tried in order. WebP first: it is the smallest for the same quality, and browsers
// that cannot read it are long out of support for the rest of this app anyway.
const CANDIDATES = ['webp', 'jpg', 'jpeg', 'png']

export default function HeroImage({ slot, alt, className = '', caption }) {
  const [attempt, setAttempt] = useState(0)
  const exhausted = attempt >= CANDIDATES.length

  return (
    <figure className={`hero-image ${className}`}>
      {exhausted ? (
        <div className="hero-image__placeholder" role="img" aria-label={alt}>
          <svg viewBox="0 0 64 64" aria-hidden="true">
            <path d="M8 44l13-15 9 10 7-8 19 21H8z" fill="currentColor" opacity="0.28" />
            <circle cx="43" cy="20" r="6" fill="currentColor" opacity="0.4" />
          </svg>
          <span>Image {slot}</span>
        </div>
      ) : (
        <img
          // Keyed so React swaps the element rather than reusing a failed one,
          // which would leave the browser showing the broken-image icon.
          key={CANDIDATES[attempt]}
          src={`/brand/hero-${slot}.${CANDIDATES[attempt]}`}
          alt={alt}
          loading="lazy"
          onError={() => setAttempt((n) => n + 1)}
        />
      )}
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  )
}
