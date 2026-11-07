// Checks on a parsed SAML message. Each finding: { severity: 'critical' | 'warning' | 'info' | 'ok', title, detail, fix }.
//
// What this can and cannot tell you. It reads a message that was captured *after* the fact, with no knowledge of your
// configuration, so it cannot prove a signature is valid (that needs the IdP's key) and it cannot know which audience or
// ACS URL you configured. It reports what the message says, flags what is wrong on its face, and, when you give it the
// values you expect ("expect"), compares against them.
import { describeStatus } from './parse'

const WEAK_SIG = /rsa-sha1|dsa-sha1|hmac-sha1|rsa-md5/i
const WEAK_DIGEST = /#sha1$|md5/i
const ok = (title, detail) => ({ severity: 'ok', title, detail, fix: '' })
const add = (list, severity, title, detail, fix) => list.push({ severity, title, detail, fix })
const skew = (ms) => (Math.abs(ms) < 1000 ? `${Math.round(Math.abs(ms))} ms` : `${(Math.abs(ms) / 1000).toFixed(1)} s`)
const fmtDur = (ms) => {
  const m = Math.abs(ms) / 60000
  return m < 1 ? `${Math.round(Math.abs(ms) / 1000)} s` : m < 120 ? `${Math.round(m)} min` : `${(m / 60).toFixed(1)} h`
}
const toMs = (s) => { const t = s ? Date.parse(s) : NaN; return Number.isNaN(t) ? null : t }

function signatureChecks(sig, label, list, { required, signedElsewhere }) {
  if (!sig) {
    if (required && !signedElsewhere) add(list, 'warning', `${label} is not signed`, 'No XML signature was found on it. An unsigned message can be forged or altered by anyone who can reach the user\'s browser.', 'Have the sender sign the response or the assertion, and make the receiving side require it.')
    return
  }
  if (!sig.hasValue) add(list, 'critical', `${label} has a Signature with no SignatureValue`, 'The Signature element is there but it does not carry a signature value, so nothing is actually signed.', 'This is a malformed or stripped signature. Check how the sender builds the message.')
  if (WEAK_SIG.test(sig.signatureMethod)) add(list, 'warning', `${label} is signed with a weak algorithm`, `The signature method is ${sig.signatureMethod.split('#').pop()}. SHA-1 and MD5 signatures are considered broken.`, 'Use RSA-SHA256 (or stronger) on the IdP, and update the SP to accept it.')
  if (WEAK_DIGEST.test(sig.digestMethod)) add(list, 'warning', `${label} uses a weak digest`, `The digest method is ${sig.digestMethod.split('#').pop()}.`, 'Use SHA-256 or stronger for the digest.')
}

function certificateChecks(sig, label, list, now, expect, fps) {
  const c = sig && sig.certificate
  if (!c) return
  if (c.error) { add(list, 'info', `${label}: the embedded certificate could not be read`, c.error, 'Check that the X509Certificate element holds a valid base64 certificate.'); return }
  if (c.notAfter < now) add(list, 'critical', `The signing certificate has expired`, `${c.subject} expired on ${new Date(c.notAfter).toISOString().slice(0, 10)}, ${fmtDur(now - c.notAfter)} before the time of this check. Receivers that check certificate dates will reject the message.`, 'Rotate the IdP signing certificate and upload the new one to every service provider.')
  else if (c.notBefore > now) add(list, 'warning', 'The signing certificate is not valid yet', `${c.subject} is valid from ${new Date(c.notBefore).toISOString().slice(0, 10)}.`, 'Check the clock on the IdP, or use a certificate that is already valid.')
  else if (c.notAfter - now < 30 * 86400000) add(list, 'warning', 'The signing certificate expires soon', `${c.subject} expires on ${new Date(c.notAfter).toISOString().slice(0, 10)} (in ${fmtDur(c.notAfter - now)}).`, 'Plan the certificate rotation now. Most outages happen on the day it expires.')
  if (c.key.algorithm === 'RSA' && c.key.bits && c.key.bits < 2048) add(list, 'warning', `The signing key is only ${c.key.bits} bits`, 'RSA keys below 2048 bits are considered weak.', 'Issue a new certificate with a 2048-bit (or larger) key.')
  if (/sha1|md5/i.test(c.signatureAlgorithm)) add(list, 'info', 'The certificate itself is signed with SHA-1', `${c.signatureAlgorithm}. It still works for SAML (the message signature is what counts) but it is outdated.`, 'Reissue the certificate with SHA-256.')
  const fp = c.fingerprints || (fps && fps[c.base64])
  if (expect && expect.fingerprint && fp) {
    const want = expect.fingerprint.replace(/[^0-9a-f]/gi, '').toUpperCase()
    const have = [fp.sha256, fp.sha1].map((f) => f.replace(/:/g, ''))
    if (want && !have.includes(want)) add(list, 'critical', 'The signing certificate is not the one you expect', `Its fingerprint is ${fp.sha256}, which does not match the one you entered.`, 'The IdP is signing with a different certificate (a rotation, or the wrong IdP). Update the trusted certificate on the receiving side.')
  }
}

