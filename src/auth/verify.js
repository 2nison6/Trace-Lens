// Verifying a JWT signature in the browser with Web Crypto. No network: the key is whatever the user pastes (a public key, a
// certificate, a JWK or a JWKS, or for HS256/384/512 the shared secret).
//
// Two safety rules, because the classic JWT attacks are about this exact step:
//   - the algorithm is NEVER taken on trust from a key's type: a token that says HS256 is only checked against a pasted SECRET,
//     never against a public key (using a public key as an HMAC secret is the "algorithm confusion" attack);
//   - "alg: none" is never verified.
import { b64urlToBytes } from './jwt'
import { parseCertificate } from '../formats/x509'

const HASH = { 256: 'SHA-256', 384: 'SHA-384', 512: 'SHA-512' }
const CURVE = { ES256: 'P-256', ES384: 'P-384', ES512: 'P-521' }
const enc = new TextEncoder()

const pemBlocks = (text) => [...String(text).matchAll(/-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----/g)].map((m) => ({ type: m[1], der: pemBytes(m[2]) }))
function pemBytes(b64) {
  const bin = atob(b64.replace(/\s+/g, ''))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

/** What was pasted: 'jwks' | 'jwk' | 'pem' | 'secret' | 'empty', with the parsed form. */
export function classifyKeyInput(input) {
  const text = String(input || '').trim()
  if (!text) return { kind: 'empty' }
  if (/^[{[]/.test(text)) {
    let json
    try { json = JSON.parse(text) } catch { return { kind: 'error', error: 'That looks like JSON, but it does not parse.' } }
    if (json && Array.isArray(json.keys)) return { kind: 'jwks', keys: json.keys }
    if (json && typeof json === 'object' && json.kty) return { kind: 'jwk', keys: [json] }
    return { kind: 'error', error: 'That JSON is neither a JWK (it needs "kty") nor a JWKS (it needs "keys").' }
  }
  if (/-----BEGIN /.test(text)) {
    const blocks = pemBlocks(text)
    if (!blocks.length) return { kind: 'error', error: 'The PEM block is incomplete.' }
    if (blocks.some((b) => /PRIVATE KEY/.test(b.type))) return { kind: 'error', error: 'That is a PRIVATE key. Do not paste private keys anywhere: verification needs only the public key or certificate. (Nothing was sent, but remove it from this box.)' }
    return { kind: 'pem', blocks }
  }
  return { kind: 'secret', secret: text }
}

const spkiOfBlock = (b) => {
  if (b.type === 'PUBLIC KEY') return { spki: b.der, from: 'public key' }
  if (b.type === 'CERTIFICATE') { const c = parseCertificate(btoa(String.fromCharCode(...b.der))); return c.error ? { error: c.error } : { spki: c.spki, from: `certificate ${c.subject}`, cert: c } }
  return { error: `A "${b.type}" block cannot be used here. Paste a PUBLIC KEY or a CERTIFICATE.` }
}

/** The keys in a JWKS that could have signed a token with this header, best match first. */
export function candidateKeys(keys, header) {
  const alg = header.alg || ''
  const kty = alg.startsWith('ES') ? 'EC' : alg.startsWith('RS') || alg.startsWith('PS') ? 'RSA' : alg === 'EdDSA' ? 'OKP' : alg.startsWith('HS') ? 'oct' : ''
  const usable = keys.filter((k) => (!kty || k.kty === kty) && (!k.use || k.use === 'sig') && (!k.alg || k.alg === alg))
  if (header.kid) {
    const byKid = usable.filter((k) => k.kid === header.kid)
    if (byKid.length) return { keys: byKid, matchedKid: true }
    return { keys: [], matchedKid: false, kidMissing: true, available: keys.map((k) => k.kid).filter(Boolean) }
  }
  return { keys: usable, matchedKid: false }
}

function algParams(alg) {
  const m = /^(RS|PS|ES|HS)(256|384|512)$/.exec(alg)
  if (!m) return null
  const hash = HASH[m[2]]
  if (m[1] === 'RS') return { import: { name: 'RSASSA-PKCS1-v1_5', hash }, verify: { name: 'RSASSA-PKCS1-v1_5' } }
  if (m[1] === 'PS') return { import: { name: 'RSA-PSS', hash }, verify: { name: 'RSA-PSS', saltLength: Number(m[2]) / 8 } }
  if (m[1] === 'ES') return { import: { name: 'ECDSA', namedCurve: CURVE[alg] }, verify: { name: 'ECDSA', hash } }
  return { import: { name: 'HMAC', hash }, verify: { name: 'HMAC' } }
}

/**
 * Verify a decoded token (from decodeJwt) against pasted key material.
 * Returns { status, title, detail, key? } with status: 'valid' | 'invalid' | 'no-key' | 'unsupported' | 'error' | 'refused'.
 */
export async function verifyJwt(dec, keyInput) {
  if (!dec || dec.error) return { status: 'error', title: 'No token to verify', detail: '' }
  const alg = String(dec.header.alg || '')
  if (!alg || alg.toLowerCase() === 'none') return { status: 'refused', title: 'An unsigned token cannot be verified', detail: 'alg is "none", so there is no signature. No service should accept this token.' }
  const params = algParams(alg)
  if (!params) return { status: 'unsupported', title: `${alg} is not checked here`, detail: 'This tool checks RS256/384/512, PS256/384/512, ES256/384/512 and HS256/384/512.' }
  if (!dec.signature) return { status: 'invalid', title: 'The token has no signature', detail: 'The third part is empty.' }
  if (!globalThis.crypto || !globalThis.crypto.subtle) return { status: 'error', title: 'Web Crypto is not available', detail: 'This browser (or this page, if it is not served over HTTPS) cannot do signature checks.' }

  const k = classifyKeyInput(keyInput)
  if (k.kind === 'empty') return { status: 'no-key', title: 'Paste a key to verify', detail: '' }
  if (k.kind === 'error') return { status: 'error', title: 'The key could not be read', detail: k.error }
  const signingInput = enc.encode(`${dec.parts[0]}.${dec.parts[1]}`)
  let sig
  try { sig = b64urlToBytes(dec.signature) } catch { return { status: 'invalid', title: 'The signature is not valid base64url', detail: '' } }

  const isHmac = alg.startsWith('HS')
  if (isHmac) {
    if (k.kind !== 'secret') return { status: 'refused', title: 'This token uses a shared secret (HMAC)', detail: `${alg} tokens are checked with the shared secret as text, not with a public key or certificate. Checking one against a public key is the "algorithm confusion" attack, so it is refused. Paste the secret.` }
    try {
      const key = await crypto.subtle.importKey('raw', enc.encode(k.secret), params.import, false, ['verify'])
      const ok = await crypto.subtle.verify(params.verify, key, sig, signingInput)
      return ok ? { status: 'valid', title: 'The signature is valid for this secret', detail: 'The token was signed with exactly this secret and has not been changed since.' } : { status: 'invalid', title: 'The signature does NOT match this secret', detail: 'Either the secret is not the one used to sign it, the token was altered, or the secret has stray spaces or a different encoding (a base64 secret must be pasted as the decoded text the signer used).' }
    } catch (e) { return { status: 'error', title: 'The secret could not be used', detail: e.message } }
  }
  if (k.kind === 'secret') return { status: 'error', title: 'That is not a public key', detail: `${alg} needs a public key, a certificate, a JWK or a JWKS. What you pasted looks like a plain secret.` }

  // gather candidate keys as { spki | jwk, label }
  const cands = []
  let note = ''
  if (k.kind === 'pem') {
    for (const b of k.blocks) { const r = spkiOfBlock(b); if (r.error) { note = r.error; continue } cands.push({ spki: r.spki, label: r.from, cert: r.cert }) }
  } else {
    const c = candidateKeys(k.keys, dec.header)
    if (c.kidMissing) return { status: 'no-key', title: `No key with kid "${dec.header.kid}"`, detail: `The key set has ${c.available.length ? `these key ids: ${c.available.join(', ')}` : 'no key ids'}. The issuer may have rotated its keys: fetch its current JWKS.` }
    for (const j of c.keys) cands.push({ jwk: j, label: `key ${j.kid || '(no kid)'}` })
    if (!cands.length) return { status: 'no-key', title: 'No key in the set fits this token', detail: `Looked for a ${alg} signing key${dec.header.kid ? '' : ' (the token has no kid)'}.` }
  }
  if (!cands.length) return { status: 'error', title: 'No usable key', detail: note || 'Nothing in what you pasted is a public key or a certificate.' }

  let lastErr = ''
  for (const c of cands) {
    try {
      const key = c.spki
        ? await crypto.subtle.importKey('spki', c.spki, params.import, false, ['verify'])
        : await crypto.subtle.importKey('jwk', { ...c.jwk, alg: undefined, use: undefined, key_ops: undefined, ext: true }, params.import, false, ['verify'])
      const ok = await crypto.subtle.verify(params.verify, key, sig, signingInput)
      if (ok) return { status: 'valid', title: `The signature is valid (${c.label})`, detail: 'The token was signed by the private key that matches this public key and has not been changed since. This says nothing about whether the claims are acceptable: check issuer, audience and expiry too.', key: c }
    } catch (e) { lastErr = e.message }
  }
  if (lastErr && cands.length === 1) return { status: 'error', title: 'This key cannot verify this algorithm', detail: `${lastErr}. The key type must match ${alg} (RSA for RS/PS, EC on ${CURVE[alg] || 'the right curve'} for ES).` }
  return { status: 'invalid', title: `The signature does NOT match ${cands.length === 1 ? 'this key' : `any of the ${cands.length} keys`}`, detail: 'Either the token was signed with a different key (check kid and the issuer\'s current keys), or it was altered after signing.' }
}

/** A readable table of the keys in a JWKS: [{ kid, kty, alg, use, size }]. */
export function describeKeys(input) {
  const k = classifyKeyInput(input)
  if (k.kind !== 'jwks' && k.kind !== 'jwk') return []
  return k.keys.map((j) => ({
    kid: j.kid || '', kty: j.kty, alg: j.alg || '', use: j.use || '',
    size: j.kty === 'RSA' && j.n ? b64urlToBytes(j.n).length * 8 - (b64urlToBytes(j.n)[0] === 0 ? 8 : 0) : j.crv || '',
    hasX5c: Array.isArray(j.x5c) && j.x5c.length > 0,
    private: !!(j.d || j.p || j.q),
  }))
}
