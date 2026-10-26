import { api, getToken } from './api.js'
import { shrinkImage, photoName } from './image.js'

// Optional chaining because import.meta.env only exists under Vite: without it
// this module cannot be imported by a plain node:test, and the error it throws
// then has nothing to do with the thing being tested.
const BASE = import.meta.env?.VITE_API_BASE_URL || '/api'

/** Every photo attached to an inspection, newest first. */
export const listPhotos = (inspectionId) =>
  api(`/attachments?entity_type=inspection&entity_id=${inspectionId}`)

/**
 * Upload one photo against an item of an inspection.
 *
 * Shrunk first, on the device. The caller gets the attachment row back, so the
 * thumbnail it renders is the stored file rather than a local preview that would
 * disappear on reload.
 */
export async function uploadPhoto(inspectionId, templateItemId, file) {
  const shrunk = await shrinkImage(file)

  const form = new FormData()
  form.set('file', shrunk, photoName(templateItemId, shrunk.name))
  form.set('entity_type', 'inspection')
  form.set('entity_id', String(inspectionId))

  return api('/attachments', { method: 'POST', form })
}

export const deletePhoto = (id) => api(`/attachments/${id}`, { method: 'DELETE' })

/**
 * A thumbnail URL for a stored photo.
 *
 * Fetched rather than set as a plain src because the download route needs the
 * bearer token, which an <img> tag cannot send. The object URL is revoked by the
 * caller when the component unmounts.
 */
export async function photoObjectUrl(id) {
  const response = await fetch(`${BASE}/attachments/${id}/download`, {
    headers: { authorization: `Bearer ${getToken()}` },
  })
  if (!response.ok) throw new Error(`Could not load photo ${id}`)
  return URL.createObjectURL(await response.blob())
}

/** Which item each photo belongs to, read back from its filename. */
export function groupPhotosByItem(photos) {
  const byItem = new Map()
  for (const photo of photos) {
    const match = /^item-(\d+)-/.exec(photo.filename)
    const key = match ? Number(match[1]) : null
    if (!byItem.has(key)) byItem.set(key, [])
    byItem.get(key).push(photo)
  }
  return byItem
}
