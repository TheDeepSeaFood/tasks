/** Single network chokepoint. text/plain body avoids the CORS preflight that
 *  breaks Apps Script cross-origin calls. */
async function apiCall(action, payload) {
  const resp = await fetch(window.APP_CONFIG.API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ idToken: getIdToken(), action: action, payload: payload || {} }),
    redirect: 'follow'
  });
  const json = await resp.json();
  if (!json.ok) throw new Error(json.error);
  return json.data;
}
