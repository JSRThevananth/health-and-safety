/**
 * Rules the browser and the server both have to agree on.
 *
 * Kept here, imported by both the pages that enforce them and the tests,
 * because the alternative was a copy in each - and that copy went stale the
 * moment the server's minimum changed, so the page promised one length while
 * the API enforced another and the person retyping was told nothing useful.
 *
 * The server is still the one that decides; this only exists so the browser can
 * say the same thing before asking.
 */

/**
 * Must match MIN_PASSWORD_LENGTH in worker/src/crypto.js, which explains why it
 * is as low as it is. There is no maximum: a long passphrase is never refused.
 */
export const MIN_PASSWORD_LENGTH = 6
