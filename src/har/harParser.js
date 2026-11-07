export const PHASES = ['blocked', 'dns', 'connect', 'ssl', 'send', 'wait', 'receive']

export const TYPE_ORDER = ['html', 'js', 'css', 'img', 'font', 'data', 'media', 'other']

const num = (v) => (typeof v === 'number' && v > 0 ? v : 0)

export function classify(mime = '', url = '') {
  const m = mime.toLowerCase()
  if (m.includes('html')) return 'html'
  if (m.includes('javascript') || m.includes('ecmascript')) return 'js'
  if (m.includes('css')) return 'css'
  if (m.startsWith('image/')) return 'img'
  if (m.includes('font') || /\.(woff2?|ttf|otf)(\?|$)/i.test(url)) return 'font'
  if (m.includes('json') || m.includes('xml')) return 'data'
  if (m.startsWith('video/') || m.startsWith('audio/')) return 'media'
  return 'other'
}

function headerMap(list = []) {
  const m = {}
  for (const h of list) {
    const k = String(h.name || '').toLowerCase()
    m[k] = m[k] ? `${m[k]}, ${h.value}` : String(h.value ?? '')
  }
  return m
}

function safeUrl(url) {
  try {
    return new URL(url)
  } catch {
    return null
  }
}

function parseCookieHeader(v = '') {
  return v
    .split(/;\s*/)
    .filter(Boolean)
    .map((p) => {
      const i = p.indexOf('=')
      return i < 0 ? { name: p, value: '' } : { name: p.slice(0, i), value: p.slice(i + 1) }
    })
}

export function parseHar(input, fileName = 'capture.har') {
  const json = typeof input === 'string' ? JSON.parse(input) : input
  const log = json && json.log
  if (!log || !Array.isArray(log.entries)) {
    throw new Error('Not a valid HAR file (missing log.entries)')
  }

  // A missing or unparsable startedDateTime must not count as time 0: that would put every other request ~50 years after
  // "the start" and wreck the waterfall, flow and totals. Such an entry borrows the previous valid start instead.
  const parsedStarts = log.entries.map((e) => Date.parse(e && e.startedDateTime))
  let lastValid = parsedStarts.find((t) => Number.isFinite(t)) ?? 0
  const raw = log.entries.map((e, i) => {
    if (Number.isFinite(parsedStarts[i])) lastValid = parsedStarts[i]
    return { e: e || {}, start: lastValid }
  })
  const t0 = raw.reduce((m, r) => Math.min(m, r.start), raw.length ? raw[0].start : 0)

  const entries = raw.map(({ e, start }, rawIndex) => {
    const req = e.request || {}
    const res = e.response || {}
    const u = safeUrl(req.url || '')
    const t = e.timings || {}

    const sslMs = num(t.ssl)
    const phases = {
      blocked: num(t.blocked),
      dns: num(t.dns),
      connect: Math.max(0, num(t.connect) - sslMs), // HAR connect includes ssl
      ssl: sslMs,
      send: num(t.send),
      wait: num(t.wait),
      receive: num(t.receive),
    }
    const phaseSum = PHASES.reduce((s, p) => s + phases[p], 0)
    const time = num(e.time) || phaseSum
    if (phaseSum === 0 && time > 0) phases.wait = time

    const startMs = start - t0
    const span = {}
    let cursor = startMs
    for (const p of PHASES) {
      span[p] = { start: cursor, end: cursor + phases[p] }
      cursor += phases[p]
    }

    const mime = (res.content && res.content.mimeType) || ''
    const transfer =
      num(res._transferSize) || Math.max(0, res.bodySize || 0) + Math.max(0, res.headersSize || 0)
    const status = res.status || 0
    const resHeaders = headerMap(res.headers)
    const reqHeaders = headerMap(req.headers)
    const ini = e._initiator || {}
    const frame = ini.stack && ini.stack.callFrames && ini.stack.callFrames[0]

    return {
      id: 0,
      reqHeaderList: req.headers || [],
      resHeaderList: res.headers || [],
      reqHeaders,
      resHeaders,
      reqCookies: req.cookies && req.cookies.length ? req.cookies : parseCookieHeader(reqHeaders.cookie),
      setCookies: (res.headers || [])
        .filter((h) => String(h.name).toLowerCase() === 'set-cookie')
        .map((h) => String(h.value)),
      query: req.queryString || (u ? [...u.searchParams].map(([name, value]) => ({ name, value })) : []),
      postData: req.postData || null,
      body: res.content || null,
      initiator: ini.url || (frame && frame.url) || '',
      initiatorType: ini.type || '',
      priority: e._priority || '',
      redirectUrl: res.redirectURL || resHeaders.location || '',
      errorText: res._error || e._error || '',
      queryKeys: u ? [...u.searchParams.keys()] : [],
      isHttps: u ? u.protocol === 'https:' : false,
      method: req.method || 'GET',
      url: req.url || '',
      host: u ? u.host : '(unknown)',
      origin: u ? u.origin : '',
      path: u ? u.pathname : req.url || '',
      name: u ? u.pathname.split('/').filter(Boolean).pop() || u.host : req.url || '(unknown)',
      status,
      statusText: res.statusText || '',
      error: status === 0 || status >= 400,
      mime,
      type: classify(mime, req.url),
      httpVersion: res.httpVersion || req.httpVersion || '',
      ip: e.serverIPAddress || '',
      connection: e.connection ? String(e.connection) : '',
      rawIndex, // position in the original log.entries, for trimming and merging the raw HAR
      contentSize: Math.max(0, (res.content && res.content.size) || 0),
      transfer,
      time,
      startMs,
      endMs: startMs + time,
      phases,
      span,
    }
  })

  entries.sort((a, b) => a.startMs - b.startMs)
  entries.forEach((e, i) => {
    e.id = i // ids must equal array index after sorting
  })

  const markers = []
  const page = (log.pages || [])[0]
  if (page && page.pageTimings) {
    const pageStart = Date.parse(page.startedDateTime)
    const base = (Number.isFinite(pageStart) ? pageStart : t0) - t0
    if (num(page.pageTimings.onContentLoad)) {
      markers.push({ label: 'DOMContentLoaded', short: 'DCL', ms: base + page.pageTimings.onContentLoad, tone: 'dcl' })
    }
    if (num(page.pageTimings.onLoad)) {
      markers.push({ label: 'Load', short: 'Load', ms: base + page.pageTimings.onLoad, tone: 'load' })
    }
  }

  return {
    fileName,
    creator: (log.creator && log.creator.name) || '',
    raw: json,
    entries,
    markers,
    summary: summarize(entries),
  }
}

