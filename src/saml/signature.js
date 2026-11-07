// Verifying an XML signature on a SAML message (XML-DSig, enveloped, RSA or ECDSA), in the browser, against a certificate or
// public key the user pastes. No network.
//
// What "valid" means here, and no more: the SignatureValue is a correct signature, by the pasted key, over the canonical form of
// the SignedInfo, AND the digest in the Reference matches the canonical form of the element it points to. Both halves matter:
// the first proves SignedInfo was signed, the second proves the signed digest is of the content you are looking at.
//
// Defences built in (XML signature wrapping is the classic attack on SAML):
//   - the Reference must point at the element that carries the signature (an enveloped signature), or the check fails;
//   - the Reference URI must be "#<ID>" of an element in THIS document, and the ID must be unique: two elements with the same
//     ID are refused;
//   - only the enveloped-signature and exclusive-c14n transforms are accepted; anything else (XPath, XSLT) is refused;
//   - SHA-1 and MD5-style algorithms are reported as weak; unknown algorithms are refused, never guessed.
//
// It does NOT decide whether the message should be TRUSTED: that also needs the key to be the identity provider's real key. The
// result says which key it used so a person can compare it with the IdP's metadata.
import { exclusiveC14n } from './c14n'
import { NS, attr, child, children, parseXml } from './xml'
import { b64ToBytes } from './binary'
import { parseCertificate } from './x509'

const ALGS = {
  sig: {
    'http://www.w3.org/2000/09/xmldsig#rsa-sha1': { kind: 'RSA', hash: 'SHA-1', weak: true },
    'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256': { kind: 'RSA', hash: 'SHA-256' },
    'http://www.w3.org/2001/04/xmldsig-more#rsa-sha384': { kind: 'RSA', hash: 'SHA-384' },
    'http://www.w3.org/2001/04/xmldsig-more#rsa-sha512': { kind: 'RSA', hash: 'SHA-512' },
    'http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256': { kind: 'EC', hash: 'SHA-256', curve: 'P-256' },
    'http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha384': { kind: 'EC', hash: 'SHA-384', curve: 'P-384' },
    'http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha512': { kind: 'EC', hash: 'SHA-512', curve: 'P-521' },
  },
  digest: {
    'http://www.w3.org/2000/09/xmldsig#sha1': { hash: 'SHA-1', weak: true },
    'http://www.w3.org/2001/04/xmlenc#sha256': { hash: 'SHA-256' },
    'http://www.w3.org/2001/04/xmldsig-more#sha384': { hash: 'SHA-384' },
    'http://www.w3.org/2001/04/xmlenc#sha512': { hash: 'SHA-512' },
  },
}
const C14N_EXC = 'http://www.w3.org/2001/10/xml-exc-c14n#'
const C14N_EXC_COMMENTS = 'http://www.w3.org/2001/10/xml-exc-c14n#WithComments'
const ENVELOPED = 'http://www.w3.org/2000/09/xmldsig#enveloped-signature'
const enc = new TextEncoder()

const fail = (title, detail) => ({ status: 'invalid', title, detail })
const refuse = (title, detail) => ({ status: 'refused', title, detail })
const bytesEq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i])

// ECDSA signatures in XML-DSig are raw r||s, which is what Web Crypto expects too, so nothing to convert.

function elementsWithId(doc, id) {
  const hits = []
  const walk = (n) => {
    if (n.nodeType !== 1) return
    if (n.getAttribute && (n.getAttribute('ID') === id || n.getAttribute('Id') === id || n.getAttribute('id') === id)) hits.push(n)
    Array.prototype.slice.call(n.childNodes).forEach(walk)
  }
  walk(doc.documentElement)
  return hits
}

function inclusivePrefixes(transformEl) {
  const inc = child(transformEl, 'http://www.w3.org/2001/10/xml-exc-c14n#', 'InclusiveNamespaces')
  return inc ? (attr(inc, 'PrefixList') || '').split(/\s+/).filter(Boolean) : []
}

/** Which key signs? The one pasted, or failing that the certificate carried in the message. */
async function importKey(alg, keyInput) {
  const text = String(keyInput || '').trim()
  let spki
  let label
  let cert = null
  if (/-----BEGIN CERTIFICATE-----/.test(text)) {
    const b = /-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/.exec(text)[1].replace(/\s+/g, '')
    const c = parseCertificate(b)
    if (c.error) return { error: c.error }
    spki = c.spki; label = `the certificate you pasted (${c.subject})`; cert = c
  } else if (/-----BEGIN PUBLIC KEY-----/.test(text)) {
    const b = /-----BEGIN PUBLIC KEY-----([\s\S]*?)-----END PUBLIC KEY-----/.exec(text)[1].replace(/\s+/g, '')
    spki = b64ToBytes(b); label = 'the public key you pasted'
  } else if (/PRIVATE KEY/.test(text)) {
    return { error: 'That is a PRIVATE key. Do not paste private keys: only the certificate or public key is needed.' }
  } else if (/^[A-Za-z0-9+/=\s]{200,}$/.test(text)) {
    const c = parseCertificate(text.replace(/\s+/g, ''))
    if (c.error) return { error: c.error }
    spki = c.spki; label = `the certificate you pasted (${c.subject})`; cert = c
  } else if (text) {
    return { error: 'Paste a certificate (PEM or the base64 from <X509Certificate>) or a PUBLIC KEY block.' }
  } else return { none: true }
  const params = alg.kind === 'RSA' ? { name: 'RSASSA-PKCS1-v1_5', hash: alg.hash } : { name: 'ECDSA', namedCurve: alg.curve }
  try { return { key: await crypto.subtle.importKey('spki', spki, params, false, ['verify']), label, cert } } catch (e) {
    return { error: `That key cannot verify this signature algorithm (${e.message}). The signature uses ${alg.kind === 'RSA' ? 'RSA' : `ECDSA on ${alg.curve}`}.` }
  }
}

