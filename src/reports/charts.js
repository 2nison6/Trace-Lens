// Small SVG charts as strings, so the same chart can be shown in the app and written into a downloaded report.
//
// Colours come from CSS variables (--ch-*), defined by the app's stylesheet and by the report's own <style>, so light and dark
// follow the page. Marks follow the data-visualisation method used here: bars at most 24px thick with a 4px rounded data end
// and a square base, 2px gaps between touching segments, a hairline recessive grid, 2px surface rings on dots, direct labels
// at the bar tip, and text in ink colours (never the series colour). Every chart carries a title and a description for
// screen readers; the report also lists the same numbers in a table.

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const W = 720
const trunc = (s, n) => { s = String(s ?? ''); return s.length > n ? `${s.slice(0, n - 1)}…` : s }
const col = (tone) => `var(--ch-${tone || 's1'})`

function svg(h, title, desc, body) {
  return `<svg class="chart" viewBox="0 0 ${W} ${h}" role="img" aria-label="${esc(title)}. ${esc(desc)}" xmlns="http://www.w3.org/2000/svg"><title>${esc(title)}</title><desc>${esc(desc)}</desc>${body}</svg>`
}

// a bar that grows from the left: square at the base, 4px rounded at the data end
function bar(x, y, len, t, tone) {
  if (!(len > 0)) return ''
  const r = Math.min(4, len / 2, t / 2)
  const d = len <= 2 * r ? `M${x} ${y}h${len}v${t}h${-len}z` : `M${x} ${y}h${len - r}a${r} ${r} 0 0 1 ${r} ${r}v${t - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}h${-(len - r)}z`
  return `<path d="${d}" style="fill:${col(tone)}"/>`
}

/**
 * Horizontal bars, one row each. rows: [{ label, value, display, tone }]. marks: [{ value, label, tone }] draws a limit line
 * (for example the size at which a browser or server refuses a cookie header).
 */
export function barList(rows, { title = 'Chart', desc = '', marks = [], max } = {}) {
  if (!rows.length) return ''
  const labelW = 210
  const rightW = 120
  const plotW = W - labelW - rightW
  const rowH = 28
  const top = marks.length ? 20 : 6
  const t = 14
  const m = max ?? Math.max(1, ...rows.map((r) => r.value), ...marks.map((k) => k.value))
  const h = top + rows.length * rowH + 6
  const x = (v) => labelW + (Math.max(0, v) / m) * plotW
  let body = ''
  for (const k of marks) body += `<line x1="${x(k.value)}" y1="${top - 4}" x2="${x(k.value)}" y2="${h - 6}" style="stroke:${col(k.tone || 'warn')}" stroke-width="1"/><text x="${x(k.value)}" y="${top - 8}" text-anchor="middle" class="m">${esc(k.label)}</text>`
  rows.forEach((r, i) => {
    const y = top + i * rowH
    const len = Math.max(r.value > 0 ? 3 : 0, (r.value / m) * plotW)
    body += `<text x="${labelW - 10}" y="${y + 13}" text-anchor="end" class="t">${esc(trunc(r.label, 32))}</text>${bar(labelW, y + 2, len, t, r.tone)}<text x="${labelW + len + 8}" y="${y + 13}" class="t">${esc(r.display ?? r.value)}</text>`
  })
  return svg(h, title, desc || `${rows.length} bars. ${rows.slice(0, 5).map((r) => `${r.label}: ${r.display ?? r.value}`).join('; ')}.`, body)
}

/**
 * Stacked bars (one per row) for counts split by kind, such as findings by severity. rows: [{ label, parts: [{ value, tone, name }] }].
 * The end label spells the counts out, so the colour is never the only way to read a segment.
 */
