// Certificate inspection: read one or more pasted certificates, put them in chain order, and say what is wrong.
// It checks structure and validity (dates, names, key strength, usage, and that each certificate was issued by the next).
// It does NOT check revocation, and it does not know which roots your system trusts, so "is the chain trusted" is not answered.
import { fingerprints, parseCertificate } from '../saml/x509'
import { b64ToBytes } from '../saml/binary'

const f = (severity, title, detail, fix) => ({ severity, title, detail, fix })
const DAY = 86400e3
/** The name people recognise a certificate by: its Common Name, else its first name part. */
export const shortName = (c) => { const m = /CN=([^,]+)/.exec(c.subject || ''); return m ? m[1].trim() : (c.subject || '').split(',')[0] }

/** Pull certificates out of pasted text (PEM blocks, or raw base64 of one certificate). Returns [{ base64, ...parsed }] and notes. */
export function readCertificates(text) {
  const input = String(text || '')
  const notes = []
  const blocks = [...input.matchAll(/-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----/g)]
  const out = []
  if (blocks.length) {
    for (const b of blocks) {
      if (/PRIVATE KEY/.test(b[1])) { notes.push('A PRIVATE KEY block was ignored. Never paste private keys; only certificates are needed.'); continue }
      if (b[1] !== 'CERTIFICATE' && b[1] !== 'TRUSTED CERTIFICATE' && b[1] !== 'X509 CERTIFICATE') { notes.push(`A "${b[1]}" block was ignored: only certificates are read.`); continue }
      const base64 = b[2].replace(/\s+/g, '')
      out.push({ base64, ...parseCertificate(base64) })
    }
  } else if (input.trim()) {
    const raw = input.replace(/\s+/g, '')
    if (/^[A-Za-z0-9+/=]{100,}$/.test(raw)) { try { b64ToBytes(raw); out.push({ base64: raw, ...parseCertificate(raw) }) } catch { notes.push('That is not valid base64.') } }
    else notes.push('Paste a certificate: PEM text starting with -----BEGIN CERTIFICATE-----, or the base64 body.')
  }
  return { certs: out, notes }
}

const bytesEq = (a, b) => !!a && !!b && a.length === b.length && a.every((x, i) => x === b[i])

/** Does `child` look issued by `parent`? Names must match; key identifiers must match when both are present. (Not a signature check.) */
export function issuedBy(child, parent) {
  if (!bytesEq(child.issuerDer, parent.subjectDer)) return false
  if (child.ext && parent.ext && child.ext.aki && parent.ext.ski && child.ext.aki !== parent.ext.ski) return false
  return true
}

/** Arrange certificates as leaf -> ... -> root where they link. Returns { chain: [certs in order], extra: [certs not in the chain] }. */
export function orderChain(certs) {
  const ok = certs.filter((c) => !c.error)
  if (!ok.length) return { chain: [], extra: [] }
  // the leaf is a certificate that issued nobody else in the set
  const isParentOfSomeone = (c) => ok.some((o) => o !== c && !o.selfSigned && issuedBy(o, c))
  const leaves = ok.filter((c) => !isParentOfSomeone(c))
  const start = leaves.find((c) => !(c.ext && c.ext.basic && c.ext.basic.ca)) || leaves[0] || ok[0]
  const chain = [start]
  while (true) {
    const last = chain[chain.length - 1]
    if (last.selfSigned) break
    const next = ok.find((o) => !chain.includes(o) && issuedBy(last, o))
    if (!next) break
    chain.push(next)
  }
  return { chain, extra: ok.filter((c) => !chain.includes(c)) }
}

/** Does a hostname match the certificate? Wildcards match exactly one label, only as the left-most label. Falls back to CN only when there is no SAN. */
export function hostMatches(cert, host) {
  const h = String(host || '').trim().toLowerCase().replace(/\.$/, '')
  if (!h) return null
  const names = cert.ext && cert.ext.san.length ? cert.ext.san.filter((s) => s.type === 'DNS' || s.type === 'IP').map((s) => s.value.toLowerCase()) : []
  const viaCn = !names.length
  if (viaCn) { const m = /CN=([^,]+)/.exec(cert.subject); if (m) names.push(m[1].trim().toLowerCase()) }
  const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(':')
  for (const n of names) {
    if (n === h) return { ok: true, via: n, viaCn }
    if (!isIp && n.startsWith('*.') && h.split('.').length === n.split('.').length && h.split('.').slice(1).join('.') === n.slice(2) && h.split('.')[0] !== '') return { ok: true, via: n, viaCn }
  }
  return { ok: false, names, viaCn }
}

