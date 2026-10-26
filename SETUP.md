# Setup guide

Written for someone who has never run a web application before. Follow it in order.
Each step says what to type, what you should see, and what to do if it goes wrong.

You only do Part 1 once. After that, starting the app is two commands.

---

## Part 1 — Get the app running on your computer

### Step 1: Install Node.js

Node.js runs the application.

1. Go to <https://nodejs.org>
2. Download the version labelled **LTS** (the left-hand button)
3. Run the installer and click Next through every screen. Defaults are fine.
4. **Restart your computer.** The installer changes settings that only take effect
   after a restart, and skipping this causes the most common failure below.

**Check it worked.** Open a terminal:

- Windows: press the Windows key, type `powershell`, press Enter
- Mac: press Cmd+Space, type `terminal`, press Enter

Type this and press Enter:

```bash
node --version
```

You should see something like `v22.14.0`. Any number **20 or higher** is fine.

> **"node is not recognized"** — Node.js is not installed, or you have not restarted.
> Restart your computer and try again. If it still fails, reinstall Node.js.

### Step 2: Install Git

Git downloads the code and keeps it up to date.

1. Go to <https://git-scm.com/downloads>
2. Download for your system and run the installer. Defaults are fine throughout.
3. Check it worked:

```bash
git --version
```

You should see something like `git version 2.43.0`.

### Step 3: Download the code

In your terminal, one line at a time:

```bash
cd Desktop
git clone https://github.com/JSRThevananth/QA.git
cd QA
git checkout claude/web-app-stack-setup-49z2df
```

You should see `Switched to branch 'claude/web-app-stack-setup-49z2df'`.

> **That last line matters.** The work is on this branch, not on `main`. If you skip
> it you will see an old version of the project and nothing below will work.

