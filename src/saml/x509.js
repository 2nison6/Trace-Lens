// A small X.509 certificate reader, enough to answer the questions that come up when a SAML sign-in breaks: whose certificate
// is it, is it still valid, how strong is its key, what is its fingerprint. It does not validate chains or signatures.
import { b64ToBytes } from './binary'

const NAME_OIDS = { '2.5.4.3': 'CN', '2.5.4.10': 'O', '2.5.4.11': 'OU', '2.5.4.6': 'C', '2.5.4.7': 'L', '2.5.4.8': 'ST', '1.2.840.113549.1.9.1': 'E' }
const SIG_OIDS = {
  '1.2.840.113549.1.1.5': 'sha1WithRSAEncryption', '1.2.840.113549.1.1.11': 'sha256WithRSAEncryption',
  '1.2.840.113549.1.1.12': 'sha384WithRSAEncryption', '1.2.840.113549.1.1.13': 'sha512WithRSAEncryption',
  '1.2.840.10045.4.3.2': 'ecdsa-with-SHA256', '1.2.840.10045.4.3.3': 'ecdsa-with-SHA384', '1.2.840.10045.4.3.4': 'ecdsa-with-SHA512',
}
const CURVES = { '1.2.840.10045.3.1.7': ['P-256', 256], '1.3.132.0.34': ['P-384', 384], '1.3.132.0.35': ['P-521', 521] }

// One ASN.1 element: its tag, where its content starts and ends. Every length is checked against the buffer.
function tlv(b, p) {
  if (p + 2 > b.length) throw new Error('truncated certificate')
  const tag = b[p]
  let len = b[p + 1]
  let q = p + 2
  if (len & 0x80) {
    const n = len & 0x7f
    if (n === 0 || n > 4 || q + n > b.length) throw new Error('unsupported length')
    len = 0
    for (let i = 0; i < n; i++) len = len * 256 + b[q++]
  }
  if (q + len > b.length) throw new Error('truncated certificate')
  return { tag, start: q, end: q + len }
}

function oid(b, t) {
  const parts = []
  let v = 0
  for (let i = t.start; i < t.end; i++) {
    v = v * 128 + (b[i] & 0x7f)
    if (!(b[i] & 0x80)) { parts.push(v); v = 0 }
  }
  const first = parts.shift()
  return [Math.floor(first / 40), first % 40, ...parts].join('.')
}

function str(b, t) {
  const bytes = b.subarray(t.start, t.end)
  if (t.tag === 0x1e) return new TextDecoder('utf-16be').decode(bytes) // BMPString
  return new TextDecoder('utf-8').decode(bytes)
}

function name(b, t) {
  const out = []
  for (let p = t.start; p < t.end;) {
    const set = tlv(b, p)
    const seq = tlv(b, set.start)
    const o = tlv(b, seq.start)
    const v = tlv(b, o.end)
    const key = oid(b, o)
    out.push(`${NAME_OIDS[key] || key}=${str(b, v)}`)
    p = set.end
  }
  return out.reverse().join(', ') // most specific part first, as people read it
}

function when(b, t) {
  const s = new TextDecoder().decode(b.subarray(t.start, t.end))
  const m = t.tag === 0x17 ? /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?Z$/.exec(s) : /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?Z$/.exec(s)
  if (!m) throw new Error('unreadable date')
  const year = t.tag === 0x17 ? (Number(m[1]) >= 50 ? 1900 : 2000) + Number(m[1]) : Number(m[1])
  return Date.UTC(year, Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] || 0))
}

function keyInfo(b, spki) {
  const alg = tlv(b, spki.start)
  const algOid = oid(b, tlv(b, alg.start))
  const bits = tlv(b, alg.end)
  if (algOid === '1.2.840.113549.1.1.1') {
    const inner = tlv(b, bits.start + 1) // skip the "unused bits" byte of the BIT STRING
    const mod = tlv(b, inner.start)
    let s = mod.start
    while (s < mod.end - 1 && b[s] === 0) s++
    return { algorithm: 'RSA', bits: (mod.end - s - 1) * 8 + (32 - Math.clz32(b[s])) }
  }
  if (algOid === '1.2.840.10045.2.1') {
    const curve = CURVES[oid(b, tlv(b, tlv(b, alg.start).end))]
    return { algorithm: 'EC', bits: curve ? curve[1] : 0, curve: curve ? curve[0] : '' }
  }
  return { algorithm: algOid, bits: 0 }
}


// ---- extensions (RFC 5280, section 4.2). Only the ones that matter when a certificate is rejected.
const EKU = { '1.3.6.1.5.5.7.3.1': 'serverAuth', '1.3.6.1.5.5.7.3.2': 'clientAuth', '1.3.6.1.5.5.7.3.3': 'codeSigning', '1.3.6.1.5.5.7.3.4': 'emailProtection', '1.3.6.1.5.5.7.3.8': 'timeStamping', '1.3.6.1.5.5.7.3.9': 'OCSPSigning', '2.5.29.37.0': 'anyExtendedKeyUsage' }
const KU = ['digitalSignature', 'nonRepudiation', 'keyEncipherment', 'dataEncipherment', 'keyAgreement', 'keyCertSign', 'cRLSign', 'encipherOnly', 'decipherOnly']

