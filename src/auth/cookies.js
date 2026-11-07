// Cookie and session analysis of a HAR.
//
// Two questions come up when a sign-in loops or a session "does not stick":
//   1. Did the browser ACCEPT the cookie the server tried to set? (Set-Cookie rules: Secure, SameSite=None needs Secure, prefixes,
//      Domain, size, third-party context.)
//   2. Did the browser SEND it back where it should have? This replays the capture against a model of the browser's cookie jar
//      and reports the requests that SHOULD have carried a cookie but did not.
//
// Limits, all stated in the UI too:
//   - "Same site" is judged without the Public Suffix List (a short built-in list of common multi-part suffixes stands in).
//   - A navigation is recognised from the request's own headers (Sec-Fetch-Dest/Mode, Accept) or Chrome's _resourceType.
//   - The browser's own settings (blocking third-party cookies, Safari's ITP, extensions) are not in a HAR. A cookie that was
//     expected but not sent may simply have been blocked by one of those.
//   - Chrome's default "Save all as HAR" REMOVES cookies ("sanitized"). With none in the capture, nothing here can be judged.

const SESSIONY = /sess|(^|[^a-z])sid([^a-z]|$)|auth|token|jwt|login|sso|msal|okta|idp|saml|bearer/i
const MULTI = new Set(['co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au', 'co.nz', 'org.nz', 'co.jp', 'ne.jp', 'or.jp', 'co.in', 'net.in', 'org.in', 'com.br', 'com.cn', 'com.mx', 'co.za', 'com.sg', 'com.hk', 'com.tw', 'com.tr', 'co.kr', 'com.ar',
  // private suffixes: sites on these are not the same site as their neighbours
  'github.io', 'herokuapp.com', 'netlify.app', 'vercel.app', 'pages.dev', 'appspot.com', 'azurewebsites.net', 'cloudfront.net', 'web.app', 'firebaseapp.com', 'onrender.com', 'fly.dev', 'workers.dev'])

const isIp = (h) => /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(':')
const bareHost = (host) => String(host || '').toLowerCase().replace(/:\d+$/, '').replace(/^\[|\]$/g, '')

/** The "site" (registrable domain, approximately) of a host. IP addresses and single-label hosts are their own site. */
export function siteOf(host) {
  const h = bareHost(host)
  if (!h || isIp(h) || !h.includes('.')) return h
  const labels = h.split('.')
  const two = labels.slice(-2).join('.')
  return MULTI.has(two) && labels.length >= 3 ? labels.slice(-3).join('.') : two
}

const isLocal = (h) => h === 'localhost' || h.endsWith('.localhost') || /^127\./.test(h) || h === '::1'
export const domainMatch = (host, domain) => host === domain || host.endsWith(`.${domain}`)
export function pathMatch(reqPath, cookiePath) {
  if (reqPath === cookiePath) return true
  if (!reqPath.startsWith(cookiePath)) return false
  return cookiePath.endsWith('/') || reqPath.charAt(cookiePath.length) === '/'
}
const defaultPath = (p) => { if (!p || !p.startsWith('/')) return '/'; const i = p.lastIndexOf('/'); return i <= 0 ? '/' : p.slice(0, i) }

/** Parse one Set-Cookie header value. */
export function parseSetCookie(header) {
  const parts = String(header).split(';')
  const first = parts.shift() || ''
  const eq = first.indexOf('=')
  const c = {
    raw: header, name: (eq < 0 ? '' : first.slice(0, eq)).trim(), value: (eq < 0 ? first : first.slice(eq + 1)).trim(),
    domain: null, path: null, expires: null, maxAge: null, secure: false, httpOnly: false, sameSite: null, sameSiteInvalid: false, partitioned: false, priority: '',
    size: 0,
  }
  c.size = c.name.length + c.value.length
  for (const part of parts) {
    const i = part.indexOf('=')
    const k = (i < 0 ? part : part.slice(0, i)).trim().toLowerCase()
    const v = i < 0 ? '' : part.slice(i + 1).trim()
    if (k === 'domain') c.domain = v.replace(/^\./, '').toLowerCase()
    else if (k === 'path') c.path = v
    else if (k === 'expires') { const t = Date.parse(v); c.expires = Number.isFinite(t) ? t : null }
    else if (k === 'max-age') { const n = Number(v); c.maxAge = Number.isFinite(n) && /^-?\d+$/.test(v) ? n : null }
    else if (k === 'secure') c.secure = true
    else if (k === 'httponly') c.httpOnly = true
    else if (k === 'samesite') { const s = v.toLowerCase(); if (['lax', 'strict', 'none'].includes(s)) c.sameSite = s; else c.sameSiteInvalid = true }
    else if (k === 'partitioned') c.partitioned = true
    else if (k === 'priority') c.priority = v.toLowerCase()
  }
  return c
}

