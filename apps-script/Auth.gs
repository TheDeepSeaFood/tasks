/**
 * Verifies a Google ID token via Google's tokeninfo endpoint.
 * Returns { email, name } or throws. This is the security gate — the web app is
 * deployed as ANYONE_ANONYMOUS, so identity is only ever established here.
 */
function verifyIdToken(idToken) {
  if (!idToken) throw new Error('Missing idToken');

  // Cache the verification result for a few minutes so we don't call Google's
  // tokeninfo endpoint on every single request (that round-trip was the main lag).
  const cache = CacheService.getScriptCache();
  const key = 'tok_' + Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, idToken));
  const hit = cache.get(key);
  if (hit) return JSON.parse(hit);

  const url = 'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken);
  const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (resp.getResponseCode() !== 200) throw new Error('Invalid token');
  const info = JSON.parse(resp.getContentText());
  if (info.aud !== CLIENT_ID) throw new Error('Wrong audience');
  if (ALLOWED_DOMAIN && info.hd !== ALLOWED_DOMAIN) throw new Error('Wrong domain');
  if (!info.email) throw new Error('No email in token');

  const result = { email: String(info.email).toLowerCase(), name: info.name || info.email };
  cache.put(key, JSON.stringify(result), 300); // 5 minutes
  return result;
}
