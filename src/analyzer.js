// Rule-based HAR diagnostics. Each finding: { id, severity, category, title, detail, fix, ids }.
// `ids` are entry ids (indexes into har.entries).

export const SEVERITIES = ['critical', 'warning', 'info']

const STATIC_TYPES = new Set(['js', 'css', 'img', 'font'])
const TEXT_TYPES = new Set(['html', 'js', 'css', 'data'])
const SENSITIVE_PARAM = /(^|[_-])(token|password|passwd|pwd|secret|api[_-]?key|apikey|auth|session|sid|access[_-]?token)([_-]|$)/i

const STATUS_HINTS = {
  400: 'Malformed request. Check the payload, query parameters and Content-Type.',
  401: 'Not authenticated. The token or session is missing, expired or invalid.',
  403: 'Authenticated but not allowed. Check permissions/scopes, CORS or a WAF rule.',
  404: 'Resource not found. Likely a broken link, wrong path or a missing deploy asset.',
  405: 'HTTP method not allowed on this endpoint.',
  408: 'The server timed out waiting for the request.',
  409: 'Conflict with current server state (e.g. duplicate or stale version).',
  413: 'Request body too large for the server or proxy.',
  422: 'The server understood the request but rejected the data (validation error).',
  429: 'Rate limited. Back off and retry, or reduce request volume.',
  500: 'Unhandled server error. Check server logs for a stack trace.',
  501: 'Endpoint not implemented on the server.',
  502: 'Bad gateway. The proxy/load balancer got an invalid reply from the upstream service.',
  503: 'Service unavailable. The backend is down, overloaded or deploying.',
  504: 'Gateway timeout. The upstream service was too slow to respond.',
}

const hint = (s) => STATUS_HINTS[s] || (s >= 500 ? 'Server-side failure.' : 'Client-side request problem.')

function short(e) {
  return `${e.method} ${e.host}${e.path}`
}

