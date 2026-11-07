// Windows integrated authentication in a capture: the WWW-Authenticate / Authorization "Negotiate" and "NTLM" handshake.
//
// Browsers do this silently, so when it fails the user just sees a login box or a 401. A HAR holds the whole exchange, which is
// enough to say which stage failed and why. Nothing here sees passwords (NTLM and Kerberos never send them) and nothing is verified:
// this reads the messages' structure.
//
// Facts the code relies on:
//   - A Kerberos token inside SPNEGO is an ASN.1 DER blob that contains the OID 1.2.840.113554.1.2.2 (or the MS variant
//     1.2.840.48018.1.2.2). An NTLM token starts with the bytes "NTLMSSP\0", then a 32-bit message type (1, 2 or 3).
//   - "Negotiate" with no data is the server asking the client to start. A 401 with "Negotiate <token>" is the server answering.
//   - A browser that has no ticket falls back to NTLM wrapped in SPNEGO, or shows a prompt.
import { b64ToBytes } from '../formats/binary'

const f = (severity, title, detail, fix) => ({ severity, title, detail, fix })

const KRB5_OIDS = [
  [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x12, 0x01, 0x02, 0x02], // 1.2.840.113554.1.2.2  Kerberos 5
  [0x2a, 0x86, 0x48, 0x82, 0xf7, 0x12, 0x01, 0x02, 0x02], // 1.2.840.48018.1.2.2   Microsoft's legacy Kerberos OID
]
const NTLM_OID = [0x2b, 0x06, 0x01, 0x04, 0x01, 0x82, 0x37, 0x02, 0x02, 0x0a] // 1.3.6.1.4.1.311.2.2.10
const SPNEGO_OID = [0x2b, 0x06, 0x01, 0x05, 0x05, 0x02]
const NTLM_SIG = [0x4e, 0x54, 0x4c, 0x4d, 0x53, 0x53, 0x50, 0x00]

const contains = (hay, needle) => { for (let i = 0; i + needle.length <= hay.length; i++) { let ok = true; for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) { ok = false; break } if (ok) return i } return -1 }
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0

// KRB5 error codes a server may answer with (RFC 4120), the ones that come up with web SSO
const KRB_ERRORS = {
  6: ['KDC_ERR_C_PRINCIPAL_UNKNOWN', 'The KDC does not know this user.'],
  7: ['KDC_ERR_S_PRINCIPAL_UNKNOWN', 'The KDC does not know the service name (SPN) the browser asked for. The SPN is not registered, or is registered on two accounts.'],
  14: ['KDC_ERR_ETYPE_NOSUPP', 'No encryption type both sides support (often AES vs RC4 settings).'],
  18: ['KDC_ERR_CLIENT_REVOKED', 'The account is disabled, locked out or expired.'],
  24: ['KDC_ERR_PREAUTH_FAILED', 'The password was wrong.'],
  25: ['KDC_ERR_PREAUTH_REQUIRED', 'Pre-authentication is needed (normal at the start of a login).'],
  31: ['KRB_AP_ERR_BAD_INTEGRITY', 'The service could not decrypt the ticket: the service account\'s key does not match the one the KDC used. Wrong password on the service account, a duplicate SPN, or a stale keytab.'],
  32: ['KRB_AP_ERR_TKT_EXPIRED', 'The ticket has expired.'],
  37: ['KRB_AP_ERR_SKEW', 'The clocks differ by more than five minutes.'],
  41: ['KRB_AP_ERR_MODIFIED', 'The message was modified in transit or decrypted with the wrong key.'],
  68: ['KDC_ERR_WRONG_REALM', 'The ticket is for a different realm.'],
}

/** Parse the value of a WWW-Authenticate or Authorization header into schemes. [{ scheme, token (base64) | null, params }] */
export function parseAuthHeader(value) {
  const out = []
  const parts = String(value || '').split(/,\s*(?=(?:Negotiate|NTLM|Basic|Bearer|Digest|Kerberos)\b)/i)
  for (const p of parts) {
    const m = /^\s*([A-Za-z]+)\s*(.*)$/.exec(p)
    if (!m) continue
    out.push({ scheme: m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase(), data: m[2].trim() || null })
  }
  return out
}

