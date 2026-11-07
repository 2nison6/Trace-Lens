export function fmtBytes(n) {
  if (!n) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  const v = n / 1024 ** i
  return `${v >= 100 || i === 0 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`
}

export function fmtMs(ms) {
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)} s`
  return `${ms >= 100 ? ms.toFixed(0) : ms.toFixed(1)} ms`
}

export function fmtDelta(delta, fmt) {
  if (delta === 0) return '0'
  return `${delta > 0 ? '+' : '-'}${fmt(Math.abs(delta))}`
}

export function statusClass(status) {
  if (!status) return 's-fail'
  if (status >= 500) return 's-5xx'
  if (status >= 400) return 's-4xx'
  if (status >= 300) return 's-3xx'
  return 's-2xx'
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.cssText = 'position:fixed;opacity:0'
    document.body.appendChild(ta)
    ta.select()
    try {
      return document.execCommand('copy')
    } catch {
      return false
    } finally {
      ta.remove()
    }
  }
}

const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`

export function toCurl(e) {
  const parts = [`curl -X ${e.method} ${shq(e.url)}`]
  for (const h of e.reqHeaderList) if (h.name && !h.name.startsWith(':')) parts.push(`-H ${shq(`${h.name}: ${h.value}`)}`)
  if (e.postData && e.postData.text) parts.push(`--data-raw ${shq(e.postData.text)}`)
  return parts.join(' \\\n  ')
}

export const fmtPct = (n) => `${Math.round(n)}%`

// Short label for time axes: 250 ms, 1.5 s, 3 s
export function fmtAxis(ms) {
  if (ms < 1000) return `${Math.round(ms)} ms`
  const s = ms / 1000
  return `${Number.isInteger(s) ? s : s.toFixed(1)} s`
}

// Round tick step so a [0, max] axis gets roughly `target` evenly spaced labels
export function niceTicks(max, target = 7) {
  if (!(max > 0)) return { step: 1, ticks: [0] }
  const raw = max / target
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((v) => v >= raw) || 10 * mag
  const ticks = []
  for (let v = 0; v <= max + 1e-6; v += step) ticks.push(v)
  return { step, ticks }
}

export function ratingOf(score) {
  return score >= 85 ? { label: 'Good', tone: 'good' } : score >= 60 ? { label: 'Needs work', tone: 'warn' } : { label: 'Poor', tone: 'crit' }
}
