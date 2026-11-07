// Reading SAML metadata (the XML a provider publishes to describe itself) and checking it against the messages in a trace.
//
// Metadata is the "contract" between an identity provider and a service provider: entity id, endpoints, signing keys. Most failed
// sign-ins are a mismatch between what a message says and what the other side's metadata says, so this compares them.
import { NS, attr, child, children, parseXml, text } from './xml'
import { parseCertificate } from './x509'

const MD = 'urn:oasis:names:tc:SAML:2.0:metadata'
const BINDING = {
  'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST': 'HTTP-POST',
  'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect': 'HTTP-Redirect',
  'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Artifact': 'HTTP-Artifact',
  'urn:oasis:names:tc:SAML:2.0:bindings:SOAP': 'SOAP',
  'urn:oasis:names:tc:SAML:2.0:bindings:PAOS': 'PAOS',
}
const bindingName = (b) => BINDING[b] || (b || '').split(':').pop()
const ms = (s) => { const t = s ? Date.parse(s) : NaN; return Number.isNaN(t) ? null : t }

function endpoints(parent, name) {
  return children(parent, MD, name).map((e) => ({
    binding: attr(e, 'Binding') || '', bindingName: bindingName(attr(e, 'Binding')),
    location: attr(e, 'Location') || '', responseLocation: attr(e, 'ResponseLocation') || '',
    index: attr(e, 'index'), isDefault: attr(e, 'isDefault') === 'true',
  }))
}

function keys(role) {
  return children(role, MD, 'KeyDescriptor').map((k) => {
    const use = attr(k, 'use') || 'signing and encryption'
    const info = child(k, NS.ds, 'KeyInfo')
    const x = info && child(info, NS.ds, 'X509Data')
    const c = x && child(x, NS.ds, 'X509Certificate')
    const b64 = c ? text(c).replace(/\s+/g, '') : ''
    const cert = b64 ? { base64: b64, ...parseCertificate(b64) } : null
    return { use: attr(k, 'use') || '', useText: use, certificate: cert, name: info && child(info, NS.ds, 'KeyName') ? text(child(info, NS.ds, 'KeyName')) : '' }
  })
}

function nameIdFormats(role) { return children(role, MD, 'NameIDFormat').map((n) => text(n)) }

function readRole(el, kind) {
  const base = {
    kind,
    protocols: (attr(el, 'protocolSupportEnumeration') || '').split(/\s+/).filter(Boolean),
    keys: keys(el),
    nameIdFormats: nameIdFormats(el),
    singleLogout: endpoints(el, 'SingleLogoutService'),
  }
  if (kind === 'idp') {
    return { ...base, wantAuthnRequestsSigned: attr(el, 'WantAuthnRequestsSigned') === 'true', singleSignOn: endpoints(el, 'SingleSignOnService'), attributes: children(el, NS.saml, 'Attribute').map((a) => attr(a, 'Name')) }
  }
  return {
    ...base,
    authnRequestsSigned: attr(el, 'AuthnRequestsSigned') === 'true',
    wantAssertionsSigned: attr(el, 'WantAssertionsSigned') === 'true',
    acs: endpoints(el, 'AssertionConsumerService'),
    requested: children(children(el, MD, 'AttributeConsumingService')[0] || el, MD, 'RequestedAttribute').map((a) => ({ name: attr(a, 'Name'), required: attr(a, 'isRequired') === 'true' })),
  }
}

/** Parse metadata XML. Returns { entities: [{ entityId, validUntil, cacheDuration, idp, sp, organization }] } or { error }. */
export function parseMetadata(xml) {
  const parsed = parseXml(xml)
  if (parsed.error) return { error: parsed.error }
  const root = parsed.root
  let els = []
  if (root.namespaceURI === MD && root.localName === 'EntityDescriptor') els = [root]
  else if (root.namespaceURI === MD && root.localName === 'EntitiesDescriptor') {
    const walk = (n) => { for (const e of children(n, MD, 'EntityDescriptor')) els.push(e); for (const g of children(n, MD, 'EntitiesDescriptor')) walk(g) }
    walk(root)
  } else return { error: `This is not SAML metadata: the root element is <${root.localName}>, and metadata starts with <EntityDescriptor> or <EntitiesDescriptor>.` }
  if (!els.length) return { error: 'No EntityDescriptor found in this metadata.' }
  const entities = els.map((e) => {
    const idpEl = child(e, MD, 'IDPSSODescriptor')
    const spEl = child(e, MD, 'SPSSODescriptor')
    const org = child(e, MD, 'Organization')
    const on = org && child(org, MD, 'OrganizationDisplayName')
    return {
      entityId: attr(e, 'entityID') || '',
      validUntil: attr(e, 'validUntil') || (attr(root, 'validUntil') || ''),
      cacheDuration: attr(e, 'cacheDuration') || '',
      signed: !!child(e, NS.ds, 'Signature'),
      organization: on ? text(on) : '',
      idp: idpEl ? readRole(idpEl, 'idp') : null,
      sp: spEl ? readRole(spEl, 'sp') : null,
    }
  })
  return { entities }
}