/** What is inside a Negotiate/NTLM token. Returns { kind: 'kerberos' | 'ntlm' | 'spnego-ntlm' | 'spnego' | 'unknown', ntlmType?, bytes }. */
export function inspectToken(base64) {
  if (!base64) return { kind: 'empty', bytes: 0 }
  let b
  try { b = b64ToBytes(base64.replace(/\s+/g, '')) } catch { return { kind: 'invalid', bytes: 0 } }
  const ntlmAt = contains(b, NTLM_SIG)
  const wrapped = b[0] === 0x60 || b[0] === 0xa0 || b[0] === 0xa1 // GSS-API InitialContextToken, or SPNEGO NegTokenInit/Resp
  if (ntlmAt >= 0) {
    const type = u32(b, ntlmAt + 8)
    return { kind: ntlmAt === 0 ? 'ntlm' : 'spnego-ntlm', ntlmType: type, bytes: b.length }
  }
  if (KRB5_OIDS.some((o) => contains(b, o) >= 0)) {
    const isReq = b[0] === 0x60
    return { kind: 'kerberos', bytes: b.length, size: b.length, apReq: isReq }
  }
  if (wrapped && contains(b, SPNEGO_OID) >= 0) {
    return { kind: 'spnego', bytes: b.length, offersNtlm: contains(b, NTLM_OID) >= 0, offersKerberos: KRB5_OIDS.some((o) => contains(b, o) >= 0) }
  }
  if (b.length > 4 && b[0] === 0x6e) return { kind: 'kerberos-error-or-ap', bytes: b.length }
  return { kind: 'unknown', bytes: b.length }
}

const NTLM_NAMES = { 1: 'NEGOTIATE (client starts)', 2: 'CHALLENGE (server answers)', 3: 'AUTHENTICATE (client proves identity)' }

/**
 * Walk a parsed HAR and describe each host's Negotiate/NTLM exchange. Returns
 * [{ host, steps: [{ entryId, method, path, status, dir: 'server'|'client', scheme, token }], checks }].
 */
export function analyzeWindowsAuth(har) {
  const byHost = new Map()
  for (const e of har.entries) {
    const www = e.resHeaders['www-authenticate']
    const auth = e.reqHeaders.authorization
    const schemesS = www ? parseAuthHeader(www).filter((s) => ['Negotiate', 'Ntlm', 'Kerberos'].includes(s.scheme)) : []
    const schemesC = auth ? parseAuthHeader(auth).filter((s) => ['Negotiate', 'Ntlm', 'Kerberos'].includes(s.scheme)) : []
    if (!schemesS.length && !schemesC.length) continue
    const row = byHost.get(e.host) || { host: e.host, steps: [] }
    for (const s of schemesC) row.steps.push({ entryId: e.id, method: e.method, path: e.path, status: e.status, dir: 'client', scheme: s.scheme, token: inspectToken(s.data), raw: s.data })
    for (const s of schemesS) row.steps.push({ entryId: e.id, method: e.method, path: e.path, status: e.status, dir: 'server', scheme: s.scheme, token: inspectToken(s.data), raw: s.data, offered: parseAuthHeader(www).map((x) => x.scheme) })
    row.steps.sort((a, b) => a.entryId - b.entryId)
    byHost.set(e.host, row)
  }
  return [...byHost.values()].map((row) => ({ ...row, checks: checkExchange(row, har) }))
}