> **Asked for a username and password?** GitHub no longer accepts your account
> password here. Sign in through the browser window it opens, or install
> [GitHub Desktop](https://desktop.github.com) and clone through that instead.

### Step 4: Start the API

The API is the part that stores data. Still in the `QA` folder:

```bash
cd server
npm install
npm run seed
npm run dev
```

- `npm install` downloads what the app needs. **It takes 1–3 minutes.** Warnings in
  yellow are normal and can be ignored.
- `npm run seed` creates the database with a demo organisation, two units and the
  full 303-point checklist.
- `npm run dev` starts it.

You should see:

```
API listening on http://localhost:8000  [development]
  email:   dry-run (logged, not sent)
  storage: local (.../server/data/uploads)
```

**Leave this window open.** Closing it stops the API.

> **"EADDRINUSE: address already in use"** — the API is already running in another
> window. Either use that one, or close it and try again.

> **`gyp ERR!` / "VisualStudioFinder" / "node-gyp rebuild failed"** — one of the
> packages tried to compile itself because no ready-made version existed for your
> Node.js. You do **not** need to install Visual Studio. Update to the latest code
> and install again from a clean slate:
>
> ```bash
> cd Desktop/QA
> git pull
> cd server
> Remove-Item -Recurse -Force node_modules   # PowerShell; on Mac use: rm -rf node_modules
> npm install
> ```
>
> A part-finished install is why you may then see **"Cannot find package 'bcryptjs'"**
> — the packages after the failure never downloaded. Removing `node_modules` and
> installing again fixes both.

### Step 5: Start the interface

Open a **second** terminal window (do not close the first).

- Windows PowerShell: press Ctrl+Shift+N
- Mac Terminal: press Cmd+N

Then:

```bash
cd Desktop/QA/web
npm install
npm run dev
```

You should see:

```
VITE ready in 400 ms
➜  Local:   http://localhost:5173/
```

### Step 6: Open the app

Go to <http://localhost:5173> in your browser.

You will see the landing page. Click **Sign in** and use:

| Username | Password | What they see |
|---|---|---|
| `omni` | `admin123` | Every unit — this is the OMNI admin |
| `lhr.manager` | `manager123` | Heathrow only |
| `lhr.inspector` | `inspector123` | Heathrow only, cannot sign off |

Sign in as each one to see how access differs. Then open **Inspections** to see the
303-point checklist with everything defaulted to satisfactory.

> These are demo accounts with weak passwords, for your laptop only. They must be
> deleted before this is used for real work.

### Stopping and restarting

To stop: click each terminal window and press **Ctrl+C**.

To start again later, you do **not** repeat the installs:

```bash
# Terminal 1
cd Desktop/QA/server
npm run dev

# Terminal 2
cd Desktop/QA/web
npm run dev
```

### Getting my later changes

```bash
cd Desktop/QA
git pull
```

If I mention that I added new packages, run `npm install` in `server` and `web` again.

---

## Part 2 — Send me the logo and images

I could not open your Google Drive links: the Drive connection has expired.

**Easiest option:** attach the three files directly to a message here — the logo and
the two landing-page images — the same way you sent the Word checklist.

**Alternative:** reconnect Drive at claude.ai → Settings → Connectors → Google Drive,
then send me the links again.

Either way I will place them correctly. If you want to do it yourself, put them in
`web/public/brand/` named `logo.svg`, `hero-1.jpg` and `hero-2.jpg`. The app picks
them up on its own; no code change needed.

---

## Part 3 — Brevo, for sending email

About 10 minutes. Free for 300 emails per day.

**Do this when you want real emails to send.** Until then the app writes them to the
terminal instead, which costs nothing and is fine for development.

1. Go to <https://www.brevo.com> and sign up with **yulfassembly@gmail.com**.
2. Click your company name (top right) → **Senders, Domains & Dedicated IPs**.
3. **Senders** tab → **Add a sender**. Enter `yulfassembly@gmail.com`.
4. **Open the confirmation email Brevo sends and click the link.**
   Skipping this makes every email fail silently, with no error to tell you why.
5. Click your company name → **SMTP & API** → **API Keys** tab → **Generate a new
   API key**. Name it `qa-platform`.
6. **Copy the key immediately.** Brevo shows it once and never again. It starts with
   `xkeysib-`.

Now create the settings file. A file whose name begins with a dot is awkward to make
on Windows — File Explorer resists it and Notepad quietly adds `.txt` — so create it
from the terminal instead. In the `server` folder run these two commands:

```powershell
New-Item -Path .env -ItemType File -Force
notepad .env
```

On Mac, use `touch .env && open -e .env` instead.

Notepad opens empty. Paste these four lines in, press Ctrl+S, and close it. Because
the file already exists, Notepad will not add `.txt` to the name:

```
BREVO_ENABLED=true
BREVO_API_KEY=xkeysib-paste-your-key-here
BREVO_SENDER_EMAIL=yulfassembly@gmail.com
BREVO_SENDER_NAME=Gate Gourmet H&S
```

> **These are lines inside a file, not commands.** Typing `.env` at the terminal makes
> PowerShell try to *run* it, which fails with "not recognized as the name of a
> cmdlet". Paste them into the Notepad window instead.

Stop the API (Ctrl+C) and run `npm run dev` again. It should now say `email: Brevo (live)`.

> **Never share this file or commit it.** It is already excluded from Git. Anyone who
> has the key can send email as you.

---

## Part 4 — Google Drive, for storing photos

About 20 minutes. Free up to 15 GB. This one is fiddly — take it slowly.

Sign in to everything below as **yulfassembly@gmail.com**.

1. Go to <https://console.cloud.google.com>
2. Top of the page → project dropdown → **New Project**. Name it `yul-qa-platform`
   → **Create**. Wait for it to finish, then make sure it is selected.
3. Left menu → **APIs & Services** → **Library**. Search `Google Drive API`, open it,
   click **Enable**.
4. Left menu → **APIs & Services** → **Credentials** → **Create Credentials** →
   **Service account**.
   - Name: `qa-storage` → **Create and Continue** → **Continue** → **Done**
   - A service account is a robot account the app signs in as. It is not you.
5. Click the service account you just made → **Keys** tab → **Add Key** →
   **Create new key** → choose **JSON** → **Create**. A file downloads.
6. Inside `server`, create a folder called `secrets`, and move that downloaded file
   into it. Rename it to `gdrive-service-account.json`.
7. Open that file in a text editor and find the line starting `"client_email"`. Copy
   the address — it ends in `.iam.gserviceaccount.com`.
8. Go to <https://drive.google.com>. Create a folder called `QA Platform Evidence`.
   Right-click it → **Share** → paste that address → set to **Editor** → **Send**.
9. Open the folder. Its web address looks like
   `https://drive.google.com/drive/folders/1AbC...`. Copy the part after `folders/`.
10. Add these lines to the same `server/.env` file from Part 3. Reopen it with
    `notepad .env` from the `server` folder, and add them below what is already there:

```
GDRIVE_ENABLED=true
GDRIVE_CREDENTIALS_FILE=./secrets/gdrive-service-account.json
GDRIVE_FOLDER_ID=paste-the-folder-id-here
```

Restart the API. It should say `storage: Google Drive`.

### Test this straight away — do not skip

Sign into the app and upload one photo against a checklist item, then check it
appears in your `QA Platform Evidence` folder in Drive.

**If you see an error mentioning `storageQuotaExceeded`, tell me.** Service accounts
have their own storage allowance separate from your 15 GB, and this is a known trap.
It is fixable, but I would much rather find out now than after we have built the
photo system on top of it.

> **Never share or commit the `secrets` folder.** That JSON file is a password to
> your Drive. It is already excluded from Git.

---

## What to do if you get stuck

Copy the **whole** error message — all of it, not a summary — and send it to me,
along with what you had just typed. Most of these errors name the exact problem,
and a screenshot of the terminal is perfect.

## Order I would do this in

1. **Part 1** — get it running and click around. Everything else can wait.
2. **Part 2** — send me the logo and images so the app looks like yours.
3. **Part 4** — Google Drive, specifically the test in that section. If there is a
   problem with the free tier, we both want to know now.
4. **Part 3** — Brevo. Nothing depends on it yet, so this is the least urgent.
