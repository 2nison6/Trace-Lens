import { analyzeCached, healthScore } from './analyzer'
import { PHASES } from './harParser'
import { cachePolicy, connectionSetup, criticalPath, endpoints, heaviest, optimizations, protocols, renderBlocking, thirdParty, vitals } from './insights'
import { fmtBytes, fmtMs } from './utils'

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const r1 = (n) => Math.round(n * 10) / 10

// One request, flattened for the exports (no header/body payloads: use the scrubbed HAR for those).
const reqRow = (e) => ({
  id: e.id, method: e.method, status: e.status, url: e.url, host: e.host, type: e.type, mime: e.mime, protocol: e.httpVersion || null, ip: e.ip || null,
  startMs: r1(e.startMs), timeMs: r1(e.time), transferBytes: e.transfer, contentBytes: e.contentSize, priority: e.priority || null,
  initiator: e.initiator || null, redirectTo: e.redirectUrl || null, error: e.errorText || (e.error ? `HTTP ${e.status}` : null),
  phasesMs: Object.fromEntries(PHASES.map((p) => [p, r1(e.phases[p])])),
})

// Everything the report pages need, computed once and shared by the JSON and HTML exports.
function collect(har) {
  const findings = analyzeCached(har)
  const entries = har.entries
  const cp = criticalPath(har)
  const rb = renderBlocking(har)
  const tp = thirdParty(har)
  const setup = connectionSetup(har)
  return {
    findings,
    score: healthScore(findings),
    v: vitals(har) || [],
    tp,
    cp,
    rb,
    setup,
    eps: endpoints(har),
    protos: protocols(har),
    cache: cachePolicy(har),
    opts: optimizations(har),
    heavy: heaviest(har, 15),
    slow: [...entries].sort((a, b) => b.time - a.time).slice(0, 15),
    entries,
  }
}

export function reportJson(har) {
  const d = collect(har)
  const s = har.summary
  const byId = (ids) => ids.map((id) => entriesUrl(har, id))
  return JSON.stringify(
    {
      file: har.fileName,
      creator: har.creator || null,
      generated: new Date().toISOString(),
      summary: {
        requests: s.count, totalTimeMs: Math.round(s.totalTime), avgRequestTimeMs: r1(s.avgTime), transferBytes: s.totalBytes, errors: s.errors,
        statusGroups: s.statusGroups, byType: s.byType, phaseTotalsMs: Object.fromEntries(PHASES.map((p) => [p, r1(s.phaseTotals[p])])),
        hosts: s.hosts,
      },
      healthScore: d.score,
      vitals: d.v,
      pageMarkers: har.markers.map((m) => ({ label: m.label, ms: Math.round(m.ms) })),
      findings: d.findings.map((f) => ({ severity: f.severity, category: f.category, title: f.title, detail: f.detail, fix: f.fix, requestCount: f.ids.length, requests: byId(f.ids) })),
      thirdParties: { firstParty: d.tp.first || null, firstPartyBytes: d.tp.firstBytes, thirdPartyBytes: d.tp.thirdBytes, thirdPartyRequests: d.tp.count, thirdPartyTimeMs: r1(d.tp.thirdTime), domains: d.tp.rows.map(({ ids, ...r }) => ({ ...r, requestCount: ids.length })) },
      criticalPath: { endsAtMs: Math.round(d.cp.end), usedInitiators: d.cp.usedInitiators, requests: byId(d.cp.ids) },
      renderBlocking: { endsAtMs: Math.round(d.rb.endsAt), requests: d.rb.entries.map((e) => e.url) },
      connectionSetup: { totalMs: r1(d.setup.total), shareOfRequestTime: r1(d.setup.share * 100), connections: d.setup.connections, hosts: d.setup.rows.map((r) => ({ host: r.host, totalMs: r1(r.total), connections: r.entries.length })) },
      protocols: d.protos.map((p) => ({ protocol: p.label, requests: p.entries.length })),
      cachePolicy: d.cache.map((g) => ({ policy: g.label, requests: g.entries.length, bytes: g.bytes })),
      optimizations: d.opts.map((o) => ({ title: o.title, note: o.note, estimatedSavingBytes: Math.round(o.saving), requests: o.entries.map((e) => e.url) })),
      endpoints: d.eps.map((g) => ({ endpoint: g.key, requests: g.count, p50Ms: r1(g.p50), p95Ms: r1(g.p95), maxMs: r1(g.max), totalMs: r1(g.total), errors: g.errors, bytes: g.bytes })),
      slowestRequests: d.slow.map(reqRow),
      heaviestRequests: d.heavy.map(reqRow),
      requests: d.entries.map(reqRow),
    },
    null,
    2,
  )
}

