/**
 * Photo evidence in Drive.
 *
 * The app creates and owns its own folder. The narrow drive.file scope only grants
 * access to files this script created, so it could not use a folder handed to it -
 * and widening to full Drive access would give the script the run of the account
 * to store photos.
 */

function _folder() {
  return DriveApp.getFolderById(requireConfig(['driveFolderId']).driveFolderId);
}

const ALLOWED_MIME = [
  'image/jpeg', 'image/png', 'image/webp', 'image/heic',
  'application/pdf', 'text/csv',
];
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

/**
 * Store an uploaded file and record it.
 *
 * `dataUrl` is what the browser produces from a camera capture:
 * "data:image/jpeg;base64,....".
 */
function storeAttachment(principal, entityType, entityId, filename, dataUrl) {
  const match = /^data:([^;]+);base64,(.*)$/.exec(String(dataUrl || ''));
  if (!match) throw new Error('Unrecognised file data');

  const mimeType = match[1];
  if (ALLOWED_MIME.indexOf(mimeType) === -1) {
    throw new Error('Unsupported file type: ' + mimeType);
  }

  const bytes = Utilities.base64Decode(match[2]);
  if (bytes.length > MAX_UPLOAD_BYTES) {
    throw new Error('File is too large. The limit is 15 MB.');
  }

  const safeName = String(filename || 'evidence').replace(/[^\w.\- ]/g, '_').slice(0, 120);
  const blob = Utilities.newBlob(bytes, mimeType, safeName);
  const file = _folder().createFile(blob);

  return dbTransaction(function () {
    return dbInsert('Attachments', {
      entity_type: entityType,
      entity_id: entityId,
      filename: safeName,
      mime_type: mimeType,
      size_bytes: bytes.length,
      drive_file_id: file.getId(),
      web_view_link: file.getUrl(),
      uploaded_by: principal.id,
      created_at: new Date().toISOString(),
      purged_at: '',
      purge_policy: '',
    });
  });
}

function listAttachments(entityType, entityId) {
  return dbFind('Attachments', function (a) {
    return a.entity_type === entityType && Number(a.entity_id) === Number(entityId);
  });
}

function deleteAttachment(attachmentId) {
  const attachment = dbGet('Attachments', attachmentId);
  if (!attachment) throw new Error('Attachment not found');

  if (attachment.drive_file_id && !attachment.purged_at) {
    try {
      DriveApp.getFileById(attachment.drive_file_id).setTrashed(true);
    } catch (e) {
      // Already gone from Drive; still remove our record of it.
    }
  }
  dbTransaction(function () { dbDelete('Attachments', attachmentId); });
  return true;
}

/**
 * Retention purge.
 *
 * Photos are roughly four thousand times the size of the record they belong to, so
 * they are what fills the 15 GB. The rows are kept as tombstones: an auditor
 * accepts "purged on this date under this policy", but not a silent gap.
 */
function purgePhotos(dryRun) {
  const days = getConfig().photoRetentionDays;
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();

  const due = dbFind('Attachments', function (a) {
    return !a.purged_at && a.created_at && a.created_at < cutoff;
  });

  if (dryRun) {
    return { would_purge: due.length, cutoff: cutoff, dry_run: true };
  }

  let purged = 0;
  due.forEach(function (attachment) {
    try {
      if (attachment.drive_file_id) DriveApp.getFileById(attachment.drive_file_id).setTrashed(true);
    } catch (e) {
      // Missing in Drive is fine; the tombstone still needs writing.
    }
    dbTransaction(function () {
      dbUpdate('Attachments', attachment.id, {
        purged_at: new Date().toISOString(),
        purge_policy: 'photo-retention-' + days + 'd',
        drive_file_id: '',
        web_view_link: '',
      });
    });
    purged += 1;
  });

  return { purged: purged, cutoff: cutoff, dry_run: false };
}
