# Setting up the Apps Script app

About 30 minutes, once. Everything is free and nothing needs a card.

You will need Node.js and Git installed — you already have both from the earlier
setup.

---

## Step 1 — Get the code

```powershell
cd Desktop\QA
git pull
```

## Step 2 — Install clasp

`clasp` is Google's tool for pushing code into Apps Script. Without it you would be
copy-pasting sixteen files by hand.

```powershell
npm install -g @google/clasp
clasp login
```

`clasp login` opens your browser. Sign in as **yulfassembly@gmail.com** and allow
access. That authorisation stays on your machine.

## Step 3 — Create the Apps Script project

```powershell
cd appscript
clasp create --type webapp --title "Health and Safety Platform" --rootDir .
```

This creates the project in your Google account and writes a `.clasp.json` holding
its id. That file is gitignored — it is specific to your project.

## Step 4 — Build the interface and push everything

```powershell
cd ..\web
npm install
npm run build:appscript
cd ..\appscript
clasp push --force
```

`build:appscript` compiles the React app and folds it into one HTML file, because
Apps Script serves a single page rather than a bundle. `clasp push` uploads that
plus the sixteen `.gs` files.

You should see roughly `Pushed 17 files.`

## Step 5 — Run the first-time setup

```powershell
clasp open
```

In the editor that opens:

1. Choose **setUp** from the function dropdown at the top
2. Press **Run**
3. Google asks for permissions the first time. It will warn that the app is not
   verified — that is expected for your own script. Choose **Advanced**, then
   **Go to Health and Safety Platform (unsafe)**, then **Allow**.
4. Open **Execution log** at the bottom

The log prints your first sign-in details:

```
  FIRST SIGN-IN
    username: admin
    password: 7f2a9c14b0e83d

  This password is shown once and cannot be recovered.
```

> **Copy that password now.** It is random, printed once, and not stored anywhere
> readable. If you lose it, run `resetPassword('admin')` from the editor to issue
> a new one.

`setUp` also creates your data spreadsheet, your Drive evidence folder, the 303-item
checklist and your first unit. Running it again is harmless.

## Step 6 — Publish the web app

In the editor: **Deploy → New deployment → ⚙ → Web app**

| Field | Set to |
|---|---|
| Execute as | **Me** |
| Who has access | **Anyone** |

Press **Deploy** and copy the **Web app URL**. That is your application.

> **"Anyone" is deliberate**, not an oversight. Your inspectors do not have Google
> accounts, so Google cannot identify them — the app's own sign-in is the gate.
> Anyone with the link reaches the sign-in screen and no further.

## Step 7 — Sign in and set your password

Open the URL. Sign in as `admin` with the password from Step 5. You will be required
to choose a new one before you can go any further.

Then walk through it: open **Inspections**, tap some findings, close the tab, come
back. Your work will be where you left it.

## Step 8 — Turn on email

Add your Brevo key so reports actually send. In the editor:
**Project Settings → Script Properties → Add script property**

| Property | Value |
|---|---|
| `BREVO_ENABLED` | `true` |
| `BREVO_API_KEY` | Your key, starting `xkeysib-` |
| `BREVO_SENDER_EMAIL` | `yulfassembly@gmail.com` |
| `BREVO_SENDER_NAME` | `Gate Gourmet H&S` |

Leave `BREVO_ENABLED` as `false` while testing — reports are recorded in the
**EmailLog** tab but not sent, so you use none of your 300/day.

> The sender address must be **verified in Brevo** first. Without that, email fails
> silently — no error, no bounce, nothing to tell you why.

## Step 9 — Schedule the automatic jobs

In the editor, run **installTriggers** once. That schedules the nightly photo purge
and the report jobs.

---

## Adding your units and people

Sign in as admin and use the app. For each unit you add, remember to add its
**report recipients** — reports go only to the list attached to that unit, so a
unit with no recipients sends to nobody.

## Everyday tasks

**Someone forgot their password** — in the editor, run `resetPassword('username')`.
The log shows a temporary password they must change at next sign-in.

**Seeing the raw data** — open the spreadsheet `Health & Safety Platform - Data` in
your Drive. Do not edit it by hand: the app expects its columns in a fixed order.

**Updating the app after I make changes**

Set up automatic deploys once and you never do this by hand again: see
[docs/appscript-deploy.md](appscript-deploy.md). Pushing to GitHub then builds
and publishes the app by itself.

By hand, if you prefer:

```powershell
cd Desktop\QA
git pull
cd web
npm run build:appscript
cd ..\appscript
npm run push
```

Then **Deploy → Manage deployments → ✏️ → Version: New version → Deploy**. Without
that last step your URL keeps serving the old version.

---

## What is not built yet

- **Corrective action tracking** — findings are recorded, but not yet followed to
  closure with an owner and a due date
- **Threshold alerts** — no automatic warning yet when a unit records repeated
  findings
- **Monthly PDF report** — the schedule exists, the report does not
- **Messaging** between admins and unit managers

Tell your first users, so nobody expects a corrective action to be tracked.

## One honest limitation

Apps Script cannot be run outside Google, so I could not execute this the way I ran
the Node build. 74 tests cover the logic through stand-ins for the Google services,
and they pass — but they prove the logic, not that the Google bindings behave as
assumed.

Step 7 is the real test. If anything misbehaves, send me the error from
**Executions** in the editor and I will fix it.
