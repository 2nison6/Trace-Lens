// Derived analytics: third-party cost, critical path and Core Web Vitals-style estimates.
// All values are estimates computed from HAR timings, not measured by the browser.
const rootDomain = (host) => {
  const h = host.split(':')[0]
  const parts = h.split('.')
  if (parts.length <= 2) return h
  const sld = parts[parts.length - 2]
  return ['co', 'com', 'org', 'net', 'gov', 'ac'].includes(sld) && parts[parts.length - 1].length === 2 ? parts.slice(-3).join('.') : parts.slice(-2).join('.')
}

export function pageDoc(har) {
  const { entries } = har
  return entries.find((e) => e.type === 'html' && e.status >= 200 && e.status < 300) || entries.find((e) => e.type === 'html') || entries[0]
}

export function thirdParty(har) {
  const doc = pageDoc(har)
  if (!doc) return { rows: [], firstBytes: 0, firstTime: 0, thirdBytes: 0, thirdTime: 0, count: 0 }
  const first = rootDomain(doc.host)
  const map = new Map()
  let firstBytes = 0
  let firstTime = 0
  let thirdBytes = 0
  let thirdTime = 0
  let count = 0
  for (const e of har.entries) {
    const d = rootDomain(e.host)
    if (d === first) {
      firstBytes += e.transfer
      firstTime += e.time
      continue
    }
    count++
    thirdBytes += e.transfer
    thirdTime += e.time
    const r = map.get(d) || { domain: d, count: 0, bytes: 0, time: 0, blocking: 0, ids: [] }
    r.count++
    r.bytes += e.transfer
    r.time += e.time
    r.blocking += e.phases.blocked + e.phases.dns + e.phases.connect + e.phases.ssl
    r.ids.push(e.id)
    map.set(d, r)
  }
  return { rows: [...map.values()].sort((a, b) => b.time - a.time), firstBytes, firstTime, thirdBytes, thirdTime, count, first }
}

// Longest chain of requests where each one was discovered by (initiated from) the previous one.
// Falls back to "started after the previous finished" when the HAR has no initiator info.
export function criticalPath(har) {
  const { entries } = har
  const byUrl = new Map()
  for (const e of entries) if (!byUrl.has(e.url)) byUrl.set(e.url, e)
  const hasInit = entries.some((e) => e.initiator)
  // Without initiator info (Firefox, Safari, proxies) the "parent" is the request that finished last before this one
  // started. Scanning every entry for each entry is O(n²) (seconds at tens of thousands of requests); instead sort by end
  // time once and keep a running best while sweeping the entries in start order: O(n log n).
  const fallbackParent = new Map()
  if (!hasInit) {
    // Ties on end time go to the earliest entry (lowest id), as the plain scan would pick.
    const byEnd = [...entries].sort((a, b) => a.endMs - b.endMs || a.id - b.id)
    let k = 0
    let bestEnd = -Infinity
    let candidates = [] // the (at most two) lowest ids that share bestEnd; two, so the entry itself can be skipped
    for (const e of entries) {
      while (k < byEnd.length && byEnd[k].endMs <= e.startMs + 1) {
        const o = byEnd[k]
        if (o.endMs > bestEnd) { bestEnd = o.endMs; candidates = [o] }
        else if (o.endMs === bestEnd && candidates.length < 2) candidates.push(o)
        k++
      }
      let parent = candidates.find((o) => o.id !== e.id) || null
      if (!parent && candidates.length === 1 && candidates[0].id === e.id) {
        // the only entry at the best end time is the entry itself (zero duration): the best other one ends earlier
        for (let j = k - 1; j >= 0; j--) if (byEnd[j].id !== e.id) { parent = byEnd[j]; break }
        if (parent) { const t = parent.endMs; parent = byEnd.find((o) => o.endMs === t && o.id !== e.id) }
      }
      fallbackParent.set(e.id, parent)
    }
  }
  const parentOf = (e) => {
    if (hasInit) return e.initiator ? byUrl.get(e.initiator) : null
    return fallbackParent.get(e.id) || null
  }
  const memo = new Map()
  const finish = (e, depth = 0) => {
    if (memo.has(e.id)) return memo.get(e.id)
    if (depth > 60) return { end: e.endMs, chain: [e.id] }
    const p = parentOf(e)
    let r
    if (!p || p.id === e.id || p.endMs > e.endMs + 1) r = { end: e.endMs, chain: [e.id] }
    else {
      const pr = finish(p, depth + 1)
      r = { end: e.endMs, chain: [...pr.chain, e.id] }
    }
    memo.set(e.id, r)
    return r
  }
  let best = { end: 0, chain: [] }
  for (const e of entries) {
    const r = finish(e)
    if (r.end > best.end || (r.end === best.end && r.chain.length > best.chain.length)) best = r
  }
  return { ids: best.chain, end: best.end, usedInitiators: hasInit }
}

