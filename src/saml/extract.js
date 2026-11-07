// Finding SAML in a HAR. A SAML message travels as a SAMLRequest / SAMLResponse (or SAMLArt) form field or query parameter, in
// a POST body (the HTTP-POST binding), in a redirect URL (HTTP-Redirect), in a response page that auto-submits a form to the
// other party, or, for logout and artifact resolution, as a SOAP body. This scans every request and response for those.
import { decodePayload } from '../formats/binary'

const PARAMS = ['SAMLRequest', 'SAMLResponse', 'SAMLart']
const FIELD_RE = /(?:^|[?&;])(SAMLRequest|SAMLResponse|SAMLart)=([^&#\s]*)/g
// <input type="hidden" name="SAMLResponse" value="..."> with the attributes in either order and either quote style
const INPUT_RE = /<input\b[^>]*>/gi
const ATTR_RE = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g

const decodeEntities = (s) => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')

function* fromUrl(url) {
  if (!url || !/SAML(Request|Response|art)=/.test(url)) return
  const q = url.indexOf('?')
  const query = q >= 0 ? url.slice(q) : ''
  for (const m of query.matchAll(FIELD_RE)) yield { param: m[1], value: m[2], where: 'query', binding: 'HTTP-Redirect' }
}

function* fromBody(text) {
  if (!text || !/SAML(Request|Response|art)/.test(text)) return
  for (const m of text.matchAll(FIELD_RE)) yield { param: m[1], value: m[2], where: 'form', binding: 'HTTP-POST' }
}

function* fromHtml(html) {
  if (!html || !/SAML(Request|Response|art)/.test(html)) return
  for (const tag of html.matchAll(INPUT_RE)) {
    const a = {}
    for (const m of tag[0].matchAll(ATTR_RE)) a[m[1].toLowerCase()] = m[2] ?? m[3] ?? ''
    if (PARAMS.includes(a.name) && a.value) yield { param: a.name, value: decodeEntities(a.value), where: 'page', binding: 'HTTP-POST' }
  }
}

// A SOAP body or a bare SAML document sent as the request or response body (back-channel logout, artifact resolution)
function bareXml(text) {
  if (!text) return null
  const t = text.trim()
  if (!t.startsWith('<')) return null
  return /(samlp?:|saml2p?:)?(AuthnRequest|Response|LogoutRequest|LogoutResponse|ArtifactResolve|ArtifactResponse|Assertion)\b/.test(t.slice(0, 4000)) ? t : null
}

/** Raw hits (not yet decoded) for one HAR entry. Pure, so it is easy to test. */
export function findIn(entry, raw) {
  const hits = []
  for (const h of fromUrl(entry.url)) hits.push({ ...h, direction: 'request' })
  const post = raw && raw.request && raw.request.postData
  if (post) {
    let any = false
    for (const p of post.params || []) {
      if (PARAMS.includes(p.name) && p.value) { hits.push({ param: p.name, value: p.value, where: 'form', binding: 'HTTP-POST', direction: 'request' }); any = true }
    }
    if (!any) for (const h of fromBody(post.text)) hits.push({ ...h, direction: 'request' })
    if (!any && !hits.length) {
      const xml = bareXml(post.text)
      if (xml) hits.push({ param: 'body', value: xml, where: 'body', binding: 'SOAP / back-channel', direction: 'request', plain: true })
    }
  }
  const res = raw && raw.response && raw.response.content
  if (res && res.text) {
    let body = res.text
    if (res.encoding === 'base64') {
      try { body = new TextDecoder().decode(Uint8Array.from(atob(body), (c) => c.charCodeAt(0))) } catch { body = '' }
    }
    for (const h of fromHtml(body)) hits.push({ ...h, direction: 'response' })
    if (!hits.some((h) => h.direction === 'response')) {
      const xml = bareXml(body)
      if (xml) hits.push({ param: 'body', value: xml, where: 'body', binding: 'SOAP / back-channel', direction: 'response', plain: true })
    }
  }
  // the same blob often shows up twice (once in the URL, once in the page that echoes it): keep one
  const seen = new Set()
  return hits.filter((h) => {
    const k = `${h.direction}|${h.param}|${h.value.slice(0, 200)}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/**
 * Every SAML message in a parsed HAR: [{ entry, hit, raw, xml, steps, error, relayState }], in the order the browser sent them.
 * `har.entries[i].rawIndex` points back to the original log entry (the parser keeps it for exactly this kind of lookup).
 */
export async function extractSaml(har) {
  const list = (har.raw && har.raw.log && har.raw.log.entries) || []
  const out = []
  for (const entry of har.entries) {
    const raw = list[entry.rawIndex]
    const hits = findIn(entry, raw)
    if (!hits.length) continue
    const relay = relayStateOf(entry, raw)
    for (const hit of hits) {
      const at = raw && Date.parse(raw.startedDateTime)
      const item = { id: `${entry.id}:${hit.param}:${hit.direction}`, entry, hit, relayState: relay, at: Number.isFinite(at) ? at : null }
      if (hit.param === 'SAMLart') {
        item.artifact = true
        item.error = 'This is a SAML artifact: a small reference, not the message itself. The message is fetched server to server (ArtifactResolve), which a browser capture cannot see.'
      } else if (hit.plain) {
        item.xml = hit.value
        item.steps = ['Plain XML body']
      } else {
        try { Object.assign(item, await decodePayload(hit.value)) } catch (e) { item.error = e.message }
      }
      out.push(item)
    }
  }
  return out
}

function relayStateOf(entry, raw) {
  const fromQuery = /[?&]RelayState=([^&#]*)/.exec(entry.url)
  if (fromQuery) return safeDecode(fromQuery[1])
  const post = raw && raw.request && raw.request.postData
  if (post) {
    const p = (post.params || []).find((x) => x.name === 'RelayState')
    if (p) return p.value
    const m = /(?:^|&)RelayState=([^&]*)/.exec(post.text || '')
    if (m) return safeDecode(m[1])
  }
  return ''
}
function safeDecode(v) { try { return decodeURIComponent(v.replace(/\+/g, ' ')) } catch { return v } }

/**
 * Whatever the user pasted: a SAML blob on its own, an XML document, a whole URL (…?SAMLRequest=…&RelayState=…), a form body
 * (SAMLResponse=…&RelayState=…) or an HTML page with the hidden field. Returns the decoded item, or { error }.
 */
export async function fromPasted(input) {
  const raw = String(input || '').trim()
  if (!raw) return { error: 'Paste a SAML message first.' }
  let value = raw
  let param = 'pasted'
  let binding = 'pasted'
  let relayState = ''
  const hits = [...fromUrl(raw.includes('?') ? raw : `?${raw}`), ...fromBody(raw), ...fromHtml(raw)]
  if (hits.length) {
    const h = hits[0]
    value = h.value
    param = h.param
    binding = h.binding
    const m = /(?:^|[?&])RelayState=([^&#\s]*)/.exec(raw)
    if (m) relayState = safeDecode(m[1])
  }
  if (param === 'SAMLart') return { error: 'This is a SAML artifact: a small reference, not the message. The message is fetched server to server, so there is nothing to decode here.' }
  try {
    const decoded = await decodePayload(value)
    return { id: `pasted:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`, pasted: true, hit: { param, where: 'pasted', binding, direction: 'pasted' }, relayState, at: null, ...decoded }
  } catch (e) {
    return { error: e.message }
  }
}

/** How many SAML messages a HAR carries, without decoding any of them. Cheap enough to run on every upload. */
export function countSaml(har) {
  const list = (har.raw && har.raw.log && har.raw.log.entries) || []
  let n = 0
  for (const entry of har.entries) n += findIn(entry, list[entry.rawIndex]).length
  return n
}
