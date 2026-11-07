// Checking an OpenID Connect discovery document (/.well-known/openid-configuration) and a JWKS, and cross-checking them with a token
// or with the sign-ins in a capture. Everything is paste-in: TraceLens makes no network requests, so it cannot fetch the document.
import { b64urlToBytes } from './jwt'

const f = (severity, title, detail, fix) => ({ severity, title, detail, fix })
const isUrl = (s) => { try { const u = new URL(s); return u.protocol === 'https:' || u.protocol === 'http:' } catch { return false } }

const REQUIRED = ['issuer', 'authorization_endpoint', 'jwks_uri', 'response_types_supported', 'subject_types_supported', 'id_token_signing_alg_values_supported']

/** Parse pasted discovery JSON. Returns { doc } or { error }. */
export function parseDiscovery(text) {
  let doc
  try { doc = JSON.parse(String(text || '').trim()) } catch { return { error: 'That is not JSON. Open the provider\'s /.well-known/openid-configuration in a browser and paste what it shows.' } }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { error: 'That JSON is not an object.' }
  if (doc.keys) return { error: 'That looks like a JWKS (a list of keys), not a discovery document. Paste it under "Signing keys" instead.' }
  if (!doc.issuer && !doc.authorization_endpoint && !doc.token_endpoint) return { error: 'That JSON has no issuer or endpoints, so it does not look like an OpenID Connect discovery document.' }
  return { doc }
}

/**
 * Checks on a discovery document. `expect`: { issuer, fetchedFrom } where fetchedFrom is the URL it came from (the issuer plus
 * /.well-known/openid-configuration), so the issuer can be compared with it, which is a requirement of the spec.
 */