export function vitals(har) {
  const doc = pageDoc(har)
  if (!doc) return null
  const render = har.entries.filter((e) => (e.type === 'css' || e.type === 'js') && e.startMs <= doc.endMs + 400 && e.id !== doc.id)
  const ttfb = doc.span.receive.start - doc.startMs
  const htmlDone = doc.endMs
  const blocking = render.filter((e) => e.type === 'css')
  const fcp = Math.max(htmlDone, ...blocking.map((e) => e.endMs), 0)
  const imgs = har.entries.filter((e) => e.type === 'img' && e.status === 200 && e.endMs >= fcp * 0.5)
  const biggest = imgs.sort((a, b) => b.contentSize - a.contentSize)[0]
  const lcp = Math.max(fcp, biggest ? biggest.endMs : 0)
  const load = (har.markers.find((m) => m.label === 'Load') || {}).ms || har.summary.totalTime
  const dcl = (har.markers.find((m) => m.label === 'DOMContentLoaded') || {}).ms || null
  const rate = (v, good, poor) => (v <= good ? 'good' : v <= poor ? 'warn' : 'bad')
  return [
    { key: 'TTFB', value: ttfb, rating: rate(ttfb, 800, 1800), note: 'Time to first byte of the main document' },
    { key: 'FCP', value: fcp, rating: rate(fcp, 1800, 3000), note: 'Estimated: HTML + render-blocking CSS finished' },
    { key: 'LCP', value: lcp, rating: rate(lcp, 2500, 4000), note: biggest ? `Estimated from largest image (${biggest.name})` : 'Estimated from FCP (no image found)' },
    ...(dcl ? [{ key: 'DCL', value: dcl, rating: rate(dcl, 2000, 4000), note: 'DOMContentLoaded from the HAR page timings' }] : []),
    { key: 'Load', value: load, rating: rate(load, 3000, 6000), note: 'onLoad from the HAR page timings, or the last request end' },
  ]
}

// ---------------------------------------------------------------------------------------------
// More analytics. Every group returns the matching request objects so the UI can list them.
const TEXT = new Set(['html', 'js', 'css', 'data'])
const sum = (list, f) => list.reduce((s, e) => s + f(e), 0)

const BUCKETS = [
  ['Under 100 ms', 0, 100, 'var(--good-mark)'],
  ['100 – 300 ms', 100, 300, 'var(--c-ssl)'],
  ['300 ms – 1 s', 300, 1000, 'var(--warn)'],
  ['1 – 3 s', 1000, 3000, 'var(--c-wait)'],
  ['Over 3 s', 3000, Infinity, 'var(--crit-mark)'],
]
export function latencyBuckets(har) {
  return BUCKETS.map(([label, min, max, color]) => ({ label, color, entries: har.entries.filter((e) => e.time >= min && e.time < max) }))
}

// How many requests were in flight across the capture, in equal time slices.
export function concurrency(har, bins = 48) {
  const total = Math.max(1, har.summary.totalTime)
  const dt = total / bins
  const out = []
  for (let i = 0; i < bins; i++) {
    const from = i * dt
    const to = from + dt
    out.push({ from, to, entries: har.entries.filter((e) => e.startMs < to && e.endMs >= from) })
  }
  return { bins: out, peak: out.reduce((m, b) => Math.max(m, b.entries.length), 0), total }
}

