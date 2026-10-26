/**
 * The shared checklist library.
 *
 * One master set of items for the whole tenant. Units customise their own copy
 * without breaking group reporting, because a customised item keeps its library id.
 */

/** Install the library for a tenant. Idempotent: existing items are left alone. */
function installLibrary(tenantId) {
  let sections = 0, groups = 0, items = 0;

  dbTransaction(function () {
    CHECKLIST_LIBRARY.forEach(function (section, sIdx) {
      let sectionRow = dbFirst('LibrarySections', function (r) {
        return Number(r.tenant_id) === Number(tenantId) && r.code === section.code;
      });
      if (!sectionRow) {
        sectionRow = dbInsert('LibrarySections', {
          tenant_id: tenantId, code: section.code, title: section.title,
          applies_to: section.applies_to, sort_order: sIdx,
        });
        sections += 1;
      }

      section.groups.forEach(function (group, gIdx) {
        let groupRow = dbFirst('LibraryGroups', function (r) {
          return Number(r.section_id) === Number(sectionRow.id) && r.code === group.code;
        });
        if (!groupRow) {
          groupRow = dbInsert('LibraryGroups', {
            section_id: sectionRow.id, code: group.code, title: group.title, sort_order: gIdx,
          });
          groups += 1;
        }

        const existing = {};
        dbFind('LibraryItems', function (r) { return Number(r.group_id) === Number(groupRow.id); })
          .forEach(function (r) { existing[r.code] = true; });

        const pending = [];
        group.items.forEach(function (pair, iIdx) {
          if (existing[pair[0]]) return;
          pending.push({
            group_id: groupRow.id, code: pair[0], text: pair[1],
            risk_weight: 1, sort_order: iIdx, active: 1,
          });
        });
        // One batched write rather than 303 separate ones.
        if (pending.length > 0) {
          dbInsertMany('LibraryItems', pending);
          items += pending.length;
        }
      });
    });
  });

  return { sections: sections, groups: groups, items: items };
}

/** The library, nested, for the checklist editor. */
function getLibrary(tenantId) {
  const sections = dbFind('LibrarySections', function (r) {
    return Number(r.tenant_id) === Number(tenantId);
  }).sort(function (a, b) { return a.sort_order - b.sort_order; });

  const allGroups = dbAll('LibraryGroups');
  const allItems = dbAll('LibraryItems');

  return sections.map(function (section) {
    const groups = allGroups
      .filter(function (g) { return Number(g.section_id) === Number(section.id); })
      .sort(function (a, b) { return a.sort_order - b.sort_order; })
      .map(function (group) {
        return Object.assign({}, group, {
          items: allItems
            .filter(function (i) {
              return Number(i.group_id) === Number(group.id) && Number(i.active) === 1;
            })
            .sort(function (a, b) { return a.sort_order - b.sort_order; }),
        });
      });
    return Object.assign({}, section, { groups: groups });
  });
}