function checkAssertion(a, i, msg, list, now, expect, tolerance, fps) {
  const tag = msg.assertions.length > 1 ? `Assertion ${i + 1}` : 'Assertion'
  const c = a.conditions
  if (!c) add(list, 'warning', `${tag} has no Conditions`, 'Without NotBefore / NotOnOrAfter and an audience restriction, the assertion never expires and can be replayed to any service.', 'Have the IdP issue assertions with a validity window and an AudienceRestriction.')
  else {
    const nb = toMs(c.notBefore)
    const na = toMs(c.notOnOrAfter)
    if (na != null && now >= na + tolerance) add(list, 'critical', `${tag} has expired`, `NotOnOrAfter is ${c.notOnOrAfter}, ${fmtDur(now - na)} before the time of this check (allowing ${fmtDur(tolerance)} of clock skew). The service provider will reject it.`, 'When this was captured live, check that the clocks on the IdP and the SP are in sync (NTP). A HAR opened later always looks expired: use "Check as of" to set the time it was captured.')
    if (nb != null && now < nb - tolerance) add(list, 'critical', `${tag} is not valid yet`, `NotBefore is ${c.notBefore}, ${fmtDur(nb - now)} after the time of this check. The IdP clock is ahead of the SP clock.`, 'Synchronise the clocks (NTP) on both sides, or allow a few minutes of clock skew on the service provider.')
    if (nb != null && na != null && na <= nb) add(list, 'critical', `${tag} has an impossible validity window`, 'NotOnOrAfter is not after NotBefore.', 'Fix the validity settings on the IdP.')
    if (nb != null && na != null && na - nb > 3600000 * 24) add(list, 'info', `${tag} is valid for a long time`, `${fmtDur(na - nb)} between NotBefore and NotOnOrAfter. Assertions are normally valid for minutes.`, 'Shorten the validity window to limit replay.')
    if (!c.audiences.length) add(list, 'warning', `${tag} has no audience restriction`, 'Any service provider could accept this assertion.', 'Have the IdP add an AudienceRestriction naming your SP entity ID.')
    if (expect && expect.audience && c.audiences.length && !c.audiences.includes(expect.audience.trim())) add(list, 'critical', `${tag}: the audience does not match`, `The assertion is for ${c.audiences.map((x) => `"${x}"`).join(', ')}, but you expect "${expect.audience.trim()}". The SP will reject it as "audience restriction failed".`, 'Make the SP entity ID configured at the IdP identical to the one the SP uses (check scheme, trailing slash and case).')
  }
  if (!a.nameId) add(list, 'warning', `${tag} has no NameID`, 'The assertion does not say who the user is.', 'Check the IdP\'s NameID configuration for this application.')
  else if (a.nameId.encrypted) add(list, 'info', `${tag} has an encrypted NameID`, 'The subject is encrypted, so it cannot be read here.', '')
  else if (!a.nameId.value) add(list, 'warning', `${tag} has an empty NameID`, 'The NameID element is present but has no value.', 'Map a user attribute that is not empty (for example the email address) to the NameID at the IdP.')
  const bearer = a.confirmations.find((x) => /bearer$/i.test(x.method)) || a.confirmations[0]
  if (!a.confirmations.length) add(list, 'warning', `${tag} has no SubjectConfirmation`, 'Browser SSO requires a bearer SubjectConfirmation naming the ACS URL.', 'Check the IdP profile: the assertion must be a bearer assertion for Web Browser SSO.')
  else if (bearer) {
    const na = toMs(bearer.notOnOrAfter)
    if (na != null && now >= na + tolerance) add(list, 'critical', `${tag}: the SubjectConfirmation has expired`, `NotOnOrAfter is ${bearer.notOnOrAfter}, ${fmtDur(now - na)} earlier than the time of this check.`, 'Same cause as an expired assertion: clocks or a stale capture.')
    if (!bearer.recipient) add(list, 'warning', `${tag}: the SubjectConfirmation has no Recipient`, 'The Recipient binds the assertion to one ACS URL.', 'Have the IdP set Recipient to the ACS URL.')
    if (expect && expect.acs && bearer.recipient && bearer.recipient !== expect.acs.trim()) add(list, 'critical', `${tag}: the Recipient is not your ACS URL`, `It says "${bearer.recipient}" but you expect "${expect.acs.trim()}".`, 'Correct the ACS URL at the IdP, character for character.')
  }
  if (msg.destination && bearer && bearer.recipient && msg.destination !== bearer.recipient) add(list, 'warning', `${tag}: Destination and Recipient differ`, `The response is addressed to "${msg.destination}" but the assertion's Recipient is "${bearer.recipient}". Many SPs require both to match.`, 'Make the Destination of the Response equal to the Recipient and the ACS URL.')
  if (!a.authn) add(list, 'info', `${tag} has no AuthnStatement`, 'It does not say how or when the user signed in. SPs usually require it.', '')
  else {
    const sx = toMs(a.authn.sessionNotOnOrAfter)
    if (sx != null && now >= sx) add(list, 'info', `${tag}: the IdP session has ended`, `SessionNotOnOrAfter is ${a.authn.sessionNotOnOrAfter}.`, '')
  }
  signatureChecks(a.signature, tag, list, { required: false })
  certificateChecks(a.signature, tag, list, now, expect, fps)
}