export function analyze(har) {
  const { entries } = har
  const findings = []
  let seq = 0
  const add = (severity, category, title, detail, fix, list) => {
    const ids = [...new Set(list.map((e) => (typeof e === 'number' ? e : e.id)))]
    if (!ids.length) return
    findings.push({ id: `f${seq++}`, severity, category, title, detail, fix, ids })
  }
  const where = (fn) => entries.filter(fn)

  const doc =
    entries.find((e) => e.type === 'html' && e.status >= 200 && e.status < 300) ||
    entries.find((e) => e.type === 'html') ||
    entries[0]
  const pageIsHttps = !!doc && doc.isHttps

  // ---- Errors ---------------------------------------------------------------------------------
  const failed = where((e) => e.status === 0)
  if (failed.length) {
    const reasons = [...new Set(failed.map((e) => e.errorText).filter(Boolean))].slice(0, 3)
    add(
      'critical',
      'Errors',
      `${failed.length} request${failed.length > 1 ? 's' : ''} failed with no response`,
      `No HTTP status was recorded${reasons.length ? ` (${reasons.join('; ')})` : ''}. Typical causes: CORS preflight/policy blocks, DNS or TLS failure, connection reset or timeout, request cancelled by the page, or blocked by an extension/ad-blocker.`,
      'Open the browser console for the exact reason (CORS, net::ERR_*). For CORS, check Access-Control-Allow-* headers on the server.',
      failed,
    )
  }

  const byStatus = new Map()
  for (const e of entries) if (e.status >= 400) (byStatus.get(e.status) || byStatus.set(e.status, []).get(e.status)).push(e)
  for (const [status, list] of [...byStatus].sort((a, b) => b[0] - a[0])) {
    const text = list[0].statusText ? ` ${list[0].statusText}` : ''
    const sev = status >= 500 || status === 401 || status === 403 ? 'critical' : 'warning'
    add(sev, 'Errors', `HTTP ${status}${text} on ${list.length} request${list.length > 1 ? 's' : ''}`, hint(status),
      status === 404 ? 'Fix the URL, or deploy the missing asset.' : status >= 500 ? 'Investigate server logs for the failing endpoints.' : 'Inspect the request/response for these calls.', list)
  }

  // Failed then retried successfully
  const firstFail = new Map()
  const retried = []
  for (const e of entries) {
    const k = `${e.method} ${e.url}`
    if (e.error && !firstFail.has(k)) firstFail.set(k, e)
    else if (!e.error && firstFail.has(k)) retried.push(firstFail.get(k), e)
  }
  add('info', 'Errors', 'Requests that failed and later succeeded', 'The same URL failed first and then succeeded; this may be a client retry or a flaky backend.', 'Check why the first attempt failed (cold start, rate limit, transient network error).', retried)

  // ---- Redirects ------------------------------------------------------------------------------
  const byUrl = new Map()
  for (const e of entries) if (!byUrl.has(e.url)) byUrl.set(e.url, e)
  const longChains = []
  for (const e of entries) {
    if (e.status < 300 || e.status >= 400) continue
    const seen = new Set([e.id])
    const chain = [e]
    let cur = e
    while (cur.redirectUrl && chain.length < 12) {
      let next
      try { next = byUrl.get(new URL(cur.redirectUrl, cur.url).href) } catch { next = null }
      if (!next || seen.has(next.id)) break
      seen.add(next.id)
      chain.push(next)
      if (next.status < 300 || next.status >= 400) break
      cur = next
    }
    if (chain.length >= 4) longChains.push(...chain)
  }
  add('warning', 'Redirects', 'Long redirect chains (3+ hops)', 'Each hop adds a full round trip before content loads.', 'Link directly to the final URL and collapse intermediate redirects.', longChains)
  add('info', 'Redirects', 'Redirects found', 'Every redirect costs an extra round trip. Some (http→https, trailing slash) are avoidable.', 'Update links/clients to use the canonical final URL.', where((e) => e.status >= 300 && e.status < 400 && e.status !== 304))
  add('warning', 'Redirects', 'Redirect downgrades to http://', 'A redirect sends the client from a secure to an insecure URL.', 'Redirect to https:// targets only.', where((e) => e.isHttps && e.status >= 300 && e.status < 400 && /^http:\/\//i.test(e.redirectUrl)))

  // ---- Performance ----------------------------------------------------------------------------
  add('warning', 'Performance', 'Very slow requests (> 3 s)', 'These requests dominate load time.', 'Profile the backend/endpoint, add caching, or reduce payload.', where((e) => e.time > 3000))
  add('info', 'Performance', 'Slow requests (1–3 s)', 'Noticeable delay for the user.', 'Check server time (TTFB) vs transfer time to see where it goes.', where((e) => e.time > 1000 && e.time <= 3000))
  add('warning', 'Performance', 'Slow server response (TTFB > 1 s)', 'The server took over a second to start responding ("wait" phase).', 'Look at backend processing, database queries, cold starts or upstream calls.', where((e) => e.phases.wait > 1000 && e.status !== 0))
  add('warning', 'Performance', 'Slow DNS lookup (> 150 ms)', 'DNS resolution is delaying the first byte.', 'Use a faster DNS provider, add dns-prefetch/preconnect hints, reduce distinct hosts.', where((e) => e.phases.dns > 150))
  add('warning', 'Performance', 'Slow TCP connect (> 300 ms)', 'Connecting to the server is slow; the server may be far away or congested.', 'Use a CDN/closer region and preconnect to critical origins.', where((e) => e.phases.connect > 300))
  add('warning', 'Performance', 'Slow TLS handshake (> 300 ms)', 'Secure handshake is slow.', 'Enable TLS 1.3, session resumption and OCSP stapling.', where((e) => e.phases.ssl > 300))
  add('warning', 'Performance', 'Requests queued before sending (blocked > 500 ms)', 'The browser waited a long time before it could send these; often the 6-connections-per-host limit on HTTP/1.1.', 'Use HTTP/2 or HTTP/3, reduce requests per host, or shard/bundle assets.', where((e) => e.phases.blocked > 500))
  add('info', 'Performance', 'Slow download (receive > 1 s)', 'The body took long to arrive; the payload is large or bandwidth is low.', 'Compress and shrink the response, or serve it from a CDN.', where((e) => e.phases.receive > 1000))

  // ---- Payload & caching ----------------------------------------------------------------------
  add('warning', 'Payload', 'Large responses (> 1 MB)', 'Big transfers slow down load, especially on mobile.', 'Compress, paginate, lazy-load or split these resources.', where((e) => e.transfer > 1024 * 1024))
  add('warning', 'Payload', 'Heavy images (> 500 KB)', 'Oversized images are a common cause of slow pages.', 'Resize, use WebP/AVIF and lazy-load below-the-fold images.', where((e) => e.type === 'img' && e.transfer > 500 * 1024))
  add(
    'warning',
    'Payload',
    'Text responses sent without compression',
    'HTML/JS/CSS/JSON larger than 2 KB had no Content-Encoding header, so they were sent uncompressed.',
    'Enable gzip or brotli on the server/CDN.',
    where((e) => TEXT_TYPES.has(e.type) && e.contentSize > 2048 && e.status === 200 && e.transfer > 0 && !e.resHeaders['content-encoding']),
  )
  add(
    'info',
    'Caching',
    'Static assets without cache headers',
    'No Cache-Control, Expires or ETag/Last-Modified was found, so browsers cannot cache these effectively.',
    'Add Cache-Control: public, max-age=31536000, immutable for versioned assets.',
    where((e) => STATIC_TYPES.has(e.type) && e.status === 200 && !e.resHeaders['cache-control'] && !e.resHeaders.expires && !e.resHeaders.etag && !e.resHeaders['last-modified']),
  )
  add('info', 'Caching', 'Static assets marked no-store / no-cache', 'These files are re-downloaded on every visit.', 'Allow caching for static assets and use hashed filenames for busting.', where((e) => STATIC_TYPES.has(e.type) && /no-store|no-cache/i.test(e.resHeaders['cache-control'] || '')))

  const dupGroups = new Map()
  for (const e of entries) if (e.method === 'GET' && e.status === 200) (dupGroups.get(e.url) || dupGroups.set(e.url, []).get(e.url)).push(e)
  add('info', 'Efficiency', 'Same URL fetched multiple times', 'Identical GET requests were repeated (3+ times), wasting bandwidth.', 'Cache the result client-side or de-duplicate the calls.', [...dupGroups.values()].filter((g) => g.length >= 3).flat())
  add('warning', 'Content', 'Asset URL returned HTML', 'A .js/.css/.json/image URL returned text/html with 200, usually an SPA fallback or error page served instead of the file.', 'Check the deploy path/rewrite rules so missing assets return a real 404.', where((e) => e.status === 200 && e.type === 'html' && /\.(js|mjs|css|json|png|jpe?g|gif|svg|woff2?|map)(\?|$)/i.test(e.path)))

  // ---- CORS preflights ----------------------------------------------------------------------------
  // A browser sends an OPTIONS request first for many cross-origin calls; if that is not answered with 2xx the real request
  // is never sent, and the console only says "blocked by CORS policy".
  add(
    'warning',
    'Errors',
    'CORS preflight (OPTIONS) requests that failed',
    'The browser asks the server for permission with an OPTIONS request before some cross-origin calls. These were not answered with a 2xx status, so the real request was blocked.',
    'Make the server answer OPTIONS with 204/200 and the Access-Control-Allow-Origin, -Methods and -Headers headers the call needs.',
    where((e) => e.method === 'OPTIONS' && (e.status === 0 || e.status >= 300)),
  )
  // Cross-origin calls that were sent without a preflight even though the matching OPTIONS failed are not detectable from a HAR,
  // so only the failed preflight itself is reported.

  // ---- Request size ---------------------------------------------------------------------------------
  add(
    'warning',
    'Performance',
    'Very large request headers (> 8 KB)',
    'Large Cookie or other request headers are resent on every request to that host and are rejected by many servers and proxies (often as 431 or 400).',
    'Trim cookies, keep session data on the server, and scope cookies to the paths and hosts that need them.',
    where((e) => e.reqHeaderList.reduce((n, h) => n + String(h.name).length + String(h.value).length + 4, 0) > 8192),
  )
  add(
    'info',
    'Content',
    'Responses without a Content-Type',
    'These responses have a body but no Content-Type header, so browsers have to guess how to read them (and may refuse scripts and styles).',
    'Send the right Content-Type for every response, with X-Content-Type-Options: nosniff.',
    where((e) => e.status >= 200 && e.status < 300 && e.status !== 204 && e.transfer > 0 && !e.mime && !e.resHeaders['content-type']),
  )

  if (entries.length > 100) {
    findings.push({ id: `f${seq++}`, severity: 'info', category: 'Efficiency', title: `High request count (${entries.length})`, detail: 'Many requests increase load time and server load.', fix: 'Bundle, sprite, lazy-load or drop unneeded requests.', ids: [] })
  }
  const hostCount = har.summary.hosts.length
  if (hostCount > 15) {
    findings.push({ id: `f${seq++}`, severity: 'info', category: 'Efficiency', title: `Many distinct hosts (${hostCount})`, detail: 'Each new host needs its own DNS + TCP + TLS setup.', fix: 'Consolidate third-party scripts and preconnect to critical ones.', ids: [] })
  }
  const h1 = new Map()
  for (const e of entries) if (/^http\/1\.[01]$/i.test(e.httpVersion)) h1.set(e.host, (h1.get(e.host) || 0) + 1)
  const h1Busy = [...h1].filter(([, n]) => n > 10).map(([h]) => h)
  add('info', 'Efficiency', 'Busy hosts still on HTTP/1.x', `${h1Busy.join(', ')} served many requests over HTTP/1.x, which is limited to ~6 parallel connections.`, 'Enable HTTP/2 or HTTP/3.', where((e) => h1Busy.includes(e.host)))

  // ---- Security -------------------------------------------------------------------------------
  const mixed = where((e) => pageIsHttps && !e.isHttps && /^http:/i.test(e.url))
  add('critical', 'Security', 'Mixed content (http:// resources on an https:// page)', 'Browsers block or warn on insecure subresources, and they can be tampered with in transit.', 'Load every resource over https://.', mixed)
  add('warning', 'Security', 'Plain HTTP requests (no TLS)', 'Traffic is unencrypted and can be read or modified.', 'Serve everything over HTTPS and enable HSTS.', where((e) => /^http:/i.test(e.url) && !mixed.includes(e)))
  add('critical', 'Security', 'Credentials sent over plain HTTP', 'An Authorization header or cookie was sent without encryption.', 'Use HTTPS everywhere; rotate any credentials that were exposed.', where((e) => /^http:/i.test(e.url) && (e.reqHeaders.authorization || e.reqHeaders.cookie)))
  add('warning', 'Security', 'Secrets or tokens in the URL query string', 'URLs end up in logs, history and Referer headers.', 'Send secrets in headers or the request body instead.', where((e) => e.queryKeys.some((k) => SENSITIVE_PARAM.test(k))))

  if (doc) {
    const h = doc.resHeaders
    const missing = []
    if (doc.isHttps && !h['strict-transport-security']) missing.push('Strict-Transport-Security')
    if (!h['content-security-policy']) missing.push('Content-Security-Policy')
    if (!h['x-content-type-options']) missing.push('X-Content-Type-Options')
    if (!h['x-frame-options'] && !/frame-ancestors/i.test(h['content-security-policy'] || '')) missing.push('X-Frame-Options / frame-ancestors')
    if (missing.length) add('warning', 'Security', 'Main document is missing security headers', `Missing: ${missing.join(', ')}.`, 'Add these headers at the server/CDN to harden against XSS, clickjacking and downgrade attacks.', [doc])
  }

  const cookieSecure = []
  const cookieHttpOnly = []
  const cookieSameSite = []
  for (const e of entries) {
    for (const c of e.setCookies) {
      if (e.isHttps && !/;\s*secure/i.test(c)) cookieSecure.push(e)
      if (!/;\s*httponly/i.test(c)) cookieHttpOnly.push(e)
      if (!/;\s*samesite/i.test(c)) cookieSameSite.push(e)
    }
  }
  add('warning', 'Security', 'Cookies set without the Secure flag', 'These cookies can be sent over plain HTTP.', 'Add the Secure attribute.', cookieSecure)
  add('info', 'Security', 'Cookies set without HttpOnly', 'JavaScript can read these cookies (XSS risk), which matters for session cookies.', 'Add HttpOnly to cookies JS does not need.', cookieHttpOnly)
  add('info', 'Security', 'Cookies set without SameSite', 'Browsers default to Lax, but being explicit avoids CSRF and cross-site surprises.', 'Add SameSite=Lax or Strict (None; Secure for cross-site).', cookieSameSite)
  add('info', 'Security', 'Server version disclosed in headers', 'Server / X-Powered-By headers reveal software details to attackers.', 'Remove or genericise these headers.', where((e) => /\d/.test(e.resHeaders.server || '') || e.resHeaders['x-powered-by']))

  const order = { critical: 0, warning: 1, info: 2 }
  findings.sort((a, b) => order[a.severity] - order[b.severity] || b.ids.length - a.ids.length)
  return findings
}

// 100 = clean. Each distinct problem costs points by severity.
export function healthScore(findings, dismissed) {
  const cost = { critical: 12, warning: 5, info: 1 }
  const counted = dismissed && dismissed.size ? findings.filter((f) => !dismissed.has(findingKey(f))) : findings
  return Math.max(0, 100 - counted.reduce((s, f) => s + cost[f.severity], 0))
}

export { short as shortName }

/** Identifies the same kind of finding in different captures: its ids and the numbers in its title (counts) differ. */
export const findingKey = (f) => `${f.severity}|${f.category}|${f.title.replace(/\d+/g, '#')}`

const cache = new WeakMap()
export function analyzeCached(har) {
  let r = cache.get(har)
  if (!r) {
    r = analyze(har)
    cache.set(har, r)
  }
  return r
}
