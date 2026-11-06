// CSV export of request tables (Waterfall, Tools).

const FORMULA = /^[=+\-@\t\r]/
const r1 = (n) => Math.round(n * 10) / 10

/**
 * One CSV cell. Text that a spreadsheet would run as a formula (it starts with =, +, - or @) gets a leading apostrophe, so
 * opening a downloaded file in Excel or Sheets can never execute something that came from a captured URL or header.
 * Numbers are written as they are.
 */
export function csvCell(v) {
  if (v == null) return ''
  let s = String(v)
  if (typeof v !== 'number' && FORMULA.test(s)) s = `'${s}`
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export const REQUEST_COLUMNS = [
  ['#', (e) => e.id + 1],
  ['Method', (e) => e.method],
  ['Status', (e) => e.status],
  ['URL', (e) => e.url],
  ['Host', (e) => e.host],
  ['Type', (e) => e.type],
  ['MIME type', (e) => e.mime],
  ['Protocol', (e) => e.httpVersion],
  ['Start (ms)', (e) => r1(e.startMs)],
  ['Time (ms)', (e) => r1(e.time)],
  ['Transferred (bytes)', (e) => e.transfer],
  ['Content size (bytes)', (e) => e.contentSize],
  ['Blocked (ms)', (e) => r1(e.phases.blocked)],
  ['DNS (ms)', (e) => r1(e.phases.dns)],
  ['Connect (ms)', (e) => r1(e.phases.connect)],
  ['TLS (ms)', (e) => r1(e.phases.ssl)],
  ['Send (ms)', (e) => r1(e.phases.send)],
  ['Wait (ms)', (e) => r1(e.phases.wait)],
  ['Receive (ms)', (e) => r1(e.phases.receive)],
  ['Error', (e) => e.errorText || (e.error ? `HTTP ${e.status}` : '')],
]

/** The given requests as CSV text (UTF-8 with a byte-order mark so Excel reads non-ASCII URLs correctly). */
export function requestsCsv(entries) {
  const lines = [REQUEST_COLUMNS.map(([label]) => csvCell(label)).join(',')]
  for (const e of entries) lines.push(REQUEST_COLUMNS.map(([, get]) => csvCell(get(e))).join(','))
  return `\uFEFF${lines.join('\r\n')}\r\n`
}