export function summarize(entries) {
  const totalTime = entries.reduce((m, e) => Math.max(m, e.endMs), 0)
  const totalBytes = entries.reduce((s, e) => s + e.transfer, 0)
  const byType = {}
  const hostMap = new Map()
  const statusGroups = { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0, failed: 0 }
  const phaseTotals = Object.fromEntries(PHASES.map((p) => [p, 0]))

  for (const e of entries) {
    const bt = (byType[e.type] ||= { count: 0, bytes: 0 })
    bt.count++
    bt.bytes += e.transfer

    const h = hostMap.get(e.host) || { host: e.host, count: 0, bytes: 0, time: 0 }
    h.count++
    h.bytes += e.transfer
    h.time += e.time
    hostMap.set(e.host, h)

    if (e.status >= 200 && e.status < 300) statusGroups['2xx']++
    else if (e.status >= 300 && e.status < 400) statusGroups['3xx']++
    else if (e.status >= 400 && e.status < 500) statusGroups['4xx']++
    else if (e.status >= 500) statusGroups['5xx']++
    else statusGroups.failed++

    for (const p of PHASES) phaseTotals[p] += e.phases[p]
  }

  const hosts = [...hostMap.values()].sort((a, b) => b.count - a.count)
  return {
    count: entries.length,
    totalTime,
    totalBytes,
    avgTime: entries.length ? entries.reduce((s, e) => s + e.time, 0) / entries.length : 0,
    errors: entries.filter((e) => e.error).length,
    byType,
    hosts,
    statusGroups,
    phaseTotals,
    slowest: [...entries].sort((a, b) => b.time - a.time).slice(0, 5),
  }
}

export function isFilterActive(f) {
  return !!(f.q.trim() || f.status !== 'all' || f.type !== 'all' || f.host !== 'all' || f.minKB || f.minMs)
}

// Returns a view of the HAR containing only matching entries. Entry objects (and their ids) are shared
// with the full capture, so ids stay valid for the inspector.
export function filterHar(har, f) {
  if (!isFilterActive(f)) return har
  const q = f.q.trim().toLowerCase()
  const minSize = (Number(f.minKB) || 0) * 1024
  const minTime = Number(f.minMs) || 0
  const entries = har.entries.filter((e) => {
    if (f.status === 'ok' && !(e.status >= 200 && e.status < 300)) return false
    if (f.status === '3xx' && !(e.status >= 300 && e.status < 400)) return false
    if (f.status === '4xx' && !(e.status >= 400 && e.status < 500)) return false
    if (f.status === '5xx' && e.status < 500) return false
    if (f.status === 'failed' && e.status !== 0) return false
    if (f.status === 'errors' && !e.error) return false
    if (f.type !== 'all' && e.type !== f.type) return false
    if (f.host !== 'all' && e.host !== f.host) return false
    if (e.transfer < minSize || e.time < minTime) return false
    if (q && !`${e.method} ${e.url} ${e.status} ${e.mime} ${e.ip}`.toLowerCase().includes(q)) return false
    return true
  })
  // keep the full capture's timeline length so waterfall/flow positions stay comparable
  return { ...har, entries, summary: { ...summarize(entries), totalTime: har.summary.totalTime } }
}

const keyOf = (e) => `${e.method} ${e.origin}${e.path}`

// Align requests across any number of captures by method + origin + path (repeats pair up in order).
// `keyFn` can loosen the match, for example to ignore build hashes in file names (see compare.js).
export function compareMulti(hars, keyFn = keyOf) {
  const queues = hars.map((h) => {
    const m = new Map()
    for (const e of h.entries) {
      const k = keyFn(e)
      if (!m.has(k)) m.set(k, [])
      m.get(k).push(e)
    }
    return m
  })
  const keys = []
  const seen = new Set()
  for (const q of queues) {
    for (const k of q.keys()) {
      if (!seen.has(k)) {
        seen.add(k)
        keys.push(k)
      }
    }
  }
  const rows = []
  for (const k of keys) {
    const n = Math.max(...queues.map((q) => (q.get(k) || []).length))
    for (let i = 0; i < n; i++) {
      const items = queues.map((q) => (q.get(k) || [])[i] || null)
      const first = items.find(Boolean)
      rows.push({ key: `${k}#${i}`, label: `${first.method} ${first.host}${first.path}`, items })
    }
  }
  return rows
}
