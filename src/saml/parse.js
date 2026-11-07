// Reading a decoded SAML document into the fields people debug with. Nothing here decides whether the message is *trusted*:
// a browser cannot verify a signature against your IdP's key. It reports what is present, so a person (or the checks in
// checks.js) can compare it with what they expect.
import { NS, attr, child, children, firstElement, parseXml, prettyXml, text } from './xml'
import { parseCertificate } from '../formats/x509'

const STATUS = {
  Success: 'The request succeeded',
  Requester: 'The sender (the app asking) made an error',
  Responder: 'The identity provider could not complete the request',
  VersionMismatch: 'The SAML version is not supported',
  AuthnFailed: 'The user could not be authenticated',
  InvalidAttrNameOrValue: 'An attribute name or value was not acceptable',
  InvalidNameIDPolicy: 'The requested NameID format is not supported',
  NoAuthnContext: 'The requested authentication method is not available',
  NoAvailableIDP: 'No identity provider is available',
  NoPassive: 'Passive authentication was requested, but the user is not signed in',
  NoSupportedIDP: 'No supported identity provider',
  PartialLogout: 'Logout did not reach every session',
  ProxyCountExceeded: 'Too many proxies',
  RequestDenied: 'The identity provider refused the request',
  RequestUnsupported: 'The request is not supported',
  RequestVersionDeprecated: 'The request version is too old',
  RequestVersionTooHigh: 'The request version is too new',
  RequestVersionTooLow: 'The request version is too old',
  ResourceNotRecognized: 'The resource is not recognised',
  TooManyResponses: 'Too many responses',
  UnknownAttrProfile: 'Unknown attribute profile',
  UnknownPrincipal: 'The identity provider does not know this user',
  UnsupportedBinding: 'The binding is not supported',
}
const lastPart = (uri) => (uri ? uri.split(':').pop() : '')
const NAMEID_FORMATS = {
  'urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified': 'unspecified',
  'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress': 'email address',
  'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent': 'persistent',
  'urn:oasis:names:tc:SAML:2.0:nameid-format:transient': 'transient',
  'urn:oasis:names:tc:SAML:2.0:nameid-format:entity': 'entity',
}
const MESSAGE_TYPES = ['AuthnRequest', 'Response', 'LogoutRequest', 'LogoutResponse', 'ArtifactResolve', 'ArtifactResponse']

const when = (s) => { const t = s ? Date.parse(s) : NaN; return Number.isNaN(t) ? null : t }

function readSignature(el) {
  const sig = child(el, NS.ds, 'Signature')
  if (!sig) return null
  const info = child(sig, NS.ds, 'SignedInfo')
  const method = info && child(info, NS.ds, 'SignatureMethod')
  const ref = info && child(info, NS.ds, 'Reference')
  const digest = ref && child(ref, NS.ds, 'DigestMethod')
  const kInfo = child(sig, NS.ds, 'KeyInfo')
  const x509 = kInfo && child(kInfo, NS.ds, 'X509Data')
  const certEl = x509 && child(x509, NS.ds, 'X509Certificate')
  const b64 = certEl ? text(certEl).replace(/\s+/g, '') : ''
  return {
    signatureMethod: attr(method, 'Algorithm') || '',
    digestMethod: attr(digest, 'Algorithm') || '',
    referenceUri: attr(ref, 'URI') || '',
    hasValue: !!child(sig, NS.ds, 'SignatureValue'),
    certificate: b64 ? { base64: b64, ...parseCertificate(b64) } : null,
  }
}

function readIssuer(el) { const i = child(el, NS.saml, 'Issuer'); return i ? text(i) : '' }

function readNameId(el) {
  const n = child(el, NS.saml, 'NameID')
  if (!n) return child(el, NS.saml, 'EncryptedID') ? { encrypted: true } : null
  const fmt = attr(n, 'Format') || ''
  return { value: text(n), raw: n.textContent || '', format: fmt, formatName: NAMEID_FORMATS[fmt] || lastPart(fmt), spNameQualifier: attr(n, 'SPNameQualifier') || '', nameQualifier: attr(n, 'NameQualifier') || '' }
}

function readConditions(c) {
  if (!c) return null
  return {
    notBefore: attr(c, 'NotBefore'),
    notOnOrAfter: attr(c, 'NotOnOrAfter'),
    audiences: children(c, NS.saml, 'AudienceRestriction').flatMap((r) => children(r, NS.saml, 'Audience').map(text)),
    oneTimeUse: !!child(c, NS.saml, 'OneTimeUse'),
  }
}

function readAttributes(stmt) {
  if (!stmt) return []
  return children(stmt, NS.saml, 'Attribute').map((a) => ({
    name: attr(a, 'Name') || '',
    friendlyName: attr(a, 'FriendlyName') || '',
    values: children(a, NS.saml, 'AttributeValue').map(text),
  }))
}

function readAssertion(a) {
  const subject = child(a, NS.saml, 'Subject')
  const confs = subject ? children(subject, NS.saml, 'SubjectConfirmation') : []
  const data = confs.map((c) => child(c, NS.saml, 'SubjectConfirmationData')).filter(Boolean)
  const authn = child(a, NS.saml, 'AuthnStatement')
  const ctx = authn && child(authn, NS.saml, 'AuthnContext')
  const ctxRef = ctx && child(ctx, NS.saml, 'AuthnContextClassRef')
  return {
    id: attr(a, 'ID') || '',
    issueInstant: attr(a, 'IssueInstant'),
    version: attr(a, 'Version') || '',
    issuer: readIssuer(a),
    nameId: subject ? readNameId(subject) : null,
    confirmations: confs.map((c, i) => ({ method: attr(c, 'Method') || '', recipient: attr(data[i], 'Recipient') || '', notOnOrAfter: attr(data[i], 'NotOnOrAfter'), inResponseTo: attr(data[i], 'InResponseTo') || '' })),
    conditions: readConditions(child(a, NS.saml, 'Conditions')),
    authn: authn ? { instant: attr(authn, 'AuthnInstant'), sessionIndex: attr(authn, 'SessionIndex') || '', sessionNotOnOrAfter: attr(authn, 'SessionNotOnOrAfter'), context: text(ctxRef) } : null,
    attributes: readAttributes(child(a, NS.saml, 'AttributeStatement')),
    signature: readSignature(a),
  }
}