function entriesUrl(har, id) {
  const e = har.entries[id]
  return e ? { id: e.id, method: e.method, status: e.status, url: e.url, timeMs: r1(e.time), transferBytes: e.transfer } : { id }
}

const table = (head, rows, cls = '') => `<table class="${cls}"><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`
const tr = (cells) => `<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`

export function reportHtml(har) {
  const d = collect(har)
  const s = har.summary
  const color = { critical: '#e5484d', warning: '#d99a00', info: '#1558c9', good: '#2f9e44', warn: '#d99a00', bad: '#e5484d' }
  const url = (e) => `<span class="u" title="${esc(e.url)}">${esc(e.url)}</span>`
  const reqCells = (e) => [e.id, esc(e.method), e.status || 'fail', url(e), esc(e.type), fmtBytes(e.transfer), fmtMs(e.time)]
  const reqHead = ['#', 'Method', 'Status', 'URL', 'Type', 'Size', 'Time']
  const kpi = (b, l) => `<div><b>${b}</b>${l}</div>`
  const typeRows = Object.entries(s.byType).sort((a, b) => b[1].bytes - a[1].bytes).map(([t, v]) => tr([esc(t), v.count, fmtBytes(v.bytes)]))
  const phaseRows = PHASES.map((p) => tr([p, fmtMs(s.phaseTotals[p])]))

  return `<!doctype html><html><head><meta charset="utf-8"><title>HAR report: ${esc(har.fileName)}</title>
<style>body{font:14px/1.5 system-ui,sans-serif;max-width:1000px;margin:30px auto;padding:0 16px;color:#111}h1{margin:0}h2{margin-top:30px;border-bottom:2px solid #d4ff24;padding-bottom:4px}h3{margin:16px 0 4px}
.k{display:flex;gap:12px;flex-wrap:wrap}.k div{background:#f3f5fa;border-radius:10px;padding:10px 14px;min-width:120px}.k b{display:block;font-size:20px}
.f{border-left:4px solid #999;background:#fafbfd;margin:8px 0;padding:8px 12px;border-radius:6px;break-inside:avoid}.f small{color:#555}.f ul{margin:6px 0 0;padding-left:18px;font-size:12px;color:#444}
table{border-collapse:collapse;width:100%;font-size:12.5px;table-layout:auto}td,th{padding:4px 8px;border-bottom:1px solid #e5e7ee;text-align:left;vertical-align:top}th{background:#f3f5fa}
.u{display:block;max-width:440px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.cols{display:grid;grid-template-columns:1fr 1fr;gap:0 24px}.note{color:#555;font-size:12.5px}
@media print{.u{max-width:none;white-space:normal;word-break:break-all}body{margin:0}}</style></head><body>
<h1>HAR report</h1><div>${esc(har.fileName)}${har.creator ? ` · captured with ${esc(har.creator)}` : ''} · generated ${new Date().toLocaleString()}</div>

<h2>Summary</h2><div class="k">${kpi(d.score, 'health score')}${kpi(s.count, 'requests')}${kpi(fmtMs(s.totalTime), 'total time')}${kpi(fmtMs(s.avgTime), 'avg request')}${kpi(fmtBytes(s.totalBytes), 'transferred')}${kpi(s.errors, 'errors')}</div>
<div class="k" style="margin-top:10px">${Object.entries(s.statusGroups).map(([g, n]) => kpi(n, g)).join('')}</div>
<div class="cols"><div><h3>By type</h3>${table(['Type', 'Requests', 'Size'], typeRows)}</div><div><h3>Time by phase (summed across requests)</h3>${table(['Phase', 'Time'], phaseRows)}</div></div>

${d.v.length ? `<h2>Timing estimates</h2><div class="k">${d.v.map((m) => `<div style="border-top:3px solid ${color[m.rating]}"><b>${fmtMs(m.value)}</b>${m.key}</div>`).join('')}</div><p class="note">${d.v.map((m) => `<b>${m.key}</b>: ${esc(m.note)}`).join(' · ')}</p>` : ''}

<h2>Findings (${d.findings.length})</h2>${d.findings.map((f) => `<div class="f" style="border-color:${color[f.severity]}"><b>${esc(f.title)}</b> <small>${f.severity} · ${esc(f.category)} · ${f.ids.length} request(s)</small><br>${esc(f.detail)}<br><i>Fix: ${esc(f.fix)}</i>${f.ids.length ? `<ul>${f.ids.map((id) => `<li>${esc(har.entries[id].method)} ${esc(har.entries[id].url)}</li>`).join('')}</ul>` : ''}</div>`).join('') || '<p>No issues found.</p>'}

${d.opts.length ? `<h2>Optimization opportunities</h2>${table(['Opportunity', 'Requests', 'Est. saving', 'Why'], d.opts.map((o) => tr([esc(o.title), o.entries.length, fmtBytes(o.saving), esc(o.note)])))}` : ''}

<h2>Third parties</h2><p>${d.tp.count} third-party requests, ${fmtBytes(d.tp.thirdBytes)}, ${fmtMs(d.tp.thirdTime)} of request time. First party${d.tp.first ? ` (${esc(d.tp.first)})` : ''}: ${fmtBytes(d.tp.firstBytes)}.</p>
${d.tp.rows.length ? table(['Domain', 'Requests', 'Bytes', 'Time', 'Connection setup'], d.tp.rows.map((r) => tr([esc(r.domain), r.count, fmtBytes(r.bytes), fmtMs(r.time), fmtMs(r.blocking)]))) : ''}

<h2>Critical path</h2><p class="note">${d.cp.usedInitiators ? 'Built from request initiators.' : 'No initiator data in this file, so requests are chained by timing.'} Ends at ${fmtMs(d.cp.end)}.</p>
${table(reqHead, d.cp.ids.map((id) => tr(reqCells(har.entries[id]))))}

${d.rb.entries.length ? `<h2>Render-blocking candidates</h2><p class="note">CSS and scripts requested with the page; they delay first render unless async or deferred. Last one finishes at ${fmtMs(d.rb.endsAt)}.</p>${table(reqHead, d.rb.entries.map((e) => tr(reqCells(e))))}` : ''}

<h2>Connection setup</h2><p>${d.setup.connections} new connections cost ${fmtMs(d.setup.total)} (${Math.round(d.setup.share * 100)}% of request time).</p>
${d.setup.rows.length ? table(['Host', 'Connections', 'DNS + connect + TLS'], d.setup.rows.map((r) => tr([esc(r.host), r.entries.length, fmtMs(r.total)]))) : ''}

<div class="cols"><div><h2>Protocols</h2>${table(['Protocol', 'Requests'], d.protos.map((p) => tr([esc(p.label), p.entries.length])))}</div>
<div><h2>Cache policy (GET 200)</h2>${table(['Policy', 'Requests', 'Size'], d.cache.map((g) => tr([esc(g.label), g.entries.length, fmtBytes(g.bytes)])))}</div></div>

<h2>Endpoints</h2>${table(['Endpoint', 'Calls', 'p50', 'p95', 'Max', 'Total', 'Errors', 'Size'], d.eps.map((g) => tr([`<span class="u" title="${esc(g.key)}">${esc(g.key)}</span>`, g.count, fmtMs(g.p50), fmtMs(g.p95), fmtMs(g.max), fmtMs(g.total), g.errors, fmtBytes(g.bytes)])))}

<h2>Slowest requests</h2>${table(reqHead, d.slow.map((e) => tr(reqCells(e))))}
<h2>Heaviest requests</h2>${table(reqHead, d.heavy.map((e) => tr(reqCells(e))))}

<h2>All requests (${d.entries.length})</h2>${table(reqHead, d.entries.map((e) => tr(reqCells(e))))}
</body></html>`
}