const f = (severity, title, detail, fix) => ({ severity, title, detail, fix })
const sameUrl = (a, b) => a === b
const slashOnly = (a, b) => a !== b && String(a).replace(/\/+$/, '') === String(b).replace(/\/+$/, '')
const caseOnly = (a, b) => a !== b && String(a).toLowerCase() === String(b).toLowerCase()

function whyDiffers(a, b) {
  if (slashOnly(a, b)) return ' They differ only by a trailing slash.'
  if (caseOnly(a, b)) return ' They differ only by letter case.'
  if (a.replace(/^https?:/, '') === b.replace(/^https?:/, '')) return ' They differ only by http vs https.'
  return ''
}

/** Checks on the metadata by itself: expiry, signing keys, endpoints. */
export function checkMetadata(entity, { now = Date.now() } = {}) {
  const out = []
  const role = entity.idp || entity.sp
  if (!entity.entityId) out.push(f('critical', 'No entityID', 'Every entity needs an entityID: it is how the other side identifies it.', ''))
  const until = ms(entity.validUntil)
  if (until != null) {
    if (until <= now) out.push(f('critical', 'The metadata has expired', `validUntil was ${entity.validUntil}. Software that honours it will refuse this metadata.`, 'Ask the provider for fresh metadata, or fetch it again from its metadata URL.'))
    else if (until - now < 7 * 86400e3) out.push(f('warning', 'The metadata expires within a week', `validUntil is ${entity.validUntil}.`, 'Make sure it is refreshed before then.'))
  }
  if (!role) { out.push(f('warning', 'No IDPSSODescriptor or SPSSODescriptor', 'This entity describes neither an identity provider nor a service provider.', '')); return out }
  if (entity.idp) {
    const r = entity.idp
    if (!r.singleSignOn.length) out.push(f('critical', 'No SingleSignOnService', 'Without one, no service provider can send users here to sign in.', ''))
    for (const e of r.singleSignOn) if (e.location && !/^https:/i.test(e.location)) out.push(f('warning', 'A sign-in endpoint is not HTTPS', e.location, 'Use HTTPS.'))
    if (!r.keys.some((k) => k.useText !== 'encryption')) out.push(f('critical', 'No signing key', 'The identity provider publishes no certificate that signs its responses, so a service provider has nothing to verify them with.', 'Add a KeyDescriptor use="signing".'))
  }
  if (entity.sp) {
    const r = entity.sp
    if (!r.acs.length) out.push(f('critical', 'No AssertionConsumerService', 'Without an ACS endpoint the identity provider has nowhere to send responses.', ''))
    for (const e of r.acs) if (e.location && !/^https:/i.test(e.location)) out.push(f('warning', 'An ACS URL is not HTTPS', e.location, 'Use HTTPS.'))
    const post = r.acs.some((e) => e.bindingName === 'HTTP-POST')
    if (r.acs.length && !post) out.push(f('warning', 'No HTTP-POST ACS', 'Most identity providers send responses with HTTP-POST. Without a POST endpoint, they may have no binding they can use.', ''))
    if (r.acs.length > 1 && r.acs.some((e) => e.index == null)) out.push(f('info', 'Several ACS endpoints, some without an index', 'Endpoints are chosen by index or URL; missing indexes make that ambiguous.', ''))
    if (r.authnRequestsSigned && !r.keys.some((k) => k.useText !== 'encryption')) out.push(f('critical', 'Signed requests, but no signing key', 'AuthnRequestsSigned is true, but there is no signing certificate to verify them with.', ''))
  }
  for (const k of role.keys) {
    const c = k.certificate
    const label = `${k.useText} certificate${c && !c.error ? ` (${c.subject})` : ''}`
    if (!c) { out.push(f('warning', 'A KeyDescriptor has no certificate', k.name ? `Key "${k.name}".` : '', '')); continue }
    if (c.error) { out.push(f('warning', 'A certificate could not be read', c.error, '')); continue }
    if (c.notAfter <= now) out.push(f('critical', `The ${label} has expired`, `It expired on ${new Date(c.notAfter).toISOString().slice(0, 10)}.`, 'Ask for the new certificate. This is the commonest cause of sign-in suddenly breaking.'))
    else if (c.notAfter - now < 30 * 86400e3) out.push(f('warning', `The ${label} expires within 30 days`, `It expires on ${new Date(c.notAfter).toISOString().slice(0, 10)}.`, 'Plan the rollover: publish the new certificate alongside the old one before this date.'))
    if (c.notBefore > now) out.push(f('warning', `The ${label} is not valid yet`, `It starts on ${new Date(c.notBefore).toISOString().slice(0, 10)}.`, ''))
    if (c.key.algorithm === 'RSA' && c.key.bits < 2048) out.push(f('warning', `The ${label} has a weak key`, `${c.key.bits}-bit RSA. Use at least 2048 bits.`, ''))
    if (/sha1|md5/i.test(c.signatureAlgorithm)) out.push(f('info', `The ${label} is signed with ${c.signatureAlgorithm}`, 'A SHA-1 certificate signature is not secure, though for a self-signed SAML certificate it does not affect message signing.', ''))
  }
  const signing = role.keys.filter((k) => k.useText !== 'encryption' && k.certificate && !k.certificate.error)
  if (signing.length > 2) out.push(f('info', `${signing.length} signing certificates`, 'Several are normal during a rollover. Make sure the old one is removed afterwards.', ''))
  if (!out.some((x) => x.severity === 'critical' || x.severity === 'warning')) out.push({ severity: 'ok', title: 'The metadata looks fine', detail: 'Expiry, endpoints and certificates are in order.' })
  return out
}

