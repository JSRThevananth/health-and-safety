/**
 * The single entry point the browser calls.
 *
 * The UI reaches this through google.script.run rather than HTTP, so there are no
 * routes - one function, an action name, and a payload. Every action resolves the
 * caller from their token, checks the capability it needs, and checks unit scope.
 *
 * Errors are returned rather than thrown, because an exception crossing the
 * google.script.run boundary arrives at the browser stripped of its message.
 */
function api(action, payload) {
  payload = payload || {};

  try {
    const result = _dispatch(action, payload);
    return { ok: true, data: result };
  } catch (error) {
    return {
      ok: false,
      error: error.message || String(error),
      code: error.code || null,
    };
  }
}

/** Actions reachable without being signed in. */
const PUBLIC_ACTIONS = ['login', 'health'];

/** Actions reachable while an admin-issued password is still in force. */
const PASSWORD_CHANGE_ACTIONS = ['me', 'changePassword', 'logout'];

function _dispatch(action, payload) {
  if (PUBLIC_ACTIONS.indexOf(action) !== -1) {
    if (action === 'health') return _health();
    if (action === 'login') return login(payload.username, payload.password);
  }

  const principal = requireAuth(payload.token);

  if (PASSWORD_CHANGE_ACTIONS.indexOf(action) === -1) {
    requirePasswordChanged(principal);
  }

  switch (action) {
    /* ---------------------------------------------------------- session -- */
    case 'me': {
      const user = dbGet('Users', principal.id);
      return publicUser(user, principal);
    }
    case 'changePassword':
      return changePassword(principal, payload.current_password, payload.new_password);
    case 'logout':
      return { ok: true };

    /* ------------------------------------------------------------ units -- */
    case 'listUnits': {
      requirePermission(principal, 'unit.view');
      return dbFind('Units', function (u) {
        if (Number(u.tenant_id) !== principal.tenantId || Number(u.active) !== 1) return false;
        return canAccessUnit(principal, u.id);
      });
    }

    /* -------------------------------------------------------- checklist -- */
    case 'getTemplate': {
      requirePermission(principal, 'template.view');
      requireUnitAccess(principal, payload.unit_id);
      const published = getPublishedTemplate(payload.unit_id);
      if (!published) throw new Error('This unit has no published checklist yet');
      return resolveTemplate(published.id);
    }

    /* ------------------------------------------------------ inspections -- */
    case 'openInspection': {
      requirePermission(principal, 'inspection.create');
      requireUnitAccess(principal, payload.unit_id);
      const opened = openDraft(payload.unit_id, principal.id);
      return resolveInspection(opened.inspection.id);
    }

    case 'getInspectionDraft': {
      requirePermission(principal, 'inspection.create');
      requireUnitAccess(principal, payload.unit_id);
      const draft = dbFirst('Inspections', function (i) {
        return Number(i.unit_id) === Number(payload.unit_id)
          && Number(i.inspector_id) === principal.id && i.status === 'draft';
      });
      if (!draft) throw new Error('No inspection in progress');
      return resolveInspection(draft.id);
    }

    case 'saveInspection': {
      requirePermission(principal, 'inspection.create');
      const inspection = _ownDraft(principal, payload.inspection_id);
      if (payload.items && payload.items.length > 0) {
        applyInspectionItems(inspection.id, payload.items);
      }
      const meta = {};
      ['department', 'shift', 'summary'].forEach(function (key) {
        if (payload[key] !== undefined) meta[key] = payload[key];
      });
      if (Object.keys(meta).length > 0) {
        dbTransaction(function () { dbUpdate('Inspections', inspection.id, meta); });
      }
      return resolveInspection(inspection.id);
    }

    case 'discardInspection': {
      requirePermission(principal, 'inspection.create');
      const inspection = _ownDraft(principal, payload.inspection_id);
      discardInspection(inspection.id);
      return { discarded: true };
    }

    case 'submitInspection': {
      requirePermission(principal, 'inspection.create');
      const inspection = _ownDraft(principal, payload.inspection_id);
      const submitted = submitInspection(inspection.id);
      // The report goes out on submission - this is the "send report" action.
      const mail = sendInspectionReport(inspection.id);
      return Object.assign({}, submitted, { report: mail });
    }

    case 'signInspection': {
      requirePermission(principal, 'inspection.sign');
      const inspection = _scopedInspection(principal, payload.inspection_id);
      return signInspection(inspection.id, principal.id);
    }

    case 'listInspections': {
      requirePermission(principal, 'inspection.view');
      return dbFind('Inspections', function (i) {
        if (!canAccessUnit(principal, i.unit_id)) return false;
        if (payload.unit_id && Number(i.unit_id) !== Number(payload.unit_id)) return false;
        if (payload.status && i.status !== payload.status) return false;
        return true;
      }).sort(function (a, b) {
        return String(b.updated_at).localeCompare(String(a.updated_at));
      }).slice(0, 200);
    }

    case 'getInspection': {
      requirePermission(principal, 'inspection.view');
      const inspection = _scopedInspection(principal, payload.inspection_id);
      return resolveInspection(inspection.id);
    }

    /* ------------------------------------------------------ attachments -- */
    case 'uploadAttachment': {
      requirePermission(principal, 'attachment.upload');
      const inspection = _ownDraft(principal, payload.inspection_id);
      return storeAttachment(
        principal, 'inspection_item', payload.template_item_id, payload.filename, payload.data
      );
    }

    case 'listAttachments': {
      requirePermission(principal, 'inspection.view');
      return listAttachments(payload.entity_type, payload.entity_id);
    }

    case 'deleteAttachment': {
      requirePermission(principal, 'attachment.delete');
      return { deleted: deleteAttachment(payload.attachment_id) };
    }

    /* ------------------------------------------------------- recipients -- */
    case 'listRecipients': {
      requirePermission(principal, 'recipient.manage');
      requireUnitAccess(principal, payload.unit_id);
      return dbFind('Recipients', function (r) {
        return Number(r.unit_id) === Number(payload.unit_id);
      });
    }

    case 'addRecipient': {
      requirePermission(principal, 'recipient.manage');
      requireUnitAccess(principal, payload.unit_id);
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(payload.email || ''))) {
        throw new Error('That does not look like an email address');
      }
      return dbTransaction(function () {
        return dbInsert('Recipients', {
          unit_id: payload.unit_id, email: payload.email, name: payload.name || '',
          report_types: payload.report_types || '', active: 1,
          created_at: new Date().toISOString(),
        });
      });
    }

    case 'removeRecipient': {
      requirePermission(principal, 'recipient.manage');
      const recipient = dbGet('Recipients', payload.recipient_id);
      if (!recipient) throw new Error('Recipient not found');
      requireUnitAccess(principal, recipient.unit_id);
      dbTransaction(function () { dbDelete('Recipients', payload.recipient_id); });
      return { removed: true };
    }

    default:
      throw new Error('Unknown action: ' + action);
  }
}

function _health() {
  const config = getConfig();
  return {
    status: 'ok',
    email: config.brevo.enabled ? 'brevo' : 'dry-run',
    storage: config.driveFolderId ? 'drive' : 'not configured',
  };
}

/** An inspection the caller may read: theirs, or one in a unit they hold. */
function _scopedInspection(principal, inspectionId) {
  const inspection = dbGet('Inspections', inspectionId);
  // The same answer whether it is missing or out of scope, so a limited user cannot
  // probe for the existence of other units' inspections.
  if (!inspection || !canAccessUnit(principal, inspection.unit_id)) {
    throw new Error('Inspection not found');
  }
  return inspection;
}

/** The caller's own editable draft. */
function _ownDraft(principal, inspectionId) {
  const inspection = _scopedInspection(principal, inspectionId);
  if (Number(inspection.inspector_id) !== principal.id) {
    throw new Error('This inspection belongs to another inspector');
  }
  if (!isEditable(inspection)) {
    const error = new Error('This inspection has been submitted and can no longer be changed');
    error.code = 'INSPECTION_LOCKED';
    throw error;
  }
  return inspection;
}
