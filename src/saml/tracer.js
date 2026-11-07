// Reading an export from the SAML-tracer browser extension (https://github.com/simplesamlphp/SAML-tracer).
//
// The format, taken from the extension's own import/export code (src/SAMLTraceIO.js, src/SAMLTrace.js):
//   { requests: [ ... ], timestamp: "2026-11-06T12:00:00.000Z" }
// and each request is
//   { method, url, requestId, requestHeaders: [{name, value}], get: [[k, v]], post: [[k, v]],
//     protocol: "SAML-P" | "WS-Fed", saml: "<decoded XML>", samlart: "...",
//     responseStatus, responseStatusText, responseHeaders: [{name, value}] }
// Older exports (before v1.0.0) have `id` instead of `requestId` and headers as [name, value] pairs.
//
// Two things matter for the analysis:
//   - the extension has already decoded the message (`saml`), so there is nothing to inflate in the usual case;
//   - the export records NO time for each request, only when the file was written. See `atIssued` below.
import { decodePayload } from '../formats/binary'

const PARAMS = ['SAMLRequest', 'SAMLResponse', 'SAMLart']
// The extension's "hash" and "obfuscate" cookie profiles replace form values with {hash:...} or {obf:N}
const MASKED = /^\{(hash|obf):/

/** True when the parsed JSON looks like a SAML-tracer export (and not a HAR, which has a top-level `log`). */
export function isTracerExport(json) {
  if (!json || typeof json !== 'object' || json.log || !Array.isArray(json.requests)) return false
  if (!json.requests.length) return true
  const first = json.requests[0]
  return !!first && typeof first === 'object' && typeof first.url === 'string' && typeof first.method === 'string'
}

// [[k, v]] (current and old exports) or [{name, value}] (headers) -> [[k, v]]
const pairs = (list) => (Array.isArray(list)
  ? list.map((p) => (Array.isArray(p) ? [String(p[0] ?? ''), p[1] == null ? '' : String(p[1])] : p && typeof p === 'object' ? [String(p.name ?? ''), String(p.value ?? '')] : null)).filter(Boolean)
  : [])
const find = (list, name) => { const p = list.find(([k]) => k === name); return p ? p[1] : null }

function queryPairs(url) {
  try { return [...new URL(url).searchParams.entries()] } catch { return [] }
}

/**
 * Parse a SAML-tracer export. Returns
 *   { name, exportedAt, total, legacy, masked, maskedButDecoded, requests: [...], items: [...] }
 * `requests` is every request in order (the sequence view); `items` are the ones that carry a SAML message, in the same shape
 * extractSaml() gives for a HAR, plus `source: 'tracer'`, `seq` and `atIssued: true`.
 */
let traceSeq = 0
export async function parseTracerExport(json, name) {
  const uid = ++traceSeq
  const reqs = json.requests
  const out = {
    uid,
    name,
    exportedAt: typeof json.timestamp === 'string' ? json.timestamp : '',
    total: reqs.length,
    legacy: reqs.length > 0 && !!reqs[0] && !('requestId' in reqs[0]),
    masked: false,
    maskedButDecoded: false,
    requests: [],
    items: [],
  }
  for (let i = 0; i < reqs.length; i++) {
    const r = reqs[i] && typeof reqs[i] === 'object' ? reqs[i] : {}
    const url = typeof r.url === 'string' ? r.url : ''
    let host = ''
    let path = url
    try { const u = new URL(url); host = u.host; path = u.pathname } catch { /* keep the raw text */ }
    const method = String(r.method || 'GET')
    const get = pairs(r.get).length ? pairs(r.get) : queryPairs(url)
    const post = pairs(r.post)
    const status = Number(r.responseStatus) || 0
    const wsfed = r.protocol === 'WS-Fed'

    const param = wsfed ? 'wresult' : PARAMS.find((p) => find(get, p) != null || find(post, p) != null) || ''
    const inGet = param && find(get, param) != null
    const saml = typeof r.saml === 'string' && r.saml.trim() ? r.saml : ''
    const artifact = !wsfed && (param === 'SAMLart' || (typeof r.samlart === 'string' && r.samlart !== ''))
    const rawValue = param ? (inGet ? find(get, param) : find(post, param)) : null
    if (post.some(([, v]) => MASKED.test(v))) { out.masked = true; if (saml) out.maskedButDecoded = true }

    const row = { n: i + 1, method, host, path, status, saml: false, kind: '', itemId: '' }
    out.requests.push(row)
    if (!param && !saml && !artifact) continue

    const item = {
      id: `t${uid}:${i}`,
      source: 'tracer',
      traceName: name,
      seq: i + 1,
      entry: { id: i, method, host, path, url, status, startMs: null },
      hit: { param: param || 'saml', where: inGet ? 'query' : 'form', binding: inGet ? 'HTTP-Redirect' : 'HTTP-POST', direction: 'request' },
      relayState: find(get, 'RelayState') ?? find(post, 'RelayState') ?? '',
      at: null,
      atIssued: true, // no time was recorded: the page checks validity as of the moment the message says it was issued
      wsfed,
    }
    if (MASKED.test(item.relayState)) item.relayState = ''
    row.saml = true
    row.itemId = item.id
    row.kind = wsfed ? 'WS-Fed' : artifact ? 'artifact' : param || 'SAML'

    if (saml) {
      item.xml = saml
      item.steps = ['Already decoded by SAML-tracer']
    } else if (artifact) {
      item.artifact = true
      item.error = 'This is a SAML artifact: a small reference, not the message itself. The message is fetched server to server (ArtifactResolve), which a browser trace cannot see.'
    } else if (rawValue != null && MASKED.test(rawValue)) {
      item.error = 'This export was made with a cookie profile that masks form values, and it does not hold the decoded message for this request, so there is nothing to read.'
    } else if (rawValue) {
      try { Object.assign(item, await decodePayload(rawValue)) } catch (e) { item.error = e.message }
    } else {
      item.error = 'SAML-tracer flagged this request but the export holds no message for it.'
    }
    out.items.push(item)
  }
  return out
}
