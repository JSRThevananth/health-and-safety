/**
 * Inspection capture.
 *
 * Exception-based: every item is satisfactory unless the inspector says otherwise,
 * so only touched items are stored. An untouched 303-point inspection costs no rows,
 * and the "accepted at default" count falls out of that rather than being tracked.
 *
 * Status rules:
 *   draft     - the inspector's own working copy, freely editable
 *   submitted - locked to the inspector; waiting on the unit admin
 *   signed    - immutable to everyone, which is what makes it audit evidence
 */

const RATINGS = ['satisfactory', 'needs_improvement', 'critical', 'na'];
const DEFAULT_RATING = 'satisfactory';

function isException(rating) {
  return rating === 'needs_improvement' || rating === 'critical';
}

function isEditable(inspection) {
  return inspection.status === 'draft';
}

/** The inspector's open draft for a unit, created if there is not one. */
function openDraft(unitId, inspectorId) {
  const existing = dbFirst('Inspections', function (i) {
    return Number(i.unit_id) === Number(unitId)
      && Number(i.inspector_id) === Number(inspectorId)
      && i.status === 'draft';
  });
  if (existing) return { inspection: existing, created: false };

  const template = getPublishedTemplate(unitId);
  if (!template) throw new Error('This unit has no published checklist yet');

  const inspection = dbTransaction(function () {
    return dbInsert('Inspections', {
      unit_id: unitId, template_id: template.id, inspector_id: inspectorId,
      status: 'draft', department: '', shift: '', summary: '',
      started_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
  });

  return { inspection: inspection, created: true };
}

/**
 * Merge the pinned template with the stored deviations into the full record.
 * Items with no stored row are satisfactory and untouched.
 */
function resolveInspection(inspectionId) {
  const inspection = dbGet('Inspections', inspectionId);
  if (!inspection) return null;

  const template = resolveTemplate(inspection.template_id);
  const stored = {};
  dbFind('InspectionItems', function (r) {
    return Number(r.inspection_id) === Number(inspectionId);
  }).forEach(function (r) { stored[Number(r.template_item_id)] = r; });

  const sections = [];
  template.sections.forEach(function (section) {
    if (!section.enabled) return;
    const items = [];
    section.items.forEach(function (item) {
      if (!item.enabled) return;
      const entry = stored[Number(item.id)];
      items.push(Object.assign({}, item, {
        rating: entry ? entry.rating : DEFAULT_RATING,
        note: entry ? (entry.note || '') : '',
        touched: Boolean(entry),
      }));
    });
    if (items.length > 0) sections.push(Object.assign({}, section, { items: items }));
  });

  const all = [];
  sections.forEach(function (s) { Array.prototype.push.apply(all, s.items); });

  const counts = {};
  RATINGS.forEach(function (r) { counts[r] = 0; });
  let touched = 0, exceptions = 0;
  all.forEach(function (i) {
    counts[i.rating] += 1;
    if (i.touched) touched += 1;
    if (isException(i.rating)) exceptions += 1;
  });

  const unit = dbGet('Units', inspection.unit_id);
  const inspector = dbGet('Users', inspection.inspector_id);

  return Object.assign({}, inspection, {
    id: Number(inspection.id),
    editable: isEditable(inspection),
    unit_name: unit ? unit.name : '',
    unit_code: unit ? unit.code : '',
    inspector_name: inspector ? inspector.full_name : '',
    template_version: template.version,
    sections: sections,
    summary_counts: Object.assign({}, counts, {
      total: all.length,
      touched: touched,
      // Items nobody opened. Surfaced at sign-off so an inspection cannot quietly
      // assert hundreds of passing checks that were never looked at.
      untouched: all.length - touched,
      exceptions: exceptions,
    }),
  });
}

/**
 * Apply autosaved changes.
 *
 * Storing a default rating with no note removes the row, so undoing a mistake
 * returns the item to genuinely untouched rather than recording a pass nobody made.
 */
function applyInspectionItems(inspectionId, items) {
  const inspection = dbGet('Inspections', inspectionId);
  if (!inspection) throw new Error('Inspection not found');

  const valid = {};
  dbFind('UnitTemplateItems', function (t) {
    return Number(t.template_id) === Number(inspection.template_id);
  }).forEach(function (t) { valid[Number(t.id)] = true; });

  items.forEach(function (item) {
    if (!valid[Number(item.template_item_id)]) {
      throw new Error('Item ' + item.template_item_id + ' is not part of this inspection');
    }
    if (RATINGS.indexOf(item.rating) === -1) {
      throw new Error('Unknown rating: ' + item.rating);
    }
  });

  return dbTransaction(function () {
    const existing = {};
    dbFind('InspectionItems', function (r) {
      return Number(r.inspection_id) === Number(inspectionId);
    }).forEach(function (r) { existing[Number(r.template_item_id)] = r; });

    const toAdd = [];
    const toDelete = [];

    items.forEach(function (item) {
      const key = Number(item.template_item_id);
      const note = String(item.note || '').trim();
      const current = existing[key];

      if (item.rating === DEFAULT_RATING && note === '') {
        if (current) toDelete.push(Number(current.id));
        return;
      }
      if (current) {
        dbUpdate('InspectionItems', current.id, {
          rating: item.rating, note: note, updated_at: new Date().toISOString(),
        });
      } else {
        toAdd.push({
          inspection_id: inspectionId, template_item_id: key,
          rating: item.rating, note: note, updated_at: new Date().toISOString(),
        });
      }
    });

    if (toAdd.length > 0) dbInsertMany('InspectionItems', toAdd);
    if (toDelete.length > 0) {
      dbDeleteWhere('InspectionItems', function (r) {
        return toDelete.indexOf(Number(r.id)) !== -1;
      });
    }

    dbUpdate('Inspections', inspectionId, { updated_at: new Date().toISOString() });
    return true;
  });
}

/** Hand it in. From here the inspector can no longer change it. */
function submitInspection(inspectionId) {
  const inspection = dbGet('Inspections', inspectionId);
  if (!inspection) throw new Error('Inspection not found');
  if (!isEditable(inspection)) throw new Error('This inspection has already been submitted');

  const resolved = resolveInspection(inspectionId);
  const undescribed = [];
  resolved.sections.forEach(function (s) {
    s.items.forEach(function (i) {
      // A finding nobody described is not actionable by whoever has to fix it.
      if (isException(i.rating) && !String(i.note).trim()) undescribed.push(i);
    });
  });
  if (undescribed.length > 0) {
    throw new Error(undescribed.length + ' finding(s) need a description before submission');
  }

  dbTransaction(function () {
    dbUpdate('Inspections', inspectionId, {
      status: 'submitted', submitted_at: new Date().toISOString(),
    });
  });
  return resolveInspection(inspectionId);
}

/** Sign off. Freezes the record permanently. */
function signInspection(inspectionId, signerId) {
  const inspection = dbGet('Inspections', inspectionId);
  if (!inspection) throw new Error('Inspection not found');
  if (inspection.status !== 'submitted') throw new Error('Only a submitted inspection can be signed off');
  // Sign-off is a second pair of eyes, not a second signature from the person who
  // carried out the inspection.
  if (Number(inspection.inspector_id) === Number(signerId)) {
    throw new Error('An inspection cannot be signed off by its own inspector');
  }

  dbTransaction(function () {
    dbUpdate('Inspections', inspectionId, {
      status: 'signed', signed_at: new Date().toISOString(), signed_by: signerId,
    });
  });
  return resolveInspection(inspectionId);
}

/** Discard a draft and everything captured in it. */
function discardInspection(inspectionId) {
  const inspection = dbGet('Inspections', inspectionId);
  if (!inspection) throw new Error('Inspection not found');
  if (!isEditable(inspection)) throw new Error('A submitted inspection cannot be discarded');

  return dbTransaction(function () {
    dbDeleteWhere('InspectionItems', function (r) {
      return Number(r.inspection_id) === Number(inspectionId);
    });
    dbDelete('Inspections', inspectionId);
    return true;
  });
}
