// Redact secrets from a raw HAR object. Returns { har, stats } and never mutates the input.
const SENSITIVE_HEADERS = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|x-auth-token|x-csrf-token|x-xsrf-token)$/i
const SENSITIVE_KEYS = /(token|password|passwd|pwd|secret|api[_-]?key|apikey|auth|session|sid|jwt|credential|signature)/i
const MASK = '[REDACTED]'

export function scrubHar(raw) {
  const clone = JSON.parse(JSON.stringify(raw))
  const stats = { headers: 0, cookies: 0, params: 0, bodies: 0 }

  const maskParam = (p) => {
    if (SENSITIVE_KEYS.test(p.name || '') && p.value !== MASK) {
      p.value = MASK
      stats.params++
    }
  }

  const maskUrl = (url) => {
    try {
      const u = new URL(url)
      let hit = false
      for (const k of [...u.searchParams.keys()]) {
        if (SENSITIVE_KEYS.test(k)) {
          u.searchParams.set(k, MASK)
          hit = true
          stats.params++
        }
      }
      return hit ? u.toString() : url
    } catch {
      return url
    }
  }

  const maskJsonText = (text) => {
    try {
      const walk = (v) => {
        if (Array.isArray(v)) return v.map(walk)
        if (v && typeof v === 'object') {
          return Object.fromEntries(Object.entries(v).map(([k, x]) => (SENSITIVE_KEYS.test(k) && typeof x !== 'object' ? ((stats.bodies++), [k, MASK]) : [k, walk(x)])))
        }
        return v
      }
      return JSON.stringify(walk(JSON.parse(text)))
    } catch {
      return text.replace(/(["']?(?:token|password|secret|api[_-]?key|authorization)["']?\s*[:=]\s*["']?)[^"'&\s,}]+/gi, (m, p) => ((stats.bodies++), `${p}${MASK}`))
    }
  }

  for (const e of (clone.log && clone.log.entries) || []) {
    const req = e.request || {}
    const res = e.response || {}
    if (req.url) req.url = maskUrl(req.url)
    if (res.redirectURL) res.redirectURL = maskUrl(res.redirectURL)
    for (const h of [...(req.headers || []), ...(res.headers || [])]) {
      if (SENSITIVE_HEADERS.test(h.name) && h.value !== MASK) {
        h.value = MASK
        stats.headers++
      }
    }
    for (const c of [...(req.cookies || []), ...(res.cookies || [])]) {
      c.value = MASK
      stats.cookies++
    }
    for (const q of req.queryString || []) maskParam(q)
    if (req.postData) {
      for (const p of req.postData.params || []) maskParam(p)
      if (req.postData.text) req.postData.text = maskJsonText(req.postData.text)
    }
    if (res.content && res.content.text && /json|x-www-form|text\/plain/i.test(res.content.mimeType || '')) {
      res.content.text = maskJsonText(res.content.text)
    }
  }
  return { har: clone, stats }
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