function checkExchange(row, har) {
  const out = []
  const steps = row.steps
  const entries = new Map(har.entries.map((e) => [e.id, e]))
  const clientSteps = steps.filter((s) => s.dir === 'client')
  const first401 = steps.find((s) => s.dir === 'server' && s.status === 401)
  const final = [...new Set(steps.map((s) => s.entryId))].map((id) => entries.get(id)).filter(Boolean)
  const lastEntry = final[final.length - 1]

  if (first401 && !clientSteps.length) {
    out.push(f('critical', 'The server asked for Windows authentication, and the browser never answered', `${row.host} replied 401 with ${first401.offered.join(', ')}, and no request after it carries an Authorization header. The browser decided not to send credentials automatically: it does that only for sites in the Local intranet zone (Edge/Chrome on Windows), or listed in AuthServerAllowlist / network.negotiate-auth.trusted-uris (Chrome/Firefox elsewhere).`, 'Add the site to the browser\'s intranet zone or allowlist (usually by Group Policy), and use the hostname, not an IP address or a CNAME the SPN does not cover.'))
  }
  if (first401 && /^\d+\.\d+\.\d+\.\d+$/.test(row.host.replace(/:\d+$/, ''))) out.push(f('warning', 'The site was reached by IP address', 'Kerberos needs a hostname to build the service name (SPN). With an IP address the browser can only use NTLM, if it signs in at all.', 'Use the DNS name.'))
  // protocol actually used
  const used = new Set(clientSteps.map((s) => (s.token.kind === 'kerberos' ? 'Kerberos' : s.token.kind === 'ntlm' || s.token.kind === 'spnego-ntlm' ? 'NTLM' : s.token.kind === 'empty' ? '' : 'Negotiate')))
  used.delete('')
  if (used.has('Kerberos')) out.push({ severity: 'ok', title: 'The browser sent a Kerberos ticket', detail: `${clientSteps.find((s) => s.token.kind === 'kerberos').token.bytes} bytes. A ticket this large (over about 12 KB) can overflow the HTTP header limit: this one is ${clientSteps.find((s) => s.token.kind === 'kerberos').token.bytes} bytes.` })
  if (used.has('NTLM') && !used.has('Kerberos')) {
    out.push(f('info', 'Signed in with NTLM, not Kerberos', 'NTLM works, but it is older, slower (an extra round trip every connection) and cannot delegate. Browsers fall back to it when they cannot get a Kerberos ticket for the service.', 'For Kerberos: register the SPN (HTTP/hostname) on the service account exactly once, use the hostname that matches it, and check the machine can reach a domain controller.'))
  }
  for (const s of clientSteps) {
    if (s.token.kind === 'kerberos' && s.token.bytes > 12000) out.push(f('critical', `The Kerberos token is ${(s.token.bytes / 1024).toFixed(1)} KB`, 'It is very large, usually because the user belongs to many groups (the ticket carries them all). IIS and many proxies refuse headers over 8 to 16 KB, which shows up as 400 / 413 / 431 or an empty reply.', 'Reduce the user\'s group membership, or raise MaxRequestBytes / the proxy\'s header limit.'))
    else if (s.token.kind === 'kerberos' && s.token.bytes > 8000) out.push(f('warning', `The Kerberos token is ${(s.token.bytes / 1024).toFixed(1)} KB`, 'It is getting close to common header limits (8 KB on some servers).', ''))
  }
  // NTLM message sequence
  const ntlm = steps.filter((s) => s.token.ntlmType)
  if (ntlm.length) {
    const seq = ntlm.map((s) => s.token.ntlmType)
    if (!seq.includes(3) && seq.includes(1)) out.push(f('critical', 'NTLM started but never finished', `Seen: ${seq.map((t) => NTLM_NAMES[t] || t).join(' → ')}. There is no AUTHENTICATE (type 3) message, so the client did not complete the handshake.`, 'Usually the client cannot reach a domain controller, or the connection was closed between the steps. NTLM needs all three messages on the same connection.'))
    // connection affinity: NTLM is per connection
    const conns = new Set(ntlm.map((s) => entries.get(s.entryId)?.connection).filter(Boolean))
    if (conns.size > 1) out.push(f('warning', 'The NTLM messages used different connections', `${conns.size} connections were involved. NTLM authenticates a connection, so the handshake breaks if a load balancer, proxy or HTTP/2 switch changes connection between steps.`, 'Use connection affinity (a single TCP connection per client) through any proxy, or use Kerberos.'))
  }
  // outcome
  if (lastEntry) {
    if (lastEntry.status === 401 && clientSteps.length) {
      const sv = steps.filter((s) => s.dir === 'server').pop()
      const err = sv && sv.token && sv.token.kind !== 'empty' ? ` The server's last answer carried a ${sv.token.kind} token.` : ''
      out.push(f('critical', 'The final response is still 401', `The browser sent credentials (${[...used].join(', ') || 'a token'}) but the server rejected them.${err}`, 'On the server: check the Security event log (event 4625 shows the failure reason) and the web server\'s Failed Request Tracing. Kerberos: the SPN is missing or duplicated, or the service account\'s password does not match the ticket (setspn -X finds duplicates). NTLM: the account is locked, or the client is not allowed to use NTLM.'))
    } else if (lastEntry.status >= 200 && lastEntry.status < 400 && clientSteps.length) {
      out.push({ severity: 'ok', title: 'The Windows sign-in succeeded', detail: `Final response: ${lastEntry.status}.` })
    }
  }
  const offered = new Set(steps.filter((s) => s.dir === 'server').flatMap((s) => s.offered))
  if (offered.has('Negotiate') && offered.has('Ntlm')) out.push(f('info', 'The server offers both Negotiate and NTLM', 'Normal for IIS. "Negotiate" tries Kerberos first and falls back to NTLM inside SPNEGO; the separate NTLM offer is for clients that do not speak Negotiate.', ''))
  if (!out.length) out.push({ severity: 'info', title: 'A Windows authentication exchange was found', detail: 'Nothing obviously wrong. See the steps below.' })
  const order = { critical: 0, warning: 1, info: 2, ok: 3 }
  return out.sort((a, b) => order[a.severity] - order[b.severity])
}

/** Look a Kerberos error code up (from a pasted KRB-ERROR or a log line). */
export function lookupKerberosError(code) {
  const n = Number(code)
  const hit = KRB_ERRORS[n]
  return hit ? { code: n, name: hit[0], meaning: hit[1] } : null
}
export const KERBEROS_ERRORS = Object.entries(KRB_ERRORS).map(([code, [name, meaning]]) => ({ code: Number(code), name, meaning }))
export { NTLM_NAMES }
