// Turning a report model (see build.js) into a file: a standalone HTML page, Markdown, or JSON. The HTML has no scripts and no
// external requests, so it opens anywhere and can be printed to PDF. Charts are inline SVG that follow light and dark.
import { explain } from '../explain'
import { esc } from './charts'

const WORD = { critical: 'Critical', warning: 'Warning', info: 'Note', ok: 'OK' }
const md = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ')

// Chart colours: the same palette the app uses, in the light and dark steps that were validated for each surface.
const LIGHT = '--ch-surface:#fcfcfb;--ch-ink:#0b0b0b;--ch-ink2:#52514e;--ch-muted:#6b6a65;--ch-grid:#e1e0d9;--ch-s1:#2a78d6;--ch-s2:#eb6834;--ch-s3:#1baf7a;--ch-blocked:#a9b1c3;--ch-dns:#86b6ef;--ch-connect:#5598e7;--ch-ssl:#2a78d6;--ch-send:#1c5cab;--ch-wait:#eb6834;--ch-receive:#1baf7a;--ch-crit:#d03b3b;--ch-warn:#fab219;--ch-info:#2a78d6;--ch-good:#0ca30c;--ch-bg:#f9f9f7'
const DARK = '--ch-surface:#1a1a19;--ch-ink:#f0efec;--ch-ink2:#c3c2b7;--ch-muted:#a3a29a;--ch-grid:#2c2c2a;--ch-s1:#3987e5;--ch-s2:#d95926;--ch-s3:#199e70;--ch-blocked:#566079;--ch-dns:#9ec5f4;--ch-connect:#5598e7;--ch-ssl:#2a78d6;--ch-send:#1c5cab;--ch-wait:#d95926;--ch-receive:#199e70;--ch-crit:#d03b3b;--ch-warn:#fab219;--ch-info:#3987e5;--ch-good:#0ca30c;--ch-bg:#0d0d0d'
export const CHART_VARS = `
.rep{${LIGHT}}
.rep.dark{${DARK}}
@media (prefers-color-scheme:dark){.rep.auto{${DARK}}}
.chart{width:100%;height:auto;display:block}.chart text{fill:var(--ch-ink2);font:12px system-ui,sans-serif}.chart .m{fill:var(--ch-muted);font-size:11px}.chart .t{fill:var(--ch-ink)}
`

const css = `${CHART_VARS}
body.rep{font:14px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;margin:0;background:var(--ch-bg);color:var(--ch-ink)}
.wrap{max-width:980px;margin:0 auto;padding:28px 18px 60px}
h1{margin:0 0 2px;font-size:26px}h2{margin:34px 0 8px;padding-bottom:5px;border-bottom:2px solid #d4ff24;font-size:19px}h3{margin:18px 0 6px;font-size:15px}
.sub{color:var(--ch-ink2)}.kpis{display:flex;flex-wrap:wrap;gap:10px;margin:16px 0}.kpi{background:var(--ch-surface);border:1px solid var(--ch-grid);border-radius:10px;padding:10px 14px;min-width:120px;border-top:3px solid var(--ch-grid)}
.kpi b{display:block;font-size:21px}.kpi.crit{border-top-color:var(--ch-crit)}.kpi.warn{border-top-color:var(--ch-warn)}.kpi.good{border-top-color:var(--ch-good)}
.card{background:var(--ch-surface);border:1px solid var(--ch-grid);border-radius:12px;padding:14px 16px;margin:12px 0;break-inside:avoid}
.card h3{margin-top:0}.note{color:var(--ch-ink2);font-size:12.5px;margin:6px 0 0}
table{border-collapse:collapse;width:100%;font-size:12.5px;margin-top:8px}th,td{padding:5px 8px;border-bottom:1px solid var(--ch-grid);text-align:left;vertical-align:top;word-break:break-word}th{color:var(--ch-ink2);font-weight:600}
details.tbl{margin-top:6px}details.tbl summary{cursor:pointer;color:var(--ch-ink2);font-size:12.5px}
.chk{border-left:4px solid var(--ch-muted);background:var(--ch-surface);margin:8px 0;padding:8px 12px;border-radius:0 8px 8px 0;break-inside:avoid}
.chk.critical{border-color:var(--ch-crit)}.chk.warning{border-color:var(--ch-warn)}.chk.info{border-color:var(--ch-info)}.chk.ok{border-color:var(--ch-good)}
.chk b{display:inline}.sev{font-size:11.5px;color:var(--ch-ink2);margin-left:6px;text-transform:uppercase;letter-spacing:.04em}.chk p{margin:4px 0 0}.chk .fix{color:var(--ch-ink2)}
.chk details{margin-top:6px}.chk summary{cursor:pointer;color:var(--ch-ink2);font-size:12.5px}.chk .ex p{margin:3px 0;font-size:13px}
dl.kv{display:grid;grid-template-columns:max-content 1fr;gap:3px 14px;margin:8px 0;font-size:13px}dl.kv dt{color:var(--ch-ink2)}dl.kv dd{margin:0;word-break:break-word}
nav.toc{display:flex;flex-wrap:wrap;gap:8px 16px;margin:12px 0}nav.toc a{color:inherit}
.priv{font-size:12.5px;color:var(--ch-ink2);border:1px solid var(--ch-grid);border-radius:8px;padding:8px 12px;margin:16px 0}
.tool{margin-top:46px;padding-top:6px;border-top:1px solid var(--ch-grid)}
@media print{body.rep{background:#fff;color:#000}.wrap{padding:0}details.tbl:not([open]) table{display:table}.chk{break-inside:avoid}.tool{break-before:page}.tool:first-of-type{break-before:auto}}
`

