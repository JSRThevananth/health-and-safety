import { timingSafeEqual } from '../crypto.js'

/**
 * Signed links for photos inside an emailed report.
 *
 * An email client cannot send a bearer token, and Brevo does not support inline
 * images, so a photo in the body has to be an ordinary https URL that works
 * without a session. Making it unguessable and short-lived is what keeps that
 * from being a hole: the token names one attachment, expires, and is signed with
 * the same secret as a session token, so it cannot be minted by anyone else.
 *
 * It is still a link: whoever holds it can see that one photo until it expires.
 * That is the same exposure as the photo being attached to the email, which it
 * also is - but it is worth knowing rather than discovering.
 */

const encoder = new TextEncoder()

export async function signPhotoToken(attachmentId, config) {
  const expires = Math.floor(Date.now() / 1000) + config.reports.photoLinkDays * 24 * 60 * 60
  const signature = await sign(`${attachmentId}.${expires}`, config.auth.secret)
  return `${expires}.${signature}`
}

/** True when the token is this attachment's, correctly signed, and still current. */
export async function verifyPhotoToken(attachmentId, token, config) {
  const [expires, signature] = String(token || '').split('.')
  if (!expires || !signature) return false
  if (!/^\d+$/.test(expires)) return false
  if (Number(expires) <= Math.floor(Date.now() / 1000)) return false

  const expected = await sign(`${attachmentId}.${expires}`, config.auth.secret)
  return timingSafeEqual(encoder.encode(signature), encoder.encode(expected))
}

async function sign(message, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(`photo-link:${secret}`),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(message)))
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