const ago = (ms) => { const d = Math.round(Math.abs(ms) / DAY); return d < 1 ? 'less than a day' : d === 1 ? '1 day' : `${d} days` }
const day = (t) => new Date(t).toISOString().slice(0, 10)

/** Findings for one certificate. `role`: 'leaf' | 'intermediate' | 'root'. `host` is optional. */
export function checkCertificate(c, { now = Date.now(), role = 'leaf', host = '' } = {}) {
  const out = []
  if (c.error) return [f('critical', 'The certificate could not be read', c.error, '')]
  if (c.notAfter <= now) out.push(f('critical', 'Expired', `It expired on ${day(c.notAfter)}, ${ago(now - c.notAfter)} ago.`, 'Renew it and deploy the new one everywhere the old one is used.'))
  else if (c.notAfter - now < 14 * DAY) out.push(f('critical', 'Expires within 14 days', `It expires on ${day(c.notAfter)} (in ${ago(c.notAfter - now)}).`, 'Renew it now.'))
  else if (c.notAfter - now < 30 * DAY) out.push(f('warning', 'Expires within 30 days', `It expires on ${day(c.notAfter)} (in ${ago(c.notAfter - now)}).`, 'Schedule the renewal.'))
  if (c.notBefore > now) out.push(f('critical', 'Not valid yet', `It becomes valid on ${day(c.notBefore)}, in ${ago(c.notBefore - now)}. Usually a clock that is behind on this machine or the other one.`, 'Check the system clock, or wait.'))
  const life = (c.notAfter - c.notBefore) / DAY
  if (role === 'leaf' && life > 398 && !c.selfSigned) out.push(f('warning', `Valid for ${Math.round(life)} days`, 'Browsers refuse publicly-trusted TLS certificates valid for more than 398 days (and the limit is shrinking). A private CA may be exempt, but Safari and Chrome apply the limit to many private chains too.', 'Issue shorter-lived certificates.'))
  if (c.key.algorithm === 'RSA' && c.key.bits < 2048) out.push(f('critical', `Weak key: ${c.key.bits}-bit RSA`, 'Keys under 2048 bits are rejected by modern software.', 'Reissue with at least 2048 bits (3072 is better).'))
  else if (c.key.algorithm === 'EC' && c.key.bits && c.key.bits < 256) out.push(f('warning', `Weak curve: ${c.key.curve}`, '', ''))
  if (/md5|md2/i.test(c.signatureAlgorithm)) out.push(f('critical', `Signed with ${c.signatureAlgorithm}`, 'MD5 signatures can be forged.', 'Reissue with SHA-256 or better.'))
  else if (/sha1/i.test(c.signatureAlgorithm) && !c.selfSigned) out.push(f('critical', 'Signed with SHA-1', 'Browsers and most TLS stacks reject certificates whose signature uses SHA-1.', 'Reissue; the CA must sign with SHA-256 or better.'))
  else if (/sha1/i.test(c.signatureAlgorithm)) out.push(f('info', 'Self-signed with SHA-1', 'For a self-signed SAML certificate the SHA-1 signature of the certificate itself does not matter for message signing, but a newer one is tidier.', ''))
  const e = c.ext
  if (e) {
    if (role === 'leaf') {
      if (e.basic && e.basic.ca) out.push(f('warning', 'A leaf that is marked as a CA', 'The certificate says it can issue other certificates.', ''))
      if (!e.san.length) out.push(f('warning', 'No Subject Alternative Name', 'Browsers and modern TLS clients ignore the Common Name and need names in the SAN. Without it, a hostname check fails with "name mismatch".', 'Reissue with a SAN. (For a SAML signing certificate, this does not matter.)'))
      if (e.extKeyUsage.length && !e.extKeyUsage.includes('serverAuth') && !e.extKeyUsage.includes('anyExtendedKeyUsage') && host) out.push(f('critical', 'Not allowed to authenticate a server', `Extended key usage is ${e.extKeyUsage.join(', ')}, without serverAuth.`, ''))
      if (e.keyUsage.length && !e.keyUsage.includes('digitalSignature') && !e.keyUsage.includes('keyEncipherment') && !e.keyUsage.includes('keyAgreement')) out.push(f('warning', `Key usage is only ${e.keyUsage.join(', ')}`, 'It does not allow signing or key exchange, which TLS needs.', ''))
    } else {
      if (e.basic && !e.basic.ca) out.push(f('critical', `A ${role} certificate that is not marked as a CA`, 'basicConstraints says CA:FALSE, so it cannot issue certificates and a validator rejects any chain through it.', 'Reissue the CA certificate with CA:TRUE.'))
      if (!e.basic) out.push(f('warning', `A ${role} certificate with no basicConstraints`, 'Without it, strict validators treat it as not a CA.', ''))
      if (e.keyUsage.length && !e.keyUsage.includes('keyCertSign')) out.push(f('critical', `A ${role} certificate that cannot sign certificates`, `Key usage is ${e.keyUsage.join(', ')}, without keyCertSign.`, ''))
    }
  }
  if (host) {
    const m = hostMatches(c, host)
    if (m && !m.ok) out.push(f('critical', `Does not match "${host}"`, `It is valid for ${m.names.length ? m.names.join(', ') : '(no names)'}${m.viaCn ? ' (taken from the Common Name, because there is no SAN)' : ''}. A wildcard covers exactly one level: *.example.test matches a.example.test, not a.b.example.test or example.test itself.`, 'Reissue with the name, or use the right hostname.'))
    else if (m && m.ok && m.viaCn) out.push(f('warning', `Matches "${host}" only by Common Name`, 'Modern clients ignore the Common Name and need a SAN.', ''))
    else if (m && m.ok) out.push({ severity: 'ok', title: `Matches "${host}"`, detail: `Through ${m.via}.` })
  }
  if (!out.some((x) => x.severity === 'critical' || x.severity === 'warning')) out.push({ severity: 'ok', title: 'No problems found', detail: 'Dates, key strength and usage are in order.' })
  const order = { critical: 0, warning: 1, info: 2, ok: 3 }
  return out.sort((a, b) => order[a.severity] - order[b.severity])
}