/**
 * Findings for one parsed message.
 *   options.now        the time to check validity against (ms). Default: now. A capture is only ever "valid" at the time it
 *                      was taken, so the page offers to use the time of the HAR entry instead.
 *   options.expect     { audience, acs, fingerprint } the user wants checked
 *   options.toleranceMs clock skew allowed (default 5 minutes, what most SPs allow)
 *   options.fingerprints  { [certificate base64]: { sha256, sha1 } }, needed only to compare against expect.fingerprint
 */
export function checkMessage(msg, options = {}) {
  const list = []
  const now = options.now ?? Date.now()
  const tolerance = options.toleranceMs ?? 5 * 60000
  const expect = options.expect || null
  const fps = options.fingerprints || null // { [certificate base64]: { sha256, sha1 } }
  if (msg.error) return [{ severity: 'critical', title: 'The message could not be read', detail: msg.error, fix: '' }]

  if (msg.version && msg.version !== '2.0') add(list, 'critical', `SAML version ${msg.version}`, 'Only SAML 2.0 is supported by modern identity providers.', 'Use SAML 2.0.')
  const issued = toMs(msg.issueInstant)
  if (issued != null && issued - now > tolerance) add(list, 'warning', 'The message was issued in the future', `IssueInstant is ${fmtDur(issued - now)} after the time of this check: the sender's clock is ahead.`, 'Synchronise the clocks (NTP).')
  if (!msg.id) add(list, 'warning', 'The message has no ID', 'Every SAML message needs an ID so it can be matched and replays can be detected.', '')
  else if (!/^[A-Za-z_]/.test(msg.id)) add(list, 'warning', 'The message ID is not a valid XML name', `"${msg.id}" starts with a digit or symbol. XML IDs must start with a letter or underscore, and some libraries reject this.`, 'Prefix generated IDs with an underscore or a letter.')

  if (msg.type === 'AuthnRequest') {
    const r = msg.request
    if (!msg.issuer) add(list, 'warning', 'The AuthnRequest has no Issuer', 'The IdP cannot tell which service provider is asking.', 'Set the SP entity ID as the Issuer.')
    if (!r.acsUrl && !r.acsIndex) add(list, 'info', 'No ACS URL in the request', 'The IdP will use the default ACS URL from its configuration for this SP.', '')
    if (r.acsUrl && !/^https:/i.test(r.acsUrl)) add(list, 'warning', 'The ACS URL is not HTTPS', r.acsUrl, 'Use HTTPS so the assertion is not exposed in transit.')
    if (expect && expect.acs && r.acsUrl && r.acsUrl !== expect.acs.trim()) add(list, 'critical', 'The request asks for a different ACS URL', `It asks for "${r.acsUrl}" but you expect "${expect.acs.trim()}".`, 'Fix the ACS URL in the SP configuration.')
    if (r.forceAuthn) add(list, 'info', 'ForceAuthn is set', 'The user will be asked to sign in again even with an active IdP session.', '')
    if (r.isPassive) add(list, 'info', 'IsPassive is set', 'The IdP must not show a sign-in page. If the user has no session it answers with NoPassive.', '')
    if (r.nameIdPolicy && r.nameIdPolicy.formatName && /unspecified/.test(r.nameIdPolicy.formatName) === false) add(list, 'info', `Requested NameID format: ${r.nameIdPolicy.formatName}`, 'If the IdP cannot supply this format it answers with InvalidNameIDPolicy.', '')
    if (!msg.signature && options.binding === 'HTTP-POST') add(list, 'info', 'The AuthnRequest is not signed', 'Many IdPs require signed requests only when the SP metadata says so.', '')
    signatureChecks(msg.signature, 'The request', list, { required: false })
    certificateChecks(msg.signature, 'The request', list, now, expect, fps)
  }

  if (msg.type === 'Response' || msg.type === 'ArtifactResponse') {
    const st = msg.status
    if (!st) add(list, 'warning', 'The response has no Status', 'A SAML response must carry a Status.', '')
    else if (!st.success) {
      add(list, 'critical', `The IdP answered ${st.subCodeName || st.codeName}`, `${st.meaning ? `${st.meaning}. ` : ''}${st.message ? `Message from the IdP: "${st.message}". ` : ''}${st.detail ? `Detail: ${st.detail}` : ''}`.trim() || `Status ${st.code}`, st.subCodeName === 'NoPassive' ? 'The user is not signed in at the IdP. Retry without IsPassive.' : st.subCodeName === 'InvalidNameIDPolicy' ? 'Align the NameID format in the request with what the IdP offers for this application.' : st.subCodeName === 'RequestDenied' || st.subCodeName === 'AuthnFailed' ? 'Check whether the user is assigned to the application at the IdP, and the IdP logs for the reason.' : 'Look up this status in the IdP logs.')
    } else add(list, 'ok', 'The IdP reports Success', st.subCode ? `Sub-status ${st.subCodeName}.` : '')
    if (st && st.success && !msg.assertions.length && !msg.encryptedAssertions) add(list, 'critical', 'Success, but no assertion', 'The status says Success but the response carries no Assertion, so there is nothing to sign the user in with.', 'Check the IdP: this usually means the user has no attributes mapped, or the assertion is encrypted for a key the SP does not have.')
    if (!msg.inResponseTo) add(list, 'info', 'No InResponseTo', 'This looks like an IdP-initiated sign-in (the IdP sent the response without a request). Some SPs refuse those.', '')
    if (msg.destination && !/^https:/i.test(msg.destination)) add(list, 'warning', 'The Destination is not HTTPS', msg.destination, 'Use HTTPS.')
    const signedElsewhere = msg.assertions.length > 0 && msg.assertions.every((a) => a.signature)
    signatureChecks(msg.signature, 'The response', list, { required: true, signedElsewhere })
    certificateChecks(msg.signature, 'The response', list, now, expect, fps)
    if (msg.encryptedAssertions) add(list, 'info', `${msg.encryptedAssertions} encrypted assertion${msg.encryptedAssertions === 1 ? '' : 's'}`, 'The assertion is encrypted for the service provider, so its contents (user, attributes, validity) cannot be read here. This is normal, and good practice.', 'To inspect it, decrypt it with the SP\'s private key or enable the SP\'s debug logging.')
    msg.assertions.forEach((a, i) => checkAssertion(a, i, msg, list, now, expect, tolerance, fps))
    if (msg.assertions.length > 1) add(list, 'info', `${msg.assertions.length} assertions in one response`, 'Unusual for browser SSO. SPs that only read the first one may ignore the rest.', '')
  }

  if (msg.type === 'LogoutRequest' && msg.request) {
    if (!msg.request.nameId) add(list, 'warning', 'The LogoutRequest has no NameID', 'The receiver cannot tell which user to sign out.', '')
    if (!msg.request.sessionIndexes.length) add(list, 'info', 'No SessionIndex', 'Without a SessionIndex the receiver signs the user out of every session.', '')
    signatureChecks(msg.signature, 'The logout request', list, { required: false })
  }
  if (msg.type === 'LogoutResponse') {
    const st = msg.status
    if (st && !st.success) add(list, st.subCodeName === 'PartialLogout' ? 'warning' : 'critical', `Logout did not complete: ${st.subCodeName || st.codeName}`, describeStatus(st.subCode || st.code), 'Check whether other service providers still hold a session for this user.')
    else if (st) add(list, 'ok', 'Logout succeeded', '')
  }
  if (!list.some((f) => f.severity !== 'ok' && f.severity !== 'info')) list.unshift(ok('No problems found on the face of the message', 'This does not prove the signature is valid or that the receiver will accept it: only the receiving side can check that.'))
  const order = { critical: 0, warning: 1, info: 2, ok: 3 }
  return list.sort((x, y) => order[x.severity] - order[y.severity])
}

