/**
 * Per-unit versioned checklists.
 *
 * A published version is immutable: edits go to a draft, and publishing archives
 * the previous version rather than replacing it, so an inspection signed months ago
 * still renders exactly as it was filled in.
 *
 * A reworded item keeps its library_item_id, which is what preserves cross-unit
 * comparison and repeat-finding detection.
 */

function getPublishedTemplate(unitId) {
  return dbFirst('UnitTemplates', function (t) {
    return Number(t.unit_id) === Number(unitId) && t.status === 'published';
  });
}

function getDraftTemplate(unitId) {
  return dbFirst('UnitTemplates', function (t) {
    return Number(t.unit_id) === Number(unitId) && t.status === 'draft';
  });
}

function _nextVersion(unitId) {
  const versions = dbFind('UnitTemplates', function (t) {
    return Number(t.unit_id) === Number(unitId);
  }).map(function (t) { return Number(t.version); });
  return versions.length === 0 ? 1 : Math.max.apply(null, versions) + 1;
}

/** Open a draft, seeded from the published version or, first time, the whole library. */
function createDraft(unitId, tenantId, userId) {
  const existing = getDraftTemplate(unitId);
  if (existing) return existing;

  return dbTransaction(function () {
    const template = dbInsert('UnitTemplates', {
      unit_id: unitId, version: _nextVersion(unitId), status: 'draft',
      notes: '', created_by: userId, created_at: new Date().toISOString(),
    });

    const published = getPublishedTemplate(unitId);
    if (published) {
      // Carry the unit's current customisation forward verbatim.
      dbInsertMany('UnitTemplateSections',
        dbFind('UnitTemplateSections', function (s) {
          return Number(s.template_id) === Number(published.id);
        }).map(function (s) {
          return { template_id: template.id, section_id: s.section_id, enabled: s.enabled, sort_order: s.sort_order };
        }));

      dbInsertMany('UnitTemplateItems',
        dbFind('UnitTemplateItems', function (i) {
          return Number(i.template_id) === Number(published.id);
        }).map(function (i) {
          return {
            template_id: template.id, library_item_id: i.library_item_id,
            custom_item_id: i.custom_item_id, text_override: i.text_override,
            enabled: i.enabled, risk_weight: i.risk_weight, sort_order: i.sort_order,
          };
        }));
    } else {
      // First draft: the whole library, everything enabled.
      const sections = dbFind('LibrarySections', function (s) {
        return Number(s.tenant_id) === Number(tenantId);
      }).sort(function (a, b) { return a.sort_order - b.sort_order; });

      const groups = dbAll('LibraryGroups');
      const items = dbAll('LibraryItems');

      const sectionRows = [];
      const itemRows = [];
      let order = 0;

      sections.forEach(function (section) {
        sectionRows.push({
          template_id: template.id, section_id: section.id, enabled: 1, sort_order: section.sort_order,
        });
        groups
          .filter(function (g) { return Number(g.section_id) === Number(section.id); })
          .sort(function (a, b) { return a.sort_order - b.sort_order; })
          .forEach(function (group) {
            items
              .filter(function (i) {
                return Number(i.group_id) === Number(group.id) && Number(i.active) === 1;
              })
              .sort(function (a, b) { return a.sort_order - b.sort_order; })
              .forEach(function (item) {
                itemRows.push({
                  template_id: template.id, library_item_id: item.id, custom_item_id: '',
                  text_override: '', enabled: 1, risk_weight: '', sort_order: order++,
                });
              });
          });
      });

      dbInsertMany('UnitTemplateSections', sectionRows);
      dbInsertMany('UnitTemplateItems', itemRows);
    }

    return dbGet('UnitTemplates', template.id);
  });
}

/**
 * Resolve a template into what the editor and the inspection form render.
 * `text` is the effective wording; `reworded` flags items whose text differs from
 * the library, so a cross-unit report can say the comparison is not like-for-like.
 */
