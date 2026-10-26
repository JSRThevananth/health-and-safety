/**
 * Shrink a photo before it leaves the phone.
 *
 * A modern phone camera produces a 4-8 MB, 4000px JPEG. Nothing downstream wants
 * that: it is slow to upload on a unit's wifi, it fills the Drive quota, and ten
 * of them will not fit in an emailed report at all. Nobody reading a report of a
 * wedged fire door needs 12 megapixels.
 *
 * 1600px on the long edge at quality 0.82 lands around 200-400 KB and is still
 * clear enough to read a label or see a crack. The work happens on the device,
 * so the server never handles the full-size original.
 */

const MAX_EDGE = 1600
const QUALITY = 0.82

export async function shrinkImage(file, { maxEdge = MAX_EDGE, quality = QUALITY } = {}) {
  // A PDF or spreadsheet attached as evidence is not an image and must pass
  // through untouched.
  if (!file.type.startsWith('image/')) return file

  let bitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    // HEIC from an iPhone, or anything else this browser cannot decode. Send the
    // original rather than refuse the evidence.
    return file
  }

  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
  // Already small enough: re-encoding would only lose quality.
  if (scale === 1 && file.size < 800 * 1024) {
    bitmap.close?.()
    return file
  }

  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  context.drawImage(bitmap, 0, 0, width, height)
  bitmap.close?.()

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
  if (!blob) return file

  // Re-encoding can make a small, already-optimised image bigger.
  if (blob.size >= file.size) return file

  return new File([blob], renameToJpeg(file.name), { type: 'image/jpeg', lastModified: Date.now() })
}

const renameToJpeg = (name) => `${(name || 'photo').replace(/\.[^.]+$/, '')}.jpg`

/**
 * The filename the report compiler reads to put a photo under its finding.
 *
 * Carried in the name rather than a column because an attachment belongs to the
 * inspection, and which item it illustrates is presentation - it should not
 * stop the photo being stored if the item is later removed from the form.
 */
export const photoName = (templateItemId, original) =>
  `item-${templateItemId}-${(original || 'photo').replace(/[^\w.-]/g, '_').slice(-60)}`