function readStatus(el) {
  const s = child(el, NS.samlp, 'Status')
  if (!s) return null
  const code = child(s, NS.samlp, 'StatusCode')
  const sub = code && child(code, NS.samlp, 'StatusCode')
  const msg = child(s, NS.samlp, 'StatusMessage')
  const detail = child(s, NS.samlp, 'StatusDetail')
  const top = attr(code, 'Value') || ''
  const second = attr(sub, 'Value') || ''
  return {
    code: top, codeName: lastPart(top), subCode: second, subCodeName: lastPart(second),
    success: lastPart(top) === 'Success',
    message: msg ? text(msg) : '', detail: detail ? text(detail) : '',
    meaning: STATUS[lastPart(second)] || STATUS[lastPart(top)] || '',
  }
}

/** Parse decoded XML text into { type, ... } or { error }. */
export function parseSamlXml(xml) {
  const parsed = parseXml(xml)
  if (parsed.error) return { error: parsed.error, unsafe: !!parsed.doctype }
  let root = parsed.root
  // SOAP back-channel: the SAML message is the first element inside <soap:Body>
  if (root.namespaceURI === NS.soap && root.localName === 'Envelope') {
    const body = child(root, NS.soap, 'Body')
    root = body ? firstElement(body) : null
    if (!root) return { error: 'The SOAP envelope has an empty body.' }
  }
  const out = { xml: prettyXml(parsed.root), rootName: root.localName }
  const isProtocol = root.namespaceURI === NS.samlp && MESSAGE_TYPES.includes(root.localName)
  const isAssertion = root.namespaceURI === NS.saml && root.localName === 'Assertion'
  if (/^RequestSecurityTokenResponse(Collection)?$/.test(root.localName)) {
    return { ...out, error: 'This is a WS-Federation (WS-Trust) token response, not a SAML 2.0 protocol message. WS-Federation is not analysed here; the XML is shown below.' }
  }
  if (root.namespaceURI === 'urn:oasis:names:tc:SAML:1.0:assertion' || root.namespaceURI === 'urn:oasis:names:tc:SAML:1.0:protocol') {
    return { ...out, error: 'This is a SAML 1.1 message. Only SAML 2.0 is analysed here.' }
  }
  if (!isProtocol && !isAssertion) {
    return { ...out, error: `The root element is <${root.localName}>${root.namespaceURI ? ` in the namespace ${root.namespaceURI}` : ''}, which is not a SAML 2.0 message.` }
  }
  out.type = root.localName
  out.id = attr(root, 'ID') || ''
  out.version = attr(root, 'Version') || ''
  out.issueInstant = attr(root, 'IssueInstant')
  out.destination = attr(root, 'Destination') || ''
  out.inResponseTo = attr(root, 'InResponseTo') || ''
  out.issuer = readIssuer(root)
  out.signature = readSignature(root)
  out.consent = attr(root, 'Consent') || ''

  if (isAssertion) {
    out.assertions = [readAssertion(root)]
    out.encryptedAssertions = 0
    return out
  }
  if (root.localName === 'AuthnRequest') {
    const policy = child(root, NS.samlp, 'NameIDPolicy')
    const ctx = child(root, NS.samlp, 'RequestedAuthnContext')
    out.request = {
      acsUrl: attr(root, 'AssertionConsumerServiceURL') || '',
      acsIndex: attr(root, 'AssertionConsumerServiceIndex') || '',
      protocolBinding: attr(root, 'ProtocolBinding') || '',
      forceAuthn: attr(root, 'ForceAuthn') === 'true',
      isPassive: attr(root, 'IsPassive') === 'true',
      providerName: attr(root, 'ProviderName') || '',
      nameIdPolicy: policy ? { format: attr(policy, 'Format') || '', formatName: NAMEID_FORMATS[attr(policy, 'Format')] || lastPart(attr(policy, 'Format')), allowCreate: attr(policy, 'AllowCreate') } : null,
      authnContext: ctx ? { comparison: attr(ctx, 'Comparison') || 'exact', classRefs: children(ctx, NS.saml, 'AuthnContextClassRef').map(text) } : null,
      subject: (() => { const s = child(root, NS.saml, 'Subject'); return s ? readNameId(s) : null })(),
    }
  } else if (root.localName === 'LogoutRequest') {
    out.request = { nameId: readNameId(root), sessionIndexes: children(root, NS.samlp, 'SessionIndex').map(text), reason: attr(root, 'Reason') || '', notOnOrAfter: attr(root, 'NotOnOrAfter') }
  }
  out.status = readStatus(root)
  if (root.localName === 'Response' || root.localName === 'ArtifactResponse') {
    out.assertions = children(root, NS.saml, 'Assertion').map(readAssertion)
    out.encryptedAssertions = children(root, NS.saml, 'EncryptedAssertion').length
  }
  return out
}

export function describeStatus(code) { return STATUS[lastPart(code)] || '' }
export { when }