function resolveTemplate(templateId) {
  const template = dbGet('UnitTemplates', templateId);
  if (!template) return null;

  const libraryItems = {};
  dbAll('LibraryItems').forEach(function (i) { libraryItems[Number(i.id)] = i; });
  const groups = {};
  dbAll('LibraryGroups').forEach(function (g) { groups[Number(g.id)] = g; });
  const sections = {};
  dbAll('LibrarySections').forEach(function (s) { sections[Number(s.id)] = s; });
  const customItems = {};
  dbAll('UnitCustomItems').forEach(function (c) { customItems[Number(c.id)] = c; });

  const templateItems = dbFind('UnitTemplateItems', function (i) {
    return Number(i.template_id) === Number(templateId);
  }).sort(function (a, b) { return a.sort_order - b.sort_order; });

  const bySection = {};
  templateItems.forEach(function (row) {
    const library = row.library_item_id ? libraryItems[Number(row.library_item_id)] : null;
    const custom = row.custom_item_id ? customItems[Number(row.custom_item_id)] : null;
    if (!library && !custom) return; // an item whose source was removed

    const group = library ? groups[Number(library.group_id)] : null;
    const sectionId = library ? Number(group.section_id) : Number(custom.section_id);

    if (!bySection[sectionId]) bySection[sectionId] = [];
    bySection[sectionId].push({
      id: Number(row.id),
      library_item_id: row.library_item_id ? Number(row.library_item_id) : null,
      custom_item_id: row.custom_item_id ? Number(row.custom_item_id) : null,
      code: library ? library.code : 'CUSTOM.' + row.custom_item_id,
      group_code: group ? group.code : '',
      group_title: group ? group.title : '',
      text: row.text_override || (library ? library.text : custom.text),
      reworded: Boolean(row.text_override),
      is_custom: Boolean(row.custom_item_id),
      enabled: Number(row.enabled) === 1,
      risk_weight: Number(row.risk_weight || (library ? library.risk_weight : custom.risk_weight) || 1),
      sort_order: Number(row.sort_order),
    });
  });

  const sectionRows = dbFind('UnitTemplateSections', function (s) {
    return Number(s.template_id) === Number(templateId);
  }).sort(function (a, b) { return a.sort_order - b.sort_order; });

  const resolvedSections = sectionRows.map(function (row) {
    const section = sections[Number(row.section_id)];
    return {
      section_id: Number(row.section_id),
      code: section ? section.code : '',
      title: section ? section.title : '',
      applies_to: section ? section.applies_to : 'department',
      enabled: Number(row.enabled) === 1,
      items: bySection[Number(row.section_id)] || [],
    };
  });

  const all = [];
  resolvedSections.forEach(function (s) { Array.prototype.push.apply(all, s.items); });

  // An item is only asked when both it and its section are enabled; counting the
  // item flag alone overstates the length of the form.
  let effective = 0;
  resolvedSections.forEach(function (s) {
    if (!s.enabled) return;
    s.items.forEach(function (i) { if (i.enabled) effective += 1; });
  });

  return Object.assign({}, template, {
    version: Number(template.version),
    sections: resolvedSections,
    stats: {
      sections_total: resolvedSections.length,
      sections_enabled: resolvedSections.filter(function (s) { return s.enabled; }).length,
      items_total: all.length,
      items_enabled: all.filter(function (i) { return i.enabled; }).length,
      items_effective: effective,
      items_custom: all.filter(function (i) { return i.is_custom; }).length,
      items_reworded: all.filter(function (i) { return i.reworded; }).length,
    },
  });
}

/** Publish a draft, archiving whatever was published before it. */
function publishDraft(templateId) {
  const draft = dbGet('UnitTemplates', templateId);
  if (!draft) throw new Error('Template not found');
  if (draft.status !== 'draft') throw new Error('Only a draft can be published');

  if (resolveTemplate(templateId).stats.items_effective === 0) {
    throw new Error('Cannot publish a checklist with no enabled items');
  }

  return dbTransaction(function () {
    dbFind('UnitTemplates', function (t) {
      return Number(t.unit_id) === Number(draft.unit_id) && t.status === 'published';
    }).forEach(function (t) { dbUpdate('UnitTemplates', t.id, { status: 'archived' }); });

    dbUpdate('UnitTemplates', templateId, {
      status: 'published', published_at: new Date().toISOString(),
    });
    return dbGet('UnitTemplates', templateId);
  });
}