export function checkDiscovery(doc, expect = {}) {
  const out = []
  for (const k of REQUIRED) if (doc[k] === undefined) out.push(f(k === 'jwks_uri' || k === 'issuer' || k === 'authorization_endpoint' ? 'critical' : 'warning', `Missing "${k}"`, 'The OpenID Connect Discovery specification lists it as required.', ''))
  if (doc.token_endpoint === undefined && !(doc.grant_types_supported || []).every((g) => g === 'implicit')) out.push(f('warning', 'Missing "token_endpoint"', 'Required unless only the implicit flow is used.', ''))

  for (const k of ['issuer', 'authorization_endpoint', 'token_endpoint', 'jwks_uri', 'userinfo_endpoint', 'end_session_endpoint', 'revocation_endpoint', 'introspection_endpoint', 'device_authorization_endpoint', 'pushed_authorization_request_endpoint']) {
    const v = doc[k]
    if (v === undefined) continue
    if (typeof v !== 'string' || !isUrl(v)) { out.push(f('critical', `"${k}" is not a URL`, JSON.stringify(v), '')); continue }
    if (!v.startsWith('https:') && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(v)) out.push(f('warning', `"${k}" is not HTTPS`, v, 'OAuth endpoints must use HTTPS (plain http is only acceptable on localhost).'))
  }
  if (doc.issuer) {
    if (/[?#]/.test(doc.issuer)) out.push(f('warning', 'The issuer has a query or fragment', doc.issuer, 'The issuer must not contain either.'))
    if (expect.fetchedFrom) {
      const want = `${String(doc.issuer).replace(/\/+$/, '')}/.well-known/openid-configuration`
      const got = String(expect.fetchedFrom).replace(/\/+$/, '')
      if (want !== got && !got.endsWith('/.well-known/openid-configuration')) out.push(f('info', 'The URL is not the issuer plus /.well-known/openid-configuration', `Fetched from ${expect.fetchedFrom}.`, ''))
      else if (want !== got) out.push(f('critical', 'The issuer does not match the URL the document came from', `The document says issuer = ${doc.issuer}, but it was fetched from ${expect.fetchedFrom}. The specification requires them to match, and strict libraries refuse the document.`, 'Check the tenant or realm in the URL, and the provider\'s configured issuer.'))
    }
    if (expect.issuer && expect.issuer !== doc.issuer) out.push(f('critical', 'The issuer is not the one you expect', `Document: ${doc.issuer}. You expect: ${expect.issuer}.${expect.issuer.replace(/\/+$/, '') === String(doc.issuer).replace(/\/+$/, '') ? ' They differ only by a trailing slash, which most libraries treat as a different issuer.' : ''}`, 'Use exactly the issuer the document gives.'))
  }
  const algs = doc.id_token_signing_alg_values_supported || []
  if (algs.length && !algs.includes('RS256')) out.push(f('warning', 'RS256 is not offered for ID tokens', `Supported: ${algs.join(', ')}. The spec says RS256 must be supported, and many libraries only handle it.`, ''))
  if (algs.includes('none')) out.push(f('warning', 'ID tokens may be unsigned ("none")', 'Unsigned tokens can be requested from this provider. Make sure your client rejects "none".', ''))
  if (algs.some((a) => /^HS/.test(a)) && algs.length > 0) out.push(f('info', 'Shared-secret signing (HS) is offered', 'Fine for confidential clients; a public client cannot keep the secret.', ''))
  const methods = doc.code_challenge_methods_supported
  if (methods === undefined) out.push(f('info', 'PKCE support is not advertised', 'code_challenge_methods_supported is absent. The provider may still support PKCE; check its documentation.', ''))
  else if (!methods.includes('S256')) out.push(f('warning', 'PKCE S256 is not supported', `Supported: ${methods.join(', ') || 'none'}. Without S256 only the weak "plain" method is available.`, ''))
  if ((doc.response_types_supported || []).includes('token') && !(doc.response_types_supported || []).includes('code')) out.push(f('info', 'Only the implicit flow is advertised', 'The authorization code flow with PKCE is the current recommendation.', ''))
  const auth = doc.token_endpoint_auth_methods_supported
  if (auth && !auth.includes('client_secret_basic') && !auth.includes('client_secret_post') && !auth.includes('private_key_jwt') && !auth.includes('none')) out.push(f('info', 'Unusual token endpoint authentication methods', auth.join(', '), ''))
  if (auth && auth.includes('client_secret_basic') && !auth.includes('client_secret_post')) out.push(f('info', 'Only client_secret_basic is accepted', 'Sending the secret in the body (client_secret_post) will be rejected with invalid_client.', ''))
  if (auth && auth.includes('client_secret_post') && !auth.includes('client_secret_basic')) out.push(f('info', 'Only client_secret_post is accepted', 'Sending the secret in an Authorization: Basic header will be rejected with invalid_client.', ''))
  if (doc.scopes_supported && !doc.scopes_supported.includes('openid')) out.push(f('warning', 'The "openid" scope is not listed', 'Without it this is plain OAuth 2.0, not OpenID Connect.', ''))
  if (doc.claims_supported && !doc.claims_supported.includes('sub')) out.push(f('warning', '"sub" is not in claims_supported', '', ''))
  if (!out.some((x) => x.severity === 'critical' || x.severity === 'warning')) out.push({ severity: 'ok', title: 'The discovery document looks fine', detail: 'Required fields are present and the endpoints are URLs over HTTPS.' })
  const order = { critical: 0, warning: 1, info: 2, ok: 3 }
  return out.sort((a, b) => order[a.severity] - order[b.severity])
}

/** Checks on a JWKS: key hygiene, duplicate ids, private parts, and whether a given token's kid is in it. */
export function checkJwks(text, token) {
  const out = []
  let jwks
  try { jwks = JSON.parse(String(text || '').trim()) } catch { return { error: 'That is not JSON. Open the provider\'s jwks_uri in a browser and paste what it shows.' } }
  if (!jwks || !Array.isArray(jwks.keys)) return { error: 'That JSON has no "keys" list, so it is not a JWKS.' }
  if (!jwks.keys.length) return { keys: [], checks: [f('critical', 'The key set is empty', 'No signing key is published, so no token can be verified.', '')] }
  const seen = new Map()
  const rows = jwks.keys.map((k) => {
    const size = k.kty === 'RSA' && k.n ? (() => { try { const b = b64urlToBytes(k.n); return b.length * 8 - (b[0] === 0 ? 8 : 0) } catch { return 0 } })() : 0
    return { kid: k.kid || '', kty: k.kty, alg: k.alg || '', use: k.use || '', crv: k.crv || '', size, hasX5c: Array.isArray(k.x5c) && k.x5c.length > 0, private: !!(k.d || k.p || k.q || k.dp || k.dq || k.qi), x5t: k['x5t#S256'] || k.x5t || '' }
  })
  rows.forEach((r) => { if (r.kid) seen.set(r.kid, (seen.get(r.kid) || 0) + 1) })
  for (const [kid, n] of seen) if (n > 1) out.push(f('critical', `Two keys share the id "${kid}"`, 'A verifier picks the key by kid, so a duplicate makes the choice ambiguous.', 'Give every key a unique kid.'))
  for (const r of rows) {
    if (r.private) out.push(f('critical', `The key "${r.kid || '(no kid)'}" contains PRIVATE key material`, 'A JWKS must publish only public keys. This one exposes the private part (d, p, q ...) to anyone who reads it.', 'Remove it from the JWKS immediately and rotate the key: it must be treated as compromised.'))
    if (r.kty === 'RSA' && r.size && r.size < 2048) out.push(f('warning', `The key "${r.kid || '(no kid)'}" is only ${r.size} bits`, 'RSA keys should be at least 2048 bits.', ''))
    if (!r.kid && rows.length > 1) out.push(f('warning', 'A key has no kid', 'With several keys, a verifier cannot tell which one signed a token.', 'Add a kid to every key.'))
    if (r.use && r.use !== 'sig' && r.use !== 'enc') out.push(f('warning', `The key "${r.kid}" has an unknown use "${r.use}"`, '', ''))
    if (!['RSA', 'EC', 'OKP', 'oct'].includes(r.kty)) out.push(f('warning', `The key "${r.kid}" has an unknown type "${r.kty}"`, '', ''))
    if (r.kty === 'oct') out.push(f('critical', `The key "${r.kid || '(no kid)'}" is a symmetric (oct) key`, 'A symmetric key is a secret. It must never appear in a public key set.', 'Remove it and rotate the secret.'))
  }
  const sigKeys = rows.filter((r) => r.use !== 'enc' && r.kty !== 'oct')
  if (!sigKeys.length) out.push(f('critical', 'No signing key', 'Every key is marked for encryption (use: enc) or is symmetric.', ''))
  if (token && !token.error) {
    const kid = token.header.kid
    if (!kid) out.push(f('info', 'The token has no kid', rows.length > 1 ? 'With several keys in the set, the verifier has to try each one.' : '', ''))
    else if (!rows.some((r) => r.kid === kid)) out.push(f('critical', `The token's key id "${kid}" is not in this key set`, `The set has: ${rows.map((r) => r.kid || '(none)').join(', ')}. Either the issuer rotated its keys and this is an old or new token, you fetched the wrong provider's keys, or your cached copy is stale.`, 'Fetch the JWKS again (and check your client refreshes it when it meets an unknown kid).'))
    else {
      const k = rows.find((r) => r.kid === kid)
      if (token.header.alg && k.alg && k.alg !== token.header.alg) out.push(f('warning', 'The token\'s algorithm differs from the key\'s', `The token says ${token.header.alg}; the key is for ${k.alg}.`, ''))
      out.push({ severity: 'ok', title: `The token's key id "${kid}" is in this key set`, detail: 'Paste the JWKS into the Verify box on the Inspect page to check the signature itself.' })
    }
  }
  if (!out.some((x) => x.severity === 'critical' || x.severity === 'warning')) out.unshift({ severity: 'ok', title: 'The key set looks fine', detail: `${rows.length} key${rows.length === 1 ? '' : 's'}, all public.` })
  const order = { critical: 0, warning: 1, info: 2, ok: 3 }
  return { keys: rows, checks: out.sort((a, b) => order[a.severity] - order[b.severity]) }
}

/** Compare the sign-in a capture shows with the discovery document: do the endpoints, scopes and PKCE method line up? */
export function compareFlowWithDiscovery(doc, flows) {
  const out = []
  for (const fl of flows) {
    const a = fl.authorize.params
    const here = fl.authorize.entry
    let base
    try { const u = new URL(here.url); base = u.origin + u.pathname } catch { base = here.url }
    if (doc.authorization_endpoint && base.replace(/\/+$/, '') !== String(doc.authorization_endpoint).replace(/\/+$/, '')) out.push(f('warning', 'The app used a different authorization endpoint', `It used ${base}; the document lists ${doc.authorization_endpoint}. The app may be configured for another tenant, environment or an old URL.`, ''))
    if (fl.token) {
      let tb
      try { const u = new URL(fl.token.entry.url); tb = u.origin + u.pathname } catch { tb = fl.token.entry.url }
      if (doc.token_endpoint && tb.replace(/\/+$/, '') !== String(doc.token_endpoint).replace(/\/+$/, '')) out.push(f('warning', 'The app used a different token endpoint', `It used ${tb}; the document lists ${doc.token_endpoint}.`, ''))
    }
    if (doc.scopes_supported) for (const s of fl.scopes) if (!doc.scopes_supported.includes(s) && s !== 'offline_access') out.push(f('info', `The scope "${s}" is not in scopes_supported`, 'Providers often accept scopes they do not list (custom API scopes), so this is only a lead.', ''))
    if (a.code_challenge_method && doc.code_challenge_methods_supported && !doc.code_challenge_methods_supported.includes(a.code_challenge_method)) out.push(f('critical', `The provider does not support PKCE method ${a.code_challenge_method}`, `It supports: ${doc.code_challenge_methods_supported.join(', ')}.`, ''))
    if (a.response_type && doc.response_types_supported && !doc.response_types_supported.includes(a.response_type) && !doc.response_types_supported.includes(a.response_type.split(' ').sort().join(' '))) out.push(f('critical', `The provider does not support response_type=${a.response_type}`, `It supports: ${doc.response_types_supported.join(', ')}.`, 'Use a response type the provider lists (usually "code").'))
    if (fl.token && doc.token_endpoint_auth_methods_supported) {
      const basic = /^basic /i.test(fl.token.entry.reqHeaders.authorization || '')
      const post = !!fl.token.form.client_secret
      const methods = doc.token_endpoint_auth_methods_supported
      if (basic && !methods.includes('client_secret_basic')) out.push(f('critical', 'The client authenticated with Basic, which the provider does not accept', `Accepted: ${methods.join(', ')}.`, 'Send the secret in the body, or as the provider lists.'))
      if (post && !methods.includes('client_secret_post')) out.push(f('critical', 'The client sent the secret in the body, which the provider does not accept', `Accepted: ${methods.join(', ')}.`, 'Use an Authorization: Basic header, or as the provider lists.'))
    }
  }
  if (!out.length) out.push({ severity: 'ok', title: 'The sign-in agrees with the discovery document', detail: 'Endpoints, response type, PKCE method and client authentication are all ones the provider lists.' })
  return out
}