const f = (severity, title, detail, fix) => ({ severity, title, detail, fix })

// Is this entry a top-level navigation (what changes which site the user is "on")?
function isNavigation(entry, raw) {
  const rt = raw && raw._resourceType
  if (rt) return String(rt).toLowerCase() === 'document'
  const dest = entry.reqHeaders['sec-fetch-dest']
  if (dest) return dest === 'document'
  const mode = entry.reqHeaders['sec-fetch-mode']
  if (mode) return mode === 'navigate'
  return /text\/html/i.test(entry.reqHeaders.accept || '')
}

/**
 * Decide whether the browser would store this Set-Cookie. Returns { ok, reasons: [{ severity, title, detail, fix }], deletes, expiresAt, cap }.
 * `ctx`: { host, https, crossSite (the response came from a different site than the top-level page), navigation, now }.
 */
export function judgeSetCookie(c, ctx) {
  const reasons = []
  const host = bareHost(ctx.host)
  const local = isLocal(host)
  const bad = (title, detail, fix) => reasons.push({ severity: 'critical', title, detail, fix })
  if (!c.name && !c.value) bad('The cookie is empty', 'It has neither a name nor a value.', 'Fix the Set-Cookie header the server sends.')
  if (c.size > 4096) bad('The cookie is too large', `Name and value are ${c.size} bytes. Browsers refuse anything over 4096 bytes.`, 'Keep the session data on the server and store only an id in the cookie.')
  if (c.secure && !ctx.https && !local) bad('Secure cookie set over plain HTTP', 'A cookie with Secure cannot be set from an http:// page; the browser drops it.', 'Serve the site over HTTPS (and check redirects from http:// to https:// happen before the cookie is set).')
  if (c.sameSite === 'none' && !c.secure) bad('SameSite=None without Secure', 'Browsers (Chrome, Edge, Firefox, Safari) refuse a SameSite=None cookie that is not also Secure.', 'Add Secure (and serve over HTTPS).')
  const lower = c.name.toLowerCase()
  if (lower.startsWith('__secure-') && !(c.secure && (ctx.https || local))) bad('A __Secure- cookie without Secure over HTTPS', 'The __Secure- prefix requires the Secure attribute and an https:// origin.', 'Add Secure, or drop the prefix.')
  if (lower.startsWith('__host-') && !(c.secure && (ctx.https || local) && c.domain === null && c.path === '/')) bad('A __Host- cookie that breaks the prefix rules', 'The __Host- prefix requires Secure, Path=/, no Domain attribute, and an https:// origin.', 'Use Secure; Path=/ and remove Domain, or drop the prefix.')
  if (c.domain !== null) {
    if (!c.domain.includes('.') && !local) bad('Domain is a bare top-level name', `Domain=${c.domain} is a public suffix or not a valid cookie domain, so the browser rejects it.`, 'Use your own domain (for example example.com), or omit Domain to make the cookie host-only.')
    else if (!domainMatch(host, c.domain)) bad('Domain does not match the host', `The cookie says Domain=${c.domain}, but it was set by ${host}. A host can only set cookies for itself and its parent domains.`, 'Set Domain to the host\'s own domain or a parent of it, or omit it.')
  }
  if (c.partitioned && !c.secure) bad('Partitioned without Secure', 'Partitioned (CHIPS) cookies must be Secure.', 'Add Secure.')
  // third-party context: a cookie set in a response from another site than the page needs SameSite=None
  const effective = c.sameSite || 'lax'
  if (ctx.crossSite && !ctx.navigation && effective !== 'none') {
    reasons.push({ severity: 'critical', title: 'Set by a third-party response without SameSite=None', detail: `This response came from a different site than the page the user was on, and the cookie is ${c.sameSite ? `SameSite=${c.sameSite}` : 'SameSite unspecified (treated as Lax)'}. Browsers drop it.`, fix: 'If the cookie must work inside another site (an embedded widget, a cross-site API call), set SameSite=None; Secure. Otherwise call the API from the same site.' })
  }

  // expiry
  let expiresAt = null
  let deletes = false
  if (c.maxAge !== null) { expiresAt = ctx.now + c.maxAge * 1000; deletes = c.maxAge <= 0 } else if (c.expires !== null) { expiresAt = c.expires; deletes = c.expires <= ctx.now }
  let cap = false
  if (expiresAt !== null && !deletes && expiresAt - ctx.now > 400 * 86400e3) cap = true
  return { ok: !reasons.length, reasons, deletes, expiresAt, cap }
}

