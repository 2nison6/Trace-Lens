// Finding OAuth 2.0 / OpenID Connect sign-ins in a HAR and checking them.
//
// A sign-in is a chain: the app sends the browser to the authorization endpoint (/authorize), the provider sends it back to the
// app's redirect_uri with a code (or an error), and the app trades the code for tokens at the token endpoint (/token). This
// finds each of those steps, pairs them up, and compares them, because most failures are a mismatch BETWEEN steps (a redirect_uri
// that differs, a state that does not come back, a PKCE verifier that does not match its challenge).
//
// It sees only what the browser saw. The token request is normally made by the app's SERVER, not the browser, so a HAR from a
// server-side web app usually has no token exchange at all; single-page apps and mobile web views do. The result says so.
import { decodeJwt, checkJwt } from './jwt'
import { explainError } from './errors'

const qparams = (url) => { try { return Object.fromEntries(new URL(url).searchParams.entries()) } catch { return {} } }
const fragParams = (url) => { try { const h = new URL(url).hash.replace(/^#/, ''); return h.includes('=') ? Object.fromEntries(new URLSearchParams(h).entries()) : {} } catch { return {} } }
const AUTHORIZE_PATH = /\/(authorize|authorization|auth|oauth2?\/(v\d+(\.\d+)?\/)?authorize|connect\/authorize|protocol\/openid-connect\/auth)\/?$/i
const TOKEN_PATH = /\/(token|oauth2?\/(v\d+(\.\d+)?\/)?token|connect\/token|protocol\/openid-connect\/token)\/?$/i

export const isAuthorizeRequest = (url) => {
  const q = qparams(url)
  if (!q.response_type || !q.client_id) return false
  try { return AUTHORIZE_PATH.test(new URL(url).pathname) || 'redirect_uri' in q || 'scope' in q } catch { return false }
}

const sha256b64url = async (text) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function formOf(entry) {
  const post = entry.postData
  if (!post) return {}
  if (post.params && post.params.length) return Object.fromEntries(post.params.map((p) => [p.name, p.value]))
  const text = post.text || ''
  if (/^\s*\{/.test(text)) { try { return JSON.parse(text) } catch { return {} } }
  try { return Object.fromEntries(new URLSearchParams(text).entries()) } catch { return {} }
}

function bodyJson(entry) {
  const b = entry.body
  if (!b || !b.text) return null
  let text = b.text
  if (b.encoding === 'base64') { try { text = new TextDecoder().decode(Uint8Array.from(atob(text), (c) => c.charCodeAt(0))) } catch { return null } }
  try { const v = JSON.parse(text); return v && typeof v === 'object' ? v : null } catch { return null }
}

const f = (severity, title, detail, fix) => ({ severity, title, detail, fix })
const trailingOnly = (a, b) => a !== b && String(a).replace(/\/+$/, '') === String(b).replace(/\/+$/, '')
const caseOnly = (a, b) => a !== b && String(a).toLowerCase() === String(b).toLowerCase()

/**
 * Every sign-in found in a parsed HAR, in order. Each is
 * { id, authorize: {entry, params}, callback: {entry, params, where} | null, token: {entry, form, body} | null,
 *   protocol: 'oidc' | 'oauth2', flow: 'code' | 'implicit' | 'hybrid', checks: [...] }.
 * Async only because checking a PKCE verifier needs SHA-256.
 */
export async function analyzeOAuth(har) {
  const list = (har.raw && har.raw.log && har.raw.log.entries) || []
  const at = (e) => { const t = Date.parse((list[e.rawIndex] || {}).startedDateTime); return Number.isFinite(t) ? t : null }
  const entries = har.entries
  const flows = []
  const claimedTokens = new Set()
  const claimedCallbacks = new Set()

  for (const e of entries) {
    if (!isAuthorizeRequest(e.url)) continue
    const params = qparams(e.url)
    const scopes = String(params.scope || '').split(/\s+/).filter(Boolean)
    const rt = String(params.response_type || '').split(/\s+/)
    const flow = rt.includes('code') ? (rt.length > 1 ? 'hybrid' : 'code') : 'implicit'
    flows.push({
      id: `oauth-${e.id}`, authorize: { entry: e, params, at: at(e) }, scopes, flow, protocol: scopes.includes('openid') ? 'oidc' : 'oauth2',
      callback: null, token: null, others: [], checks: [],
    })
  }

  // callbacks: the request (or redirect) that carries the result back to the redirect_uri
  for (const fl of flows) {
    const ru = fl.authorize.params.redirect_uri
    const state = fl.authorize.params.state
    const startIdx = fl.authorize.entry.id
    let best = null
    for (const e of entries) {
      if (e.id <= startIdx || claimedCallbacks.has(e.id)) continue
      const p = { ...qparams(e.url), ...fragParams(e.url) }
      // the provider's redirect carries the answer in its Location header
      let loc = null
      if (e.redirectUrl) { try { loc = new URL(e.redirectUrl, e.url).href } catch { loc = null } }
      const lp = loc ? { ...qparams(loc), ...fragParams(loc) } : {}
      const carries = (x) => 'code' in x || 'error' in x || 'access_token' in x || 'id_token' in x
      const target = ru && (e.url.startsWith(ru) || (loc && loc.startsWith(ru)))
      if (target && (carries(p) || carries(lp))) {
        const useLoc = !carries(p) && carries(lp)
        const match = state && ((useLoc ? lp : p).state === state)
        if (!best || match) best = { entry: e, params: useLoc ? lp : p, where: useLoc ? 'redirect from the provider' : 'request to the app', at: at(e) }
        if (match) break
      }
    }
    if (best) { fl.callback = best; claimedCallbacks.add(best.entry.id) }
  }

  // token requests
  const tokenReqs = entries.filter((e) => e.method === 'POST' && (TOKEN_PATH.test(e.path) || (formOf(e).grant_type && (formOf(e).code || formOf(e).refresh_token || formOf(e).client_id))))
  for (const fl of flows) {
    const code = fl.callback && fl.callback.params.code
    if (!code) continue
    const t = tokenReqs.find((e) => !claimedTokens.has(e.id) && formOf(e).code === code) || tokenReqs.find((e) => !claimedTokens.has(e.id) && e.id > fl.callback.entry.id && formOf(e).grant_type === 'authorization_code')
    if (t) { claimedTokens.add(t.id); fl.token = { entry: t, form: formOf(t), body: bodyJson(t), at: at(t) } }
    fl.others = tokenReqs.filter((x) => !claimedTokens.has(x.id) && x.id > (fl.token ? fl.token.entry.id : fl.callback.entry.id) && formOf(x).grant_type === 'refresh_token').map((x) => ({ entry: x, form: formOf(x), body: bodyJson(x), at: at(x) }))
  }

  for (const fl of flows) fl.checks = await checkFlow(fl)
  return { flows, tokenOnly: tokenReqs.filter((x) => !claimedTokens.has(x.id)).map((x) => ({ entry: x, form: formOf(x), body: bodyJson(x), at: at(x) })) }
}

async function checkFlow(fl) {
  const out = []
  const a = fl.authorize.params
  const cb = fl.callback
  const tk = fl.token
  const ae = fl.authorize.entry

  // ---- the authorization request itself
  if (!ae.isHttps && !/^(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(ae.host)) out.push(f('critical', 'The authorization request is not over HTTPS', `It was sent to ${ae.host} over plain http.`, 'Always send users to the authorization endpoint over HTTPS.'))
  if (a.response_type && /(^|\s)token(\s|$)/.test(a.response_type) && !/code/.test(a.response_type)) out.push(f('warning', 'Uses the implicit flow (response_type=token)', 'The access token comes back in the URL, where it can leak through history, logs and referrers. Current guidance (OAuth 2.0 Security Best Current Practice) is to use the authorization code flow with PKCE instead.', 'Switch to response_type=code with PKCE.'))
  if (!a.redirect_uri) out.push(f('warning', 'No redirect_uri in the request', 'The provider will use the single registered URI, or reject the request if there are several.', 'Send redirect_uri explicitly.'))
  if (fl.flow !== 'implicit' || /code/.test(a.response_type || '')) {
    if (!a.code_challenge) out.push(f(fl.flow === 'code' ? 'warning' : 'info', 'No PKCE (code_challenge)', 'Without PKCE, an authorization code that is intercepted can be used by someone else. It is required for public clients (single-page and mobile apps) and recommended for all.', 'Send code_challenge and code_challenge_method=S256, and the matching code_verifier in the token request.'))
    else if (a.code_challenge_method === 'plain' || (!a.code_challenge_method)) out.push(f('warning', a.code_challenge_method === 'plain' ? 'PKCE uses the "plain" method' : 'PKCE method not stated (defaults to plain)', 'With "plain", the challenge is the verifier itself, which gives little protection if the request is observed.', 'Use code_challenge_method=S256.'))
  }
  if (!a.state) out.push(f('warning', 'No state parameter', 'state ties the response to the request and protects against cross-site request forgery. (An app that uses PKCE or a nonce may be protected another way, but state is the standard defence.)', 'Send a random state and check it comes back unchanged.'))
  if (fl.protocol === 'oidc' && (fl.flow === 'implicit' || fl.flow === 'hybrid') && !a.nonce) out.push(f('critical', 'OpenID Connect implicit/hybrid request without a nonce', 'A nonce is required here, and the provider will reject the request or the ID token cannot be checked.', 'Send a random nonce and verify it in the ID token.'))
  else if (fl.protocol === 'oidc' && !a.nonce) out.push(f('info', 'No nonce', 'Optional with the code flow, but it lets the app check the ID token belongs to this sign-in.'))
  if (fl.protocol === 'oidc' && a.prompt === 'none') out.push(f('info', 'Silent request (prompt=none)', 'No screen is shown. It fails with login_required or interaction_required when the user has no session, and often fails in a hidden iframe when third-party cookies are blocked.'))
  if (a.scope && /\s*,\s*/.test(a.scope) && !/\s/.test(a.scope.trim())) out.push(f('warning', 'Scopes look comma-separated', 'Scopes are separated by spaces. A comma-separated list reaches the provider as one unknown scope.', 'Separate scopes with spaces (+ or %20 in the URL).'))

  // ---- the answer coming back
  if (!cb) {
    out.push(f('warning', 'No response back to the app was found', 'There is no request or redirect to the redirect_uri that carries a code, token or error. The sign-in may not have finished, the user may have stopped at the login page, or the capture ended too early.', 'Capture the whole sign-in, from clicking Sign in to the page after the redirect, with "Preserve log" on.'))
    return out
  }
  const p = cb.params
  if (p.error) {
    const known = explainError(p.error, p.error_description || '')
    out.push(f('critical', `The provider returned an error: ${p.error}`, `${p.error_description ? `"${p.error_description}". ` : ''}${known ? `${known.title}: ${known.meaning}` : 'No further detail.'}`, known ? `${known.fix[0]}. Look it up under Error lookup for the usual causes.` : 'Look the error up under Error lookup, and check the provider\'s logs.'))
  }
  if (a.state && p.state !== undefined && p.state !== a.state) out.push(f('critical', 'state does not match', `The request sent state=${a.state} and the response carries state=${p.state}. An app must reject this.`, 'Check the app stores state per sign-in (and not in a cookie another tab overwrote).'))
  if (a.state && p.state === undefined && !p.error) out.push(f('critical', 'state was not returned', 'The request had a state, but the response does not carry it.', 'The provider or something in between dropped it. Check for a proxy or a redirect that rebuilds the URL.'))
  if (a.redirect_uri && cb.entry && !p.error) {
    const url = cb.where === 'redirect from the provider' ? cb.entry.redirectUrl : cb.entry.url
    if (url && !url.startsWith(a.redirect_uri)) out.push(f('warning', 'The response went to a different address than redirect_uri', `redirect_uri is ${a.redirect_uri}, but the response went to ${url.split('?')[0]}.`))
  }
  if (p.access_token && fl.flow === 'implicit') out.push(f('warning', 'The access token is in the URL', 'It can leak through browser history, logs and the Referer header.', 'Use the authorization code flow with PKCE.'))
  if (p.code && p.error === undefined && fl.flow === 'code' && !tk) {
    out.push(f('info', 'No token request in this capture', 'A code came back, but there is no request that trades it for tokens. That is normal when the app\'s server makes the call: the browser never sees it. To see the token step, look at the app\'s server logs.', ''))
  }

  // ---- the token exchange
  if (tk) {
    const form = tk.form
    const te = tk.entry
    if (!te.isHttps) out.push(f('critical', 'The token request is not over HTTPS', 'The code and any secret travel in clear text.', 'Use HTTPS.'))
    if (form.redirect_uri !== undefined && a.redirect_uri !== undefined && form.redirect_uri !== a.redirect_uri) {
      const why = trailingOnly(form.redirect_uri, a.redirect_uri) ? ' They differ only by a trailing slash.' : caseOnly(form.redirect_uri, a.redirect_uri) ? ' They differ only by letter case.' : ''
      out.push(f('critical', 'redirect_uri differs between the authorization and token requests', `Authorization: ${a.redirect_uri}. Token: ${form.redirect_uri}.${why} The provider must see exactly the same value both times and returns invalid_grant otherwise.`, 'Send the same redirect_uri in both requests.'))
    } else if (form.redirect_uri === undefined && a.redirect_uri !== undefined) {
      out.push(f('critical', 'redirect_uri is missing from the token request', 'It was sent in the authorization request, so the token request must repeat it (RFC 6749, section 4.1.3).', 'Add redirect_uri to the token request.'))
    }
    if (form.client_id && a.client_id && form.client_id !== a.client_id) out.push(f('critical', 'client_id differs between the requests', `Authorization: ${a.client_id}. Token: ${form.client_id}.`, 'Use one client_id throughout.'))
    if (a.code_challenge) {
      if (!form.code_verifier) out.push(f('critical', 'PKCE: the token request has no code_verifier', 'The authorization request sent a code_challenge, so the code can only be redeemed with the verifier. The provider returns invalid_grant.', 'Keep the verifier from the start of the sign-in and send it as code_verifier.'))
      else if ((a.code_challenge_method || 'plain') === 'S256') {
        const expect = await sha256b64url(form.code_verifier)
        if (expect !== a.code_challenge) out.push(f('critical', 'PKCE: the verifier does not match the challenge', 'SHA-256 of the code_verifier sent is not the code_challenge from the authorization request. The provider returns invalid_grant.', 'Use the verifier that was generated for this sign-in. A common cause is a second sign-in (another tab, a retry) overwriting the stored verifier.'))
        else out.push({ severity: 'ok', title: 'PKCE: the verifier matches the challenge', detail: 'SHA-256 of the code_verifier equals the code_challenge.' })
      } else if (form.code_verifier !== a.code_challenge) out.push(f('critical', 'PKCE: the verifier does not match the challenge', 'With method plain the two must be identical.'))
    } else if (form.code_verifier) {
      out.push(f('warning', 'A code_verifier was sent, but the authorization request had no code_challenge', 'The provider cannot check it, and may reject the request.', 'Send code_challenge in the authorization request too.'))
    }
    if (cb.params.code && form.code && form.code !== cb.params.code) out.push(f('warning', 'The code in the token request is not the one returned', 'The token request carries a different code than the one in the response.'))
    const authz = te.reqHeaders.authorization || ''
    if (/^basic /i.test(authz) && form.client_secret) out.push(f('warning', 'The client authenticates twice (Basic header and client_secret)', 'Only one method is allowed per request; some providers reject this with invalid_client.', 'Use either the Authorization header or the client_secret field.'))
    if (form.client_secret) {
      // a secret in a request the browser made is visible to the user and to anyone who gets the capture
      out.push(f('critical', 'A client secret is sent from the browser', 'Anything the browser sends is visible to the user and to anyone who gets the capture, so this secret is no longer a secret. Public clients (single-page apps, mobile apps) must not hold one.', 'Remove the secret and use PKCE, or move the token exchange to your server. Rotate this secret.'))
    }
    if (te.status >= 400 || (tk.body && tk.body.error)) {
      const err = (tk.body && tk.body.error) || ''
      const known = explainError(err, (tk.body && tk.body.error_description) || '')
      out.push(f('critical', `The token request failed: HTTP ${te.status}${err ? ` ${err}` : ''}`, `${tk.body && tk.body.error_description ? `"${tk.body.error_description}". ` : ''}${known ? `${known.title}: ${known.meaning}` : ''}`, known ? known.fix[0] : 'Look at the response body and the provider\'s logs.'))
    } else if (tk.body) {
      const body = tk.body
      if (!body.access_token) out.push(f('warning', 'The token response has no access_token', 'A successful response must contain one.'))
      if (body.token_type && !/^bearer$/i.test(body.token_type) && !/^dpop$/i.test(body.token_type)) out.push(f('info', `token_type is ${body.token_type}`, 'Most APIs expect Bearer.'))
      if (fl.protocol === 'oidc' && !body.id_token) out.push(f('warning', 'An OpenID Connect sign-in returned no id_token', 'The scope included openid, but the response has no ID token.', 'Check the app is allowed to request the openid scope, and that the provider supports it for this flow.'))
      if (body.id_token) {
        const dec = decodeJwt(body.id_token)
        if (!dec.error) {
          const now = tk.at ?? Date.now()
          for (const c of checkJwt(dec, { now, expect: { issuer: undefined, audience: a.client_id } }).filter((x) => x.severity === 'critical' || x.severity === 'warning')) out.push({ ...c, title: `ID token: ${c.title}` })
          if (a.nonce && dec.payload.nonce !== a.nonce) out.push(f('critical', 'ID token: the nonce does not match', `The request sent nonce=${a.nonce}; the ID token has ${dec.payload.nonce === undefined ? 'none' : dec.payload.nonce}. An app must reject this.`, 'Check the nonce is stored per sign-in and sent in the request.'))
          else if (a.nonce) out.push({ severity: 'ok', title: 'ID token: the nonce matches', detail: '' })
        }
      }
      if (body.access_token && body.expires_in !== undefined && !(body.expires_in > 0)) out.push(f('warning', 'expires_in is zero or invalid', `It is ${JSON.stringify(body.expires_in)}.`))
      if (a.scope && body.scope) {
        const asked = String(a.scope).split(/\s+/).filter(Boolean)
        const got = new Set(String(body.scope).split(/\s+/).filter(Boolean))
        const missing = asked.filter((s) => !got.has(s) && s !== 'offline_access')
        if (missing.length) out.push(f('warning', 'Some scopes were not granted', `Asked for: ${asked.join(' ')}. Got: ${[...got].join(' ')}. Missing: ${missing.join(' ')}.`, 'The user or admin may have declined them, or the app is not allowed them. Providers may silently drop scopes.'))
      }
      if (asked(a, 'offline_access') && !body.refresh_token) out.push(f('info', 'offline_access was requested but no refresh_token came back', 'Some providers need extra settings (a consent prompt, or "refresh tokens" enabled for the app).'))
      if (!te.resHeaders['cache-control'] || !/no-store/i.test(te.resHeaders['cache-control'])) out.push(f('info', 'The token response is not marked Cache-Control: no-store', 'RFC 6749 requires no-store on responses that contain tokens, so no cache keeps them.'))
    }
    const t0 = fl.callback.at
    if (t0 != null && tk.at != null && tk.at - t0 > 60000) out.push(f('warning', `The code was redeemed ${Math.round((tk.at - t0) / 1000)} seconds after it was issued`, 'Authorization codes live for between about one and ten minutes, and some providers allow less.', 'Exchange the code straight after the redirect.'))
  }
  // dedupe 'ok' noise: keep order
  if (!out.some((x) => x.severity === 'critical' || x.severity === 'warning')) {
    out.push({ severity: 'ok', title: 'Nothing wrong found in this sign-in', detail: 'This reads the browser\'s side only. The provider\'s own logs have the final word.' })
  }
  return out
}

const asked = (a, scope) => String(a.scope || '').split(/\s+/).includes(scope)

/** A short line for each step of a flow, for the timeline. */
export function flowSteps(fl) {
  const steps = []
  const e = fl.authorize.entry
  steps.push({ n: 1, name: 'Authorization request', detail: `${e.host}${e.path}`, status: e.status, at: fl.authorize.at, entryId: e.id })
  if (fl.callback) steps.push({ n: 2, name: fl.callback.params.error ? 'Error returned' : 'Response to the app', detail: fl.callback.params.error ? `error=${fl.callback.params.error}` : (fl.callback.params.code ? 'code' : fl.callback.params.access_token ? 'access_token' : 'id_token') + ' returned', status: fl.callback.entry.status, at: fl.callback.at, entryId: fl.callback.entry.id })
  if (fl.token) steps.push({ n: 3, name: 'Token request', detail: `${fl.token.entry.host}${fl.token.entry.path}`, status: fl.token.entry.status, at: fl.token.at, entryId: fl.token.entry.id })
  for (const r of fl.others) steps.push({ n: steps.length + 1, name: 'Token refresh', detail: `${r.entry.host}${r.entry.path}`, status: r.entry.status, at: r.at, entryId: r.entry.id })
  return steps
}

// ---------------------------------------------------------------------------------------------------------------- token requests
// Every request to a token endpoint in a capture, whatever started it, checked on its own and against the others. This is where
// refresh-token problems show up (a token used twice, a rotated token not adopted, repeated refreshes that keep failing), and it
// is the only place the non-browser grants appear (client credentials, device flow, password).

const tokenFail = (r) => r.entry.status >= 400 || (r.body && r.body.error)

/** Returns { requests: [{ ...r, grant, checks }], checks: [cross-request checks] }. */
export function analyzeTokenRequests(har) {
  const list = (har.raw && har.raw.log && har.raw.log.entries) || []
  const at = (e) => { const t = Date.parse((list[e.rawIndex] || {}).startedDateTime); return Number.isFinite(t) ? t : null }
  const reqs = har.entries
    .filter((e) => e.method === 'POST' && (TOKEN_PATH.test(e.path) || (formOf(e).grant_type && (formOf(e).code || formOf(e).refresh_token || formOf(e).client_id || formOf(e).device_code || formOf(e).username))))
    .map((e) => ({ entry: e, form: formOf(e), body: bodyJson(e), at: at(e), grant: formOf(e).grant_type || '(none)' }))
  const cross = []
  for (const r of reqs) {
    r.checks = []
    const g = r.grant
    const ok = !tokenFail(r)
    const err = (r.body && r.body.error) || ''
    if (g === 'password') r.checks.push(f('warning', 'Uses the password grant (ROPC)', 'The app collects the user\'s password itself. The OAuth 2.0 Security Best Current Practice says this grant MUST NOT be used; it also cannot do multi-factor sign-in.', 'Use the authorization code flow with PKCE.'))
    if (g === 'client_credentials') {
      r.checks.push({ severity: 'info', title: 'Client credentials grant (app-only token)', detail: 'The token is for the application itself, not a user. It has no sub of a person and no refresh token, by design.' })
      if (!r.form.scope && !r.form.resource && !(r.entry.reqHeaders.authorization || '').match(/^basic/i) && !r.form.client_secret && !r.form.client_assertion) r.checks.push(f('warning', 'No client authentication found', 'A client credentials request must authenticate the client (a secret, a certificate assertion or Basic).', ''))
      if (ok && r.body && r.body.refresh_token) r.checks.push(f('info', 'A refresh token came back with a client credentials grant', 'Unusual: this grant does not normally issue one.', ''))
    }
    if (g === 'urn:ietf:params:oauth:grant-type:device_code') {
      if (err === 'authorization_pending') r.checks.push({ severity: 'info', title: 'Device flow: waiting for the user', detail: 'Normal. The app polls until the user approves on the other device.' })
      else if (err === 'slow_down') r.checks.push(f('warning', 'Device flow: polling too fast', 'The server asked the device to slow down.', 'Increase the polling interval by 5 seconds each time.'))
      else if (err === 'expired_token') r.checks.push(f('critical', 'Device flow: the code expired before the user approved', '', 'Start again and approve sooner.'))
      else if (err === 'access_denied') r.checks.push(f('critical', 'Device flow: the user denied the request', '', ''))
    }
    if (g === 'refresh_token') {
      if (!ok) {
        const known = explainError(err, (r.body && r.body.error_description) || '')
        r.checks.push(f('critical', `The refresh failed: HTTP ${r.entry.status}${err ? ` ${err}` : ''}`, `${r.body && r.body.error_description ? `"${r.body.error_description}". ` : ''}${known ? `${known.title}: ${known.meaning}` : ''}`, known ? known.fix[0] : 'The user has to sign in again.'))
      } else if (r.body && !r.body.refresh_token) {
        r.checks.push({ severity: 'info', title: 'No new refresh token returned', detail: 'The old one stays valid (no rotation).' })
      }
    }
    if (g !== 'refresh_token' && !ok) {
      const known = explainError(err, (r.body && r.body.error_description) || '')
      if (g !== 'urn:ietf:params:oauth:grant-type:device_code' || (err !== 'authorization_pending' && err !== 'slow_down')) r.checks.push(f('critical', `Token request failed: HTTP ${r.entry.status}${err ? ` ${err}` : ''}`, `${r.body && r.body.error_description ? `"${r.body.error_description}". ` : ''}${known ? `${known.title}: ${known.meaning}` : ''}`, known ? known.fix[0] : ''))
    }
    if (!r.entry.isHttps && !/^(localhost|127\.0\.0\.1)/.test(r.entry.host)) r.checks.push(f('critical', 'The token request is not over HTTPS', '', 'Use HTTPS.'))
  }

  // refresh tokens across requests
  const byToken = new Map()
  for (const r of reqs) if (r.grant === 'refresh_token' && r.form.refresh_token) { const a = byToken.get(r.form.refresh_token) || []; a.push(r); byToken.set(r.form.refresh_token, a) }
  for (const [tok, uses] of byToken) {
    const okUses = uses.filter((u) => !tokenFail(u))
    const short = `${tok.slice(0, 8)}…${tok.slice(-4)}`
    if (okUses.length > 1 && okUses.some((u) => u.body && u.body.refresh_token && u.body.refresh_token !== tok)) {
      cross.push(f('critical', `A refresh token was used successfully ${okUses.length} times, and the server rotates them`, `The token ${short} worked more than once, but each response issued a different one. With rotation a token is valid once; reuse is what makes servers revoke the whole token family. Two tabs, a retry or a lost response are the usual causes.`, 'Make sure only one place refreshes at a time (a lock across tabs), and always store the new refresh token from the latest response.'))
    }
    const failedAfterOk = uses.some((u, i) => tokenFail(u) && uses.slice(0, i).some((p) => !tokenFail(p)))
    if (failedAfterOk) cross.push(f('critical', `A refresh token stopped working after it had worked (${short})`, 'It succeeded earlier and then failed. With rotation, this is what reuse detection looks like: the second use is refused (invalid_grant) and the whole chain may be revoked.', 'Do not refresh from more than one place; keep the newest refresh token only.'))
  }
  const refreshFails = reqs.filter((r) => r.grant === 'refresh_token' && tokenFail(r))
  if (refreshFails.length >= 3) cross.push(f('warning', `${refreshFails.length} refresh attempts failed`, 'Repeated failures usually mean the app keeps retrying with a dead token instead of sending the user to sign in.', 'After invalid_grant on a refresh, stop retrying and start a new sign-in.'))
  return { requests: reqs, checks: cross }
}
