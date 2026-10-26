import http from 'node:http'
import readline from 'node:readline/promises'
import { stdin, stdout } from 'node:process'

/**
 * Get a Google refresh token for Drive, interactively, on your own machine.
 *
 * Why this exists: the app uploads photos to Drive as the account owner, not as
 * a service account - a service account has no storage of its own and Google
 * refuses its uploads to a personal My Drive. Acting as the owner needs a
 * refresh token, and getting one means a browser consent screen, which a Worker
 * cannot show. So it happens here, once.
 *
 * Nothing is sent anywhere except Google. The token is printed for you to paste
 * into "wrangler secret put GDRIVE_REFRESH_TOKEN", and this script never writes
 * it to disk - a credential in a file is a credential that gets committed.
 *
 *   node scripts/google-auth.mjs
 */

const PORT = 53682
const REDIRECT = `http://localhost:${PORT}`
const SCOPE = 'https://www.googleapis.com/auth/drive.file'

console.log(`
Google Drive setup
──────────────────
You need the Client ID and Client secret from the OAuth client you created in
the Google Cloud console (APIs & Services -> Credentials -> Desktop app).
`)

/**
 * Taken from the command line or the environment if given, asked for if not.
 *
 *   node scripts/google-auth.mjs <client-id> <client-secret>
 *   GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... node scripts/google-auth.mjs
 *
 * Prompting is the friendly path, but it needs a real terminal; the other two
 * work anywhere, which also makes this script testable.
 */
async function credentials() {
  const [argId, argSecret] = process.argv.slice(2)
  const id = argId || process.env.GOOGLE_CLIENT_ID
  const secret = argSecret || process.env.GOOGLE_CLIENT_SECRET
  if (id && secret) return { clientId: id.trim(), clientSecret: secret.trim() }

  if (!stdin.isTTY) {
    console.error(
      'No terminal to ask on. Pass them instead:\n' +
        '  node scripts/google-auth.mjs <client-id> <client-secret>'
    )
    process.exit(1)
  }

  const rl = readline.createInterface({ input: stdin, output: stdout })
  const clientId = (await rl.question('Client ID: ')).trim()
  const clientSecret = (await rl.question('Client secret: ')).trim()
  rl.close()
  return { clientId, clientSecret }
}

const { clientId, clientSecret } = await credentials()

if (!clientId || !clientSecret) {
  console.error('\nBoth are required. Nothing was changed.')
  process.exit(1)
}

const authUrl =
  'https://accounts.google.com/o/oauth2/v2/auth?' +
  new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT,
    response_type: 'code',
    scope: SCOPE,
    // Without these two Google returns an access token only, and the refresh
    // token - the one thing this script exists to get - is simply absent.
    access_type: 'offline',
    prompt: 'consent',
  })

console.log(`
Open this in your browser, signed in as the account whose Drive will hold the photos:

${authUrl}

Google will warn that the app is not verified. It is your own app; click
"Advanced", then "Go to ... (unsafe)", then allow access.

Waiting for you to finish...`)

const code = await new Promise((resolve, reject) => {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, REDIRECT)
    const received = url.searchParams.get('code')
    const error = url.searchParams.get('error')

    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(
      `<body style="font-family:system-ui;padding:40px;max-width:40em">
         <h2>${received ? 'Done.' : 'That did not work.'}</h2>
         <p>${received ? 'You can close this tab and go back to the terminal.' : `Google said: ${error}`}</p>
       </body>`
    )

    server.close()
    if (received) resolve(received)
    else reject(new Error(error || 'No authorization code was returned'))
  })

  server.on('error', (error) => {
    reject(
      error.code === 'EADDRINUSE'
        ? new Error(`Port ${PORT} is already in use. Close whatever is using it and run this again.`)
        : error
    )
  })
  server.listen(PORT)
})

// Overridable so the script itself can be tested without talking to Google.
const TOKEN_ENDPOINT = process.env.GOOGLE_TOKEN_ENDPOINT || 'https://oauth2.googleapis.com/token'

const response = await fetch(TOKEN_ENDPOINT, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: REDIRECT,
    grant_type: 'authorization_code',
  }),
})

if (!response.ok) {
  console.error(`\nGoogle refused the exchange:\n${await response.text()}`)
  process.exit(1)
}

const token = await response.json()
if (!token.refresh_token) {
  console.error(`
Google returned an access token but no refresh token.

That happens when this account has already granted access to this client: the
refresh token is only issued the first time. Remove the app at
https://myaccount.google.com/permissions and run this again.`)
  process.exit(1)
}

console.log(`
Done. Three values to set, one at a time:

  wrangler secret put GDRIVE_CLIENT_ID
  ${clientId}

  wrangler secret put GDRIVE_CLIENT_SECRET
  ${clientSecret}

  wrangler secret put GDRIVE_REFRESH_TOKEN
  ${token.refresh_token}

Then the id of the Drive folder the photos go into:

  wrangler secret put GDRIVE_FOLDER_ID

Treat all four as passwords. They let anything holding them write to that
Drive, and this script has not saved them anywhere.
`)
