/**
 * Password hashing and token signing.
 *
 * Apps Script has no bcrypt, so passwords are stretched with repeated SHA-256 -
 * PBKDF2 in shape, if not in name.
 *
 * Be clear about what this is: it is weaker than bcrypt. bcrypt is deliberately
 * memory-hard, which blunts GPU cracking; SHA-256 is not, so an attacker holding
 * the hashes can try far more candidates per second. What it buys is that hashes
 * are salted and stretched rather than stored raw, so a leaked spreadsheet does
 * not hand over everyone's password immediately.
 *
 * The compensating controls matter more here than in the Node build:
 *   - the Users tab is hidden and the spreadsheet is never shared
 *   - sign-in is rate limited (see Auth.gs)
 *   - a minimum password length is enforced
 *   - admin-issued passwords must be changed on first use
 */

// Each round is a native call, so the cost is real wall-clock time on sign-in.
// 12,000 keeps a sign-in comfortably under a second while making bulk guessing
// against a leaked hash meaningfully expensive.
const HASH_ROUNDS = 12000;
const SALT_BYTES = 24;

function _bytesToHex(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    // computeDigest returns signed bytes; bring them back into 0-255.
    const b = (bytes[i] + 256) % 256;
    out += (b < 16 ? '0' : '') + b.toString(16);
  }
  return out;
}

function generateSalt() {
  let seed = '';
  for (let i = 0; i < 3; i += 1) seed += Utilities.getUuid();
  return _bytesToHex(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, seed)
  ).slice(0, SALT_BYTES * 2);
}

/** Stretch a password into a hash. Same salt and password always give the same result. */
function hashPassword(password, salt) {
  let digest = String(salt) + String(password);
  for (let i = 0; i < HASH_ROUNDS; i += 1) {
    digest = _bytesToHex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, digest + i));
  }
  return digest;
}

/**
 * Compare two hashes without leaking, through timing, how much of the value matched.
 * A plain === returns as soon as it finds a difference, which is measurable.
 */
function safeEqual(a, b) {
  const x = String(a);
  const y = String(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i += 1) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

function verifyPassword(password, salt, expectedHash) {
  return safeEqual(hashPassword(password, salt), expectedHash);
}

/**
 * Sign a session token so it cannot be forged.
 *
 * HMAC-SHA256 is a real primitive provided by Apps Script rather than something
 * hand-rolled, which is why tokens are trusted more readily than passwords here.
 */
function signToken(payload) {
  const secret = requireConfig(['tokenSecret']).tokenSecret;
  const body = Utilities.base64EncodeWebSafe(JSON.stringify(payload));
  const mac = _bytesToHex(
    Utilities.computeHmacSha256Signature(body, secret)
  );
  return body + '.' + mac;
}

/** Verify and unpack a token. Returns null for anything tampered with or expired. */
function readToken(token) {
  if (!token || String(token).indexOf('.') === -1) return null;
  const secret = getConfig().tokenSecret;
  if (!secret) return null;

  const parts = String(token).split('.');
  if (parts.length !== 2) return null;

  const expected = _bytesToHex(Utilities.computeHmacSha256Signature(parts[0], secret));
  if (!safeEqual(parts[1], expected)) return null;

  let payload;
  try {
    payload = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString());
  } catch (e) {
    return null;
  }

  if (!payload || !payload.exp || new Date(payload.exp).getTime() < Date.now()) return null;
  return payload;
}
