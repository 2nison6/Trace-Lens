// Logic for the Compare page: matching requests across captures, per-request differences, an overall verdict, and the
// difference in findings. Kept free of React so it can be tested on its own.
import { PHASES } from './harParser'
import { findingKey } from './analyzer'
import { fmtBytes, fmtMs } from './utils'

// ---- matching renamed (hashed) files ------------------------------------------------------------------------------

// A build hash is a run of 8+ letters/digits that contains a digit ("2VYo1NAP", "a1b2c3d4"), or a long number (a
// timestamp used as a cache buster). Words that merely end in a digit ("bootstrap5") are not hashes.
function isHashToken(t) {
  if (t.length < 8 || !/^[A-Za-z0-9_]+$/.test(t)) return false
  if (/^\d+$/.test(t)) return true
  return /\d/.test(t) && /[A-Za-z]/.test(t) && !/^[A-Za-z]+\d{1,4}$/.test(t)
}

/**
 * Like harParser's keyOf (method + origin + path), but a build hash in the file name is ignored, so `index-Cagtxs0k.js`
 * in one capture matches `index-D3f9aQ21.js` in another instead of showing up as "removed" and "new".
 */
export function looseKey(e) {
  const i = e.path.lastIndexOf('/')
  const dir = e.path.slice(0, i + 1)
  const file = e.path.slice(i + 1)
  const norm = file.split(/([.-])/).map((t) => (isHashToken(t) ? '~' : t)).join('')
  return `${e.method} ${e.origin}${dir}${norm}`
}

// ---- per-request differences ---------------------------------------------------------------------------------------

/** Adds the first-versus-last differences to each matched row of compareMulti. */
export function diffRows(rows) {
  return rows.map((r) => {
    const a = r.items[0]
    const b = r.items[r.items.length - 1]
    const both = !!(a && b)
    let phaseDelta = null
    let topPhase = ''
    if (both) {
      phaseDelta = {}
      let best = 0
      for (const p of PHASES) {
        phaseDelta[p] = b.phases[p] - a.phases[p]
        if (Math.abs(phaseDelta[p]) > Math.abs(best)) { best = phaseDelta[p]; topPhase = p }
      }
    }
    return {
      ...r, a, b,
      dt: both ? b.time - a.time : 0,
      ds: both ? b.transfer - a.transfer : 0,
      sc: both && a.status !== b.status,
      only: !a ? 'last' : !b ? 'first' : '',
      phaseDelta,
      topPhase,
    }
  })
}

export const isNotable = (d) => !!(d.only || d.sc || Math.abs(d.dt) > 50 || Math.abs(d.ds) > 1024)

// ---- findings ------------------------------------------------------------------------------------------------------

/** Findings that are new in `last`, fixed since `first`, and how many are unchanged. Counts inside titles are ignored. */
export function findingsDiff(first, last) {
  const a = new Map(first.map((f) => [findingKey(f), f]))
  const b = new Map(last.map((f) => [findingKey(f), f]))
  return {
    added: last.filter((f) => !a.has(findingKey(f))),
    fixed: first.filter((f) => !b.has(findingKey(f))),
    same: last.filter((f) => a.has(findingKey(f))).length,
  }
}

// ---- verdict -------------------------------------------------------------------------------------------------------

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/**
 * One sentence on how the newest capture compares to the first.
 * Returns { tone: 'good' | 'bad' | 'mixed' | 'same', title, text, pills[] }.
 */