export function stackBars(rows, { title = 'Chart', desc = '', legend = [] } = {}) {
  if (!rows.length) return ''
  const labelW = 210
  const rightW = 190
  const plotW = W - labelW - rightW
  const rowH = 28
  const t = 14
  const totals = rows.map((r) => r.parts.reduce((s, p) => s + p.value, 0))
  const m = Math.max(1, ...totals)
  const h = 6 + rows.length * rowH + (legend.length ? 26 : 4)
  let body = ''
  rows.forEach((r, i) => {
    const y = 6 + i * rowH
    let x = labelW
    const live = r.parts.filter((p) => p.value > 0)
    body += `<text x="${labelW - 10}" y="${y + 13}" text-anchor="end" class="t">${esc(trunc(r.label, 32))}</text>`
    live.forEach((p, j) => {
      const len = Math.max(3, (p.value / m) * plotW) - (j < live.length - 1 ? 2 : 0)
      const last = j === live.length - 1
      body += last ? bar(x, y + 2, len, t, p.tone) : `<rect x="${x}" y="${y + 2}" width="${len}" height="${t}" style="fill:${col(p.tone)}"/>`
      x += len + 2
    })
    const said = live.map((p) => `${p.value} ${p.name}`).join(', ') || 'none'
    body += `<text x="${(live.length ? x : labelW) + 8}" y="${y + 13}" class="t">${esc(trunc(said, 30))}</text>`
  })
  const ly = 6 + rows.length * rowH + 14
  let lx = labelW
  const SHAPE = { crit: (x, y) => `<rect x="${x}" y="${y - 7}" width="9" height="9" style="fill:${col('crit')}"/>`, warn: (x, y) => `<path d="M${x + 4.5} ${y - 8}l5 9h-10z" style="fill:${col('warn')}"/>`, info: (x, y) => `<circle cx="${x + 4.5}" cy="${y - 3}" r="4.5" style="fill:${col('info')}"/>`, good: (x, y) => `<path d="M${x + 4.5} ${y - 8}l4.5 4.5-4.5 4.5-4.5-4.5z" style="fill:${col('good')}"/>` }
  for (const l of legend) {
    body += `${(SHAPE[l.tone] || SHAPE.info)(lx, ly)}<text x="${lx + 15}" y="${ly}" class="m">${esc(l.name)}</text>`
    lx += 15 + l.name.length * 7 + 16
  }
  return svg(h, title, desc || rows.map((r) => `${r.label}: ${r.parts.filter((p) => p.value > 0).map((p) => `${p.value} ${p.name}`).join(', ') || 'none'}`).join('; '), body)
}

const pad = (n) => String(n).padStart(2, '0')
const stamp = (t, withTime) => { const d = new Date(t); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}${withTime ? ` ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` : ''}` }

/**
 * Ranges on a time axis, such as the validity of a token, assertion or certificate. rows: [{ label, from, to, tone, marks: [{ at, tone, name }] }].
 * `now` draws a vertical line. Times are UTC (milliseconds).
 */
export function rangeTimeline(rows, { title = 'Timeline', desc = '', now = null } = {}) {
  const live = rows.filter((r) => Number.isFinite(r.from) && Number.isFinite(r.to))
  if (!live.length) return ''
  const labelW = 210
  const rightW = 24
  const plotW = W - labelW - rightW
  const rowH = 34
  const top = 22
  const all = live.flatMap((r) => [r.from, r.to, ...(r.marks || []).map((k) => k.at)]).concat(now != null ? [now] : []).filter(Number.isFinite)
  let lo = Math.min(...all)
  let hi = Math.max(...all)
  if (hi - lo < 60e3) { lo -= 30e3; hi += 30e3 }
  const padT = (hi - lo) * 0.04
  lo -= padT; hi += padT
  const x = (t) => labelW + ((t - lo) / (hi - lo)) * plotW
  const withTime = hi - lo < 3 * 86400e3
  const h = top + live.length * rowH + 8
  let body = ''
  for (let i = 0; i <= 4; i++) {
    const tv = lo + ((hi - lo) * i) / 4
    body += `<line x1="${x(tv)}" y1="${top - 4}" x2="${x(tv)}" y2="${h - 8}" style="stroke:var(--ch-grid)" stroke-width="1"/><text x="${x(tv)}" y="${top - 8}" text-anchor="${i === 0 ? 'start' : i === 4 ? 'end' : 'middle'}" class="m">${esc(stamp(tv, withTime))}</text>`
  }
  if (now != null) body += `<line x1="${x(now)}" y1="${top - 4}" x2="${x(now)}" y2="${h - 8}" style="stroke:var(--ch-ink)" stroke-width="1.5"/><text x="${x(now) + 4}" y="${h - 10}" class="m">now</text>`
  live.forEach((r, i) => {
    const y = top + i * rowH
    const w = Math.max(3, x(r.to) - x(r.from))
    body += `<text x="${labelW - 10}" y="${y + 15}" text-anchor="end" class="t">${esc(trunc(r.label, 32))}</text><rect x="${x(r.from)}" y="${y + 6}" width="${w}" height="10" rx="4" style="fill:${col(r.tone || 's1')}" opacity="0.55"/>`
    for (const k of r.marks || []) if (Number.isFinite(k.at)) body += `<circle cx="${x(k.at)}" cy="${y + 11}" r="4.5" style="fill:${col(k.tone || 'ink')};stroke:var(--ch-surface)" stroke-width="2"><title>${esc(k.name)}: ${esc(stamp(k.at, true))}</title></circle>`
  })
  return svg(h, title, desc || live.map((r) => `${r.label}: ${stamp(r.from, true)} to ${stamp(r.to, true)}`).join('; '), body)
}
