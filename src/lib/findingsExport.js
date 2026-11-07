// Findings as Markdown, for tickets and pull requests.
import { fmtBytes, fmtMs } from './utils'

const WORD = { critical: 'Critical', warning: 'Warning', info: 'Note' }
const md = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ')

/** `findings` with the ones in `dismissed` left out. Each lists its fix and up to `perFinding` affected requests. */
export function findingsMarkdown(har, findings, { score, label, dismissed = new Set(), keyOf, perFinding = 8 } = {}) {
  const shown = findings.filter((f) => !dismissed.has(keyOf(f)))
  const lines = [`## HAR findings: ${md(har.fileName)}`, '', `Health score **${score}/100** (${label}). ${shown.length} finding${shown.length === 1 ? '' : 's'}${dismissed.size ? `, ${findings.length - shown.length} dismissed` : ''}.`, '']
  for (const f of shown) {
    lines.push(`### ${WORD[f.severity]}: ${md(f.title)} (${f.ids.length})`, '', md(f.detail), '', `**Fix:** ${md(f.fix)}`)
    const rows = f.ids.slice(0, perFinding).map((id) => har.entries[id]).filter(Boolean)
    if (rows.length) {
      lines.push('', ...rows.map((e) => `- \`${e.method}\` ${md(e.host)}${md(e.path)}: ${e.status || 'ERR'}, ${fmtBytes(e.transfer)}, ${fmtMs(e.time)}`))
      if (f.ids.length > rows.length) lines.push(`- …and ${f.ids.length - rows.length} more`)
    }
    lines.push('')
  }
  return `${lines.join('\n').trim()}\n`
}
