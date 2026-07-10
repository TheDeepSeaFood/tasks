/**
 * Verifies a Google ID token via Google's tokeninfo endpoint.
 * Returns { email, name } or throws. This is the security gate — the web app is
 * deployed as ANYONE_ANONYMOUS, so identity is only ever established here.
 */
function verifyIdToken(idToken) {
  if (!idToken) throw new Error('Missing idToken');
  const url = 'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken);
  const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (resp.getResponseCode() !== 200) throw new Error('Invalid token');
  const info = JSON.parse(resp.getContentText());
  if (info.aud !== CLIENT_ID) throw new Error('Wrong audience');
  if (ALLOWED_DOMAIN && info.hd !== ALLOWED_DOMAIN) throw new Error('Wrong domain');
  if (!info.email) throw new Error('No email in token');
  return { email: String(info.email).toLowerCase(), name: info.name || info.email };
}
