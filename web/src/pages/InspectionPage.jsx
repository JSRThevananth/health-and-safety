import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import { useUnit } from '../lib/unitContext.jsx'
import { useAutosave } from '../lib/useAutosave.js'
import ChecklistItem from '../components/ChecklistItem.jsx'
import SendReport from '../components/SendReport.jsx'
import SignOffDialog from '../components/SignOffDialog.jsx'
import RaiseActions from '../components/RaiseActions.jsx'
import { RATINGS, DEFAULT_RATING, isException } from '../lib/ratings.js'
import { listPhotos, uploadPhoto, deletePhoto, groupPhotosByItem } from '../lib/photos.js'

/**
 * Inspection capture.
 *
 * Exception-based: every item starts satisfactory and the inspector touches only
 * what deviates. Work is autosaved as a draft, so leaving and coming back resumes
 * exactly where they stopped, and "Start over" discards the partial deliberately.
 */
export default function InspectionPage() {
  const { user } = useAuth()
  const { units, unitId: contextUnitId, select } = useUnit()

  const [unitId, setUnitId] = useState(contextUnitId ?? null)
  const [inspection, setInspection] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [openItem, setOpenItem] = useState(null)
  const [activeSection, setActiveSection] = useState(null)
  const [busy, setBusy] = useState(false)
  const [photos, setPhotos] = useState([])
  const [photoBusyItem, setPhotoBusyItem] = useState(null)
  const [photoErrors, setPhotoErrors] = useState({})
  const [sending, setSending] = useState(false)
  const [raising, setRaising] = useState(false)
  const [signingOff, setSigningOff] = useState(false)
  const sectionRefs = useRef({})

  useEffect(() => {
    if (contextUnitId) setUnitId(contextUnitId)
    else if (!unitId && units.length > 0) setUnitId(units[0].id)
  }, [contextUnitId, units, unitId])

  const inspectionId = inspection?.id

  const persist = useCallback(
    async (items) => {
      if (!inspectionId) return
      const updated = await api(`/inspections/${inspectionId}`, {
        method: 'PATCH',
        body: { items },
      })
      setInspection(updated)
    },
    [inspectionId]
  )

  const { queue, flush, status: saveStatus } = useAutosave(persist)

  /** Load the open draft for this unit, or start one. */
  const load = useCallback(async (id) => {
    setLoading(true)
    setError('')
    try {
      let draft
      try {
        draft = await api(`/inspections/draft?unit_id=${id}`)
      } catch (err) {
        if (err.status !== 404) throw err
        draft = await api('/inspections/draft', { method: 'POST', body: { unit_id: id } })
      }
      setInspection(draft)
      setOpenItem(null)
      setActiveSection(draft.sections[0]?.code ?? null)
      // Photos already attached to this draft: an inspector resuming after a
      // break must see the evidence they have taken, not an empty strip.
      try {
        setPhotos(await listPhotos(draft.id))
      } catch {
        // Storage not configured yet, or offline. The checklist still works;
        // the capture control reports the failure when they try to use it.
        setPhotos([])
      }
    } catch (err) {
      setInspection(null)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (unitId) load(unitId)
  }, [unitId, load])

  const sections = inspection?.sections ?? []
  const allItems = useMemo(() => sections.flatMap((s) => s.items), [sections])
  const counts = inspection?.summary_counts

  /** Optimistic local update, then queue the save. */
  const change = (item, patch) => {
    const next = { rating: item.rating, note: item.note, ...patch }
    setInspection((prev) => ({
      ...prev,
      sections: prev.sections.map((section) => ({
        ...section,
        items: section.items.map((i) =>
          i.id === item.id ? { ...i, ...next, touched: next.rating !== DEFAULT_RATING || Boolean(next.note) } : i
        ),
      })),
    }))
    queue({ template_item_id: item.id, rating: next.rating, note: next.note ?? '' })
  }

  const photosByItem = useMemo(() => groupPhotosByItem(photos), [photos])

  const addPhoto = async (item, file) => {
    if (!inspection) return
    setPhotoBusyItem(item.id)
    setPhotoErrors((prev) => ({ ...prev, [item.id]: '' }))
    try {
      const stored = await uploadPhoto(inspection.id, item.id, file)
      setPhotos((prev) => [stored, ...prev])
    } catch (err) {
      setPhotoErrors((prev) => ({
        ...prev,
        [item.id]: err.payload?.error || err.message || 'The photo could not be uploaded.',
      }))
    } finally {
      setPhotoBusyItem(null)
    }
  }

  const removePhoto = async (item, photo) => {
    if (!window.confirm('Remove this photo? It cannot be recovered.')) return
    try {
      await deletePhoto(photo.id)
      setPhotos((prev) => prev.filter((p) => p.id !== photo.id))
    } catch (err) {
      setPhotoErrors((prev) => ({ ...prev, [item.id]: err.payload?.error || err.message }))
    }
  }

  const startOver = async () => {
    if (!inspection) return
    const flagged = counts?.exceptions ?? 0
    const warning = flagged > 0
      ? `Discard this inspection? ${flagged} finding${flagged === 1 ? '' : 's'} will be lost and cannot be recovered.`
      : 'Discard this inspection and start a clean sheet?'
    if (!window.confirm(warning)) return

    setBusy(true)
    try {
      await api(`/inspections/${inspection.id}`, { method: 'DELETE' })
      await load(unitId)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  /**
   * Submission goes through the signing dialog: the inspector signs, then it is
   * submitted, in that order and in one step. Pending edits are flushed first so
   * what they sign is what the server holds.
   */
  const submit = async () => {
    if (!inspection) return
    setError('')
    setBusy(true)
    try {
      await flush()
      setSigningOff(true)
    } catch (err) {
      setError(err.payload?.error || err.message)
    } finally {
      setBusy(false)
    }
  }

  const jumpTo = (code) => {
    setActiveSection(code)
    sectionRefs.current[code]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  if (loading) return <div className="dash"><p className="muted">Loading checklist…</p></div>

  if (error && !inspection) {
    return (
      <div className="dash">
        <header className="dash__head"><div><h1>Inspection</h1></div></header>
        <div className="empty glass"><span className="empty__badge">Not available</span><p>{error}</p></div>
      </div>
    )
  }

  const locked = inspection && !inspection.editable

  return (
    <div className="dash inspection">
      <header className="dash__head">
        <div>
          <h1>{locked ? 'Inspection submitted' : 'Inspection in progress'}</h1>
          <p className="muted">
            {inspection?.unit_name} · checklist v{inspection?.template_version} ·{' '}
            {counts?.total} points · {user.full_name}
          </p>
        </div>
        {units.length > 1 && (
          <label className="field-inline">
            <span>Unit</span>
            <select
              value={unitId ?? ''}
              onChange={(e) => { const v = Number(e.target.value); setUnitId(v); select(v) }}
            >
              {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </label>
        )}
      </header>

      {locked ? (
        <div className="notice notice--done glass">
          <strong>Handed in for sign-off.</strong>
          <span>
            {counts.exceptions} finding{counts.exceptions === 1 ? '' : 's'} raised.
            You can no longer change this inspection.
          </span>
          <button type="button" className="btn btn--primary btn--sm" onClick={() => setSending(true)}>
            Send report
          </button>
          {counts.exceptions > 0 && user.permissions.includes('capa.create') && (
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setRaising(true)}>
              Raise corrective actions
            </button>
          )}
        </div>
      ) : (
        <div className="notice glass">
          <strong>Everything starts as satisfactory.</strong>
          <span>Tap only what needs a different rating, a note or a photo. Your work saves itself.</span>
        </div>
      )}

      {error && <p className="error">{error}</p>}

      <nav className="section-chips" aria-label="Jump to section">
        {sections.map((section) => {
          const flagged = section.items.filter((i) => isException(i.rating)).length
          return (
            <button
              key={section.code}
              type="button"
              className={activeSection === section.code ? 'is-active' : ''}
              onClick={() => jumpTo(section.code)}
            >
              {section.code}
              {flagged > 0 && <span className="section-chips__count">{flagged}</span>}
            </button>
          )
        })}
      </nav>

      <div className="checklist">
        {sections.map((section) => (
          <section
            key={section.code}
            className="checklist__section glass"
            ref={(el) => { sectionRefs.current[section.code] = el }}
          >
            <header className="checklist__section-head">
              <h2>{section.title}</h2>
              <span className="muted small">{section.items.length} points</span>
            </header>

            {groupItems(section.items).map(({ title, items }) => (
              <div className="checklist__group" key={title || 'ungrouped'}>
                {title && <h3 className="checklist__group-title">{title}</h3>}
                <ul className="checklist__items">
                  {items.map((item) => (
                    <ChecklistItem
                      key={item.id}
                      item={item}
                      entry={item}
                      readOnly={locked}
                      open={openItem === item.id}
                      onToggle={() => setOpenItem(openItem === item.id ? null : item.id)}
                      onChange={(patch) => change(item, patch)}
                      photos={photosByItem.get(item.id) ?? []}
                      photoBusy={photoBusyItem === item.id}
                      photoError={photoErrors[item.id] ?? ''}
                      onAddPhoto={(file) => addPhoto(item, file)}
                      onRemovePhoto={(photo) => removePhoto(item, photo)}
                    />
                  ))}
                </ul>
              </div>
            ))}
          </section>
        ))}
      </div>

      <aside className="signoff glass glass--strong">
        <div className="signoff__counts">
          {RATINGS.map((rating) => (
            <span key={rating.key} className={`signoff__count signoff__count--${rating.key}`}>
              <span aria-hidden="true">{rating.icon}</span>
              <b>{counts?.[rating.key] ?? 0}</b>
              <small>{rating.label}</small>
            </span>
          ))}
        </div>

        <div className="signoff__meta">
          {!locked && <SaveIndicator status={saveStatus} />}
          {counts?.untouched > 0 && !locked && (
            <span className="signoff__untouched">
              {counts.untouched} of {counts.total} at default
            </span>
          )}
          {!locked && (
            <>
              <button type="button" className="btn btn--ghost btn--sm" onClick={startOver} disabled={busy}>
                Start over
              </button>
              <button type="button" className="btn btn--primary" onClick={submit} disabled={busy}>
                {busy ? 'Saving…' : `Sign & submit (${counts?.exceptions ?? 0})`}
              </button>
            </>
          )}
        </div>
      </aside>

      {signingOff && inspection && (
        <SignOffDialog
          inspection={inspection}
          onClose={() => setSigningOff(false)}
          onDone={(done) => {
            setInspection(done)
            setSigningOff(false)
            // Straight on to the report: finishing the walkround and sending the
            // report are one task in the inspector's head, not two.
            setSending(true)
          }}
        />
      )}

      {sending && inspection && (
        <SendReport inspection={inspection} onClose={() => setSending(false)} />
      )}

      {raising && inspection && (
        <RaiseActions
          inspection={inspection}
          onClose={() => setRaising(false)}
          onRaised={() => setRaising(false)}
        />
      )}
    </div>
  )
}

function SaveIndicator({ status }) {
  const label = {
    idle: '',
    pending: 'Saving…',
    saving: 'Saving…',
    saved: 'All changes saved',
    error: 'Not saved — retrying',
  }[status]
  if (!label) return null
  return <span className={`savestate savestate--${status}`}>{label}</span>
}

/** Preserve the source document's subsection grouping within a section. */
function groupItems(items) {
  const groups = []
  for (const item of items) {
    const title = item.group_title || ''
    const last = groups.at(-1)
    if (last && last.title === title) last.items.push(item)
    else groups.push({ title, items: [item] })
  }
  return groups
}
