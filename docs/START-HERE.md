# Start here

**You do not need PowerShell, a terminal, or anything installed.** The whole
setup happens in your browser: Cloudflare's dashboard, GitHub's website, and a
page in the app itself.

Three phases. Each ends with something you can see working, so you always know
where you are, and you can stop between them for a day or a week.

| Phase | At the end of it | Roughly |
| --- | --- | --- |
| **1** | The app is online. You can sign in and complete an inspection. | 30 min |
| **2** | The camera works. Photos go into your own Google Drive. | 25 min |
| **3** | Reports arrive by email. | 15 min |

> There is also a [command-line route](#appendix--the-command-line-route) if you
> prefer one. It is not faster, and it is where the sharp edges are.

---

# PHASE 1 — Get the app online

Everything here is clicking in a browser. At the end you will have a working app
at your own web address.

## 1.1 Create the database

1. Go to <https://dash.cloudflare.com> and sign in
2. Left sidebar → **Storage & Databases** → **D1 SQL Database**
3. **Create** → name it exactly **qa-platform** → **Create**
4. Copy the **Database ID** from the page that opens

## 1.2 Put that id into the code

You edit one file on GitHub's website. Nothing is downloaded.

1. Open `worker/wrangler.jsonc` on GitHub → the **pencil** icon
2. Find:

   ```
   "database_id": "REPLACE_WITH_YOUR_D1_DATABASE_ID",
   ```

3. Paste your id over the capitals, keeping the quotes and comma
4. **Commit changes** → commit directly to the branch

> That id is **not** a password. It only names the database, which still needs
> your Cloudflare account to open.

## 1.3 Let Cloudflare build the repository

Cloudflare can watch the repository and build it itself. This is the easy
route: it creates its own API token internally, so there is no token to copy
and no GitHub secrets to set.

1. Cloudflare dashboard → **Compute (Workers)** → **Create** → the
   **Import a repository** tab
2. Connect GitHub when prompted (an approval screen — nothing to copy). You can
   grant access to just this one repository.
3. Choose your repository, then fill in:

| Field | Value |
| --- | --- |
| Project name | `qa-platform` |
| Build command | `cd ../web && npm ci && npm run build && cd ../worker && npm ci` |
| Deploy command | `bash scripts/ci-deploy.sh` |
| **Advanced settings → Path** | `worker` |
| API token | leave on *Create new token* — Cloudflare makes it for you |
| Build variables | leave empty |

The project name must be exactly `qa-platform`: Cloudflare refuses the build if
it does not match the `name` in the configuration file.

4. **Deploy**

### The first build will fail, and that is expected

There is no branch field on that form, so Cloudflare uses the repository's
default branch — which does not have this code. You will see:

```
Failed: root directory not found
```

Fix it:

1. **Settings** → **Build** → **Production branch** → change it to the branch
   holding this work → **Save**
2. **This is the part people miss:** do *not* press **Retry build**. A retry
   re-runs the build it is attached to, which belongs to a commit on the old
   branch, so it fails the same way. A **new commit** on the production branch
   is what starts a correct build.

   Make any small edit on GitHub and commit it — a space in a comment will do.

The build after that is the real one: install, build, migrate, deploy. Three or
four minutes.

## 1.4 Find your address

Cloudflare → **Compute (Workers)** → **qa-platform**. The page shows:

```
https://qa-platform.<something>.workers.dev
```

**Write it down.** Below, **YOUR-URL** means this.

## 1.5 Add the signing key

The app refuses to let **anyone** sign in without this — deliberately, because
a missing key would mean logins anyone could forge.

**Make a random one.** Open Notepad and type a long jumble of letters and
digits — 50 characters or so, no spaces, all on one line. That is genuinely
enough; it only has to be long and unguessable.

*(If you would rather have the computer do it: right-click any web page →
**Inspect** → the **Console** tab → paste `crypto.randomUUID() +
crypto.randomUUID()` and press Enter.)*

**Store it where the build can reach it:** **qa-platform** → **Settings** →
**Builds** → **Variables and secrets** → **+ Add** → type **Secret** → name
`JWT_SECRET` → paste the value → **Save**.

**Then have the deploy install it.** In that same **Builds** section, check the
**Deploy command** reads:

```
bash scripts/ci-deploy.sh
```

**Save**, then make any small commit to trigger a build.

> **Why the long way round.** A build-time secret is not available when the app
> actually runs, so the obvious place is the wrong one. The dashboard's own
> runtime equivalent is not easy to find on a Worker built from a repository:
> **Settings → Runtime** holds only placement and compatibility settings, and
> **Settings → Bindings → + Add binding** lists resources — D1, KV, R2, Queues —
> with no plain secret among them.
>
> Having the deploy copy the build secret into the Worker's runtime secrets
> sidesteps all of that, and it keeps working: every future deploy re-applies
> it. The value never reaches the build log, because wrangler reads it from a
> pipe rather than the command line.
>
> `worker/scripts/ci-deploy.sh` is that step. It already knows the names used in
> Phases 2 and 3, and skips any that are not set — so from here on, adding a
> secret is one dashboard entry and **no change to the deploy command**.

## 1.6 Check it

Open **YOUR-URL/api/health**. You want:

```
{"status":"ok", ... "problems":[]}
```

If `problems` lists anything, it names exactly what is missing.

## 1.7 Create your organisation

Open **YOUR-URL**. It will say there are no accounts yet, with a link to set one
up. Click it, fill in the five boxes, press **Create my organisation**.

It shows a **temporary password**. **Write it down now** — shown once, stored
nowhere you can read back, and there is no other administrator to reset it.

## 1.8 Sign in

Username **omni**, that password. The app makes you choose your own at once.

Then **Inspections** → tap an item → **Critical** → type a note →
**Sign & submit**, and sign with your finger or mouse.

### ✅ Phase 1 is done when

- **YOUR-URL/api/health** says `"status":"ok"` with no problems
- You can sign in with your own password
- You can complete and sign an inspection

**Photos will not work yet.** The button is there and it will fail. That is
Phase 2, and it is expected.

---

# PHASE 2 — Photos into your Google Drive

Still all browser. At the end, photos taken in the app land in a folder in your
own Drive.

> **Why this phase has the most steps.** The obvious approach — a Google
> "service account" — does not work: Google gives them no storage of their own,
> so every upload fails. The app has to act as *you*, and that means going
> through Google's consent screen once.

## 2.1 Make the Drive folder

1. <https://drive.google.com> as **yulfassembly@gmail.com**
2. **New → New folder**, call it **H&S Inspection Photos**, create it, **open it**
3. The address bar now reads:

   ```
   https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz
   ```

   Copy the part after `folders/`. That is your **folder id**.

## 2.2 Make a Google Cloud project

1. <https://console.cloud.google.com>
2. Project dropdown (top left) → **New Project** → name it **HS Inspection** →
   **Create**. Wait a few seconds, then select it.
3. Search bar at the top → type **Google Drive API** → open it → **Enable**

## 2.3 Set up the consent screen

1. Left menu → **APIs & Services → OAuth consent screen**
2. **External** → **Create**
3. App name **HS Inspection**; support email and developer email are your own →
   **Save and Continue**
4. Scopes → **Save and Continue**
5. Test users → **Add Users** → **yulfassembly@gmail.com** → Add →
   **Save and Continue**

> Leave it in "Testing". You are the only user, so it never needs Google review.

## 2.4 Create the credentials

1. Left menu → **Credentials → Create Credentials → OAuth client ID**
2. Application type: **Web application** (not Desktop)
3. Name: **HS Inspection**
4. Under **Authorised redirect URIs** → **+ Add URI** → paste exactly:

   ```
   https://developers.google.com/oauthplayground
   ```

5. **Create**
6. Copy the **Client ID** and **Client secret**

## 2.5 Get the refresh token

Google has a page for exactly this, so nothing needs installing.

1. Go to <https://developers.google.com/oauthplayground>
2. Click the **gear icon** (top right)
3. Tick **Use your own OAuth credentials**
4. Paste your **Client ID** and **Client secret** → close the gear panel
5. In the left-hand list, scroll to **Drive API v3** and tick:

   ```
   https://www.googleapis.com/auth/drive.file
   ```

6. **Authorize APIs** → sign in as **yulfassembly@gmail.com**
7. **"Google hasn't verified this app"** → **Advanced** → **Go to HS Inspection
   (unsafe)**. It is your own app; the warning only means you have not paid
   Google to review it.
8. **Continue** / **Allow**
9. Back on the playground, click **Exchange authorization code for tokens**
10. Copy the **Refresh token** (it starts with `1//`)

## 2.6 Store the four values in Cloudflare

Same place as `JWT_SECRET` in Phase 1: **qa-platform** → **Settings** →
**Builds** → **Variables and secrets** → **+ Add**, type **Secret**, one at a
time:

| Name | Value |
| --- | --- |
| `GDRIVE_CLIENT_ID` | from 2.4 |
| `GDRIVE_CLIENT_SECRET` | from 2.4 |
| `GDRIVE_REFRESH_TOKEN` | from 2.5 |
| `GDRIVE_FOLDER_ID` | from 2.1 |

**Save.** The deploy command needs no change — it already installs these four
if they are there.

> **All four are passwords.** They let whoever holds them write to your Drive.
> They live in Cloudflare and nowhere else — never in a file, an email or a chat.

## 2.7 Switch photo storage on

Back on GitHub, edit the same file as before:
<https://github.com/JSRThevananth/QA/blob/main/worker/wrangler.jsonc>

Change:

```
"STORAGE_BACKEND": "none",
```

to:

```
"STORAGE_BACKEND": "drive",
```

While you are in there, check `PUBLIC_URL` is your own address — the photo
links in emailed reports are built from it:

```
"PUBLIC_URL": "https://qa-platform.yulfassembly.workers.dev"
```

Commit. **That commit deploys the app by itself** — watch the build in Cloudflare under **qa-platform → Deployments**.

## 2.8 Check it

**YOUR-URL/api/health** should say `"status":"ok"` and `"storage":"drive"`.

In the app: start an inspection, tap an item, tap **Take photo**, choose a
picture. A thumbnail appears within a few seconds — and the photo is in your
Drive folder.

### ✅ Phase 2 is done when

- A photo taken in the app shows as a thumbnail
- The same photo is in your Drive folder
- Health says `"storage":"drive"` with no problems

---

# PHASE 3 — Email the reports

## 3.1 Make a Brevo account

1. <https://www.brevo.com> → sign up, free plan
2. Confirm the email they send you

## 3.2 Verify the address reports come from

1. **Senders, Domains & Dedicated IPs → Senders → Add a sender**
2. Use **yulfassembly@gmail.com**
3. Brevo emails you a confirmation — **click the link in it**

> Skip this and every report fails silently. Brevo will not send from an address
> it has not confirmed is yours.

## 3.3 Get the API key

Your name (top right) → **SMTP & API → API Keys → Generate a new API key**.
Name it **HS Inspection** and copy it — **Brevo shows it once**.

## 3.4 Store it in Cloudflare

Same place as before — **qa-platform** → **Settings** → **Builds** →
**Variables and secrets**, both as type **Secret**:

| Name | Value |
| --- | --- |
| `BREVO_API_KEY` | from 3.3 |
| `BREVO_SENDER_EMAIL` | `yulfassembly@gmail.com` |

## 3.5 Switch sending on

On GitHub, edit `worker/wrangler.jsonc` once more and change:

```
"BREVO_ENABLED": "false",
```

to:

```
"BREVO_ENABLED": "true",
```

Commit. It deploys itself.

## 3.6 Add who gets the reports

In the app: **Units → Montreal Catering Unit**, and add the people who should
receive this unit's reports.

> Recipients belong to the unit. Add a second unit later and its reports go to
> *its* recipients, never to this one's. The app enforces that, not just the
> screen.

## 3.7 Send a real report

Run an inspection: flag an item, add a note, take a photo, **Sign & submit**.
The send dialog opens with your recipients already ticked. **Send**.

Check the inbox. The email has the finding, the note, the photo and your
signature — and the whole report attached as a **PDF**, photographs inside it,
so the recipient can file it without keeping the email.

### ✅ Phase 3 is done when

A report lands in a real inbox with its PDF attached, and the photo is in it.

---

# You are live

From here on, changes deploy themselves: a push to GitHub runs the tests, builds
the app and deploys it, and a failing test stops the deploy before it reaches
you.

To change a setting later, edit `worker/wrangler.jsonc` on GitHub and commit.
To change a secret, use the Cloudflare dashboard.

**The nightly job** runs at 03:10 UTC. It deletes photos past their retention
window (14 days by default) and marks the record as purged, then rebuilds each
unit's monthly spreadsheet in your Drive folder. Ratings, notes, findings and
signatures are never purged.

**The morning digest** goes out weekdays at 11:45 UTC to anyone with a
corrective action overdue or due that week — and to nobody when there is
nothing outstanding. See [docs/corrective-actions.md](corrective-actions.md).

**The monthly sheet** is a view of the database, rebuilt from scratch each
night — so an edit typed into the spreadsheet is replaced, not kept. Find it
under **Units → the unit → Monthly record**, where you can also download the
month as a CSV or rebuild it on the spot. See
[docs/monthly-sheet.md](monthly-sheet.md).

**Someone forgot their password** — an admin resets it in the app under Users.

## When something is wrong

**Always start at YOUR-URL/api/health.** Its `problems` list names what is
missing.

| What you see | What it means |
| --- | --- |
| The build fails with "root directory not found" | The production branch is wrong, or you pressed Retry instead of making a new commit — see 1.3. |
| Sign-in fails with a 503 | `JWT_SECRET` is not set — step 1.8. |
| "no such table" | The build did not get as far as the migrations. Check the Deployments log. |
| Photos fail with a 500 | A Google secret is wrong — redo 2.5 for a fresh refresh token. |
| "This deployment is already set up" | Setup has been used. Sign in with the account you made — the username is `omni`, not your name. |
| You lost the temporary password before signing in | See [Reissuing the administrator](#reissuing-the-administrator) below. |
| Report says sent, nothing arrives | Sender not confirmed in Brevo (3.2), then the spam folder, then **YOUR-URL/api/notifications/log**. |
| The app looks unchanged after a deploy | Hard-refresh: **Ctrl+Shift+R**. |

## Reissuing the administrator

The temporary password is shown once and stored only as a hash. Lose it before
signing in and that account can never be used — and on a fresh deployment it is
the only account, so there is nobody to reset it.

The way out is to remove the unusable account so setup can issue another. Your
organisation, unit and checklist all stay.

> This only works **before any inspection exists**. After that the account is
> the author of records and cannot be removed; create a second admin from
> inside the app and reset passwords there instead.

Run this once, from `worker/`:

```
wrangler d1 execute qa-platform --remote --command "UPDATE unit_templates SET created_by = NULL WHERE created_by IN (SELECT id FROM users WHERE role = 'omni_admin'); UPDATE unit_custom_items SET created_by = NULL WHERE created_by IN (SELECT id FROM users WHERE role = 'omni_admin'); UPDATE unit_recipients SET created_by = NULL WHERE created_by IN (SELECT id FROM users WHERE role = 'omni_admin'); UPDATE attachments SET uploaded_by = NULL WHERE uploaded_by IN (SELECT id FROM users WHERE role = 'omni_admin'); UPDATE inspections SET signed_by = NULL WHERE signed_by IN (SELECT id FROM users WHERE role = 'omni_admin'); UPDATE inspection_signatures SET captured_by = NULL WHERE captured_by IN (SELECT id FROM users WHERE role = 'omni_admin'); DELETE FROM users WHERE role = 'omni_admin';"
```

The `UPDATE` lines come first because several tables record which user created a
row, and those references would otherwise block the delete.

Then open **YOUR-URL/setup** again. It will see no administrator, create a new
one, and show a new temporary password. **Write it down this time** — the
checklist step afterwards will report that the checklist is already installed,
which is correct and not a failure.

## What this costs

Nothing. Cloudflare's free plan covers 100,000 requests a day and the database.
Drive uses the 15 GB you already have. Brevo sends 300 emails a day free.

No card is needed anywhere. The one Cloudflare feature that *does* ask for one —
R2 storage — is exactly what using Drive avoids.

---

# Appendix — the command-line route

Only if you want it. The browser route above does everything this does.

You need [Node.js](https://nodejs.org) (LTS) and [Git](https://git-scm.com).
Then:

```
git clone -b claude/web-app-stack-setup-49z2df https://github.com/JSRThevananth/QA.git
cd QA
npm install --prefix web
npm install --prefix worker
npm install --global wrangler
wrangler login
```

Then from `worker/`:

```
wrangler d1 create qa-platform          # put the id in wrangler.jsonc
wrangler d1 migrations apply qa-platform --remote
wrangler secret put JWT_SECRET
cd ../web && npm run build
cd ../worker && wrangler deploy
```

For the Drive token, `node scripts/google-auth.mjs` does what the OAuth
playground does in 2.5.

Useful afterwards:

```
wrangler tail                                     # watch requests live
wrangler d1 export qa-platform --remote --output backup.sql
```
