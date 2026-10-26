/**
 * Sign-in, sessions and the forced first password change.
 *
 * The web app is reachable by anyone with the link, because floor inspectors do not
 * have Google accounts. That makes this file the only gate in front of the data.
 */

const LOGIN_WINDOW_MINUTES = 15;
const LOGIN_MAX_FAILURES = 10;

function _cacheKey(username) {
  return 'login_fail_' + String(username).toLowerCase().replace(/[^a-z0-9._-]/g, '_');
}

/** Count of recent failures for a username. */
function _recentFailures(username) {
  const raw = CacheService.getScriptCache().get(_cacheKey(username));
  return raw ? Number(raw) : 0;
}

function _recordFailure(username) {
  const cache = CacheService.getScriptCache();
  const key = _cacheKey(username);
  cache.put(key, String(_recentFailures(username) + 1), LOGIN_WINDOW_MINUTES * 60);
}

function _clearFailures(username) {
  CacheService.getScriptCache().remove(_cacheKey(username));
}

/**
 * Shape a user for the client. Never returns the hash or the salt - those must not
 * leave the server side, and a stray field here would put them in the browser.
 */
function publicUser(user, principal) {
  return {
    id: Number(user.id),
    username: user.username,
    email: user.email,
    full_name: user.full_name,
    initials: user.initials,
    role: user.role,
    tenant_id: Number(user.tenant_id),
    must_change_password: Number(user.must_change_password) === 1,
    unit_ids: principal.unitIds,
    permissions: principal.permissions,
  };
}

function buildPrincipal(user) {
  return {
    id: Number(user.id),
    tenantId: Number(user.tenant_id),
    username: user.username,
    role: user.role,
    mustChangePassword: Number(user.must_change_password) === 1,
    permissions: effectivePermissions(user.id, user.role),
    unitIds: accessibleUnitIds(user.id, user.role),
  };
}

function login(username, password) {
  const name = String(username || '').trim();
  if (!name || !password) throw new Error('Invalid credentials');

  // Throttle the one route that tells an attacker whether a guess was right.
  if (_recentFailures(name) >= LOGIN_MAX_FAILURES) {
    throw new Error('Too many sign-in attempts. Try again in ' + LOGIN_WINDOW_MINUTES + ' minutes.');
  }

  const user = dbFirst('Users', function (u) {
    return String(u.username).toLowerCase() === name.toLowerCase() && Number(u.active) === 1;
  });

  // Hash regardless of whether the user exists, so response time does not reveal
  // which usernames are real.
  const salt = user ? user.password_salt : 'absent-user-salt';
  const expected = user ? user.password_hash : 'never-matches';
  const ok = verifyPassword(password, salt, expected);

  if (!user || !ok) {
    _recordFailure(name);
    throw new Error('Invalid credentials');
  }

  _clearFailures(name);

  const principal = buildPrincipal(user);
  const expires = new Date(Date.now() + getConfig().sessionHours * 3600 * 1000).toISOString();
  const token = signToken({ uid: Number(user.id), exp: expires });

  return { token: token, user: publicUser(user, principal) };
}

/**
 * Resolve a token into the caller.
 *
 * Permissions are read from the sheet on every call rather than trusted from the
 * token, so revoking someone's access takes effect immediately instead of whenever
 * their token happens to expire.
 */
function principalFromToken(token) {
  const payload = readToken(token);
  if (!payload) return null;

  const user = dbGet('Users', payload.uid);
  if (!user || Number(user.active) !== 1) return null;

  return buildPrincipal(user);
}

function requireAuth(token) {
  const principal = principalFromToken(token);
  if (!principal) throw new Error('Your session has ended. Please sign in again.');
  return principal;
}

/**
 * Everything except the change itself is refused while an admin-issued password is
 * still in force, so the requirement cannot be skipped by calling the API directly.
 */
function requirePasswordChanged(principal) {
  if (principal.mustChangePassword) {
    const error = new Error('Password change required before continuing');
    error.code = 'PASSWORD_CHANGE_REQUIRED';
    throw error;
  }
}

function changePassword(principal, currentPassword, newPassword) {
  const config = getConfig();
  const user = dbGet('Users', principal.id);
  if (!user) throw new Error('User not found');

  if (!verifyPassword(currentPassword, user.password_salt, user.password_hash)) {
    throw new Error('Current password is incorrect');
  }
  if (String(newPassword).length < config.minPasswordLength) {
    throw new Error('Use at least ' + config.minPasswordLength + ' characters');
  }
  // Otherwise a forced change could be satisfied by re-entering the temporary one.
  if (String(currentPassword) === String(newPassword)) {
    throw new Error('New password must be different from the current one');
  }

  const salt = generateSalt();
  dbTransaction(function () {
    dbUpdate('Users', user.id, {
      password_salt: salt,
      password_hash: hashPassword(newPassword, salt),
      must_change_password: 0,
      password_changed_at: new Date().toISOString(),
    });
  });

  const updated = dbGet('Users', user.id);
  return publicUser(updated, buildPrincipal(updated));
}