export function heaviest(har, n = 10) {
  return [...har.entries].sort((a, b) => b.transfer - a.transfer).slice(0, n)
}

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))]
// Per-endpoint latency (method + origin + path), busiest first.
export function endpoints(har) {
  const m = new Map()
  for (const e of har.entries) {
    const k = `${e.method} ${e.origin}${e.path}`
    const g = m.get(k) || { key: k, method: e.method, host: e.host, path: e.path, entries: [] }
    g.entries.push(e)
    m.set(k, g)
  }
  return [...m.values()]
    .map((g) => {
      const t = g.entries.map((e) => e.time).sort((a, b) => a - b)
      return { ...g, count: t.length, p50: pct(t, 0.5), p95: pct(t, 0.95), max: t[t.length - 1], total: sum(t, (x) => x), errors: g.entries.filter((e) => e.error).length, bytes: sum(g.entries, (e) => e.transfer) }
    })
    .sort((a, b) => b.total - a.total)
}

function protoName(v = '') {
  const s = v.toLowerCase()
  if (!s) return 'unknown'
  if (s.startsWith('h3') || s.includes('quic') || s.includes('/3')) return 'HTTP/3'
  if (s === 'h2' || s.includes('/2')) return 'HTTP/2'
  if (s.includes('1.1')) return 'HTTP/1.1'
  if (s.includes('1.0')) return 'HTTP/1.0'
  return v
}
export function protocols(har) {
  const m = new Map()
  for (const e of har.entries) {
    const k = protoName(e.httpVersion)
    ;(m.get(k) || m.set(k, []).get(k)).push(e)
  }
  return [...m].map(([label, entries]) => ({ label, entries })).sort((a, b) => b.entries.length - a.entries.length)
}

export const setupMs = (e) => e.phases.dns + e.phases.connect + e.phases.ssl
// Time spent opening connections (DNS + TCP + TLS), per host.
export function connectionSetup(har) {
  const m = new Map()
  for (const e of har.entries) {
    if (setupMs(e) <= 0) continue
    const g = m.get(e.host) || { host: e.host, total: 0, entries: [] }
    g.total += setupMs(e)
    g.entries.push(e)
    m.set(e.host, g)
  }
  const rows = [...m.values()].sort((a, b) => b.total - a.total)
  const total = sum(rows, (r) => r.total)
  const all = sum(har.entries, (e) => e.time)
  return { rows, total, share: all ? total / all : 0, connections: sum(rows, (r) => r.entries.length) }
}

function freshness(e) {
  const cc = (e.resHeaders['cache-control'] || '').toLowerCase()
  if (/no-store|no-cache/.test(cc)) return 0
  const m = /s-maxage=(\d+)/.exec(cc) || /max-age=(\d+)/.exec(cc)
  if (m) return Number(m[1])
  const exp = Date.parse(e.resHeaders.expires || '')
  const date = Date.parse(e.resHeaders.date || '')
  if (!Number.isNaN(exp) && !Number.isNaN(date)) return Math.max(0, (exp - date) / 1000)
  return null
}
const CACHE_LABELS = ['No cache policy', 'Never reused (no-store / max-age=0)', 'Under 1 hour', '1 hour – 1 day', '1 day or more']
export function cachePolicy(har) {
  const groups = CACHE_LABELS.map((label) => ({ label, entries: [] }))
  for (const e of har.entries) {
    if (e.method !== 'GET' || e.status !== 200) continue
    const f = freshness(e)
    const i = f == null ? 0 : f <= 0 ? 1 : f < 3600 ? 2 : f < 86400 ? 3 : 4
    groups[i].entries.push(e)
  }
  return groups.map((g) => ({ ...g, bytes: sum(g.entries, (e) => e.transfer) }))
}

