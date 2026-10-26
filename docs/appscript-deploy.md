# Automatic deploys: push to GitHub, the app updates itself

Once this is set up you never open the Apps Script editor to paste code again.
You push to GitHub, GitHub builds the app and sends it to Apps Script, and the
`/exec` URL serves the new version a minute later.

The workflow that does it is `.github/workflows/deploy-appscript.yml`.

> **Read this before you set `APPS_SCRIPT_ID` to your live project.**
>
> This workflow makes GitHub the source of truth: it overwrites every file in
> the target Apps Script project with what is in this repository. The app
> currently running at your `/exec` URL was written in the editor and its code
> is **not** in this repository, so pointing this at that project would replace
> your running app with this repository's version.
>
> Do one of these first:
>
> - **Keep the running app.** On your computer, `clasp clone <SCRIPT_ID>` into a
>   folder, copy the files it pulls into `appscript/src/` (and the HTML into
>   `appscript/html/`), commit them. Now the repository matches what is live and
>   the first deploy changes nothing. This is the right order if you want the
>   signatures and recipient-dropdown work added to the app you are already
>   using.
> - **Or deploy somewhere safe first.** Create a brand-new Apps Script project,
>   use its script id, and check the result before you ever point this at the
>   live one.

## What it does on every push

1. Runs the Apps Script tests. A failing test stops the deploy.
2. Builds the React UI and inlines it into one HTML file.
3. Copies the `.gs` files, the manifest and that HTML into one flat folder.
4. `clasp push` sends them to your Apps Script project.
5. `clasp create-deployment` republishes the same deployment, so the live
   `/exec` URL starts serving the new code **without the URL changing**.

Step 5 is the one people miss. `clasp push` only changes the code in the
editor; a web app keeps serving whichever version its deployment points at. Skip
step 5 and the deploy looks like it did nothing.

## Your side of the setup — three secrets, once

### Before you start

The Apps Script API must be on for your Google account. Open
<https://script.google.com/home/usersettings> and turn on **Google Apps Script
API**. Nothing below works until that switch is on — this is the error you hit
last time.

### 1. APPS_SCRIPT_ID

In the Apps Script editor: **Project Settings** (the gear on the left) → **IDs**
→ copy **Script ID**. It is a long string of letters and numbers.

### 2. CLASPRC_JSON

On your own computer, in PowerShell (don't type the `$`):

```
npm install --global @google/clasp@3
clasp login
```

A browser window opens; sign in as **yulfassembly@gmail.com** and allow access.
Then print the credentials file:

```
Get-Content $HOME\.clasprc.json
```

Copy everything it prints, including the opening `{` and closing `}`.

**This file contains a Google refresh token for that account.** Anyone who has it
can act as your account against the Apps Script API. It goes into a GitHub
repository secret and nowhere else — not into a file you commit, not into a chat
message, not into an email. If you ever think it leaked, run `clasp logout` and
then revoke access at <https://myaccount.google.com/permissions>.

### 3. APPS_SCRIPT_DEPLOYMENT_ID

This is the deployment behind your current `/exec` link, the one in the QR code.

In the Apps Script editor: **Deploy** → **Manage deployments**, click your active
web app deployment, and copy its **Deployment ID**. If the panel shows the URL
but no id, the id is the long middle section of the URL itself:
`https://script.google.com/macros/s/`**`THIS_PART`**`/exec`.

If you leave this secret out, the code still pushes but the live URL keeps
serving the old version, and the deploy logs a warning saying so.

### 4. Paste them into GitHub

In the repository: **Settings** → **Secrets and variables** → **Actions** →
**New repository secret**. Add all three, named exactly:

| Name | Value |
| --- | --- |
| `APPS_SCRIPT_ID` | the Script ID from step 1 |
| `CLASPRC_JSON` | the whole file from step 2 |
| `APPS_SCRIPT_DEPLOYMENT_ID` | the Deployment ID from step 3 |

### 5. Try it

Repository → **Actions** tab → **Deploy to Apps Script** → **Run workflow**.
Watch it go green, then open your `/exec` URL and hard-refresh.

After that it runs by itself on every push that touches `web/` or `appscript/`.

## Deploying from your own machine instead

The same thing, without GitHub:

```
cd appscript
npm run push
```

That needs a local `.clasp.json` (gitignored — it holds the script id):

```
{ "scriptId": "YOUR_SCRIPT_ID", "rootDir": "./.deploy" }
```

and a `web` build first if you changed the UI (`cd web; npm run build:appscript`).

## When it goes wrong

**"clasp could not use CLASPRC_JSON" / `show-authorized-user` fails.** The token
expired or was revoked. Run `clasp login` again locally and re-paste
`~/.clasprc.json` into the secret.

**"User has not enabled the Apps Script API".** The switch in *Before you start*
is off.

**The job is green but the app is unchanged.** Either
`APPS_SCRIPT_DEPLOYMENT_ID` is missing (check the job log for the warning), or
your browser cached the old page — hard-refresh.

**`push` fails on the manifest.** Someone edited `appsscript.json` in the Apps
Script editor. The repository is the source of truth now; the workflow overwrites
editor changes on purpose. Make the change in `appscript/src/appsscript.json` and
push.

**It overwrote something I had only in the editor.** That is what it does, and
why editor edits have to stop. Before the first deploy, run `clasp pull` once
into a scratch folder and keep that copy, so anything that only exists in the
live project is saved.
