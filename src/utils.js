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