/**
 * Analyse the cookies of a parsed HAR. Returns
 * { cookies: [...], problems: [...], stats: { setCount, sentCount, requestsWithCookies, hasAny, sanitized } }
 * Each cookie: { key, name, domain, hostOnly, path, attrs, state ('stored' | 'rejected' | 'deleted' | 'earlier'), sets: [...], sends: [...], missed: [...], checks: [...] }.
 */
export function analyzeCookies(har) {
  const raws = (har.raw && har.raw.log && har.raw.log.entries) || []
  const entries = [...har.entries].sort((a, b) => a.startMs - b.startMs)
  const when = (e) => { const t = Date.parse((raws[e.rawIndex] || {}).startedDateTime); return Number.isFinite(t) ? t : e.startMs }
  let anySet = 0
  let anySent = 0
  for (const e of entries) { anySet += e.setCookies.length; if (e.reqCookies.length) anySent += 1 }
  const stats = { setCount: anySet, requestsWithCookies: anySent, hasAny: anySet > 0 || anySent > 0, sanitized: !(anySet > 0 || anySent > 0) && entries.length > 0 }
  const records = new Map() // key -> record
  const jar = new Map() // key -> { rec, host, domain, hostOnly, path, secure, sameSite, expiresAt, setAt, setEntry }
  const problems = []

  const keyOf = (name, domain, path) => `${name}\u0000${domain}\u0000${path}`
  const rec = (name, domain, hostOnly, path, attrs) => {
    const key = keyOf(name, domain, path)
    let r = records.get(key)
    if (!r) { r = { key, name, domain, hostOnly, path, attrs, state: 'stored', sets: [], sends: [], missed: [], checks: [] }; records.set(key, r) }
    return r
  }
  const report = (r, check, entry) => { const c = { ...check, entryId: entry ? entry.id : null }; r.checks.push(c); problems.push({ ...c, cookie: r.name, domain: r.domain, key: r.key }) }

  let topSite = null
  const suppressMissed = anySent === 0 // with no cookie ever sent, the capture was almost certainly stripped: do not call that a browser problem

  for (const e of entries) {
    const raw = raws[e.rawIndex]
    const now = when(e)
    const host = bareHost(e.host)
    const site = siteOf(host)
    const nav = isNavigation(e, raw)
    if (topSite === null || nav) topSite = site
    const crossSite = site !== topSite
    const https = e.isHttps

    // ---- request side: what should have been sent, and what was
    const sentNames = new Set()
    const sentList = e.reqCookies || []
    const counts = {}
    for (const c of sentList) { sentNames.add(c.name); counts[c.name] = (counts[c.name] || 0) + 1 }
    const reqPath = e.path || '/'
    const sentByName = new Map()
    for (const c of sentList) {
      // attach to a jar record when one matches, else it is a cookie from before the capture
      let match = null
      for (const j of jar.values()) {
        if (j.rec.name === c.name && (j.hostOnly ? j.domain === host : domainMatch(host, j.domain)) && pathMatch(reqPath, j.path)) { match = j; break }
      }
      let r
      if (match) r = match.rec
      else {
        r = [...records.values()].find((x) => x.name === c.name && x.state === 'earlier' && x.domain === host)
        if (!r) { r = rec(c.name, host, true, '/', null); r.state = 'earlier' }
      }
      r.sends.push({ entryId: e.id, at: now, https, host })
      sentByName.set(c.name, r)
      if (SESSIONY.test(c.name) && !https && !isLocal(host)) report(r, f('warning', 'A session-looking cookie was sent over plain HTTP', `Sent to http://${e.host}${e.path}. Anyone on the network path can read it.`, 'Serve everything over HTTPS and mark the cookie Secure.'), e)
    }
    for (const [name, n] of Object.entries(counts)) {
      if (n > 1) {
        const r = sentByName.get(name)
        if (r) report(r, f('warning', `Two cookies named "${name}" were sent together`, `The request to ${e.host}${e.path} carried "${name}" ${n} times. They come from different domains or paths (or one was set with and one without Domain). Servers usually read the first, so the wrong one may win.`, 'Pick one scope for the cookie. Clear the stale one by setting it with Max-Age=0 and the same Domain and Path it was created with.'), e)
      }
    }
    const headerSize = (e.reqHeaders.cookie || '').length
    if (headerSize > 8000) {
      const r = sentByName.values().next().value || rec('(Cookie header)', host, true, '/', null)
      report(r, f(e.status === 400 || e.status === 431 ? 'critical' : 'warning', `The Cookie header is ${(headerSize / 1024).toFixed(1)} KB`, `${e.method} ${e.host}${e.path} carried ${sentList.length} cookies. Most servers refuse headers over about 8 KB${e.status === 400 || e.status === 431 ? `, and this one answered ${e.status}` : ''}.`, 'Remove cookies that are no longer needed, shrink the large ones, and scope cookies to the paths that need them.'), e)
    }

    // ---- what the jar says should have been sent
    if (!suppressMissed) {
      for (const j of jar.values()) {
        if (sentNames.has(j.rec.name)) continue
        if (j.availableAt > now) continue // set by a response that had not finished yet
        if (j.expiresAt !== null && j.expiresAt <= now) continue
        if (j.hostOnly ? j.domain !== host : !domainMatch(host, j.domain)) continue
        if (!pathMatch(reqPath, j.path)) continue
        if (j.secure && !https && !isLocal(host)) continue
        const ss = j.sameSite || 'lax'
        if (crossSite) {
          if (ss === 'strict') continue
          if (ss === 'lax' && !(nav && e.method === 'GET')) continue
        }
        // the cookie should have been sent
        j.rec.missed.push({ entryId: e.id, at: now })
        report(j.rec, f(SESSIONY.test(j.rec.name) ? 'critical' : 'warning', `"${j.rec.name}" was not sent where it should have been`, `${e.method} ${e.host}${e.path} matches the cookie's domain, path and flags (stored from ${j.setEntryHost}), but the request has no "${j.rec.name}".${crossSite ? ' (A cross-site request, but the cookie\'s SameSite setting allows it.)' : ''} The browser may be blocking or partitioning it (a privacy setting, Safari/Firefox tracking protection, or an extension), the cookie may have been cleared in between, or the capture was sanitized.`, 'Compare with a capture from a browser with no extensions and default settings. If it only fails in some browsers, look at SameSite and third-party cookie handling.'), e)
      }
    }

    // ---- response side: Set-Cookie
    for (const header of e.setCookies) {
      const c = parseSetCookie(header)
      const j = judgeSetCookie(c, { host, https, crossSite, navigation: nav, now })
      const domain = c.domain !== null ? c.domain : host
      const hostOnly = c.domain === null
      const path = c.path && c.path.startsWith('/') ? c.path : defaultPath(e.path)
      const r = rec(c.name, domain, hostOnly, path, c)
      r.attrs = c
      r.sets.push({ entryId: e.id, at: now, host, accepted: j.ok, deletes: j.deletes, raw: header, thirdParty: crossSite && !nav })
      if (!j.ok) {
        r.state = r.state === 'earlier' ? 'earlier' : 'rejected'
        for (const reason of j.reasons) report(r, { ...reason, severity: SESSIONY.test(c.name) ? 'critical' : 'warning' }, e)
        r.rejected = true
        continue
      }
      r.rejected = false
      if (j.deletes) {
        jar.delete(r.key); r.state = 'deleted'
        continue
      }
      r.state = 'stored'
      if (j.cap) report(r, f('info', 'Lifetime is capped at 400 days', 'Browsers (Chrome) limit a cookie\'s life to 400 days from when it is set, whatever Expires or Max-Age says.', ''), e)
      if (SESSIONY.test(c.name)) {
        if (!c.httpOnly) report(r, f('warning', `"${c.name}" looks like a session cookie but is not HttpOnly`, 'Any script on the page can read it, so one cross-site scripting bug is enough to steal the session.', 'Add HttpOnly.'), e)
        if (!c.secure && https) report(r, f('warning', `"${c.name}" looks like a session cookie but is not Secure`, 'It will also be sent over plain HTTP if the browser is ever sent there.', 'Add Secure.'), e)
        if (!c.sameSite) report(r, f('info', `"${c.name}" has no SameSite attribute`, 'Browsers treat that as Lax. Being explicit avoids surprises, especially for cookies that must work across sites.', 'Set SameSite=Lax, Strict, or None; Secure.'), e)
        if (c.expires === null && c.maxAge === null) { /* session cookie: normal */ }
      }
      if (crossSite && c.sameSite === 'none') report(r, f('info', `"${c.name}" is a third-party cookie`, `It was set by ${e.host} while the user was on ${topSite}. Safari and Firefox block or partition third-party cookies by default, and Chrome does in Incognito or when the user turns them off, so anything that depends on this cookie fails there.`, 'If a sign-in depends on it, use a redirect-based flow or the Storage Access API, or mark it Partitioned (CHIPS) when it is only needed within the embedding site.'), e)
      jar.set(r.key, { rec: r, domain, hostOnly, path, secure: c.secure, sameSite: c.sameSite, expiresAt: j.expiresAt, availableAt: now + (e.time || 0), setEntryHost: host })
    }
  }

  const cookies = [...records.values()]
  const order = { critical: 0, warning: 1, info: 2, ok: 3 }
  problems.sort((a, b) => order[a.severity] - order[b.severity])
  // one cookie can be flagged on many requests for the same reason: keep the first and count the rest
  const grouped = []
  const seen = new Map()
  for (const p of problems) {
    const k = `${p.key}|${p.title}`
    if (seen.has(k)) { seen.get(k).count += 1; seen.get(k).entryIds.push(p.entryId); continue }
    const g = { ...p, count: 1, entryIds: [p.entryId] }
    seen.set(k, g)
    grouped.push(g)
  }
  for (const r of cookies) {
    const s = new Set(); r.checks = r.checks.filter((c) => { const k = c.title; if (s.has(k)) return false; s.add(k); return true })
  }
  return { cookies, problems: grouped, stats: { ...stats, topSite, captured: entries.length, suppressedMissed: suppressMissed && anySet > 0 } }
}