/** How a request and the response to it line up (InResponseTo, timing). Used on the page to point out mismatches. */
export function linkExchange(items) {
  const reqs = items.filter((i) => i.parsed && i.parsed.type === 'AuthnRequest')
  const out = new Map()
  for (const it of items) {
    if (!it.parsed || it.parsed.type !== 'Response' || !it.parsed.inResponseTo) continue
    const r = reqs.find((q) => q.parsed.id === it.parsed.inResponseTo)
    const both = Number.isFinite(it.entry.startMs) && Number.isFinite(r && r.entry.startMs)
    out.set(it.id, r ? { request: r, ms: both ? it.entry.startMs - r.entry.startMs : null } : { missing: true })
  }
  return out
}

export const _skew = skew

// ---------------------------------------------------------------------------------------------------------------- flow-level analysis
// Looks at the messages of one sign-in together: who started it, whether the request and response agree, how long it took, and
// which identity provider it looks like. Takes the items the SAML page builds ({ parsed, entry, at, source }).

const PROVIDERS = [
  { name: 'Microsoft Entra ID / Azure AD', test: (m) => /sts\.windows\.net|login\.microsoftonline\.com/i.test(m.issuer || '') || /schemas\.microsoft\.com\/identity\/claims/.test(JSON.stringify((m.assertions || []).flatMap((a) => a.attributes.map((x) => x.name)))),
    tips: ['The Entity ID (audience) must match the "Identifier (Entity ID)" in the enterprise application exactly, including a trailing slash.', 'A user must be assigned to the application, unless assignment is not required (error AADSTS50105).', 'Group claims are sent as object IDs, and are replaced by a link when a user is in more than 150 groups (group overage).'] },
  { name: 'Okta', test: (m) => /okta\.com|oktapreview\.com/i.test(m.issuer || ''),
    tips: ['The ACS URL, audience and Name ID format in the Okta app must match the service provider\'s metadata.', 'A user must be assigned to the application, directly or through a group.', 'Okta signs the assertion by default; the response signature is optional ("Response" under Signature settings).'] },
  { name: 'Active Directory Federation Services (ADFS)', test: (m) => /\/adfs\/services\/trust|adfs/i.test(m.issuer || ''),
    tips: ['ADFS uses claim rules to build the assertion: a missing attribute usually means a missing or failing claim rule.', 'The Relying Party Trust identifier must match the audience, and its endpoint must match the ACS URL.', 'Token-signing certificates roll over automatically: the service provider needs the new one (check the federation metadata).'] },
  { name: 'Google Workspace', test: (m) => /accounts\.google\.com\/o\/saml2/i.test(m.issuer || ''),
    tips: ['Name ID defaults to the primary email address; check the format the service provider expects.', 'Changes in the Admin console can take a few minutes to apply.'] },
  { name: 'Keycloak', test: (m) => /\/realms\//i.test(m.issuer || ''),
    tips: ['Check "Valid redirect URIs" and the client\'s "Name ID format" in the realm.', '"Client signature required" must match whether the SP signs its requests.'] },
  { name: 'Shibboleth IdP', test: (m) => /\/idp\/shibboleth|shibboleth/i.test(m.issuer || ''),
    tips: ['Attributes are released by the attribute filter policy: a missing attribute is usually a missing release rule.', 'The relying-party metadata must be loaded and current for the SP.'] },
  { name: 'PingFederate / PingOne', test: (m) => /pingone|pingidentity|pingfederate/i.test(m.issuer || ''),
    tips: ['Check the SP connection\'s entity ID, ACS URL and attribute contract.'] },
  { name: 'OneLogin', test: (m) => /onelogin\.com/i.test(m.issuer || ''), tips: ['Check the application\'s "Audience (EntityID)" and "ACS URL Validator" settings.'] },
  { name: 'Auth0', test: (m) => /auth0\.com/i.test(m.issuer || '') || /^urn:[a-z0-9-]+\.auth0\.com/i.test(m.issuer || ''), tips: ['Check the SAML2 Web App add-on: Audience, Callback URL (ACS) and the mappings.'] },
  { name: 'SimpleSAMLphp', test: (m) => /simplesaml/i.test(m.issuer || ''), tips: ['Check the SP entry in saml20-sp-remote.php: AssertionConsumerService and the certificate.'] },
]