// Rough savings estimates. They use typical ratios, not measurements.
export function optimizations(har) {
  const out = []
  const text = har.entries.filter((e) => TEXT.has(e.type) && e.status === 200 && e.contentSize > 1024 && e.transfer > 0 && !e.resHeaders['content-encoding'])
  if (text.length) out.push({ key: 'gzip', title: 'Compress text responses', note: 'HTML / JS / CSS / JSON sent without gzip or brotli. Text usually shrinks ~70%.', saving: sum(text, (e) => e.contentSize) * 0.7, entries: text })

  const imgs = har.entries.filter((e) => e.type === 'img' && e.transfer > 100 * 1024 && /jpe?g|png|gif|bmp/i.test(e.mime))
  if (imgs.length) out.push({ key: 'img', title: 'Modern image formats', note: 'Large JPEG / PNG files. WebP or AVIF is often ~30% smaller or better.', saving: sum(imgs, (e) => e.transfer) * 0.3, entries: imgs })

  const stat = har.entries.filter((e) => ['js', 'css', 'img', 'font'].includes(e.type) && e.method === 'GET' && e.status === 200 && e.transfer > 0)
  const weak = stat.filter((e) => {
    const f = freshness(e)
    return f == null || f < 3600
  })
  if (weak.length) out.push({ key: 'cache', title: 'Cache static files longer', note: 'Static files with no or very short caching are re-downloaded on repeat visits.', saving: sum(weak, (e) => e.transfer), entries: weak })

  const byUrl = new Map()
  for (const e of har.entries) if (e.method === 'GET' && e.status === 200 && e.transfer > 0) (byUrl.get(e.url) || byUrl.set(e.url, []).get(e.url)).push(e)
  const dups = [...byUrl.values()].filter((g) => g.length >= 2)
  if (dups.length) {
    const flat = dups.flat()
    out.push({ key: 'dup', title: 'Remove repeated downloads', note: 'The same URL was fetched more than once. Cache it client-side or de-duplicate the calls.', saving: sum(flat, (e) => e.transfer) - sum(dups, (g) => g[0].transfer), entries: flat })
  }
  return out.filter((o) => o.saving > 0)
}

// CSS and scripts requested right alongside the page itself; they delay first render unless async/deferred.
export function renderBlocking(har) {
  const doc = pageDoc(har)
  if (!doc) return { doc: null, entries: [], endsAt: 0 }
  const entries = har.entries
    .filter((e) => e.id !== doc.id && (e.type === 'css' || e.type === 'js') && e.status >= 200 && e.status < 400 && e.startMs <= doc.endMs + 400)
    .sort((a, b) => a.endMs - b.endMs)
  return { doc, entries, endsAt: entries.reduce((m, e) => Math.max(m, e.endMs), doc.endMs) }
}

// ---- additions: biggest wins, third-party estimate, connection reuse, notable moments ------------------------------

/** The estimated top savings first, with the third-party cost as one more candidate. */
export function biggestWins(har, limit = 3) {
  const wins = optimizations(har).map((o) => ({ key: o.key, title: o.title, note: o.note, bytes: o.saving, entries: o.entries }))
  const tp = thirdParty(har)
  if (tp.rows.length && tp.thirdBytes > 0) {
    const ids = tp.rows.flatMap((r) => r.ids)
    wins.push({ key: 'third', upTo: true, title: 'Trim third-party requests', note: `${tp.count} requests to other domains. This is everything they transfer: drop, delay or self-host the ones you do not need.`, bytes: tp.thirdBytes, entries: ids.map((id) => har.entries[id]) })
  }
  return wins.filter((w) => w.bytes > 0).sort((a, b) => b.bytes - a.bytes).slice(0, limit)
}

/**
 * Rough "what if" for third parties: when would the page have finished if only the site's own requests had run?
 * It keeps every first-party request where it was, so it is a best case, not a prediction.
 */
export function withoutThirdParty(har) {
  const tp = thirdParty(har)
  if (!tp.rows.length) return null
  const third = new Set(tp.rows.flatMap((r) => r.ids))
  let end = 0
  for (const e of har.entries) if (!third.has(e.id) && e.endMs > end) end = e.endMs
  const total = har.summary.totalTime
  return { end, saved: Math.max(0, total - end), total }
}

/** New versus reused connections, and which requests share a connection id (when the HAR records one). */
export function connections(har) {
  const byConn = new Map()
  let created = 0
  let reused = 0
  for (const e of har.entries) {
    if (e.connection) (byConn.get(e.connection) || byConn.set(e.connection, []).get(e.connection)).push(e)
    if (e.phases.dns > 0 || e.phases.connect > 0 || e.phases.ssl > 0) created++
    else reused++
  }
  return { byConn, created, reused }
}

/** Requests worth jumping to in the Flow replay: failures and anything slower than the threshold. */
export function notableMoments(har, slowMs = 1000, limit = 60) {
  return har.entries
    .filter((e) => e.error || e.time >= slowMs)
    .sort((a, b) => a.startMs - b.startMs)
    .slice(0, limit)
    .map((e) => ({ id: e.id, ms: e.startMs, kind: e.error ? 'error' : 'slow', label: `${e.error ? (e.status || 'ERR') : fmtSlow(e.time)} ${e.method} ${e.name}` }))
}
const fmtSlow = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`)