/**
 * Verify the signature element `sigEl` (an <ds:Signature>) of the document in `xml`. `keyInput`: pasted certificate/public key,
 * or '' to use the certificate embedded in the signature (which only proves the message is self-consistent, NOT who signed it).
 * Returns { status: 'valid' | 'invalid' | 'refused' | 'error' | 'no-key', title, detail, weak: [..], usedKey }.
 */
export async function verifyXmlSignature(xml, keyInput, { which = 0 } = {}) {
  if (!globalThis.crypto || !globalThis.crypto.subtle) return { status: 'error', title: 'Web Crypto is not available', detail: 'Signature checks need a modern browser on an HTTPS page.' }
  const parsed = parseXml(xml)
  if (parsed.error) return { status: 'error', title: 'The XML could not be read', detail: parsed.error }
  const doc = parsed.doc
  const sigs = []
  const walk = (n) => { if (n.nodeType !== 1) return; if (n.namespaceURI === NS.ds && n.localName === 'Signature') { sigs.push(n); return } Array.prototype.slice.call(n.childNodes).forEach(walk) }
  walk(doc.documentElement)
  if (!sigs.length) return { status: 'error', title: 'There is no signature to verify', detail: 'This message is not signed (or the signature is on something that was not in the message).' }
  const sig = sigs[which] || sigs[0]
  const owner = sig.parentNode

  const info = child(sig, NS.ds, 'SignedInfo')
  const sv = child(sig, NS.ds, 'SignatureValue')
  if (!info || !sv) return fail('The signature is incomplete', 'SignedInfo or SignatureValue is missing.')
  const sigMethod = attr(child(info, NS.ds, 'SignatureMethod'), 'Algorithm')
  const alg = ALGS.sig[sigMethod]
  if (!alg) return refuse('Unsupported signature algorithm', `${sigMethod || '(none)'} is not one this tool checks (RSA and ECDSA with SHA-1/256/384/512).`)
  const weak = []
  if (alg.weak) weak.push('The signature uses SHA-1, which is no longer considered secure.')

  const c14nEl = child(info, NS.ds, 'CanonicalizationMethod')
  const c14nAlg = attr(c14nEl, 'Algorithm')
  if (c14nAlg !== C14N_EXC && c14nAlg !== C14N_EXC_COMMENTS) return refuse('Unsupported canonicalization', `${c14nAlg || '(none)'}: only exclusive canonicalization (the SAML standard) is supported.`)

  // ---- 1. the reference: find what was signed, and check the digest
  const refs = children(info, NS.ds, 'Reference')
  if (refs.length !== 1) return refuse(refs.length ? 'More than one Reference' : 'No Reference', 'A SAML signature must have exactly one Reference. (Several are a signature-wrapping warning sign.)')
  const ref = refs[0]
  const uri = attr(ref, 'URI')
  if (uri === null || !/^#.+/.test(uri)) return refuse('Unsupported Reference URI', `URI="${uri ?? ''}": it must be "#" followed by the ID of an element in this message.`)
  const id = uri.slice(1)
  const targets = elementsWithId(doc, id)
  if (targets.length === 0) return fail('The signed element is not in the message', `The signature points to ID "${id}", but no element has it. The element may have been removed or moved.`)
  if (targets.length > 1) return refuse('Duplicate ID', `More than one element has the ID "${id}". That is how signature-wrapping attacks hide content, so this is refused.`)
  const target = targets[0]
  if (target !== owner) return refuse('The signature covers a different element than the one it sits in', `It is inside <${owner.localName}> but signs <${target.localName}> (ID "${id}"). Real SAML signatures are enveloped: they sit inside the element they sign. A receiver that reads a different element from the one signed can be fooled.`)

  let inclusive = []
  let enveloped = false
  const transforms = child(ref, NS.ds, 'Transforms')
  for (const t of transforms ? children(transforms, NS.ds, 'Transform') : []) {
    const a = attr(t, 'Algorithm')
    if (a === ENVELOPED) enveloped = true
    else if (a === C14N_EXC || a === C14N_EXC_COMMENTS) inclusive = inclusivePrefixes(t)
    else return refuse('Unsupported transform', `${a}: only the enveloped-signature and exclusive-canonicalization transforms are accepted.`)
  }
  if (!enveloped) return refuse('No enveloped-signature transform', 'Without it, the digest would include the signature itself, which cannot be.')
  const dAlg = ALGS.digest[attr(child(ref, NS.ds, 'DigestMethod'), 'Algorithm')]
  if (!dAlg) return refuse('Unsupported digest algorithm', `${attr(child(ref, NS.ds, 'DigestMethod'), 'Algorithm') || '(none)'}.`)
  if (dAlg.weak) weak.push('The digest uses SHA-1, which is no longer considered secure.')
  const dv = child(ref, NS.ds, 'DigestValue')
  if (!dv) return fail('The Reference has no DigestValue', '')

  const canonTarget = exclusiveC14n(target, { inclusive, skip: (n) => n === sig })
  const digest = new Uint8Array(await crypto.subtle.digest(dAlg.hash, enc.encode(canonTarget)))
  let claimed
  try { claimed = b64ToBytes(dv.textContent.replace(/\s+/g, '')) } catch { return fail('The DigestValue is not valid base64', '') }
  const digestOk = bytesEq(digest, claimed)

  // ---- 2. the signature over SignedInfo
  const canonInfo = exclusiveC14n(info, { inclusive: inclusivePrefixes(c14nEl) })
  let sigBytes
  try { sigBytes = b64ToBytes(sv.textContent.replace(/\s+/g, '')) } catch { return fail('The SignatureValue is not valid base64', '') }

  // which key
  let key = await importKey(alg, keyInput)
  let usedEmbedded = false
  if (key.error) return { status: 'error', title: 'The key could not be used', detail: key.error, weak }
  if (key.none) {
    const x = child(child(sig, NS.ds, 'KeyInfo') || sig, NS.ds, 'X509Data')
    const cEl = x && child(x, NS.ds, 'X509Certificate')
    if (!cEl) return { status: 'no-key', title: 'Paste the identity provider\'s certificate', detail: 'This message carries no certificate, so there is nothing to check it against.', weak }
    key = await importKey(alg, cEl.textContent.replace(/\s+/g, ''))
    if (key.error) return { status: 'error', title: 'The certificate in the message could not be used', detail: key.error, weak }
    key.label = `the certificate carried inside the message${key.cert ? ` (${key.cert.subject})` : ''}`
    usedEmbedded = true
  }
  let sigOk
  try { sigOk = await crypto.subtle.verify(alg.kind === 'RSA' ? { name: 'RSASSA-PKCS1-v1_5' } : { name: 'ECDSA', hash: alg.hash }, key.key, sigBytes, enc.encode(canonInfo)) } catch (e) {
    return { status: 'error', title: 'The signature could not be checked', detail: e.message, weak }
  }

  const base = { weak, usedKey: key.label, usedEmbedded, signed: `<${target.localName}> ID ${id}`, certificate: key.cert || null }
  if (sigOk && digestOk) {
    return {
      ...base, status: 'valid',
      title: usedEmbedded ? 'The message is internally consistent (checked with the certificate it carries)' : `The signature is valid (${key.label})`,
      detail: usedEmbedded
        ? 'The signature matches the certificate inside the message, and the content has not changed since it was signed. But anyone can sign a message with their own certificate and include it, so this does NOT show who signed it. Paste your identity provider\'s certificate (from its metadata) to prove that.'
        : `The signature was made by the key that matches ${key.label}, and the signed element has not changed since. This does not say the claims are acceptable: also check audience, recipient, time window and status.`,
    }
  }
  if (!digestOk && sigOk) return { ...base, status: 'invalid', title: 'The content was changed after it was signed', detail: `The signature itself is genuine, but the digest of ${base.signed} no longer matches what was signed. Something in the message was altered or re-serialised (a proxy, a logging tool or a hand edit) after signing.` }
  if (digestOk && !sigOk) return { ...base, status: 'invalid', title: usedEmbedded ? 'The signature does not match the certificate in the message' : 'The signature does NOT match this certificate', detail: usedEmbedded ? 'The message was altered, or the certificate it carries is not the one that signed it.' : 'The content is intact, but this certificate did not sign it. This is the usual cause of "invalid signature" at the service provider: the identity provider has rolled over to a new signing certificate, or you pasted the wrong one. Compare the certificate in the message with the one in the IdP\'s metadata.' }
  return { ...base, status: 'invalid', title: 'Neither the signature nor the content checks out', detail: 'Both the digest and the signature failed. The message may have been altered, or this is not the certificate that signed it.' }
}

/** How many signatures a message has (to let the page offer a choice). */
export function countSignatures(xml) {
  const parsed = parseXml(xml)
  if (parsed.error) return 0
  let n = 0
  const walk = (el) => { if (el.nodeType !== 1) return; if (el.namespaceURI === NS.ds && el.localName === 'Signature') { n++; return } Array.prototype.slice.call(el.childNodes).forEach(walk) }
  walk(parsed.doc.documentElement)
  return n
}
