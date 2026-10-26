/*
 * Brand mark.
 *
 * Drop the supplied logo at web/public/brand/logo.png and it is used automatically.
 * Until then the inline mark below renders, so spacing and layout are already final.
 *
 * The supplied logo is a horizontal wordmark on a white background, so it sits on a
 * white plate in both themes: on a dark surface a white-background image would
 * otherwise read as an unexplained white rectangle. The plate makes that deliberate.
 *
 * Served as a local static file rather than from Google Drive - Drive links need
 * auth, are rate limited, and would leave the page with no logo if Drive were down.
 */
import { useState } from 'react'

/*
 * Tried in order, so replacing the artwork needs no code change.
 *
 * PNG first because that is what is supplied. It matters more than it looks:
 * a missing file does not 404 here - the single-page-application fallback
 * answers every unmatched path with index.html - so a wrong first guess costs
 * a request that downloads the whole page and then fails to decode as an image.
 */
const LOGO_CANDIDATES = ['/brand/logo.png', '/brand/logo.svg', '/brand/logo.webp']

export default function Brand({ size = 'md', showDescriptor = true }) {
  const [attempt, setAttempt] = useState(0)
  const logoFailed = attempt >= LOGO_CANDIDATES.length

  return (
    <span className={`brand brand--${size}`}>
      {logoFailed ? (
        <FallbackMark />
      ) : (
        <span className="brand__plate">
          <img
            key={LOGO_CANDIDATES[attempt]}
            className="brand__logo"
            src={LOGO_CANDIDATES[attempt]}
            alt="gate gourmet"
            onError={() => setAttempt((n) => n + 1)}
          />
        </span>
      )}
      {showDescriptor && <span className="brand__descriptor">Health &amp; Safety</span>}
    </span>
  )
}

/** Placeholder until the logo file is in place: a shield over a check. */
function FallbackMark() {
  return (
    <svg className="brand__fallback" viewBox="0 0 40 40" aria-label="Health and safety" role="img">
      <defs>
        {/*
          stop-color is an SVG presentation attribute, and those do not resolve CSS
          custom properties - set it as a style property so var() applies.
        */}
        <linearGradient id="brandGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" style={{ stopColor: 'var(--brand-mark)' }} />
          <stop offset="100%" style={{ stopColor: 'var(--brand-hover)' }} />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="11" fill="url(#brandGrad)" />
      <path
        d="M20 9.5l7.5 2.8v6.2c0 4.6-3.1 8.4-7.5 9.8-4.4-1.4-7.5-5.2-7.5-9.8v-6.2L20 9.5z"
        fill="none" stroke="#fff" strokeWidth="1.9" strokeLinejoin="round"
      />
      <path d="M16.4 19.2l2.6 2.6 5-5.2" fill="none" stroke="#fff" strokeWidth="2.1"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
