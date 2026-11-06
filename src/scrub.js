// Redact secrets from a raw HAR object, and build trimmed or merged copies of one. Nothing here mutates its input.
const SENSITIVE_HEADERS = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|x-auth-token|x-csrf-token|x-xsrf-token)$/i
// SAMLResponse carries the user's identity and works as a login credential until it expires; SAMLart is a reference to one.
// (SAMLRequest is left alone: it holds no credential, and a recipient debugging a sign-in needs it.)
const SENSITIVE_KEYS = /(token|password|passwd|pwd|secret|api[_-]?key|apikey|auth|session|sid|jwt|credential|signature|samlresponse|samlart)/i
const MASK = '[REDACTED]'

export const KINDS = ['headers', 'cookies', 'params', 'bodies']
export const KIND_LABEL = { headers: 'Headers', cookies: 'Cookies', params: 'Query and form parameters', bodies: 'Fields in JSON bodies' }

/**
 * Turn the user's custom patterns into regular expressions. One pattern per line: plain text is matched literally; a line
 * written /like this/ (optionally with flags) is a regular expression. Returns { list, errors }.
 */
export function parsePatterns(text) {
  const list = []
  const errors = []
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    if (line.length > 200) { errors.push(`“${line.slice(0, 30)}…” is too long (200 characters at most)`); continue }
    const m = /^\/(.+)\/([a-z]*)$/.exec(line)
    try {
      if (m) list.push(new RegExp(m[1], m[2].includes('g') ? m[2] : `${m[2]}g`))
      else list.push(new RegExp(line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))
    } catch {
      errors.push(`“${line}” is not a valid pattern`)
    }
  }
  return { list, errors }
}

/**
 * Find (apply = false) or redact (apply = true) secrets.
 *   skip    Set of "kind:name" keys the user left unticked: they are found but not redacted
 *   custom  extra RegExps; every match in a URL, header, cookie, parameter or body is replaced
 * Returns { har, stats, found } where found is [{ kind, name, count }] for the preview list.
 */