/** Which identity provider the first response looks like, with its common gotchas. Null when nothing matches. */
export function identifyProvider(items) {
  for (const it of items) {
    const m = it.parsed
    if (!m || m.error || m.type !== 'Response') continue
    const hit = PROVIDERS.find((p) => p.test(m))
    if (hit) return { name: hit.name, tips: hit.tips, issuer: m.issuer }
  }
  return null
}

/**
 * Findings that need several messages: initiation style, timing, request/response agreement, clock skew.
 * `items`: [{ parsed, entry, at, source, atIssued }] in capture order. Returns { checks, flow } where flow is 'sp' | 'idp' | 'unknown'.
 */
export function analyzeFlow(items) {
  const checks = []
  const msgs = items.filter((i) => i.parsed && !i.parsed.error)
  const requests = msgs.filter((i) => i.parsed.type === 'AuthnRequest')
  const responses = msgs.filter((i) => i.parsed.type === 'Response')
  if (!responses.length && !requests.length) return { checks, flow: 'unknown' }
  let flow = 'unknown'
  if (responses.length) {
    const unsolicited = responses.filter((r) => !r.parsed.inResponseTo)
    if (unsolicited.length === responses.length) {
      flow = 'idp'
      checks.push({ severity: 'info', title: 'IdP-initiated sign-in', detail: 'The response has no InResponseTo and no request came before it: the user started at the identity provider (a tile or bookmark), not at the application. Many service providers refuse these, or need a setting that allows unsolicited responses. They also cannot verify the response answers a request they made, so they are more open to replay.', fix: 'If the application rejects it, start the sign-in from the application instead, or enable "allow IdP-initiated SSO" on the service provider.' })
    } else flow = 'sp'
  } else if (requests.length) flow = 'sp'
  if (flow === 'sp') {
    for (const r of responses) {
      const req = requests.find((q) => q.parsed.id === r.parsed.inResponseTo)
      if (r.parsed.inResponseTo && !req && requests.length) checks.push({ severity: 'warning', title: 'The response answers a request that is not in this trace', detail: `InResponseTo = ${r.parsed.inResponseTo}, but the AuthnRequest in the trace has ID ${requests.map((q) => q.parsed.id).join(', ')}. Usually a second sign-in attempt, or the request happened before the capture started. If the SP stores the request ID in a session cookie that was lost, it will reject this as "InResponseTo mismatch".`, fix: '' })
      if (req) {
        const a = req.parsed.request
        // the response must go to where the request asked
        if (a && a.acsUrl && r.parsed.destination && a.acsUrl !== r.parsed.destination) checks.push({ severity: 'critical', title: 'The response went to a different address than the request asked for', detail: `The request asked for ${a.acsUrl}; the response's Destination is ${r.parsed.destination}.`, fix: 'The identity provider ignored the ACS URL in the request and used its own configured one. Make them equal.' })
        if (a && a.nameIdPolicy && a.nameIdPolicy.format) {
          const got = (r.parsed.assertions || []).map((x) => x.nameId && x.nameId.format).filter(Boolean)
          if (got.length && got.every((g) => g !== a.nameIdPolicy.format)) checks.push({ severity: 'warning', title: 'The NameID format is not the one requested', detail: `Requested ${a.nameIdPolicy.formatName}; the assertion uses ${got.map((g) => g.split(':').pop()).join(', ')}.`, fix: 'Align the NameID format on both sides, or the SP may not find the user.' })
        }
        if (a && a.authnContext && a.authnContext.classRefs.length) {
          const got = (r.parsed.assertions || []).map((x) => x.authn && x.authn.context).filter(Boolean)
          if (got.length && !got.some((g) => a.authnContext.classRefs.includes(g))) checks.push({ severity: 'warning', title: 'The authentication method is not what was requested', detail: `Requested ${a.authnContext.classRefs.map((x) => x.split(':').pop()).join(' or ')} (${a.authnContext.comparison}); the assertion says ${got.map((g) => g.split(':').pop()).join(', ')}. A strict SP rejects this.`, fix: '' })
        }
      }
    }
  }
  // timing between request and response
  for (const r of responses) {
    const req = requests.find((q) => q.parsed.id === r.parsed.inResponseTo)
    if (!req) continue
    const t1 = Date.parse(req.parsed.issueInstant), t2 = Date.parse(r.parsed.issueInstant)
    if (Number.isFinite(t1) && Number.isFinite(t2)) {
      const gap = t2 - t1
      if (gap < -tolDefault) checks.push({ severity: 'critical', title: 'The response is dated before the request it answers', detail: `The request says ${req.parsed.issueInstant}; the response ${r.parsed.issueInstant}, ${fmtDur(-gap)} earlier. The two sides' clocks disagree.`, fix: 'Synchronise both servers\' clocks (NTP).' })
      else if (gap > 10 * 60000) checks.push({ severity: 'warning', title: `The sign-in took ${fmtDur(gap)}`, detail: 'From request to response. Long gaps (a user who left the login page open, MFA, an approval) can exceed the SP\'s limit on how old a request may be.', fix: '' })
    }
  }
  // clock skew: the time the browser says it happened vs the time the IdP wrote (HAR only: the Date header of the response is the web server's clock)
  for (const r of responses) {
    const issued = Date.parse(r.parsed.issueInstant)
    if (r.at != null && Number.isFinite(issued) && !r.atIssued) {
      const skewMs = issued - r.at
      if (Math.abs(skewMs) > 2 * 60000) checks.push({ severity: Math.abs(skewMs) > 5 * 60000 ? 'warning' : 'info', title: `The IdP's clock differs from the capture's by ${fmtDur(skewMs)}`, detail: `The response says it was issued at ${r.parsed.issueInstant}; the browser recorded the request at ${new Date(r.at).toISOString()}. Most service providers allow about 5 minutes. (The capturing machine's own clock may be the one that is off.)`, fix: 'Check NTP on the identity provider and on the service provider.' })
    }
  }
  const prov = identifyProvider(items)
  return { checks, flow, provider: prov }
}
const tolDefault = 5 * 60000

