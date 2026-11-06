// A short plain-text summary of a capture, for pasting into a chat message or a ticket.
import { analyzeCached, healthScore } from './analyzer'
import { fmtBytes, fmtMs, ratingOf } from './utils'

const WORD = { critical: 'Critical', warning: 'Warning', info: 'Note' }

export function summaryText(har, top = 3) {
  const s = har.summary
  const findings = analyzeCached(har)
  const score = healthScore(findings)
  const lines = [
    `HAR summary: ${har.fileName}`,
    `${s.count} request${s.count === 1 ? '' : 's'} across ${s.hosts.length} host${s.hosts.length === 1 ? '' : 's'} · ${fmtBytes(s.totalBytes)} transferred · ${fmtMs(s.totalTime)} load time · ${s.errors} error${s.errors === 1 ? '' : 's'}`,
  ]
  if (har.markers.length) lines.push(`Page load: ${har.markers.map((m) => `${m.label} ${fmtMs(m.ms)}`).join(', ')}`)
  lines.push(`Health score: ${score}/100 (${ratingOf(score).label})`)
  if (findings.length) {
    lines.push('Top issues:')
    for (const f of findings.slice(0, top)) lines.push(`- ${WORD[f.severity]}: ${f.title} (${f.ids.length} request${f.ids.length === 1 ? '' : 's'})`)
    if (findings.length > top) lines.push(`- …and ${findings.length - top} more`)
  } else {
    lines.push('No issues found.')
  }
  if (s.slowest.length) lines.push(`Slowest request: ${s.slowest[0].method} ${s.slowest[0].host}${s.slowest[0].path} (${fmtMs(s.slowest[0].time)})`)
  return lines.join('\n')
}
