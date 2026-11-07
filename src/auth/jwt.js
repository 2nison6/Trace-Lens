// Reading JSON Web Tokens (RFC 7519) and checking the things that make a sign-in fail: expiry, audience, issuer, algorithm.
//
// What this CANNOT do: verify a signature. That needs the issuer's public key, and fetching it would mean a network call (this
// app makes none). So every result says what the token CLAIMS; whether the receiving service accepts it is for that service to
// decide. A token is also never "trusted" because it decodes: anyone can write a token that decodes.

const B64URL = /^[A-Za-z0-9_-]*$/

/** base64url -> bytes. Throws on characters that cannot be base64url. */
export function b64urlToBytes(s) {
  if (!B64URL.test(s)) throw new Error('contains characters that are not base64url')
  const std = s.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(std + '='.repeat((4 - (std.length % 4)) % 4))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

function jsonPart(s, what) {
  let text
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(b64urlToBytes(s)) } catch (e) { throw new Error(`The ${what} is not valid base64url text (${e.message}).`, { cause: e }) }
  let value
  try { value = JSON.parse(text) } catch { throw new Error(`The ${what} decodes, but it is not JSON.`) }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`The ${what} is JSON, but not an object.`)
  return value
}

// A value that is a bearer wrapper, a quoted string, or has surrounding space: tidy it up
export function cleanToken(input) {
  let s = String(input || '').trim()
  s = s.replace(/^(authorization:\s*)?(bearer\s+)/i, '')
  s = s.replace(/^["'`]+|["'`,;]+$/g, '').trim()
  return s
}

/** True for something shaped like a signed or unsigned JWT (three parts, header starting with the base64url of '{"'). */
export const looksLikeJwt = (s) => /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/.test(s)
/** An encrypted token (JWE) has five parts. */
export const looksLikeJwe = (s) => /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*$/.test(s)

/** Decode a token. Returns { token, header, payload, signature } or { token, error, kind } (kind: 'jwe' | 'opaque' | 'malformed'). */
export function decodeJwt(input) {
  const token = cleanToken(input)
  if (!token) return { token, error: 'Paste a token first.', kind: 'empty' }
  if (looksLikeJwe(token)) {
    let header = null
    try { header = jsonPart(token.split('.')[0], 'header') } catch { /* the five-part shape is the answer */ }
    return { token, kind: 'jwe', header, error: 'This is an encrypted token (a JWE, five parts). Only the intended recipient can read its claims, so there is nothing to decode here. The header is shown.' }
  }
  const parts = token.split('.')
  if (parts.length !== 3) {
    return { token, kind: 'opaque', error: parts.length === 1 ? 'This is not a JWT: it has no dots. It may be an opaque token (a random reference that only the issuer can look up), which cannot be read here.' : `This is not a JWT: a JWT has three dot-separated parts and this has ${parts.length}.` }
  }
  let header
  let payload
  try { header = jsonPart(parts[0], 'header'); payload = jsonPart(parts[1], 'payload') } catch (e) { return { token, kind: 'malformed', error: e.message } }
  if (!B64URL.test(parts[2])) return { token, kind: 'malformed', error: 'The signature part contains characters that are not base64url.' }
  return { token, header, payload, signature: parts[2], signatureBytes: parts[2] ? Math.floor((parts[2].length * 3) / 4) : 0, parts }
}

const NUMERIC_DATES = ['exp', 'nbf', 'iat', 'auth_time', 'updated_at']

/** A NumericDate (seconds since 1970) as ms, or null when it is not a usable number. Seconds only: a value in milliseconds is reported. */
export function numericDate(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v * 1000 : null
}

const SKEW_MS = 5 * 60 * 1000
const f = (severity, title, detail, fix) => ({ severity, title, detail, fix })
const fmtSpan = (ms) => {
  const s = Math.round(Math.abs(ms) / 1000)
  if (s < 90) return `${s} second${s === 1 ? '' : 's'}`
  if (s < 5400) return `${Math.round(s / 60)} minutes`
  if (s < 129600) return `${Math.round(s / 3600)} hours`
  return `${Math.round(s / 86400)} days`
}
const iso = (ms) => new Date(ms).toISOString().replace('T', ' ').replace(/\.\d+Z$/, 'Z')
const sameUrl = (a, b) => String(a).replace(/\/+$/, '') === String(b).replace(/\/+$/, '')

/**
 * Checks on a decoded token. `options`: { now (ms), expect: { audience, issuer, scope } }.
 * Returns [{ severity: 'critical' | 'warning' | 'info' | 'ok', title, detail, fix }].
 */
export function checkJwt(dec, options = {}) {
  const out = []
  if (!dec || dec.error) return out
  const { header, payload } = dec
  const now = options.now ?? Date.now()
  const expect = options.expect || {}
  const alg = typeof header.alg === 'string' ? header.alg : ''

  // ---- algorithm and header
  if (!alg) {
    out.push(f('critical', 'The header has no algorithm (alg)', 'Every JWT header must say how the token is signed.', 'The issuer is not producing a valid JWT. Check how the token was created.'))
  } else if (alg.toLowerCase() === 'none') {
    out.push(f('critical', 'The token is unsigned (alg: none)', 'Anyone can create a token like this, so no service should accept it as proof of identity.', 'Make the issuer sign its tokens, and make sure the receiving library rejects "none".'))
  } else if (!dec.signature) {
    out.push(f('warning', `The header says ${alg}, but the signature is empty`, 'A signed token has a signature; an empty one is rejected by every verifier.', 'The token may have been cut short when it was copied. Copy it again in full.'))
  }
  if (/^HS(256|384|512)$/.test(alg)) {
    out.push(f('info', `Signed with a shared secret (${alg})`, 'Both the issuer and the receiver hold the same secret. That is fine between two parts of one system. A service that accepts tokens from a third party should use an asymmetric algorithm (RS256, ES256).'))
  }
  if (/^(RS|PS|ES)(256|384|512)$/.test(alg) && !header.kid && !header.x5t && !header['x5t#S256']) {
    out.push(f('info', 'No key id (kid) in the header', 'When the issuer has more than one signing key, the receiver uses kid to pick the right one. Without it, verification can fail after a key rotation.'))
  }
  for (const k of ['jku', 'x5u', 'jwk', 'x5c']) {
    if (header[k] !== undefined) {
      out.push(f('warning', `The header carries its own key source (${k})`, 'A token can point to or embed the key that signs it. A receiver must never trust that: an attacker can supply their own key. Keys should come from a list the receiver configured.', 'Ignore this header field when verifying, and fetch keys from the issuer\'s configured JWKS URL instead.'))
      break
    }
  }
  if (header.crit !== undefined) out.push(f('info', 'The header marks extensions as critical (crit)', 'A receiver that does not understand a listed extension must reject the token.'))

  // ---- dates
  for (const k of NUMERIC_DATES) {
    if (payload[k] !== undefined && numericDate(payload[k]) === null) {
      out.push(f('warning', `"${k}" is not a number`, `It is ${JSON.stringify(payload[k])}. JWT dates are a number of seconds since 1970.`, 'Fix the code that creates the token.'))
    } else if (numericDate(payload[k]) !== null && payload[k] > 1e11) {
      out.push(f('critical', `"${k}" looks like milliseconds, not seconds`, `The value ${payload[k]} would be year ${new Date(payload[k] * 1000).getUTCFullYear() > 9999 ? 'beyond 9999' : new Date(payload[k] * 1000).getUTCFullYear()} if read as seconds. Most receivers will treat the token as valid for thousands of years, or reject it.`, 'Divide by 1000 when creating the token (JWT dates are in seconds).'))
    }
  }
  const exp = payload.exp > 1e11 ? null : numericDate(payload.exp)
  const nbf = payload.nbf > 1e11 ? null : numericDate(payload.nbf)
  const iat = payload.iat > 1e11 ? null : numericDate(payload.iat)
  if (exp !== null) {
    if (exp <= now - SKEW_MS) out.push(f('critical', 'The token has expired', `It expired at ${iso(exp)}, ${fmtSpan(now - exp)} before the time checked against (${iso(now)}).`, 'Get a new token (sign in again, or use the refresh token). If this keeps happening right after sign-in, check for clock differences between the issuer and this machine.'))
    else if (exp <= now) out.push(f('warning', 'The token expired seconds ago', `It expired at ${iso(exp)}, ${fmtSpan(now - exp)} before the time checked against. Receivers usually allow a few minutes of clock difference, so it may still be accepted.`, 'Check that the clocks of the issuer and the receiver agree (NTP).'))
    else if (exp - now < SKEW_MS) out.push(f('warning', 'The token expires within 5 minutes', `It expires at ${iso(exp)}, in ${fmtSpan(exp - now)}.`, 'Refresh it before it expires, or the next call will fail.'))
    if (iat !== null && exp > iat && exp - iat > 24 * 3600 * 1000 * 30) out.push(f('info', `The token is valid for ${fmtSpan(exp - iat)}`, 'Long-lived access tokens are riskier when they leak. Short access tokens plus refresh tokens are the usual practice.'))
  } else if (payload.exp === undefined) {
    out.push(f('warning', 'The token has no expiry (exp)', 'A token that never expires stays valid for as long as its signing key does, even after the user leaves or the token leaks.', 'Add an exp claim when creating the token.'))
  }
  if (nbf !== null && nbf > now + SKEW_MS) out.push(f('critical', 'The token is not valid yet (nbf)', `It becomes valid at ${iso(nbf)}, ${fmtSpan(nbf - now)} after the time checked against.`, 'Usually a clock difference: the issuer\'s clock is ahead. Sync the clocks, or retry in a moment.'))
  if (iat !== null && iat > now + SKEW_MS) out.push(f('warning', 'The token was issued in the future (iat)', `It says it was issued at ${iso(iat)}, ${fmtSpan(iat - now)} after the time checked against.`, 'The issuer\'s clock is ahead, or the time basis for this check is wrong.'))
  if (exp !== null && nbf !== null && exp <= nbf) out.push(f('critical', 'The token expires before it becomes valid', `nbf is ${iso(nbf)} and exp is ${iso(exp)}.`, 'Fix the code that creates the token.'))

  // ---- who issued it and who it is for
  if (payload.iss === undefined) out.push(f('warning', 'No issuer (iss)', 'The receiver cannot tell who issued the token, so it cannot pick the right key or check that it trusts the issuer.'))
  else if (expect.issuer && !sameUrl(payload.iss, expect.issuer)) {
    out.push(f('critical', 'The issuer is not the one you expect', `The token says iss = ${payload.iss}; you expect ${expect.issuer}.`, 'Check the tenant, realm or domain in your configuration. Some providers (Auth0, Okta) include a trailing slash in iss; the match must be exact in most libraries.'))
  } else if (expect.issuer && payload.iss !== expect.issuer) {
    out.push(f('warning', 'The issuer differs only by a trailing slash', `Token: ${payload.iss}. Expected: ${expect.issuer}. Many libraries compare these exactly and reject the token.`, 'Use the exact string the token carries.'))
  }
  const aud = payload.aud === undefined ? [] : Array.isArray(payload.aud) ? payload.aud.map(String) : [String(payload.aud)]
  if (!aud.length && payload.aud === undefined) out.push(f('warning', 'No audience (aud)', 'Without an audience, any service that trusts this issuer could accept the token.', 'Have the issuer set aud to the API that should receive the token.'))
  if (expect.audience) {
    if (!aud.some((a) => a === expect.audience)) {
      const near = aud.find((a) => sameUrl(a, expect.audience))
      out.push(f('critical', 'The audience is not the one you expect', `The token is for ${aud.length ? aud.join(', ') : '(nothing)'}; you expect ${expect.audience}.${near ? ' They differ only by a trailing slash.' : ''}`, 'Request the token for the right API (the resource, scope or audience parameter), or fix the audience your API is configured with.'))
    }
  }
  if (expect.scope) {
    const have = new Set(String(payload.scope ?? payload.scp ?? '').split(/[\s,]+/).filter(Boolean).concat(Array.isArray(payload.scp) ? payload.scp : []))
    const missing = String(expect.scope).split(/[\s,]+/).filter(Boolean).filter((s) => !have.has(s))
    if (missing.length) out.push(f('critical', 'A scope you expect is missing', `Missing: ${missing.join(', ')}. The token has: ${[...have].join(', ') || '(no scope claim)'}.`, 'Ask for the scope when signing in, and check the user or app was granted it.'))
  }
  if (payload.sub === undefined) out.push(f('info', 'No subject (sub)', 'Tokens for a user normally say who the user is. App-only tokens may legitimately omit it.'))

  // ---- things that point to a particular kind of token
  if (payload.nonce !== undefined || payload.at_hash !== undefined || payload.c_hash !== undefined) {
    if (payload.nonce === undefined) out.push(f('info', 'An ID token without a nonce', 'If the sign-in request sent a nonce, the ID token must echo it; a missing one means the check cannot be made.'))
  }
  if (payload.azp !== undefined && aud.length > 1 && !aud.includes(String(payload.azp))) out.push(f('warning', 'The authorized party (azp) is not in the audience', 'With more than one audience, azp must be one of them.'))

  if (!out.some((x) => x.severity === 'critical' || x.severity === 'warning')) {
    out.push({ severity: 'ok', title: 'Nothing wrong on the face of the token', detail: 'This does not prove the signature is valid: only a service holding the issuer\'s public key can check that.' })
  }
  return out
}

/** One line per claim, with the well-known ones named and dates shown as dates. */
const CLAIM_NAMES = {
  iss: 'Issuer', sub: 'Subject (user)', aud: 'Audience', exp: 'Expires', nbf: 'Not before', iat: 'Issued at', jti: 'Token id', nonce: 'Nonce',
  azp: 'Authorized party', scope: 'Scope', scp: 'Scope', auth_time: 'Authenticated at', acr: 'Auth context', amr: 'Auth methods', at_hash: 'Access-token hash',
  c_hash: 'Code hash', email: 'Email', email_verified: 'Email verified', name: 'Name', preferred_username: 'Username', roles: 'Roles', groups: 'Groups',
  tid: 'Tenant id', oid: 'Object id', ver: 'Version', client_id: 'Client id', sid: 'Session id', idp: 'Identity provider', updated_at: 'Updated at',
}
export function describeClaims(payload) {
  return Object.entries(payload).map(([k, v]) => {
    const ms = NUMERIC_DATES.includes(k) && typeof v === 'number' && v < 1e11 ? numericDate(v) : null
    return { claim: k, label: CLAIM_NAMES[k] || '', value: typeof v === 'string' ? v : JSON.stringify(v), when: ms !== null ? iso(ms) : '' }
  })
}

// ---------------------------------------------------------------------------------------------------------------- finding tokens in a HAR
const TOKEN_PARAMS = /^(access_token|id_token|refresh_token|token|assertion|client_assertion|id_token_hint|logout_token|bearer)$/i
const JWT_IN_TEXT = /eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]*/g

function* bodyTokens(text) {
  if (!text || text.length > 2e6) return
  let json = null
  if (/^\s*[{[]/.test(text)) { try { json = JSON.parse(text) } catch { json = null } }
  if (json && typeof json === 'object') {
    const seen = []
    const walk = (o, d) => {
      if (!o || typeof o !== 'object' || d > 3) return
      for (const [k, v] of Object.entries(o)) {
        if (typeof v === 'string' && TOKEN_PARAMS.test(k) && v.length > 10) seen.push([k, v])
        else if (v && typeof v === 'object') walk(v, d + 1)
      }
    }
    walk(json, 0)
    for (const [k, v] of seen) yield { where: `response body: ${k}`, value: v }
    return
  }
  for (const m of text.matchAll(JWT_IN_TEXT)) yield { where: 'response body', value: m[0] }
}

/**
 * Every token a HAR carries: Authorization headers, token-looking query/form parameters, token fields in JSON responses,
 * and cookie values that are JWTs. One row per distinct token, with every place it was seen.
 * Returns [{ token, kind: 'jwt'|'opaque', decoded, uses: [{ entryId, method, host, path, status, where, at }] }].
 */
export function findTokens(har) {
  const list = (har.raw && har.raw.log && har.raw.log.entries) || []
  const map = new Map()
  const add = (value, use) => {
    const token = cleanToken(value)
    if (!token || token.length < 12) return
    const jwt = looksLikeJwt(token) || looksLikeJwe(token)
    if (!jwt && !/^(authorization|bearer)/i.test(use.where) && !/access_token|refresh_token|id_token|^token$/.test(use.where)) return
    let row = map.get(token)
    if (!row) { row = { token, kind: jwt ? 'jwt' : 'opaque', uses: [] }; map.set(token, row) }
    row.uses.push(use)
  }
  for (const e of har.entries) {
    const raw = list[e.rawIndex] || {}
    const at = Date.parse(raw.startedDateTime)
    const base = { entryId: e.id, method: e.method, host: e.host, path: e.path, status: e.status, at: Number.isFinite(at) ? at : null }
    const auth = e.reqHeaders.authorization
    if (auth) {
      const m = /^(bearer|dpop)\s+(.+)$/i.exec(auth.trim())
      if (m) add(m[2], { ...base, where: 'Authorization header' })
    }
    if (e.reqHeaders['proxy-authorization']) { const m = /^bearer\s+(.+)$/i.exec(e.reqHeaders['proxy-authorization'].trim()); if (m) add(m[1], { ...base, where: 'Proxy-Authorization header' }) }
    for (const q of e.query || []) if (TOKEN_PARAMS.test(q.name)) add(q.value, { ...base, where: `URL parameter: ${q.name}` })
    const post = e.postData
    if (post) {
      for (const p of post.params || []) if (TOKEN_PARAMS.test(p.name)) add(p.value, { ...base, where: `form field: ${p.name}` })
      if (!(post.params || []).length && post.text) for (const m of post.text.matchAll(/(?:^|&)(access_token|id_token|refresh_token|assertion|client_assertion)=([^&]*)/g)) { try { add(decodeURIComponent(m[2].replace(/\+/g, ' ')), { ...base, where: `form field: ${m[1]}` }) } catch { /* skip */ } }
    }
    for (const c of e.reqCookies || []) if (looksLikeJwt(String(c.value || ''))) add(c.value, { ...base, where: `cookie sent: ${c.name}` })
    for (const sc of e.setCookies || []) { const m = /^([^=;]+)=([^;]*)/.exec(sc); if (m && looksLikeJwt(m[2])) add(m[2], { ...base, where: `cookie set: ${m[1]}` }) }
    const body = e.body && e.body.text
    if (body && /json|text|javascript/i.test(e.mime || '') ) {
      let text = body
      if (e.body.encoding === 'base64') { try { text = new TextDecoder().decode(Uint8Array.from(atob(body), (c) => c.charCodeAt(0))) } catch { text = '' } }
      for (const t of bodyTokens(text)) add(t.value, { ...base, where: t.where })
    }
  }
  return [...map.values()].map((r) => ({ ...r, decoded: r.kind === 'jwt' ? decodeJwt(r.token) : null }))
}

// ---------------------------------------------------------------------------------------------------------------- comparing two tokens
/**
 * A claim-by-claim comparison of two decoded tokens ("works for user A, fails for user B").
 * Returns { rows: [{ claim, a, b, same, kind }], header: [...], summary } where kind is 'both' | 'only-a' | 'only-b' | 'different' | 'same'.
 * Per-token identifiers (jti, iat, exp, nbf, auth_time, nonce, at_hash, c_hash, sid, uti) always differ; they are marked noise.
 */
const NOISE = new Set(['jti', 'iat', 'nbf', 'exp', 'auth_time', 'nonce', 'at_hash', 'c_hash', 'sid', 'uti', 'sub', 'oid', 'unique_name', 'upn', 'email', 'preferred_username', 'name', 'given_name', 'family_name', 'ipaddr', 'aio', 'rh', 'xms_tdbr'])
const show = (v) => (v === undefined ? undefined : typeof v === 'string' ? v : JSON.stringify(v))
const sameVal = (x, y) => JSON.stringify(x) === JSON.stringify(y)

export function compareTokens(a, b) {
  const keys = [...new Set([...Object.keys(a.payload), ...Object.keys(b.payload)])]
  const rows = keys.map((claim) => {
    const x = a.payload[claim]; const y = b.payload[claim]
    const kind = x === undefined ? 'only-b' : y === undefined ? 'only-a' : sameVal(x, y) ? 'same' : 'different'
    let items = null
    if (kind === 'different' && Array.isArray(x) && Array.isArray(y)) items = { onlyA: x.filter((v) => !y.some((w) => sameVal(v, w))), onlyB: y.filter((v) => !x.some((w) => sameVal(v, w))) }
    if (kind === 'different' && (claim === 'scope' || claim === 'scp') && typeof x === 'string' && typeof y === 'string') {
      const xs = x.split(/\s+/); const ys = y.split(/\s+/)
      items = { onlyA: xs.filter((v) => !ys.includes(v)), onlyB: ys.filter((v) => !xs.includes(v)) }
    }
    return { claim, a: show(x), b: show(y), kind, noise: NOISE.has(claim), items }
  })
  const hk = [...new Set([...Object.keys(a.header), ...Object.keys(b.header)])]
  const header = hk.map((claim) => ({ claim, a: show(a.header[claim]), b: show(b.header[claim]), kind: a.header[claim] === undefined ? 'only-b' : b.header[claim] === undefined ? 'only-a' : sameVal(a.header[claim], b.header[claim]) ? 'same' : 'different' })).filter((r) => r.kind !== 'same')
  const order = { different: 0, 'only-a': 1, 'only-b': 1, same: 2 }
  rows.sort((p, q) => (p.noise - q.noise) || (order[p.kind] - order[q.kind]) || (p.claim < q.claim ? -1 : 1))
  const meaningful = rows.filter((r) => !r.noise && r.kind !== 'same')
  return { rows, header, meaningful, identical: !meaningful.length && !header.length }
}

// ---------------------------------------------------------------------------------------------------------------- claim hints
/** Findings about what a token's claims say about how it was issued (provider-specific gotchas). */
export function claimHints(dec) {
  const out = []
  if (!dec || dec.error) return out
  const p = dec.payload
  const iss = String(p.iss || '')
  const isEntra = /login\.microsoftonline\.com|sts\.windows\.net/i.test(iss) || p.tid !== undefined && (p.oid !== undefined || p.ver !== undefined)
  if (isEntra) {
    if (p.ver === '1.0' && /login\.microsoftonline\.com\/[^/]+\/v2\.0/.test(iss)) out.push(f('warning', 'An Entra v1 token with a v2 issuer', 'ver is 1.0 but the issuer is a v2.0 URL.', ''))
    if (p.ver === '1.0' || /sts\.windows\.net/.test(iss)) out.push(f('info', 'A Microsoft Entra v1.0 token', 'The issuer is sts.windows.net/<tenant>/ and the audience is the resource URI. If your API validates v2.0 tokens (issuer login.microsoftonline.com/<tenant>/v2.0), change the app\'s accessTokenAcceptedVersion in its manifest to 2, or request tokens with the v2.0 endpoint. A version mix-up is behind most "issuer is invalid" errors.', ''))
    if (p.ver === '2.0') out.push(f('info', 'A Microsoft Entra v2.0 token', 'The audience is the application ID (a GUID) or the "api://" URI, and the issuer ends in /v2.0.', ''))
    if (p._claim_names || p._claim_sources || p.hasgroups) out.push(f('critical', 'Group overage: the groups are not in this token', 'The user is in too many groups for the token to list them (150 in a SAML token, 200 in a JWT). The token carries a pointer to look them up instead (_claim_names), or hasgroups.', 'Use app roles, group filtering ("groups assigned to the application"), or call Microsoft Graph for the groups.'))
    if (p.idtyp === 'app' || (p.oid && p.sub && p.oid === p.sub && !p.upn && !p.preferred_username && !p.name)) out.push(f('info', 'An app-only token (no user)', 'There is no user in it: roles come from the application permissions granted to the app, not from the user.', ''))
    if (p.scp === undefined && p.roles === undefined && p.idtyp !== undefined) out.push(f('warning', 'Neither scp nor roles', 'An API that authorises on scopes (delegated) or roles (application) will find nothing to check.', 'Request the scope, or grant and consent the application permission.'))
    if (p.wids) out.push(f('info', 'Directory roles are in "wids"', 'These are Entra directory role template IDs (like Global Administrator), not application roles.', ''))
  }
  if (/auth0\.com/i.test(iss) && !p.aud) out.push(f('warning', 'Auth0 token without an audience', 'Without an API audience Auth0 returns an opaque or userinfo-only token. Pass the API identifier as the audience parameter.', ''))
  if (/okta\.com/i.test(iss)) {
    if (p.cid !== undefined && p.scp !== undefined && p.sub === undefined) out.push(f('info', 'An Okta token with no sub', 'Likely a client-credentials token for the app itself.', ''))
    if (/\/oauth2\/default|\/oauth2\/aus/.test(iss) === false && /okta\.com$|okta\.com\/?$/.test(iss)) out.push(f('info', 'An Okta org authorization server token', 'The org authorization server issues tokens only for Okta\'s own APIs. For your own API use a custom authorization server (an issuer containing /oauth2/…).', ''))
  }
  if (/cognito-idp\./i.test(iss)) {
    if (p.token_use === 'access' && p.aud !== undefined) out.push(f('info', 'This Cognito access token has an "aud"', 'Cognito access tokens normally carry client_id, not aud.', ''))
    if (p.token_use === 'access') out.push(f('info', 'A Cognito access token', 'Validate client_id (not aud). The audience check libraries apply to aud will fail on it.', ''))
    if (p.token_use === 'id') out.push(f('info', 'A Cognito ID token', 'ID tokens are for the client application; an API should be given the access token.', ''))
  }
  if (/accounts\.google\.com/i.test(iss) && p.hd === undefined && p.email) out.push(f('info', 'A Google token without "hd"', 'The hosted-domain claim is missing, so this is a consumer Google account, not a Workspace one. If you restrict sign-in to a company domain, check hd, not just the email suffix.', ''))
  if (p.azp !== undefined && p.aud !== undefined && p.azp !== p.aud && !Array.isArray(p.aud) && p.token_use === undefined) out.push(f('info', 'The authorized party differs from the audience', `azp is ${p.azp} and aud is ${p.aud}. Normal when a client gets a token for another API; a bug if your app expected a token for itself.`, ''))
  if (p.scope && p.scp) out.push(f('info', 'Both scope and scp are present', 'Some providers use one name and some the other; an API that reads only one will think there are no scopes.', ''))
  if (typeof p.aud === 'string' && /\s/.test(p.aud)) out.push(f('warning', 'The audience contains whitespace', JSON.stringify(p.aud), 'A space-separated audience is a bug: audiences are a string or an array.'))
  if (typeof p.scope === 'string' && /,/.test(p.scope) && !/\s/.test(p.scope)) out.push(f('warning', 'Scopes look comma-separated', p.scope, 'Scopes are space-separated.'))
  return out
}

// ---------------------------------------------------------------------------------------------------------------- timeline
/**
 * For each token found in a capture: when it was issued, when it expired, and when it was first and last used, so a 401 after
 * "the token was fine a minute ago" can be placed on a line. Times are ms since 1970. Returns rows sorted by first use.
 */
export function tokenTimeline(tokens) {
  return tokens.filter((t) => t.decoded && !t.decoded.error).map((t) => {
    const p = t.decoded.payload
    const iat = numericDate(p.iat); const exp = numericDate(p.exp); const nbf = numericDate(p.nbf)
    const used = t.uses.map((u) => u.at).filter((x) => x != null)
    const first = used.length ? Math.min(...used) : null
    const last = used.length ? Math.max(...used) : null
    const rejected = t.uses.filter((u) => u.status === 401 || u.status === 403)
    return {
      token: t.token, label: p.sub ? String(p.sub).slice(0, 24) : (p.client_id || p.cid || t.decoded.header.alg),
      aud: Array.isArray(p.aud) ? p.aud.join(', ') : p.aud, iat, nbf, exp, first, last, uses: t.uses.length, rejected: rejected.length,
      usedAfterExpiry: exp != null && last != null && last > exp, usedBeforeValid: nbf != null && first != null && first < nbf,
      lifetimeMs: iat != null && exp != null ? exp - iat : null,
    }
  }).sort((a, b) => (a.first ?? 0) - (b.first ?? 0))
}