// ---------------------------------------------------------------------------------------------------------------- attributes
const ENTRA_GROUPS = 'http://schemas.microsoft.com/ws/2008/06/identity/claims/groups'
const ENTRA_OVERAGE = ['http://schemas.microsoft.com/claims/groups.link', 'http://schemas.microsoft.com/claims/CommonStream']
const EMAILISH = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Checks on what an assertion says about the user. `expect.attributes`: names the service provider needs. */
export function checkAttributes(msg, { expect = {} } = {}) {
  const out = []
  for (const [i, a] of (msg.assertions || []).entries()) {
    const tag = (msg.assertions || []).length > 1 ? `Assertion ${i + 1}` : 'The assertion'
    const names = a.attributes.map((x) => x.name)
    if (!a.attributes.length) out.push({ severity: 'info', title: `${tag} carries no attributes`, detail: 'Only the NameID identifies the user. Fine if the service provider needs nothing else; if it expects a name, email or groups, the identity provider is not releasing them.', fix: 'Add the attributes to the IdP\'s release / claim configuration for this application.' })
    for (const x of a.attributes) {
      if (!x.values.length || x.values.every((v) => v === '')) out.push({ severity: 'warning', title: `The attribute "${x.friendlyName || x.name.split(/[/:]/).pop()}" is empty`, detail: 'It is released, but with no value. The user probably has nothing in that field in the directory.', fix: 'Fill the field for the user, or map a different source attribute.' })
      if (x.values.length > 50) out.push({ severity: 'info', title: `The attribute "${x.friendlyName || x.name.split(/[/:]/).pop()}" has ${x.values.length} values`, detail: 'Large attribute values make the response (and the form post) big. Some servers reject posts over 1 MB.', fix: '' })
    }
    // Entra group overage: more than 150 groups -> groups are NOT in the assertion, a link is
    const overage = a.attributes.find((x) => ENTRA_OVERAGE.includes(x.name))
    if (overage) out.push({ severity: 'critical', title: 'Group overage: the user\'s groups are NOT in the assertion', detail: 'The user belongs to too many groups for Microsoft Entra ID to list in the token (over 150 for SAML), so it sends a link to look them up instead. A service provider that expects the groups in the assertion sees none and denies access.', fix: 'In the Entra app, send only the groups assigned to the application ("Groups assigned to the application"), or use group filtering / app roles instead of all groups.' })
    const groups = a.attributes.find((x) => x.name === ENTRA_GROUPS)
    if (groups && groups.values.length && groups.values.every((v) => /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(v))) out.push({ severity: 'info', title: 'Groups are sent as object IDs (GUIDs)', detail: 'The service provider has to be configured with group IDs, not names. A role mapping written with group names never matches.', fix: 'Map the GUIDs, or change the claim to send group names (sAMAccountName / cloud-only names).' })
    // NameID that is not what it claims
    if (a.nameId && a.nameId.value) {
      const fmt = a.nameId.format || ''
      if (/emailAddress/.test(fmt) && !EMAILISH.test(a.nameId.value)) out.push({ severity: 'warning', title: 'The NameID is declared an email address, but is not one', detail: `Format emailAddress, value "${a.nameId.value}".`, fix: 'Send an email address, or change the NameID format to match what is sent.' })
      if (/transient/.test(fmt)) out.push({ severity: 'info', title: 'A transient NameID', detail: 'The value changes every sign-in, so a service provider cannot recognise a returning user by it. Fine only if the application identifies users by an attribute.', fix: '' })
      if (/persistent/.test(fmt) && EMAILISH.test(a.nameId.value)) out.push({ severity: 'info', title: 'A persistent NameID that looks like an email', detail: 'Persistent identifiers should be opaque and stable. An email address changes when a user is renamed.', fix: '' })
      if (a.nameId.raw && /^\s|\s$/.test(a.nameId.raw)) out.push({ severity: 'warning', title: 'The NameID has leading or trailing whitespace', detail: `The raw value is ${JSON.stringify(a.nameId.raw)}.`, fix: 'Trim it at the source; a service provider that matches it exactly will not find the user.' })
      const upper = /[A-Z]/.test(a.nameId.value) && EMAILISH.test(a.nameId.value)
      if (upper) out.push({ severity: 'info', title: 'The NameID email contains capital letters', detail: 'Some service providers compare it case-sensitively against a lower-case user record.', fix: '' })
    }
    for (const want of expect.attributes || []) {
      const hit = a.attributes.find((x) => x.name === want || x.friendlyName === want || x.name.split(/[/:]/).pop() === want)
      if (!hit) out.push({ severity: 'critical', title: `The attribute "${want}" is missing`, detail: `The assertion carries: ${names.map((n) => n.split(/[/:]/).pop()).join(', ') || 'none'}. Names are compared as the full URI, the friendly name, or the last part.`, fix: 'Add it to the IdP\'s attribute release for this application, and check the name matches exactly (case counts).' })
    }
  }
  return out
}
