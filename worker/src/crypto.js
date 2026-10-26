/**
 * Passwords and session tokens, on WebCrypto.
 *
 * The Node build used bcrypt and jsonwebtoken. Neither runs in a Worker: bcrypt is
 * a native addon, and jsonwebtoken reaches for Node's crypto module. Both are
 * replaced here with the primitives the Workers runtime provides natively, which
 * also means no dependency to audit for either one.
 */

const encoder = new TextEncoder()

/* ------------------------------------------------------------- passwords -- */

export const MIN_PIN_LENGTH = 4

/**
 * PBKDF2-SHA256, in place of bcrypt.
 *
 * The iteration count is a compromise forced by the platform, and it is worth
 * being plain about it.
 *
 * OWASP's figure for PBKDF2-HMAC-SHA256 is 210,000. Measured in the Workers
 * runtime that costs 92ms of CPU - and the Workers free plan allows 10ms per
 * request. A Worker that hashes at OWASP strength is simply killed mid-request,
 * which is not a theoretical problem: it is how this deployment first failed,
 * silently, half-way through creating its own admin account.
 *
 * Measured on workerd: 10,000 iterations costs 4ms, 25,000 costs 12ms. 10,000
 * leaves room for the rest of a sign-in - parsing, the database round trips and
 * signing the token - inside the budget.
 *
 * What that costs in security, honestly: a stolen database becomes roughly 20x
 * cheaper to attack offline than at OWASP strength. Two things offset it. The
 * minimum password length is 12 rather than 8, and length buys far more against
 * an offline attack than iterations do. And the cost is recorded in every hash,
 * so raising it later re-secures new passwords without invalidating old ones -
 * on the Workers paid plan, where the budget is 30 seconds rather than 10ms,
 * PASSWORD_ITERATIONS can simply be set to 210000.
 */
const DEFAULT_ITERATIONS = 10_000
const KEY_BYTES = 32
const SALT_BYTES = 16

/**
 * A stored hash records the algorithm and cost that produced it, so raising the
 * iteration count later does not invalidate every existing password: an old hash
 * still verifies against its own recorded cost.
 */
export async function hashPassword(password, iterations = DEFAULT_ITERATIONS) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const hash = await pbkdf2(password, salt, iterations)
  return `pbkdf2-sha256$${iterations}$${b64(salt)}$${b64(hash)}`
}

/** The longest hash this will attempt, so a crafted value cannot burn the budget. */
const MAX_VERIFY_ITERATIONS = 400_000

export async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$')
  if (parts.length !== 4 || parts[0] !== 'pbkdf2-sha256') {
    // Includes the bcrypt hashes the Node build wrote. They cannot be verified
    // here, and silently returning false is correct: the account needs a reset,
    // not a quietly accepted sign-in.
    return false
  }
  const [, iterations, salt, expected] = parts
  const rounds = Number(iterations)
  // The cost comes out of the stored hash, which is what lets the default rise
  // later without invalidating existing passwords - but it is still a number
  // read from the database, so it is bounded.
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > MAX_VERIFY_ITERATIONS) return false
  const actual = await pbkdf2(password, unb64(salt), rounds)
  return timingSafeEqual(actual, unb64(expected))
}

/**
 * Something for login to compare against when the username does not exist, so an
 * unknown user costs the same time as a wrong password and the response cannot be
 * used to enumerate accounts.
 */
export const DUMMY_HASH = `pbkdf2-sha256$${DEFAULT_ITERATIONS}$${b64(new Uint8Array(SALT_BYTES))}$${b64(new Uint8Array(KEY_BYTES))}`

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    key,
    KEY_BYTES * 8
  )
  return new Uint8Array(bits)
}

/* ----------------------------------------------------------------- tokens -- */

/**
 * Sign a JWT (HS256).
 *
 * Hand-rolled rather than pulled from a library because it is twenty lines of
 * WebCrypto, and a signing routine is worth being able to read in full.
 */
export async function signToken(payload, secret, ttlSeconds) {
  const issued = Math.floor(Date.now() / 1000)
  const body = { ...payload, iat: issued, exp: issued + ttlSeconds }
  const head = b64url(encoder.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
  const claims = b64url(encoder.encode(JSON.stringify(body)))
  const signature = await hmac(`${head}.${claims}`, secret)
  return `${head}.${claims}.${b64url(signature)}`
}

/** Verify and decode a token. Returns null for anything not currently valid. */
export async function readToken(token, secret) {
  const parts = String(token || '').split('.')
  if (parts.length !== 3) return null

  const [head, claims, signature] = parts
  const expected = await hmac(`${head}.${claims}`, secret)
  if (!timingSafeEqual(unb64url(signature), expected)) return null

  let payload
  try {
    payload = JSON.parse(new TextDecoder().decode(unb64url(claims)))
  } catch {
    return null
  }

  // A signature alone does not make a token current; an expired one is still
  // perfectly signed.
  if (typeof payload.exp !== 'number' || payload.exp <= Math.floor(Date.now() / 1000)) return null
  return payload
}

async function hmac(message, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(message)))
}

/* ------------------------------------------------------------------ bytes -- */

/**
 * Compare without leaking where two values first differ.
 *
 * A plain === on a signature returns as soon as a byte differs, and the timing of
 * that return is enough to recover the signature one byte at a time.
 */
export function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i]
  return diff === 0
}

// Function declarations, not consts: DUMMY_HASH above is computed at module load
// and a const arrow defined further down the file would not exist yet.
function b64(bytes) {
  return btoa(String.fromCharCode(...bytes))
}

function unb64(text) {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0))
}

function b64url(bytes) {
  return b64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function unb64url(text) {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(text.length / 4) * 4, '=')
  return unb64(padded)
}

/** A random identifier for object keys and the like. */
export const randomId = () =>
  [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('')