function checkHtml(c, withExplain) {
  const ex = withExplain && c.severity !== 'ok' ? explain(c) : null
  return `<div class="chk ${esc(c.severity)}"><b>${esc(c.title)}</b><span class="sev">${esc(WORD[c.severity] || c.severity)}</span>${c.detail ? `<p>${esc(c.detail)}</p>` : ''}${c.fix ? `<p class="fix">Fix: ${esc(c.fix)}</p>` : ''}${ex ? `<details><summary>Explain this</summary><div class="ex"><p><b>What it means.</b> ${esc(ex.what)}</p><p><b>Why it matters.</b> ${esc(ex.why)}</p><p><b>Look at first.</b> ${esc(ex.first)}</p></div></details>` : ''}</div>`
}
const tableHtml = (t) => `<table><thead><tr>${t.head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${t.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`

/** One report as HTML to place inside a page (no <html> wrapper). */
export function reportBody(r, { explainChecks = true, headingLevel = 2 } = {}) {
  const H = `h${headingLevel}`
  return `<section class="tool" id="${esc(r.id)}"><${H}>${esc(r.title)}</${H}><div class="sub">${esc(r.subtitle)}</div>
<div class="kpis">${r.kpis.map((k) => `<div class="kpi ${esc(k.tone || '')}"><b>${esc(k.value)}</b>${esc(k.label)}</div>`).join('')}</div>
${(r.charts || []).map((c) => `<div class="card"><h3>${esc(c.title)}</h3>${c.svg}${c.note ? `<p class="note">${esc(c.note)}</p>` : ''}<details class="tbl"><summary>Show the numbers</summary>${tableHtml({ head: c.head, rows: c.rows })}</details></div>`).join('')}
${(r.sections || []).map((s) => `<div class="card"><h3>${esc(s.title)}</h3>${s.intro ? `<p class="note">${esc(s.intro)}</p>` : ''}${s.kv ? `<dl class="kv">${s.kv.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : ''}${s.table ? tableHtml(s.table) : ''}${(s.checks || []).map((c) => checkHtml(c, explainChecks)).join('')}</div>`).join('')}
${(r.notes || []).map((n) => `<p class="note">${esc(n)}</p>`).join('')}</section>`
}

const PRIVACY = 'This report was made in the browser and was not uploaded. It leaves out token values, cookie values, SAML XML and assertions, user names, and the query part of every address. Host names, paths, entity IDs, client IDs and the findings are included, so read it before sending it outside your organisation.'

/** A complete HTML document for one report or several (a combined export). `reports` is an array of models. */
export function reportsHtml(reports, { title, generated = new Date(), explainChecks = true, theme = 'auto' } = {}) {
  const many = reports.length > 1
  const head = title || (many ? 'TraceLens report' : `TraceLens: ${reports[0].title}`)
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(head)}</title><style>${css}</style></head><body class="rep ${theme}"><div class="wrap">
<h1>${esc(head)}</h1><div class="sub">Generated ${esc(generated.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC'))} by TraceLens</div>
<p class="priv">${esc(PRIVACY)}</p>
${many ? `<nav class="toc" aria-label="Contents">${reports.map((r) => `<a href="#${esc(r.id)}">${esc(r.title)}</a>`).join('')}</nav>` : ''}
${reports.map((r) => reportBody(r, { explainChecks, headingLevel: 2 })).join('\n')}
</div></body></html>`
}

function checkMd(c) {
  const out = [`- **${WORD[c.severity] || c.severity}: ${md(c.title)}**`]
  if (c.detail) out.push(`  ${md(c.detail)}`)
  if (c.fix) out.push(`  Fix: ${md(c.fix)}`)
  return out.join('\n')
}
const tableMd = (t) => [`| ${t.head.map(md).join(' | ')} |`, `| ${t.head.map(() => '---').join(' | ')} |`, ...t.rows.map((r) => `| ${r.map(md).join(' | ')} |`)].join('\n')

/** Markdown for one report, for a ticket or a pull request. Charts become tables (a picture is not needed to read the numbers). */
export function reportMarkdown(r, level = 2) {
  const h = '#'.repeat(level)
  const out = [`${h} ${r.title}`, '', r.subtitle, '', r.kpis.map((k) => `**${md(k.label)}:** ${md(k.value)}`).join(' · '), '']
  for (const c of r.charts || []) out.push(`${h}# ${c.title}`, '', tableMd({ head: c.head, rows: c.rows }), '', ...(c.note ? [`_${md(c.note)}_`, ''] : []))
  for (const s of r.sections || []) {
    out.push(`${h}# ${s.title}`, '')
    if (s.kv) out.push(...s.kv.map(([k, v]) => `- ${md(k)}: ${md(v)}`), '')
    if (s.table) out.push(tableMd(s.table), '')
    if (s.checks) out.push(...s.checks.map(checkMd), '')
  }
  for (const n of r.notes || []) out.push(`_${md(n)}_`, '')
  return `${out.join('\n').trim()}\n`
}

export function reportsMarkdown(reports, { title = 'TraceLens report', generated = new Date() } = {}) {
  return `# ${title}\n\nGenerated ${generated.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC')} by TraceLens.\n\n> ${PRIVACY}\n\n${reports.map((r) => reportMarkdown(r, 2)).join('\n')}`
}

/** JSON without the SVG (the numbers behind each chart are in `rows`). */
export function reportsJson(reports, { generated = new Date() } = {}) {
  const strip = (r) => ({ ...r, charts: (r.charts || []).map(({ svg, ...c }) => c) }) // eslint-disable-line no-unused-vars
  return JSON.stringify({ generated: generated.toISOString(), generator: 'TraceLens', privacy: PRIVACY, reports: reports.map(strip) }, null, 2)
}
