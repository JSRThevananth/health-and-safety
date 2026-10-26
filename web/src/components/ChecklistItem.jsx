import { RATINGS, DEFAULT_RATING, ratingOf, isException } from '../lib/ratings.js'
import PhotoStrip from './PhotoStrip.jsx'

/**
 * One checklist point.
 *
 * Collapsed by default so 300 items stay scannable; tapping opens the rating
 * control plus note and photo capture. An item at its default rating is visually
 * quiet - only exceptions draw the eye.
 */
export default function ChecklistItem({
  item,
  entry,
  open,
  onToggle,
  onChange,
  readOnly = false,
  photos = [],
  photoBusy = false,
  photoError = '',
  onAddPhoto,
  onRemovePhoto,
}) {
  const rating = entry?.rating ?? DEFAULT_RATING
  const meta = ratingOf(rating)
  const flagged = isException(rating)


  return (
    <li className={`ci${flagged ? ' ci--flagged' : ''}${open ? ' ci--open' : ''}`}>
      <button
        type="button"
        className="ci__row"
        onClick={onToggle}
        aria-expanded={open}
      >
        <span className="ci__status" style={{ color: meta.color }} aria-hidden="true">
          {meta.icon}
        </span>
        <span className="ci__text">{item.text}</span>
        <span className="ci__badge" data-rating={rating}>
          {meta.short}
          {/* Only expand when the short form differs, so a screen reader does not
              hear "Critical - Critical". */}
          {meta.short !== meta.label && <span className="sr-only"> — {meta.label}</span>}
        </span>
      </button>

      {open && (
        <div className="ci__panel">
          <div className="ci__ratings" role="radiogroup" aria-label={`Rating for: ${item.text}`}>
            {RATINGS.map((option) => (
              <button
                key={option.key}
                type="button"
                role="radio"
                aria-checked={rating === option.key}
                className={`ci__rating${rating === option.key ? ' is-active' : ''}`}
                data-rating={option.key}
                disabled={readOnly}
                onClick={() => onChange({ rating: option.key })}
              >
                <span aria-hidden="true">{option.icon}</span>
                {option.label}
              </button>
            ))}
          </div>

          <label className="ci__note">
            <span className="sr-only">Note</span>
            <textarea
              rows={2}
              readOnly={readOnly}
              placeholder={
                readOnly ? '' : flagged ? 'Describe the finding (required to submit)' : 'Optional note'
              }
              value={entry?.note ?? ''}
              onChange={(e) => onChange({ note: e.target.value })}
            />
          </label>

          <PhotoStrip
            photos={photos}
            readOnly={readOnly}
            busy={photoBusy}
            error={photoError}
            onAdd={onAddPhoto}
            onRemove={onRemovePhoto}
          />

          {flagged && (
            <p className="ci__hint">
              This finding will be raised as a corrective action on submission.
            </p>
          )}
        </div>
      )}
    </li>
  )
}
