let _idToken = null;
const TOKEN_KEY = 'taskmgr.idtoken';

/** ms-since-epoch expiry of a Google ID token (JWT), or 0 if unparseable. */
function _tokenExpiry(jwt) {
  try {
    const payload = JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return (payload.exp || 0) * 1000;
  } catch (e) { return 0; }
}

/** A stored token that is still valid (30s skew), else null (and clears it). */
function _validStoredToken() {
  const t = localStorage.getItem(TOKEN_KEY);
  if (t && _tokenExpiry(t) > Date.now() + 30000) return t;
  if (t) localStorage.removeItem(TOKEN_KEY);
  return null;
}

function initAuth(onSignIn) {
  google.accounts.id.initialize({
    client_id: window.APP_CONFIG.CLIENT_ID,
    auto_select: true,                 // silently re-issue for returning users
    callback: function (resp) {
      _idToken = resp.credential;
      try { localStorage.setItem(TOKEN_KEY, resp.credential); } catch (e) { /* private mode */ }
      onSignIn();
    }
  });
  google.accounts.id.renderButton(
    document.getElementById('signin'),
    { theme: 'filled_blue', size: 'large', shape: 'pill' }
  );

  // Reuse a still-valid token so a refresh doesn't bounce back to the login page.
  const cached = _validStoredToken();
  if (cached) { _idToken = cached; onSignIn(); return; }

  // No valid token yet — try One Tap silent sign-in for returning users.
  google.accounts.id.prompt();
}

function getIdToken() { return _idToken; }

/** Drop the session (used when the server rejects the token, and on manual sign-out). */
function clearAuth() {
  _idToken = null;
  try { localStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignore */ }
  google.accounts.id.disableAutoSelect();
}

function signOut() {
  clearAuth();
  location.reload();
}
