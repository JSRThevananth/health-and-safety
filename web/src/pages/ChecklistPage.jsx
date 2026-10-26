import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'

/**
 * The unit's checklist.
 *
 * Editing happens on a draft and takes effect when it is published, which is
 * the whole reason the versioning exists: an inspection pins the version it
 * was filled against, so a form edited today cannot change what a signed
 * inspection from last month says.
 *
 * The live version is shown read-only until somebody starts a draft. That
 * ordering is deliberate — opening this page should not quietly create a
 * revision of a unit's form.
 */
export default function ChecklistPage() {
  const { user } = useAuth()
  const [units, setUnits] = useState([])
  const [unitId, setUnitId] = useState(null)
  const [template, setTemplate] = useState(null)
  const [draft, setDraft] = useState(null)
  const [versions, setVersions] = useState([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [adding, setAdding] = useState(false)

  const canEdit = user.permissions.includes('template.edit')
  const editing = Boolean(draft)
  const showing = draft || template

  useEffect(() => {
    api('/units')
      .then((rows) => {
        setUnits(rows)
        setUnitId(rows[0]?.id ?? null)
      })
      .catch((err) => setError(err.message))
  }, [])

  const load = async (id) => {
    if (!id) return
    setError('')
    setDraft(null)
    try {
      setTemplate(await api(`/units/${id}/template`))
    } catch (err) {
      // A unit with no published checklist is a normal state, not a failure.
      setTemplate(null)
      if (err.status !== 404) setError(err.message)
    }
    try {
      setVersions(await api(`/units/${id}/template/versions`))
    } catch {
      setVersions([])
    }
    if (canEdit) {
      // An existing draft is picked up rather than started again, so a half
      // finished revision is never silently abandoned.
      try {
        const existing = await api(`/units/${id}/template/draft`)
        if (existing?.status === 'draft') setDraft(existing)
      } catch {
        /* no draft yet */
      }
    }
  }

  useEffect(() => {
    load(unitId)
  }, [unitId])

  const counts = useMemo(() => {
    const sections = showing?.sections || []
    const items = sections.flatMap((s) => (s.enabled ? s.items : []))
    return {
      sections: sections.filter((s) => s.enabled).length,
      items: items.filter((i) => i.enabled).length,
      off: sections.flatMap((s) => s.items).length - items.filter((i) => i.enabled).length,
    }
  }, [showing])

  const act = async (what, fn) => {
    setBusy(what)
    setError('')
    try {
      await fn()
    } catch (err) {
      setError(err.payload?.error || err.message)
    } finally {
      setBusy('')
    }
  }

  const startDraft = () =>
    act('start', async () => setDraft(await api(`/units/${unitId}/template/draft`, { method: 'POST' })))

  const patch = (body) =>
    act('save', async () => setDraft(await api(`/units/${unitId}/template/draft`, { method: 'PATCH', body })))

  const publish = () =>
    act('publish', async () => {
      const published = await api(`/units/${unitId}/template/draft/publish`, { method: 'POST' })
      setTemplate(published)
      setDraft(null)
      setVersions(await api(`/units/${unitId}/template/versions`))
    })

  const discard = () =>
    act('discard', async () => {
      if (!window.confirm('Throw away this draft? The published checklist is untouched.')) return
      await api(`/units/${unitId}/template/draft`, { method: 'DELETE' })
      await load(unitId)
    })

  return (
    <div className="dash">
      <header className="dash__head">
        <div>
          <h1>Checklist</h1>
          <p className="muted">
            {showing
              ? `${counts.sections} sections · ${counts.items} points${counts.off ? ` · ${counts.off} switched off` : ''}`
              : 'The points an inspection asks about, per unit.'}
          </p>
        </div>
        {units.length > 1 && (
          <label className="field-inline">
            <span>Unit</span>
            <select value={unitId ?? ''} onChange={(e) => setUnitId(Number(e.target.value))}>
              {units.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </header>

      {error && <p className="error">{error}</p>}

      <div className={`notice glass${editing ? ' notice--warn' : ''}`}>
        {editing ? (
          <>
            <strong>Draft, not live yet.</strong>
            <span>
              Inspections keep using v{template?.version ?? '—'} until you publish. Published
              versions are never edited, so a signed inspection still reads as it was filled in.
            </span>
            <button type="button" className="btn btn--primary btn--sm" onClick={publish} disabled={Boolean(busy)}>
              {busy === 'publish' ? 'Publishing…' : `Publish v${(template?.version ?? 0) + 1}`}
            </button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={discard} disabled={Boolean(busy)}>
              Discard
            </button>
          </>
        ) : (
          <>
            <strong>{template ? `Live: v${template.version}` : 'No checklist published yet'}</strong>
            <span>
              {versions.length > 0 && `${versions.length} version${versions.length === 1 ? '' : 's'} on record. `}
              {canEdit ? 'Start a draft to change it.' : 'You can read this but not change it.'}
            </span>
            {canEdit && (
              <button type="button" className="btn btn--primary btn--sm" onClick={startDraft} disabled={Boolean(busy)}>
                {busy === 'start' ? 'Opening…' : 'Start a draft'}
              </button>
            )}
          </>
        )}
      </div>

      {!showing ? (
        <p className="muted">Loading…</p>
      ) : (
        <div className="checklist">
          {showing.sections.map((section) => (
            <Section
              key={section.section_id}
              section={section}
              editing={editing}
              busy={Boolean(busy)}
              onToggleSection={(enabled) => patch({ sections: [{ section_id: section.section_id, enabled }] })}
              onToggleItem={(item, enabled) => patch({ items: [{ id: item.id, enabled }] })}
              onReword={(item, text) =>
                patch({ items: [{ id: item.id, text_override: text === '' ? null : text }] })
              }
              onAdd={() => setAdding(section)}
            />
          ))}
        </div>
      )}

      {adding && (
        <AddItem
          unitId={unitId}
          section={adding}
          onClose={() => setAdding(false)}
          onAdded={(updated) => {
            setDraft(updated)
            setAdding(false)
          }}
        />
      )}
    </div>
  )
}

function Section({ section, editing, busy, onToggleSection, onToggleItem, onReword, onAdd }) {
  const [open, setOpen] = useState(false)
  const live = section.items.filter((i) => i.enabled).length

  return (
    <section className={`clsection glass${section.enabled ? '' : ' is-off'}`}>
      <header className="clsection__head">
        <button type="button" className="clsection__toggle" onClick={() => setOpen((v) => !v)}>
          <span aria-hidden="true">{open ? '▾' : '▸'}</span>
          <b>{section.title}</b>
          <small className="muted">
            {live} of {section.items.length}
          </small>
        </button>

        {editing && (
          <label className="clsection__switch">
            <input
              type="checkbox"
              checked={section.enabled}
              onChange={(e) => onToggleSection(e.target.checked)}
              disabled={busy}
            />
            <span>{section.enabled ? 'In use' : 'Off'}</span>
          </label>
        )}
      </header>

      {open && (
        <>
          <ul className="clitems">
            {section.items.map((item) => (
              <Item key={item.id} item={item} editing={editing} busy={busy} onToggle={onToggleItem} onReword={onReword} />
            ))}
          </ul>
          {editing && (
            <button type="button" className="btn btn--ghost btn--sm" onClick={onAdd} disabled={busy}>
              Add a point to this section
            </button>
          )}
        </>
      )}
    </section>
  )
}

function Item({ item, editing, busy, onToggle, onReword }) {
  const [text, setText] = useState(item.text)

  useEffect(() => {
    setText(item.text)
  }, [item.text])

  return (
    <li className={item.enabled ? '' : 'is-off'}>
      {editing ? (
        <>
          <input
            type="checkbox"
            checked={item.enabled}
            onChange={(e) => onToggle(item, e.target.checked)}
            disabled={busy}
            aria-label={`Include "${item.text}"`}
          />
          <input
            className="clitems__text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            // Saved on blur rather than on every keystroke: each save is a
            // round trip, and a 303-point form would otherwise make one per
            // letter typed.
            onBlur={() => text.trim() !== item.text && onReword(item, text.trim())}
            disabled={busy}
          />
          {item.reworded && (
            <button
              type="button"
              className="linkish"
              onClick={() => onReword(item, '')}
              disabled={busy}
              title="Restore the standard wording"
            >
              Reset
            </button>
          )}
        </>
      ) : (
        <>
          <span className="clitems__code">{item.code}</span>
          <span className="clitems__text">{item.text}</span>
          {!item.enabled && <span className="muted small">off</span>}
        </>
      )}
    </li>
  )
}

function AddItem({ unitId, section, onClose, onAdded }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const save = async () => {
    setBusy(true)
    setError('')
    try {
      onAdded(
        await api(`/units/${unitId}/template/draft/items`, {
          method: 'POST',
          body: { section_id: section.section_id, text: text.trim() },
        })
      )
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Add a checklist point">
      <div className="modal__panel glass glass--strong">
        <header className="modal__head">
          <h2>Add a point</h2>
          <button type="button" className="modal__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <p className="muted small">
          Added to <b>{section.title}</b>, for this unit only. The shared library is untouched.
        </p>

        <label className="field">
          <span>What the inspector checks</span>
          <textarea
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Ice machine scoop stored outside the ice bin"
          />
        </label>

        {error && <p className="error" role="alert">{error}</p>}

        <footer className="modal__foot">
          <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" onClick={save} disabled={busy || text.trim().length < 3}>
            {busy ? 'Adding…' : 'Add'}
          </button>
        </footer>
      </div>
    </div>
  )
}