/**
 * Compare metadata with the SAML messages seen in a trace. `items` are parsed messages ({ parsed, ... } from the SAML page).
 * `fps` maps a certificate's base64 to its fingerprints. Returns checks.
 */
export function compareWithMessages(entity, items, { fps = {} } = {}) {
  const out = []
  const msgs = items.map((i) => i.parsed).filter((p) => p && !p.error)
  const requests = msgs.filter((m) => m.type === 'AuthnRequest')
  const responses = msgs.filter((m) => m.type === 'Response')

  if (entity.sp) {
    const sp = entity.sp
    for (const r of requests) {
      if (r.issuer && entity.entityId && r.issuer !== entity.entityId) out.push(f('critical', 'The request\'s Issuer is not this entity\'s ID', `The AuthnRequest says Issuer = ${r.issuer}; the metadata says entityID = ${entity.entityId}.${whyDiffers(r.issuer, entity.entityId)} The identity provider looks the service provider up by this value and will say it does not know it.`, 'Make the SP\'s configured entity ID and the one in the IdP match exactly.'))
      const acs = r.request && r.request.acsUrl
      if (acs && !sp.acs.some((e) => sameUrl(e.location, acs))) {
        const near = sp.acs.find((e) => slashOnly(e.location, acs) || caseOnly(e.location, acs))
        out.push(f('critical', 'The request asks for an ACS URL that is not in the metadata', `It asks for ${acs}. The metadata lists ${sp.acs.map((e) => e.location).join(', ') || 'none'}.${near ? whyDiffers(acs, near.location) : ''} Identity providers refuse to send a response to an address not registered for the SP.`, 'Register this ACS URL with the IdP, or fix the URL the SP sends.'))
      }
      const bind = r.request && r.request.protocolBinding && bindingName(r.request.protocolBinding)
      if (acs && bind) {
        const e = sp.acs.find((x) => x.location === acs)
        if (e && e.bindingName !== bind) out.push(f('warning', 'The requested binding differs from the metadata for that ACS', `The request wants ${bind}; the metadata lists ${e.bindingName} for ${acs}.`, ''))
      }
    }
    for (const r of responses) {
      for (const a of r.assertions || []) {
        for (const aud of (a.conditions && a.conditions.audiences) || []) {
          if (entity.entityId && aud !== entity.entityId) out.push(f('critical', 'The assertion\'s audience is not this service provider', `The assertion is for ${aud}; the metadata says entityID = ${entity.entityId}.${whyDiffers(aud, entity.entityId)} The SP rejects it with "audience restriction failed".`, 'Set the IdP\'s audience for this SP to the SP\'s entity ID exactly.'))
        }
        for (const c of a.confirmations || []) {
          if (c.recipient && !sp.acs.some((e) => sameUrl(e.location, c.recipient))) out.push(f('critical', 'The assertion\'s Recipient is not an ACS URL in the metadata', `Recipient is ${c.recipient}; the metadata lists ${sp.acs.map((e) => e.location).join(', ') || 'none'}.${sp.acs[0] ? whyDiffers(c.recipient, sp.acs[0].location) : ''}`, 'The IdP\'s configured ACS URL for this SP must be one of the SP\'s.'))
        }
        if (sp.wantAssertionsSigned && !a.signature) out.push(f('critical', 'The metadata says assertions must be signed, but this assertion is not', 'WantAssertionsSigned is true. A strict SP rejects an unsigned assertion, even when the response itself is signed.', 'Sign the assertion at the IdP, not only the response.'))
      }
      if (r.destination && !sp.acs.some((e) => sameUrl(e.location, r.destination))) out.push(f('warning', 'The response\'s Destination is not an ACS URL in the metadata', `Destination is ${r.destination}.${sp.acs[0] ? whyDiffers(r.destination, sp.acs[0].location) : ''}`, ''))
      const fmt = (r.assertions || []).map((a) => a.nameId && a.nameId.format).filter(Boolean)
      for (const x of fmt) if (sp.nameIdFormats.length && !sp.nameIdFormats.includes(x)) out.push(f('warning', 'The NameID format is not one the SP lists', `The assertion uses ${x.split(':').pop()}; the SP lists ${sp.nameIdFormats.map((y) => y.split(':').pop()).join(', ')}.`, ''))
      const have = new Set((r.assertions || []).flatMap((a) => a.attributes.map((y) => y.name)))
      for (const q of sp.requested.filter((y) => y.required)) if (!have.has(q.name)) out.push(f('warning', `A required attribute is missing: ${q.name}`, 'The SP\'s metadata marks it required, and the assertion has no such attribute.', 'Add the attribute to the IdP\'s attribute release for this SP.'))
    }
  }

  if (entity.idp) {
    const idp = entity.idp
    for (const r of requests) {
      if (r.destination && !idp.singleSignOn.some((e) => sameUrl(e.location, r.destination))) out.push(f('warning', 'The request\'s Destination is not a sign-in endpoint in the IdP metadata', `Destination is ${r.destination}; the metadata lists ${idp.singleSignOn.map((e) => e.location).join(', ') || 'none'}.${idp.singleSignOn[0] ? whyDiffers(r.destination, idp.singleSignOn[0].location) : ''}`, 'The SP is configured with an old or wrong IdP sign-in URL.'))
      if (idp.wantAuthnRequestsSigned && !r.signature) out.push(f('critical', 'The IdP requires signed requests, and this one is not signed', 'WantAuthnRequestsSigned is true in the IdP metadata. (A redirect-binding request carries its signature in the URL, outside the XML, which this view cannot see.)', 'Turn on request signing at the SP.'))
    }
    for (const r of responses) {
      if (r.issuer && entity.entityId && r.issuer !== entity.entityId) out.push(f('critical', 'The response\'s Issuer is not this IdP\'s entity ID', `The response says Issuer = ${r.issuer}; the metadata says entityID = ${entity.entityId}.${whyDiffers(r.issuer, entity.entityId)} The SP expects responses from the IdP it has configured and rejects others.`, 'Make the IdP\'s configured entity ID and the one the SP trusts match exactly.'))
      const signers = [r.signature, ...(r.assertions || []).map((a) => a.signature)].filter(Boolean)
      for (const sig of signers) {
        const c = sig.certificate
        if (!c || c.error) continue
        const known = idp.keys.filter((k) => k.certificate && k.certificate.base64 && k.useText !== 'encryption')
        if (known.length && !known.some((k) => k.certificate.base64 === c.base64)) {
          const fp = fps[c.base64]
          out.push(f('critical', 'The message is signed with a certificate that is NOT in the IdP\'s metadata', `The signing certificate is ${c.subject}${fp ? ` (SHA-256 ${fp.sha256})` : ''}. The metadata publishes ${known.map((k) => k.certificate.subject).join('; ')}. A service provider that trusts the metadata rejects this with "invalid signature". This is what a certificate rollover that was not communicated looks like.`, 'Give the SP the IdP\'s current metadata (or certificate), or have the IdP sign with the published one.'))
        }
      }
    }
  }
  if (!out.length) out.push({ severity: 'ok', title: 'The messages agree with the metadata', detail: 'Entity IDs, endpoints and certificates line up. This looks only at what the metadata and the messages in this trace say.' })
  const order = { critical: 0, warning: 1, info: 2, ok: 3 }
  return out.sort((a, b) => order[a.severity] - order[b.severity])
}

