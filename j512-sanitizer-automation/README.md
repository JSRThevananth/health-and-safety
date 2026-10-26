# J-512 Sanitizer Concentration Check — Automation

Automates the gategroup **OPRP-8 J-512 Sanitizer Concentration** checklist:

1. An employee refills a J-512 sanitizer bottle.
2. They scan **one common QR code** posted at the refill station.
3. The QR code opens a Google Form where they pick the **Caddy # / location**,
   the **Shift**, enter the **Concentration (ppm)** and their **Employee Name**.
4. The submission time is logged **automatically** in **24-hour** format using
   the **America/Toronto** time zone (covers Montreal / Quebec, with automatic
   EST/EDT handling).
5. Every day at **23:59** local time, a PDF report for the whole day — laid out
   exactly like the gategroup checklist — is emailed to **qasys0020@gmail.com**
   and archived in Google Drive.

Everything runs inside the **qasys0020@gmail.com** Google account using Google
Apps Script. No servers, no third-party hosting.

---

## Why this is delivered as code (not pre-deployed)

Deploying this requires the Google Forms API, the Apps Script API, and
permission to install time-based triggers and send mail as the account — none
of which are available to the assistant through its current tooling. Instead,
this folder contains the **complete Apps Script project**. You paste it into
the account **once** and run `setup()`; from then on it is fully automatic.

---

## Files

| File         | Purpose                                                              |
|--------------|----------------------------------------------------------------------|
| `Config.gs`  | Constants: time zone, recipients, ppm range, caddy list, shifts.     |
| `Setup.gs`   | One-time `setup()` — creates the Form, Sheet, triggers, and QR code. |
| `Code.gs`    | `onFormSubmit` — timestamps each scan and writes the Daily Log row.  |
| `Report.gs`  | `sendDailyReport` — builds the PDF and emails it at 23:59.           |

---

## Deployment (one time, ~5 minutes)

1. Sign in to Google as **qasys0020@gmail.com**.
2. Go to <https://script.google.com> → **New project**.
3. For each `.gs` file in this folder: add a matching script file in the
   project (➕ next to *Files*) and paste in the contents. Delete the default
   empty `Code.gs` only after you've pasted the real one. File names don't have
   to match exactly, but keeping them identical makes maintenance easier.
4. Select the **`setup`** function in the toolbar dropdown and click **Run**.
5. Approve the authorization prompts (Forms, Sheets, Drive, Gmail, Triggers).
6. Open **View → Logs**. It prints:
   - the **Form URL** (what the QR code points to),
   - the **QR code image** location in Drive,
   - the response **spreadsheet** URL,
   - the **Drive folder** URL.
7. Open the Drive folder, download **`J-512 Sanitizer QR Code.png`**, print it,
   and post it at the refill station. That single QR code is shared by everyone.

`setup()` is **idempotent** — safe to re-run. It remembers the Form, Sheet, and
folder it created (via Script Properties) and will not create duplicates.

---

## How it works day to day

- **Each scan** → the Form submission triggers `onFormSubmit`, which records a
  row in the **`Daily Log`** tab: `Date`, `Time (24h)`, `Caddy`, `Shift`,
  `Concentration`, `Employee`, `Status`, `Timestamp (ISO)`.
- **`Status`** is `OK` when the reading is within **200–400 ppm**, otherwise
  `DEVIATION` (shown in red on the PDF, with the J6 corrective-action note).
- **At 23:59** → `sendDailyReport` gathers that day's rows, renders the PDF in
  the gategroup checklist layout (19 caddy locations × 3 shifts, verification
  footer, document number), emails it, and saves a copy to the Drive folder.

> Apps Script clock triggers fire within a short window of the requested
> minute, so the report goes out at approximately 23:59. Entries submitted in
> that final minute are extremely unlikely; if needed you can re-issue any
> day's report manually (see below).

---

## Manual / testing functions

Run these from the Apps Script editor:

- **`sendDailyReport()`** — builds and sends the report for *today* immediately.
- **`sendReportForDate('2026-05-14')`** — (re)builds and sends the report for a
  specific date (`yyyy-MM-dd`).

To generate a few test rows, just open the Form URL and submit it a few times.

---

## Configuration

All tunable values live in `Config.gs`:

- `TIME_ZONE` — IANA zone for timestamps and the 23:59 send time.
- `REPORT_RECIPIENTS` — array of email addresses that receive the PDF.
- `PPM_MIN` / `PPM_MAX` — approved concentration window (200–400 ppm).
- `CADDY_LOCATIONS` — the 19 caddy locations, in printed order.
- `SHIFTS` — the three shift options shown in the Form.

After changing `CADDY_LOCATIONS` or `SHIFTS`, re-run `setup()` so the Form
choices are rebuilt to match.
