import { analyzeCached, healthScore } from './analyzer'
import { thirdParty, vitals } from './insights'
import { fmtBytes, fmtMs } from './utils'

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

export function reportJson(har) {
  const findings = analyzeCached(har)
  return JSON.stringify(
    {
      file: har.fileName,
      generated: new Date().toISOString(),
      summary: { requests: har.summary.count, totalTimeMs: Math.round(har.summary.totalTime), bytes: har.summary.totalBytes, errors: har.summary.errors },
      healthScore: healthScore(findings),
      vitals: vitals(har),
      findings: findings.map((f) => ({ severity: f.severity, category: f.category, title: f.title, detail: f.detail, fix: f.fix, requests: f.ids.slice(0, 50).map((id) => har.entries[id].url) })),
    },
    null,
    2,
  )
}

export function reportHtml(har) {
  const findings = analyzeCached(har)
  const score = healthScore(findings)
  const tp = thirdParty(har)
  const v = vitals(har) || []
  const color = { critical: '#e5484d', warning: '#d99a00', info: '#1558c9', good: '#2f9e44', warn: '#d99a00', bad: '#e5484d' }
  return `<!doctype html><html><head><meta charset="utf-8"><title>HAR report – ${esc(har.fileName)}</title>
<style>body{font:14px/1.5 system-ui,sans-serif;max-width:900px;margin:30px auto;padding:0 16px;color:#111}h1{margin:0}h2{margin-top:28px;border-bottom:2px solid #d4ff24;padding-bottom:4px}
.k{display:flex;gap:12px;flex-wrap:wrap}.k div{background:#f3f5fa;border-radius:10px;padding:10px 14px;min-width:120px}.k b{display:block;font-size:20px}
.f{border-left:4px solid #999;background:#fafbfd;margin:8px 0;padding:8px 12px;border-radius:6px}.f small{color:#555}table{border-collapse:collapse;width:100%}td,th{padding:4px 8px;border-bottom:1px solid #e5e7ee;text-align:left}</style></head><body>
<h1>HAR report</h1><div>${esc(har.fileName)} · generated ${new Date().toLocaleString()}</div>
<h2>Summary</h2><div class="k"><div><b>${score}</b>health score</div><div><b>${har.summary.count}</b>requests</div><div><b>${fmtMs(har.summary.totalTime)}</b>total time</div><div><b>${fmtBytes(har.summary.totalBytes)}</b>transferred</div><div><b>${har.summary.errors}</b>errors</div></div>
${v.length ? `<h2>Timing estimates</h2><div class="k">${v.map((m) => `<div style="border-top:3px solid ${color[m.rating]}"><b>${fmtMs(m.value)}</b>${m.key}</div>`).join('')}</div>` : ''}
<h2>Findings (${findings.length})</h2>${findings.map((f) => `<div class="f" style="border-color:${color[f.severity]}"><b>${esc(f.title)}</b> <small>${f.severity} · ${esc(f.category)} · ${f.ids.length} request(s)</small><br>${esc(f.detail)}<br><i>Fix: ${esc(f.fix)}</i></div>`).join('') || '<p>No issues found.</p>'}
<h2>Third parties</h2><p>${tp.count} third-party requests, ${fmtBytes(tp.thirdBytes)}.</p><table><tr><th>Domain</th><th>Requests</th><th>Bytes</th><th>Time</th></tr>${tp.rows.slice(0, 15).map((r) => `<tr><td>${esc(r.domain)}</td><td>${r.count}</td><td>${fmtBytes(r.bytes)}</td><td>${fmtMs(r.time)}</td></tr>`).join('')}</table>
</body></html>`
}