/** Findings about the chain as a whole. */
export function checkChain(chain, extra, { now = Date.now() } = {}) {
  const out = []
  if (!chain.length) return out
  const top = chain[chain.length - 1]
  if (chain.length === 1 && !top.selfSigned) out.push(f('warning', 'Only the certificate itself was pasted', `Issued by ${top.issuer}. Servers should send the intermediate certificate(s) too; clients that do not already have them fail with "unable to get local issuer certificate" or "unknown authority".`, 'Paste the rest of the chain here to check it, and configure the server to send the full chain.'))
  else if (!top.selfSigned) out.push(f('warning', 'The chain stops before a root', `The last certificate was issued by ${top.issuer}, which was not pasted. That is normal (servers should not send the root), but the client must already trust that issuer.`, ''))
  else if (chain.length > 1) out.push({ severity: 'ok', title: 'The chain ends in a self-signed root', detail: `${chain.map(shortName).join(' → ')}` })
  // path length constraints
  chain.forEach((c, i) => {
    const pl = c.ext && c.ext.basic && c.ext.basic.ca ? c.ext.basic.pathLen : null
    if (pl != null) {
      const below = chain.slice(0, i).filter((x) => x !== chain[0] && x.ext && x.ext.basic && x.ext.basic.ca).length
      if (below > pl) out.push(f('critical', `${shortName(c)} allows ${pl} intermediate CA(s) below it, but there are ${below}`, 'The path length constraint is violated, and a validator rejects the chain.', ''))
    }
  })
  // validity nesting: a child valid beyond its issuer
  for (let i = 0; i < chain.length - 1; i++) {
    if (chain[i].notAfter > chain[i + 1].notAfter) out.push(f('warning', `${shortName(chain[i])} outlives its issuer`, `It is valid until ${day(chain[i].notAfter)}, but ${shortName(chain[i + 1])} expires ${day(chain[i + 1].notAfter)}. After that date it stops validating, even though its own date has not passed.`, ''))
    if (chain[i + 1].notAfter <= now) out.push(f('critical', `${shortName(chain[i + 1])} (the issuer) has expired`, `Everything below it stops validating, whatever its own date.`, ''))
  }
  if (extra.length) out.push(f('info', `${extra.length} pasted certificate${extra.length === 1 ? ' is' : 's are'} not part of this chain`, extra.map((c) => c.subject).join('; '), 'They are shown below, checked on their own. A certificate listed after the root, or one for another host, is a common mistake in a server\'s chain file.'))
  return out
}

export { fingerprints }