export function scrubHar(raw, { apply = true, skip = new Set(), custom = [] } = {}) {
  const doc = apply ? JSON.parse(JSON.stringify(raw)) : raw
  const stats = { headers: 0, cookies: 0, params: 0, bodies: 0, custom: 0 }
  const found = new Map()

  // Records a hit. It counts when the item would be redacted (not unticked), in preview mode too, so the preview total equals
  // what applying will do; it returns true only when the caller should really change the document.
  const hit = (kind, name) => {
    const k = `${kind}:${name}`
    found.set(k, { kind, name, count: (found.get(k)?.count || 0) + 1 })
    if (skip.has(k)) return false
    stats[kind]++
    return apply
  }
  // Replaces every custom-pattern match; counts them either way. Preview mode counts but returns the text untouched.
  const runCustom = (text) => {
    let out = text
    for (const re of custom) {
      re.lastIndex = 0
      out = out.replace(re, () => { stats.custom++; return MASK })
    }
    return apply ? out : text
  }

  const maskParam = (p) => {
    if (!p) return
    if (SENSITIVE_KEYS.test(p.name || '') && p.value !== MASK && hit('params', p.name)) p.value = MASK
    else if (typeof p.value === 'string') { const v = runCustom(p.value); if (apply) p.value = v }
  }

  const maskUrl = (url) => {
    try {
      const u = new URL(url)
      let changed = false
      for (const k of [...u.searchParams.keys()]) {
        if (SENSITIVE_KEYS.test(k) && hit('params', k)) { u.searchParams.set(k, MASK); changed = true }
      }
      const base = changed ? u.toString() : url
      return runCustom(base)
    } catch {
      return runCustom(url)
    }
  }

  const maskJsonText = (text) => {
    try {
      const walk = (v) => {
        if (Array.isArray(v)) return v.map(walk)
        if (v && typeof v === 'object') {
          return Object.fromEntries(Object.entries(v).map(([k, x]) => (SENSITIVE_KEYS.test(k) && typeof x !== 'object' ? (hit('bodies', k) ? [k, MASK] : [k, x]) : [k, walk(x)])))
        }
        return v
      }
      const out = JSON.stringify(walk(JSON.parse(text)))
      return runCustom(apply ? out : text)
    } catch {
      const out = text.replace(/(["']?(?:token|password|secret|api[_-]?key|authorization|SAMLResponse|SAMLart)["']?\s*[:=]\s*["']?)[^"'&\s,}]+/gi, (m, p) => (hit('bodies', p.replace(/["'\s:=]+$/g, '').replace(/^["']/, '')) ? `${p}${MASK}` : m))
      return runCustom(out)
    }
  }

  // <input ... name="SAMLResponse" ... value="..."> in either attribute order, either quote style
  const maskHtmlSaml = (html) => html.replace(/<input\b[^>]*>/gi, (tag) => {
    const name = /\bname\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag)
    const key = name && (name[1] ?? name[2])
    if (!key || !/^(SAMLResponse|SAMLart)$/i.test(key)) return tag
    const val = /\bvalue\s*=\s*(?:"[^"]*"|'[^']*')/i.exec(tag)
    if (!val || /\[REDACTED\]/.test(val[0]) || !hit('bodies', key)) return tag
    return tag.replace(val[0], `value="${MASK}"`)
  })

  for (const e of (doc.log && doc.log.entries) || []) {
    const req = e.request || {}
    const res = e.response || {}
    if (req.url) { const u = maskUrl(req.url); if (apply) req.url = u }
    if (res.redirectURL) { const u = maskUrl(res.redirectURL); if (apply) res.redirectURL = u }
    for (const h of [...(req.headers || []), ...(res.headers || [])]) {
      if (SENSITIVE_HEADERS.test(h.name) && h.value !== MASK && hit('headers', String(h.name).toLowerCase())) h.value = MASK
      else if (typeof h.value === 'string') { const v = runCustom(h.value); if (apply) h.value = v }
    }
    for (const c of [...(req.cookies || []), ...(res.cookies || [])]) {
      if (hit('cookies', c.name || '(unnamed)')) c.value = MASK
      else if (typeof c.value === 'string') { const v = runCustom(c.value); if (apply) c.value = v }
    }
    for (const q of req.queryString || []) maskParam(q)
    if (req.postData) {
      for (const p of req.postData.params || []) maskParam(p)
      if (req.postData.text) { const t = maskJsonText(req.postData.text); if (apply) req.postData.text = t }
    }
    if (res.content && res.content.text && /json|x-www-form|text\/plain/i.test(res.content.mimeType || '')) {
      const t = maskJsonText(res.content.text)
      if (apply) res.content.text = t
    }
    if (res.content && res.content.text && /html/i.test(res.content.mimeType || '') && /SAML(Response|art)/i.test(res.content.text)) {
      const t = maskHtmlSaml(res.content.text)
      if (apply) res.content.text = t
    }
  }
  const list = [...found.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  return { har: doc, stats, found: list }
}

/** A copy of the raw HAR that keeps only the given positions in log.entries. */
export function subsetHar(raw, rawIndexes) {
  const keep = new Set(rawIndexes)
  const entries = (raw.log.entries || []).filter((_, i) => keep.has(i))
  return { ...raw, log: { ...raw.log, entries } }
}

/** One HAR holding every entry of several (page ids are prefixed so they cannot collide), in start-time order. */
export function mergeHars(hars) {
  const entries = []
  const pages = []
  hars.forEach((h, i) => {
    const log = (h.raw && h.raw.log) || {}
    for (const p of log.pages || []) pages.push({ ...p, id: `${i + 1}:${p.id}` })
    for (const e of log.entries || []) entries.push(e.pageref ? { ...e, pageref: `${i + 1}:${e.pageref}` } : e)
  })
  entries.sort((a, b) => (Date.parse(a.startedDateTime) || 0) - (Date.parse(b.startedDateTime) || 0))
  const first = (hars[0].raw && hars[0].raw.log) || {}
  return { log: { version: first.version || '1.2', creator: { name: 'HAR.lens', version: 'merge' }, ...(pages.length ? { pages } : {}), entries } }
}

export function download(name, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