// ---------------------------------------------------------------------------------------------------------------- size budget
/** For each host, the biggest Cookie header seen and which cookies make it up. Returns [{ host, maxBytes, requests, cookies: [{ name, bytes, share }], status }]. */
export function cookieBudget(har) {
  const byHost = new Map()
  for (const e of har.entries) {
    const header = e.reqHeaders.cookie
    if (!header) continue
    const row = byHost.get(e.host) || { host: e.host, maxBytes: 0, requests: 0, widest: null, statuses: new Set() }
    row.requests += 1
    if (header.length > row.maxBytes) { row.maxBytes = header.length; row.widest = e; row.header = header }
    if (e.status === 400 || e.status === 431 || e.status === 413) row.statuses.add(e.status)
    byHost.set(e.host, row)
  }
  return [...byHost.values()].map((r) => {
    const parts = String(r.header).split(/;\s*/).filter(Boolean).map((p) => { const i = p.indexOf('='); return { name: i < 0 ? p : p.slice(0, i), bytes: p.length + 2 } })
    const total = parts.reduce((s, x) => s + x.bytes, 0) || 1
    const cookies = parts.sort((a, b) => b.bytes - a.bytes).map((x) => ({ ...x, share: x.bytes / total }))
    const rejected = [...r.statuses]
    const status = r.maxBytes > 8000 || rejected.length ? 'critical' : r.maxBytes > 4000 ? 'warning' : 'ok'
    return { host: r.host, maxBytes: r.maxBytes, requests: r.requests, count: parts.length, cookies, status, rejectedWith: rejected }
  }).sort((a, b) => b.maxBytes - a.maxBytes)
}

// ---------------------------------------------------------------------------------------------------------------- session lifetime
/**
 * What a capture says about how long the session lasts: for each session-looking cookie, session-only vs persistent, its
 * lifetime, and whether the server renews it (sliding expiry) or sets it once (absolute expiry).
 */
export function sessionLifetimes(analysis) {
  const out = []
  for (const c of analysis.cookies) {
    if (!c.attrs || !SESSIONY.test(c.name)) continue
    const a = c.attrs
    const sets = c.sets.filter((s) => s.accepted && !s.deletes)
    if (!sets.length) continue
    const life = a.maxAge !== null ? a.maxAge * 1000 : a.expires !== null && sets[0].at ? a.expires - sets[0].at : null
    out.push({
      name: c.name, domain: c.domain, kind: life === null ? 'session' : 'persistent', lifetimeMs: life, renewed: sets.length > 1,
      note: life === null ? 'No Expires or Max-Age: the cookie lasts until the browser is closed (browsers that restore sessions may keep it longer).' : sets.length > 1 ? `Set ${sets.length} times: the server renews it, so the session slides while the user is active.` : 'Set once in this capture.',
    })
  }
  return out
}