export function verdict(firstHar, lastHar, diffs, names = ['A', 'B']) {
  const [nameA, nameB] = names
  const ta = firstHar.summary.totalTime
  const tb = lastHar.summary.totalTime
  const pct = ta ? ((tb - ta) / ta) * 100 : 0
  const dBytes = lastHar.summary.totalBytes - firstHar.summary.totalBytes
  const bigBytes = Math.abs(dBytes) >= Math.max(10 * 1024, 0.05 * firstHar.summary.totalBytes)
  const newErrors = diffs.filter((d) => d.b && d.b.error && !(d.a && d.a.error)).length
  const fixedErrors = diffs.filter((d) => d.a && d.a.error && !(d.b && d.b.error)).length
  const added = diffs.filter((d) => d.only === 'last').length
  const removed = diffs.filter((d) => d.only === 'first').length
  const slower = pct >= 5
  const faster = pct <= -5

  const parts = []
  if (slower || faster) parts.push(`${nameB} loads ${Math.abs(Math.round(pct))}% ${slower ? 'slower' : 'faster'} (${fmtMs(ta)} → ${fmtMs(tb)})`)
  else parts.push(`Load time is about the same (${fmtMs(ta)} → ${fmtMs(tb)})`)
  if (bigBytes) parts.push(`${fmtBytes(Math.abs(dBytes))} ${dBytes > 0 ? 'more' : 'less'} data`)
  if (newErrors) parts.push(plural(newErrors, 'new error'))
  if (fixedErrors) parts.push(plural(fixedErrors, 'error') + ' fixed')
  if (added) parts.push(plural(added, 'request') + ' added')
  if (removed) parts.push(plural(removed, 'request') + ' removed')

  const bad = pct > 10 || newErrors > 0
  const good = (pct < -10 || fixedErrors > 0) && newErrors === 0 && pct <= 10
  const quiet = !slower && !faster && !bigBytes && !newErrors && !fixedErrors && !added && !removed
  const tone = bad && (pct < -10 || fixedErrors > 0) ? 'mixed' : bad ? 'bad' : good ? 'good' : quiet ? 'same' : 'mixed'
  const title = { good: `${nameB} looks better than ${nameA}`, bad: `${nameB} looks worse than ${nameA}`, mixed: `${nameB} differs from ${nameA}`, same: `${nameB} is basically the same as ${nameA}` }[tone]
  return { tone, title, text: `${parts.join(', ')}.`, pills: parts }
}

// ---- Markdown export -----------------------------------------------------------------------------------------------

const md = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ')
const signed = (d, fmt) => (d === 0 ? '0' : `${d > 0 ? '+' : '-'}${fmt(Math.abs(d))}`)

/** The comparison as Markdown, ready to paste into a ticket or a pull request. */
export function compareMarkdown({ hars, names, verdict: v, diffs, fd, limit = 40 }) {
  const lines = [`## HAR comparison: ${names.map((n, i) => `${n} = ${md(hars[i].fileName)}`).join(', ')}`, '', `**${v.title}.** ${v.text}`, '']
  lines.push(`| | ${names.join(' | ')} |`, `|---|${names.map(() => '---:').join('|')}|`)
  const rows = [
    ['Requests', (h) => h.summary.count],
    ['Load time', (h) => fmtMs(h.summary.totalTime)],
    ['Transferred', (h) => fmtBytes(h.summary.totalBytes)],
    ['Errors', (h) => h.summary.errors],
    ['Hosts', (h) => h.summary.hosts.length],
  ]
  for (const [label, get] of rows) lines.push(`| ${label} | ${hars.map((h) => get(h)).join(' | ')} |`)
  if (fd) {
    lines.push('', `### Findings: ${fd.added.length} new, ${fd.fixed.length} fixed, ${fd.same} unchanged`)
    for (const f of fd.added) lines.push(`- New: ${md(f.title)} (${f.severity})`)
    for (const f of fd.fixed) lines.push(`- Fixed: ${md(f.title)}`)
  }
  const notable = diffs.filter(isNotable).sort((x, y) => Math.abs(y.dt) - Math.abs(x.dt)).slice(0, limit)
  if (notable.length) {
    lines.push('', `### Biggest request changes (${notable.length} of ${diffs.filter(isNotable).length})`, '', '| Request | Δ time | Δ size | Status |', '|---|---:|---:|---|')
    for (const d of notable) {
      const status = d.only === 'last' ? 'New' : d.only === 'first' ? 'Removed' : d.sc ? `${d.a.status} → ${d.b.status}` : String(d.a.status)
      lines.push(`| ${md(d.label)} | ${d.a && d.b ? signed(d.dt, fmtMs) : '—'} | ${d.a && d.b ? signed(d.ds, fmtBytes) : '—'} | ${status} |`)
    }
  }
  return `${lines.join('\n')}\n`
}
