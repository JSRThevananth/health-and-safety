import { useEffect, useState } from 'react'
import { photoObjectUrl } from '../lib/photos.js'

/**
 * Photo evidence for one checklist point.
 *
 * Capture and upload happen immediately, not on submit: an inspector on a
 * walkround may close the app, lose signal or run out of battery between taking
 * a photo and finishing, and a photo that only exists in the page is a photo
 * that will be lost.
 */
export default function PhotoStrip({ photos, readOnly, busy, error, onAdd, onRemove }) {
  const pick = (event) => {
    const files = [...event.target.files]
    // Clear the input so choosing the same file twice still fires a change.
    event.target.value = ''
    for (const file of files) onAdd(file)
  }

  return (
    <div className="ci__evidence">
      <div className="ci__photos">
        {photos.map((photo) => (
          <Thumbnail key={photo.id} photo={photo} readOnly={readOnly} onRemove={() => onRemove(photo)} />
        ))}

        {!readOnly && (
          <>
            {/*
              Two inputs rather than one: capture="environment" opens the camera
              straight away on a phone, which is what an inspector standing in
              front of the problem wants, but it also hides the gallery - so the
              second input is there for a photo taken earlier, and on a desktop.
            */}
            <label className="ci__photo-add">
              <input type="file" accept="image/*" capture="environment" onChange={pick} hidden />
              <span aria-hidden="true">📷</span>
              Take photo
            </label>
            <label className="ci__photo-add ci__photo-add--secondary">
              <input type="file" accept="image/*,application/pdf" multiple onChange={pick} hidden />
              <span aria-hidden="true">📎</span>
              Upload
            </label>
          </>
        )}
      </div>

      {busy && <p className="ci__photo-status">Uploading…</p>}
      {error && (
        <p className="ci__photo-status ci__photo-status--error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

function Thumbnail({ photo, readOnly, onRemove }) {
  const [url, setUrl] = useState(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let revoked = false
    let objectUrl

    // The download route needs a bearer token, which an <img src> cannot send,
    // so the bytes are fetched and handed to the tag as an object URL.
    photoObjectUrl(photo.id)
      .then((next) => {
        if (revoked) return URL.revokeObjectURL(next)
        objectUrl = next
        setUrl(next)
      })
      .catch(() => setFailed(true))

    return () => {
      revoked = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [photo.id])

  return (
    <figure className="ci__photo">
      {url ? (
        <img src={url} alt={`Evidence: ${photo.filename}`} />
      ) : (
        <span className="ci__photo-placeholder">{failed ? 'Unavailable' : '…'}</span>
      )}
      {!readOnly && (
        <button type="button" className="ci__photo-remove" onClick={onRemove} title="Remove this photo">
          <span aria-hidden="true">×</span>
          <span className="sr-only">Remove {photo.filename}</span>
        </button>
      )}
    </figure>
  )
}
