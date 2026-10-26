# Photos and reports

How a photo gets from an inspector's phone into a report in a manager's inbox.

```
  phone camera
      │  shrunk in the browser: 4000px / 5 MB  ->  1600px / ~300 KB
      ▼
  POST /api/attachments
      │
      ▼
  Google Drive          (your own 15 GB, no card anywhere)
      │
      │  ...later, when the report is compiled:
      ▼
  fetched back out of Drive
      ├── attached to the email          (so the report survives the photo purge)
      └── shown in the body by a signed, expiring link
      │
      ▼
  Brevo  ->  the unit's recipients
```

## Why the photo is shrunk on the phone

A modern phone camera makes a 4000px, 5 MB JPEG. Ten of those is 50 MB, which
is more than Brevo will send in one email, slower than a catering unit's wifi
wants to be, and about forty times more detail than anyone needs to see that a
fire door is wedged open.

The browser scales it to 1600px on the long edge at quality 0.82 before it is
uploaded — usually 200–400 KB. Everything downstream then fits: Drive quota,
upload time, and the 20 MB cap on an email with attachments.

A file the browser cannot decode (an iPhone HEIC on an old Android, say) is
uploaded untouched rather than refused. A PDF goes through as a PDF.

## Why both an attachment and a link

Brevo does not support inline (`cid:`) images in transactional email. The
supported way to show a picture in the body is an ordinary `https` image, so the
report body points at a link the Worker serves back out of Drive.

But links expire and photos get purged. So the compiler attaches the evidence as
well — as a single PDF of the whole report, photographs and signatures inside
it. Open the email in two years and the body's images may be dead while the PDF
still shows everything.

**The PDF replaces the loose photo attachments** rather than joining them. It
carries the same images, so sending both would double a message that has a
20 MB ceiling, and a recipient who has to file the report would rather have one
document than an email plus eight JPEGs. If the PDF fails to render for any
reason, the photos are attached individually as before: a report that arrives in
a less convenient shape beats one that does not arrive.

The link carries a signed token that names one attachment and expires after
30 days (`REPORT_PHOTO_LINK_DAYS`). Anyone holding the link can see that one
photo until then — the same exposure as the attachment, but worth knowing.

## Why Drive and not R2

Cloudflare R2 is faster and simpler, and the code supports it — but Cloudflare
asks for a payment method on file before enabling R2, even at zero usage. Drive
needs no card anywhere, which is the constraint this project runs under.

Set `STORAGE_BACKEND` to `r2` and uncomment the `r2_buckets` line in
`wrangler.jsonc` to switch; nothing else changes.

## Why a service account does not work

The obvious way to let a server write to Drive is a service account. It does not
work here, and the failure is not obvious until you try it:

> Service Accounts do not have storage quota.

A service account owns no storage. Sharing a My Drive folder with it lets it
*read*, but every upload fails. The documented fix is a Workspace **shared
drive**, and shared drives need a paid Google Workspace plan.

So the Worker authenticates as **you**, with an OAuth refresh token — the same
mechanism `clasp` and `rclone` use. Files are owned by your account and count
against your own 15 GB. `docs/cloudflare-setup.md` walks through getting the
token.

The service-account path is still in the code for anyone who *does* have a
Workspace shared drive: set `GDRIVE_CREDENTIALS_JSON` instead.

## Signatures are not in Drive

They are in the database, and deliberately:

- A signature is the record, not evidence attached to it. Photos are purged
  after a fortnight; a signature must still be there when somebody asks who
  signed off on this.
- It is tiny — a few kB of PNG against a few hundred for a photo.
- Compiling a report must never depend on Drive being reachable to prove who
  signed it. If Drive is down the report says a photo is missing; it must never
  say the signature is missing.

The inspector signs **before** submitting, and submitting is what freezes the
record. That order matters: a signature on something still editable is
worthless, and one captured after the freeze is impossible. The department
supervisor's countersignature is optional and captured on the same device, at
the end of the walkround, because that is the only moment both people are
standing in the same place — an inspector on a night shift with nobody to
countersign is not blocked by it.

## Per-unit recipients

Recipients hang off the unit, not the organisation, so one unit's report cannot
reach another's. The server enforces it even if a client asks: naming another
unit's recipient by id finds nothing rather than sending.

Recipients are plain email addresses, not user accounts — most of the people who
should receive a report will never sign in.

Each is marked `default_selected` or not. The defaults are pre-ticked in the
send dialog, so the ordinary case is one tap; anyone can be deselected for a
single report without being removed from the unit, and a one-off address (a
visiting auditor) can be typed in without being saved.

## Retention

Nightly at 03:10 UTC:

- **Photos** past the unit's window (14 days by default) are deleted from Drive.
  The attachment row stays as a tombstone, so an auditor opening an old
  inspection sees *"purged on 2026-02-01 under photo retention: 14 days"* rather
  than a broken image.
- **Ratings, notes, findings and signatures** are never purged. They are small,
  and they are the whole reason for having a database rather than a pile of
  emails.

## What the sender sees

After sending, the dialog names any photo that did not make it and why — "too
large to attach", "could not be retrieved from Drive", "purged on …". Not a
count: *which* photo. A quality manager forwarding a report to a client needs to
notice that before they send it, not after.

## The PDF

`GET /api/inspections/:id/report.pdf` returns the same document, for filing or
printing. In the app it is the **Download PDF** button in the send dialog. What
is filed and what was sent cannot differ, because they are the same render.

It is written by `worker/src/services/pdf.js`, which is about 400 lines and has
no dependencies. The alternatives did not fit the constraints:

| | |
| --- | --- |
| Headless browser | not available in a Worker |
| An HTML-to-PDF library | 300 KB+ and far past the 10 ms CPU budget |
| A conversion service | costs money; the project runs at zero |

What a report needs is text in two weights, a rule, a field list and some
photographs. The photographs are the expensive part, and they are **copied in
rather than re-encoded**: PDF reads JPEG natively through `DCTDecode`, and the
browser already converted every upload to JPEG, so embedding a 300 KB photograph
costs no decoding at all.

Signatures are the exception. A canvas writes PNG with an alpha channel, and PDF
cannot read PNG's per-row filters or that alpha, so a signature is inflated,
unfiltered, flattened onto white and deflated again — using the platform's own
`DecompressionStream`, so the compression is not ours to pay for. Anything
awkward (interlaced, 16-bit, palette, or over 400,000 pixels) is skipped, and the
signature block still carries who signed and when: the attestation is the
record, the drawing illustrates it.

Only the base-14 fonts are used, so nothing is embedded and the file opens
anywhere. Text is folded to ASCII — `café` prints as `cafe` — which is the one
visible compromise, and the alternative is embedding a font subset that would
cost more CPU than the rest of the document put together.