function generalNames(b, seq) {
  const out = []
  for (let p = seq.start; p < seq.end;) {
    const n = tlv(b, p)
    const raw = b.subarray(n.start, n.end)
    const s = () => new TextDecoder().decode(raw)
    if (n.tag === 0x82) out.push({ type: 'DNS', value: s() })
    else if (n.tag === 0x81) out.push({ type: 'email', value: s() })
    else if (n.tag === 0x86) out.push({ type: 'URI', value: s() })
    else if (n.tag === 0x87) out.push({ type: 'IP', value: raw.length === 4 ? [...raw].join('.') : [...raw].reduce((a, x, i) => a + (i % 2 ? '' : ':') + x.toString(16).padStart(2, '0'), '').slice(1) })
    else out.push({ type: `other(${n.tag & 0x1f})`, value: '' })
    p = n.end
  }
  return out
}

function readExtensions(der, tbsEnd, afterSpki) {
  const out = { san: [], basic: null, keyUsage: [], extKeyUsage: [], ski: '', aki: '', critical: {} }
  let p = afterSpki
  while (p < tbsEnd) {
    const n = tlv(der, p)
    if (n.tag === 0xa3) { // [3] extensions
      const list = tlv(der, n.start)
      for (let q = list.start; q < list.end;) {
        const ext = tlv(der, q)
        const o = tlv(der, ext.start)
        const id = oid(der, o)
        let r = tlv(der, o.end)
        let critical = false
        if (r.tag === 0x01) { critical = der[r.start] !== 0; r = tlv(der, r.end) }
        const val = tlv(der, r.start) // inside the OCTET STRING
        out.critical[id] = critical
        if (id === '2.5.29.17') out.san = generalNames(der, val)
        else if (id === '2.5.29.19') {
          let isCa = false
          let pathLen = null
          for (let x = val.start; x < val.end;) { const e = tlv(der, x); if (e.tag === 0x01) isCa = der[e.start] !== 0; else if (e.tag === 0x02) pathLen = der[e.start]; x = e.end }
          out.basic = { ca: isCa, pathLen }
        } else if (id === '2.5.29.15') {
          const bits = der.subarray(val.start + 1, val.end) // skip the unused-bits byte
          out.keyUsage = KU.filter((_, i) => bits[i >> 3] & (0x80 >> (i & 7)))
        } else if (id === '2.5.29.37') {
          for (let x = val.start; x < val.end;) { const e = tlv(der, x); out.extKeyUsage.push(EKU[oid(der, e)] || oid(der, e)); x = e.end }
        } else if (id === '2.5.29.14') out.ski = hex(der.subarray(val.start, val.end))
        else if (id === '2.5.29.35') { for (let x = val.start; x < val.end;) { const e = tlv(der, x); if (e.tag === 0x80) out.aki = hex(der.subarray(e.start, e.end)); x = e.end } }
        q = ext.end
      }
    }
    p = n.end
  }
  return out
}

const hex = (bytes) => [...bytes].map((x) => x.toString(16).padStart(2, '0').toUpperCase()).join(':')

/** Read a certificate given as base64 (the content of <ds:X509Certificate>). Returns { error } when it cannot be read. */
export function parseCertificate(base64) {
  try {
    const der = b64ToBytes(base64)
    const cert = tlv(der, 0)
    const tbs = tlv(der, cert.start)
    let t = tlv(der, tbs.start)
    if (t.tag === 0xa0) t = tlv(der, t.end) // optional version
    // DER writes an integer with a leading 00 byte when its top bit is set (to keep it positive); that byte is not part of the number
    let sStart = t.start
    while (sStart < t.end - 1 && der[sStart] === 0) sStart++
    const serial = hex(der.subarray(sStart, t.end))
    const sigAlg = tlv(der, t.end)
    const sigOid = oid(der, tlv(der, sigAlg.start))
    const issuer = tlv(der, sigAlg.end)
    const validity = tlv(der, issuer.end)
    const nb = tlv(der, validity.start)
    const na = tlv(der, nb.end)
    const subject = tlv(der, validity.end)
    const spki = tlv(der, subject.end)
    const same = issuer.end - issuer.start === subject.end - subject.start && der.subarray(issuer.start, issuer.end).every((x, i) => x === der[subject.start + i])
    return {
      der,
      subject: name(der, subject),
      issuer: name(der, issuer),
      notBefore: when(der, nb),
      notAfter: when(der, na),
      serial,
      signatureAlgorithm: SIG_OIDS[sigOid] || sigOid,
      selfSigned: same,
      spki: der.subarray(subject.end, spki.end), // the whole SubjectPublicKeyInfo, ready for crypto.subtle.importKey('spki', ...)
      key: keyInfo(der, spki),
      ext: (() => { try { return readExtensions(der, tbs.end, spki.end) } catch { return null } })(),
      subjectDer: der.subarray(validity.end, subject.end),
      issuerDer: der.subarray(sigAlg.end, issuer.end),
    }
  } catch (e) {
    return { error: `The certificate could not be read (${e.message}).` }
  }
}

/** SHA-256 and SHA-1 fingerprints, "AA:BB:..." (SAML tools and IdP consoles show either). Null where Web Crypto is not available. */
export async function fingerprints(der) {
  const subtle = globalThis.crypto && globalThis.crypto.subtle
  if (!subtle) return null
  const [s256, s1] = await Promise.all([subtle.digest('SHA-256', der), subtle.digest('SHA-1', der)])
  return { sha256: hex(new Uint8Array(s256)), sha1: hex(new Uint8Array(s1)) }
}
