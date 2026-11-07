// Report builders: one per tool, each turning what the tool already computed into a plain, shareable model.
//
//   report = { id, tool, title, subtitle, kpis: [{ label, value, tone }], charts: [{ title, svg, head, rows, note }],
//              sections: [{ title, intro, checks, table: { head, rows } }], notes: [string] }
//
// A report is made to be sent to someone else, so it never contains the secrets a capture does: no token strings, no cookie
// values, no SAML XML or assertions, no user names or NameIDs, and no URL query strings (those carry codes and tokens). It does
// contain host names, paths, entity IDs, client IDs and the findings themselves.
import { analyzeCached, healthScore } from '../har/analyzer'
import { PHASES } from '../har/harParser'
import { analyzeCookies, cookieBudget, sessionLifetimes } from '../auth/cookies'
import { analyzeOAuth, analyzeTokenRequests, flowSteps } from '../auth/oauth'
import { analyzeWindowsAuth } from '../auth/windows'
import { checkJwt, findTokens, tokenTimeline } from '../auth/jwt'
import { checkCertificate, shortName } from '../auth/certs'
import { analyzeFlow, checkMessage } from '../saml/checks'
import { fmtBytes, fmtMs, ratingOf } from '../lib/utils'
import { barList, rangeTimeline, stackBars } from './charts'

const SEV = ['critical', 'warning', 'info']
const TONE = { critical: 'crit', warning: 'warn', info: 'info', ok: 'good' }
const NAME = { critical: 'critical', warning: 'warnings', info: 'notes' }
export const LEGEND = [{ tone: 'crit', name: 'Critical' }, { tone: 'warn', name: 'Warning' }, { tone: 'info', name: 'Note' }]

/** The address without its query string or fragment: those hold the codes and tokens a report must not carry. */
export const noQuery = (u) => String(u ?? '').replace(/[?#].*$/, '')
const where = (e) => `${e.host || ''}${noQuery(e.path || '')}`
export const countOf = (checks) => Object.fromEntries(SEV.map((s) => [s, checks.filter((c) => c.severity === s).length]))
const parts = (checks) => SEV.map((s) => ({ value: countOf(checks)[s], tone: TONE[s], name: NAME[s] }))
const byWorst = (a, b) => ['critical', 'warning', 'info', 'ok'].indexOf(a.severity) - ['critical', 'warning', 'info', 'ok'].indexOf(b.severity)
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`
const day = (t) => (Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : '—')

/** Merge checks that say the same thing (same title) across many items, keeping a count. */
function merge(checks) {
  const seen = new Map()
  for (const c of checks) {
    const k = `${c.severity}|${c.title}`
    if (seen.has(k)) seen.get(k).count += 1
    else seen.set(k, { ...c, count: 1 })
  }
  return [...seen.values()].map((c) => ({ ...c, title: c.count > 1 ? `${c.title} (×${c.count})` : c.title })).sort(byWorst)
}

const bars = (title, rows, fmt, opts = {}) => ({
  title, svg: barList(rows.map((r) => ({ ...r, display: fmt ? fmt(r.value) : r.value })), { title, ...opts }), head: [opts.labelHead || 'Item', opts.valueHead || 'Value'], rows: rows.map((r) => [r.label, fmt ? fmt(r.value) : String(r.value)]), note: opts.note || '',
})
const stacks = (title, rows, opts = {}) => ({
  title, svg: stackBars(rows, { title, legend: LEGEND, ...opts }), head: [opts.labelHead || 'Item', 'Critical', 'Warning', 'Note'], rows: rows.map((r) => [r.label, ...r.parts.map((p) => String(p.value))]), note: opts.note || '',
})

// ---------------------------------------------------------------------------------------------------------------- HAR
export function harReport(har) {
  if (!har) return null
  const findings = analyzeCached(har)
  const score = healthScore(findings)
  const s = har.summary
  const cats = [...new Set(findings.map((f) => f.category))]
  const catRows = cats.map((c) => ({ label: c, parts: parts(findings.filter((f) => f.category === c)) })).sort((a, b) => b.parts.reduce((n, p) => n + p.value, 0) - a.parts.reduce((n, p) => n + p.value, 0))
  const phaseTone = { blocked: 'blocked', dns: 'dns', connect: 'connect', ssl: 'ssl', send: 'send', wait: 'wait', receive: 'receive' }
  const types = Object.entries(s.byType).sort((a, b) => b[1].bytes - a[1].bytes).slice(0, 8)
  const slow = [...har.entries].sort((a, b) => b.time - a.time).slice(0, 8)
  const charts = []
  if (catRows.length) charts.push(stacks('Findings by category', catRows, { labelHead: 'Category', note: 'Each bar is a category of problem; its segments are how many findings of each severity it has.' }))
  charts.push(bars('Where the time went, summed over all requests', PHASES.map((p) => ({ label: p, value: s.phaseTotals[p], tone: phaseTone[p] })), fmtMs, { labelHead: 'Phase', valueHead: 'Time', note: 'Waiting is the server thinking; receive is the download; the rest is setting up the connection.' }))
  if (types.length) charts.push(bars('Data transferred by type', types.map(([t, v]) => ({ label: t, value: v.bytes, tone: 's1' })), fmtBytes, { labelHead: 'Type', valueHead: 'Size' }))
  if (slow.length) charts.push(bars('Slowest requests', slow.map((e) => ({ label: `${e.method} ${where(e)}`, value: e.time, tone: e.error ? 'crit' : 's2' })), fmtMs, { labelHead: 'Request', valueHead: 'Time' }))
  const checks = findings.map((f) => ({ severity: f.severity, title: `${f.title}${f.ids.length > 1 ? ` (${f.ids.length} requests)` : ''}`, detail: f.detail, fix: f.fix }))
  return {
    id: 'har', tool: 'har', title: 'Network trace (HAR)', subtitle: `${har.fileName}${har.creator ? ` · captured with ${har.creator}` : ''}`,
    kpis: [{ label: 'Health score', value: `${score}/100`, tone: ratingOf(score).tone }, { label: 'Requests', value: String(s.count) }, { label: 'Transferred', value: fmtBytes(s.totalBytes) }, { label: 'Load time', value: fmtMs(s.totalTime) }, { label: 'Errors', value: String(s.errors), tone: s.errors ? 'crit' : 'good' }, { label: 'Hosts', value: String(s.hosts.length) }],
    charts,
    sections: [
      { title: `Findings (${findings.length})`, checks: checks.length ? checks : [{ severity: 'ok', title: 'No issues found', detail: 'None of the checks fired for this capture.' }] },
      { title: 'Slowest requests', table: { head: ['Request', 'Status', 'Size', 'Time'], rows: slow.map((e) => [`${e.method} ${where(e)}`, String(e.status || 'failed'), fmtBytes(e.transfer), fmtMs(e.time)]) } },
    ],
    notes: ['Addresses are shown without their query strings. For every request in a table, use Tools → Export a report on the HAR analyzer.'],
  }
}

// ---------------------------------------------------------------------------------------------------------------- SAML
const TITLE = { AuthnRequest: 'Sign-in request', Response: 'Sign-in response', LogoutRequest: 'Sign-out request', LogoutResponse: 'Sign-out response', ArtifactResolve: 'Artifact request', ArtifactResponse: 'Artifact response' }
const msOf = (s) => { const t = s ? Date.parse(s) : NaN; return Number.isFinite(t) ? t : null }

/** items: [{ parsed, at, atIssued, entry, hit }]; now: the time to check pasted messages against. extra: { metadata } published checks. */
export function samlReport(items, { now = Date.now(), metadata = null } = {}) {
  const usable = (items || []).filter((i) => i && i.parsed)
  if (!usable.length && !metadata) return null
  const asOf = (it) => {
    if (it.at != null) return it.at
    if (it.atIssued) { const p = it.parsed; const t = msOf(p && !p.error ? p.issueInstant || (p.assertions && p.assertions[0] && p.assertions[0].issueInstant) : null); return t != null ? t + 1000 : now }
    return now
  }
  const rows = usable.map((it, i) => {
    const p = it.parsed
    const label = `${i + 1}. ${TITLE[p && p.type] || 'Message'}`
    const checks = p && !p.error ? checkMessage(p, { now: asOf(it) }) : [{ severity: 'critical', title: 'The message could not be read', detail: (p && p.error) || it.error || '' }]
    return { it, p, label, checks }
  })
  const flow = analyzeFlow(usable.filter((i) => i.parsed && !i.parsed.error))
  const all = [...rows.flatMap((r) => r.checks), ...flow.checks]
  const windows = []
  for (const r of rows) {
    const a = r.p && !r.p.error && r.p.assertions && r.p.assertions[0]
    const c = a && a.conditions
    if (c && msOf(c.notBefore) != null && msOf(c.notOnOrAfter) != null) windows.push({ label: r.label, from: msOf(c.notBefore), to: msOf(c.notOnOrAfter), tone: r.checks.some((x) => x.severity === 'critical') ? 'crit' : 's1', marks: [{ at: msOf(a.issueInstant), tone: 'info', name: 'Issued' }, { at: asOf(r.it), tone: 'ink', name: 'Checked at' }] })
  }
  const charts = []
  if (rows.length) charts.push(stacks('Findings per message', rows.map((r) => ({ label: r.label, parts: parts(r.checks) })).slice(0, 14), { labelHead: 'Message' }))
  if (windows.length) charts.push({ title: 'When each assertion is valid', svg: rangeTimeline(windows.slice(0, 10), { title: 'When each assertion is valid', desc: 'Each bar is the time an assertion may be used. The blue dot is when it was issued and the dark dot is the time it was checked.' }), head: ['Message', 'Valid from', 'Valid until'], rows: windows.map((w) => [w.label, new Date(w.from).toISOString(), new Date(w.to).toISOString()]), note: 'A dark dot outside the bar means the message was checked outside its own validity window.' })
  const sections = []
  if (rows.length) sections.push({ title: 'Messages', table: { head: ['Message', 'Sent', 'Issuer (entity ID)', 'Status', 'Problems'], rows: rows.map((r) => { const c = countOf(r.checks); const st = r.p && r.p.status; return [r.label, r.it.entry ? `${r.it.entry.method} ${where(r.it.entry)}` : (r.it.hit && r.it.hit.param) || '', (r.p && r.p.issuer) || '—', st ? (st.success ? 'Success' : `${st.codeName}${st.subCodeName ? ` / ${st.subCodeName}` : ''}`) : '—', `${c.critical} critical, ${c.warning} warning`] }) } })
  if (flow.checks.length) sections.push({ title: 'The sign-in as a whole', checks: flow.checks })
  const merged = merge(rows.flatMap((r) => r.checks).filter((c) => c.severity !== 'ok'))
  sections.push({ title: 'Findings across the messages', checks: merged.length ? merged : [{ severity: 'ok', title: 'Nothing wrong found in the messages', detail: 'This covers what the messages themselves say, not whether a signature was verified against your identity provider’s certificate.' }] })
  if (metadata && metadata.length) sections.push({ title: 'Metadata and how the messages agree with it', checks: metadata })
  return {
    id: 'saml', tool: 'saml', title: 'SAML sign-in', subtitle: plural(usable.length, 'message'),
    kpis: [{ label: 'Messages', value: String(usable.length) }, { label: 'Critical', value: String(countOf(all).critical), tone: countOf(all).critical ? 'crit' : 'good' }, { label: 'Warnings', value: String(countOf(all).warning), tone: countOf(all).warning ? 'warn' : 'good' }, { label: 'Notes', value: String(countOf(all).info) }],
    charts, sections,
    notes: ['SAML XML, assertions, user names and NameIDs are not included. Signature verification needs your identity provider’s certificate and is done on the SAML page, so it is not part of this report.'],
  }
}

// ---------------------------------------------------------------------------------------------------------------- OAuth
export async function oauthReport(har, { discovery = null } = {}) {
  if (!har && !discovery) return null
  const result = har ? await analyzeOAuth(har) : { flows: [], tokenOnly: [] }
  const tokenReqs = har ? analyzeTokenRequests(har) : { requests: [], checks: [] }
  const flows = result.flows
  if (!flows.length && !tokenReqs.requests.length && !discovery) return null
  const rows = flows.map((fl, i) => ({ fl, label: `Sign-in ${i + 1} (${fl.protocol === 'oidc' ? 'OpenID Connect' : 'OAuth 2.0'}, ${fl.flow})` }))
  const all = [...flows.flatMap((f) => f.checks), ...tokenReqs.checks, ...tokenReqs.requests.flatMap((r) => r.checks), ...(discovery || [])]
  const charts = []
  if (rows.length) charts.push(stacks('Findings per sign-in', rows.map((r) => ({ label: r.label, parts: parts(r.fl.checks) })), { labelHead: 'Sign-in' }))
  const step = flows.find((f) => f.token) || flows[0]
  if (step) {
    const steps = flowSteps(step)
    const t0 = steps[0] && steps[0].at
    const timed = steps.filter((s) => s.at != null && t0 != null)
    if (timed.length > 1) charts.push(bars('When each step happened (first sign-in)', timed.map((s) => ({ label: s.name, value: s.at - t0, tone: s.status >= 400 ? 'crit' : 's1' })), fmtMs, { labelHead: 'Step', valueHead: 'Time since the first step', note: 'A long gap before the token request is a code that may have expired before it was redeemed.' }))
  }
  const sections = []
  for (const r of rows) {
    const a = r.fl.authorize.params
    const steps = flowSteps(r.fl)
    sections.push({
      title: r.label,
      table: { head: ['Step', 'Where', 'Status'], rows: steps.map((s) => [s.name, noQuery(s.detail), String(s.status || '—')]) },
      kv: [['client_id', a.client_id || '—'], ['redirect_uri', a.redirect_uri ? noQuery(a.redirect_uri) : '—'], ['Scopes', r.fl.scopes.join(' ') || '—'], ['PKCE', a.code_challenge ? (a.code_challenge_method || 'plain') : 'not used']],
      checks: r.fl.checks.length ? r.fl.checks : [{ severity: 'ok', title: 'No problems found in this sign-in', detail: '' }],
    })
  }
  if (tokenReqs.requests.length) sections.push({ title: `Token requests (${tokenReqs.requests.length})`, table: { head: ['Grant', 'Endpoint', 'Status', 'Problems'], rows: tokenReqs.requests.map((r) => [r.grant || '—', where(r.entry), String(r.entry.status), String(r.checks.filter((c) => c.severity !== 'ok').length)]) }, checks: merge([...tokenReqs.checks, ...tokenReqs.requests.flatMap((r) => r.checks)].filter((c) => c.severity !== 'ok')) })
  if (discovery && discovery.length) sections.push({ title: 'Provider discovery document and signing keys', checks: discovery })
  const c = countOf(all)
  return {
    id: 'oauth', tool: 'oauth', title: 'OAuth 2.0 and OpenID Connect', subtitle: `${plural(flows.length, 'sign-in')}, ${plural(tokenReqs.requests.length, 'token request')}`,
    kpis: [{ label: 'Sign-ins', value: String(flows.length) }, { label: 'Token requests', value: String(tokenReqs.requests.length) }, { label: 'Critical', value: String(c.critical), tone: c.critical ? 'crit' : 'good' }, { label: 'Warnings', value: String(c.warning), tone: c.warning ? 'warn' : 'good' }],
    charts, sections,
    notes: ['Authorization codes, tokens, state values and code verifiers are not included, and addresses are shown without their query strings.'],
  }
}

// ---------------------------------------------------------------------------------------------------------------- tokens
export function tokensReport(har, { loadedAt = Date.now(), inspected = null } = {}) {
  const found = har ? findTokens(har) : []
  if (!found.length && !inspected) return null
  const readable = found.filter((t) => t.decoded && !t.decoded.error)
  const timeline = tokenTimeline(found)
  const idx = new Map(readable.map((t, i) => [t.token, i + 1]))
  const label = (t) => { const p = t.decoded.payload; return `Token ${idx.get(t.token)}${p.aud ? ` for ${(Array.isArray(p.aud) ? p.aud[0] : p.aud)}`.slice(0, 40) : ''}` }
  const perToken = readable.map((t) => { const first = t.uses.find((u) => u.at != null); return { t, checks: checkJwt(t.decoded, { now: first ? first.at : loadedAt }) } })
  const all = perToken.flatMap((x) => x.checks)
  const charts = []
  const ranges = timeline.filter((r) => r.exp != null).map((r) => {
    const t = readable.find((x) => x.token === r.token)
    return { label: label(t), from: r.iat ?? r.nbf ?? r.first, to: r.exp, tone: r.usedAfterExpiry ? 'crit' : 's1', marks: [{ at: r.first, tone: 'info', name: 'First used' }, { at: r.last, tone: 'ink', name: 'Last used' }] }
  }).filter((r) => Number.isFinite(r.from))
  if (ranges.length) charts.push({ title: 'Token lifetimes and when they were used', svg: rangeTimeline(ranges.slice(0, 10), { title: 'Token lifetimes and when they were used', desc: 'Each bar runs from when a token was issued to when it expires. Dots show the first and last time it was used.' }), head: ['Token', 'Issued', 'Expires'], rows: ranges.map((r) => [r.label, new Date(r.from).toISOString(), new Date(r.to).toISOString()]), note: 'A red bar is a token that was used after it expired.' })
  if (perToken.length) charts.push(stacks('Findings per token', perToken.map((x) => ({ label: label(x.t), parts: parts(x.checks) })).slice(0, 12), { labelHead: 'Token' }))
  const sections = []
  if (readable.length) sections.push({ title: 'Tokens in the capture', table: { head: ['Token', 'Algorithm', 'Issuer', 'Lifetime', 'Used', 'Rejected', 'Used after expiry'], rows: readable.map((t) => { const r = timeline.find((x) => x.token === t.token); const p = t.decoded.payload; return [label(t), t.decoded.header.alg || '—', p.iss ? noQuery(String(p.iss)) : '—', r && r.lifetimeMs != null ? fmtMs(r.lifetimeMs).replace(/^(\d+)\.\d+ s$/, '$1 s') : '—', String(t.uses.length), r ? String(r.rejected) : '0', r && r.usedAfterExpiry ? 'yes' : 'no'] }) } })
  const merged = merge(all.filter((c) => c.severity !== 'ok'))
  if (readable.length) sections.push({ title: 'Findings across the tokens', checks: merged.length ? merged : [{ severity: 'ok', title: 'Nothing wrong found in the tokens', detail: 'This reads the tokens; it does not verify their signatures.' }] })
  if (inspected && inspected.length) sections.push({ title: 'The token you pasted on the Inspect page', checks: inspected })
  const c = countOf([...all, ...(inspected || [])])
  return {
    id: 'tokens', tool: 'tokens', title: 'Tokens (JWT)', subtitle: `${plural(found.length, 'token')} in the capture`,
    kpis: [{ label: 'Tokens', value: String(found.length) }, { label: 'Used after expiry', value: String(timeline.filter((r) => r.usedAfterExpiry).length), tone: timeline.some((r) => r.usedAfterExpiry) ? 'crit' : 'good' }, { label: 'Critical', value: String(c.critical), tone: c.critical ? 'crit' : 'good' }, { label: 'Warnings', value: String(c.warning), tone: c.warning ? 'warn' : 'good' }],
    charts, sections,
    notes: ['Token values, user names and subject IDs are not included. Signatures are not verified here: use the Inspect page with the issuer’s key.'],
  }
}

// ---------------------------------------------------------------------------------------------------------------- certificates
/** chain: certificates (parsed), chainChecks: checks across the chain, host: the host name it must be valid for. */
export function certsReport({ chain = [], chainChecks = [], host = '', now = Date.now(), fps = {}, roleOf = (i, n, c) => (c.selfSigned && i === n - 1 ? 'root' : i === 0 ? 'leaf' : 'intermediate') } = {}) {
  if (!chain.length) return null
  const each = chain.map((c, i) => ({ c, role: roleOf(i, chain.length, c), checks: checkCertificate(c, { now, role: roleOf(i, chain.length, c), host: i === 0 ? host : '' }) }))
  const all = [...each.flatMap((x) => x.checks), ...chainChecks]
  const ranges = each.map((x) => ({ label: `${x.role}: ${shortName(x.c)}`, from: x.c.notBefore, to: x.c.notAfter, tone: x.c.notAfter <= now ? 'crit' : x.c.notAfter - now < 30 * 86400e3 ? 'warn' : 's1' }))
  const charts = [
    { title: 'When each certificate is valid', svg: rangeTimeline(ranges, { title: 'When each certificate is valid', desc: 'Each bar is the period a certificate is valid. The dark line is today.', now }), head: ['Certificate', 'Valid from', 'Valid until'], rows: each.map((x) => [`${x.role}: ${shortName(x.c)}`, day(x.c.notBefore), day(x.c.notAfter)]), note: 'Red has expired; orange expires within 30 days.' },
    stacks('Findings per certificate', each.map((x) => ({ label: `${x.role}: ${shortName(x.c)}`, parts: parts(x.checks) })), { labelHead: 'Certificate' }),
  ]
  return {
    id: 'certs', tool: 'certs', title: 'Certificates and chains', subtitle: `${plural(chain.length, 'certificate')}${host ? ` · checked for ${host}` : ''}`,
    kpis: [{ label: 'Certificates', value: String(chain.length) }, { label: 'Critical', value: String(countOf(all).critical), tone: countOf(all).critical ? 'crit' : 'good' }, { label: 'Warnings', value: String(countOf(all).warning), tone: countOf(all).warning ? 'warn' : 'good' }, { label: 'Soonest expiry', value: day(Math.min(...chain.map((c) => c.notAfter))) }],
    charts,
    sections: [
      { title: 'The certificates', table: { head: ['Role', 'Subject', 'Issuer', 'Valid until', 'Key', 'Signed with', 'SHA-256 fingerprint'], rows: each.map((x) => [x.role, x.c.subject, x.c.selfSigned ? `${x.c.issuer} (self-signed)` : x.c.issuer, day(x.c.notAfter), `${x.c.key.algorithm} ${x.c.key.curve || x.c.key.bits}`, x.c.signatureAlgorithm, (fps[x.c.base64] && fps[x.c.base64].sha256) || '—']) } },
      { title: 'Across the chain', checks: chainChecks.length ? chainChecks : [{ severity: 'ok', title: 'Nothing to report about the chain', detail: '' }] },
      ...each.map((x) => ({ title: `${x.role}: ${shortName(x.c)}`, checks: x.checks.length ? x.checks : [{ severity: 'ok', title: 'No problems found', detail: '' }] })),
    ],
    notes: ['Certificates are public. This checks dates, names, usages and how the chain fits together. It does not check revocation or whether your system trusts the root.'],
  }
}

// ---------------------------------------------------------------------------------------------------------------- Windows sign-in
export function windowsReport(har) {
  if (!har) return null
  const hosts = analyzeWindowsAuth(har)
  if (!hosts.length) return null
  const all = hosts.flatMap((h) => h.checks)
  const sizes = hosts.flatMap((h) => h.steps.filter((s) => s.dir === 'client' && s.token && s.token.bytes).map((s) => ({ label: `${h.host} (${s.token.kind})`, value: s.token.bytes, tone: s.token.bytes > 12000 ? 'crit' : s.token.bytes > 8000 ? 'warn' : 's1' })))
  const charts = [stacks('Findings per server', hosts.map((h) => ({ label: h.host, parts: parts(h.checks) })), { labelHead: 'Server' })]
  if (sizes.length) charts.push(bars('Size of the tokens the browser sent', sizes.slice(0, 10), (n) => `${(n / 1024).toFixed(1)} KB`, { marks: [{ value: 8000, label: '8 KB', tone: 'warn' }, { value: 12000, label: '12 KB', tone: 'crit' }], labelHead: 'Server', valueHead: 'Size', note: 'Large Kerberos tickets can exceed the server’s header limit, which fails with HTTP 400.' }))
  return {
    id: 'windows', tool: 'windows', title: 'Windows sign-in (Kerberos and NTLM)', subtitle: plural(hosts.length, 'server'),
    kpis: [{ label: 'Servers', value: String(hosts.length) }, { label: 'Critical', value: String(countOf(all).critical), tone: countOf(all).critical ? 'crit' : 'good' }, { label: 'Warnings', value: String(countOf(all).warning), tone: countOf(all).warning ? 'warn' : 'good' }],
    charts,
    sections: [
      { title: 'The exchanges', table: { head: ['Server', 'Steps', 'Schemes', 'Last status', 'Problems'], rows: hosts.map((h) => [h.host, String(h.steps.length), [...new Set(h.steps.map((s) => s.scheme))].join(', '), String(h.steps[h.steps.length - 1].status || '—'), String(h.checks.filter((c) => c.severity === 'critical' || c.severity === 'warning').length)]) } },
      ...hosts.map((h) => ({ title: h.host, checks: h.checks })),
    ],
    notes: ['The Negotiate and NTLM tokens themselves are not included.'],
  }
}

// ---------------------------------------------------------------------------------------------------------------- cookies
export function cookiesReport(har) {
  if (!har) return null
  const a = analyzeCookies(har)
  if (!a.stats.hasAny) return null
  const budget = cookieBudget(har)
  const sessions = sessionLifetimes(a)
  const problems = a.problems.map((p) => ({ severity: p.severity, title: `${p.title}: ${p.cookie || ''}${p.count > 1 ? ` (×${p.count})` : ''}`.replace(/: $/, ''), detail: p.detail, fix: p.fix }))
  const all = a.problems
  const charts = []
  if (budget.length) charts.push(bars('The biggest Cookie header sent to each host', budget.slice(0, 10).map((b) => ({ label: b.host, value: b.maxBytes, tone: b.status === 'critical' ? 'crit' : b.status === 'warning' ? 'warn' : 's1' })), (n) => `${fmtBytes(n)}`, { marks: [{ value: 4000, label: '4 KB', tone: 'warn' }, { value: 8000, label: '8 KB', tone: 'crit' }], labelHead: 'Host', valueHead: 'Largest header', note: 'Many servers refuse a Cookie header of about 8 KB.' }))
  const states = ['stored', 'rejected', 'deleted', 'earlier'].map((k) => ({ label: { stored: 'Stored', rejected: 'Rejected by the browser', deleted: 'Deleted', earlier: 'Set before the capture' }[k], value: a.cookies.filter((c) => c.state === k).length, tone: k === 'rejected' ? 'crit' : 's1' })).filter((r) => r.value)
  if (states.length) charts.push(bars('What happened to each cookie', states, String, { labelHead: 'State', valueHead: 'Cookies' }))
  const life = sessions.filter((s) => s.lifetimeMs != null).map((s) => ({ label: s.name, value: s.lifetimeMs / 86400e3, tone: 's1' }))
  if (life.length) charts.push(bars('How long the session cookies last', life, (d) => (d < 1 ? `${Math.round(d * 24)} hours` : `${d.toFixed(d < 10 ? 1 : 0)} days`), { labelHead: 'Cookie', valueHead: 'Lifetime' }))
  const flags = (x) => (x ? [x.secure && 'Secure', x.httpOnly && 'HttpOnly', x.sameSite ? `SameSite=${x.sameSite}` : 'no SameSite', x.partitioned && 'Partitioned'].filter(Boolean).join(', ') : '—')
  const c = countOf(all)
  return {
    id: 'cookies', tool: 'cookies', title: 'Cookies and sessions', subtitle: `${plural(a.cookies.length, 'cookie')} across ${plural(a.stats.captured, 'request')}`,
    kpis: [{ label: 'Cookies', value: String(a.cookies.length) }, { label: 'Rejected', value: String(a.cookies.filter((x) => x.state === 'rejected').length), tone: a.cookies.some((x) => x.state === 'rejected') ? 'crit' : 'good' }, { label: 'Critical', value: String(c.critical), tone: c.critical ? 'crit' : 'good' }, { label: 'Warnings', value: String(c.warning), tone: c.warning ? 'warn' : 'good' }],
    charts,
    sections: [
      { title: 'Cookies', table: { head: ['Name', 'Domain', 'Flags', 'State', 'Set', 'Sent'], rows: a.cookies.slice(0, 60).map((x) => [x.name || '(no name)', `${x.domain}${x.path}`, flags(x.attrs), x.state, String(x.sets.length), String(x.sends.length)]) } },
      { title: 'Problems', checks: problems.length ? problems : [{ severity: 'ok', title: 'No cookie problems found', detail: 'The browser’s own settings are not in a capture, so blocking by the browser cannot be seen here.' }] },
    ],
    notes: ['Cookie values are not included. Browser privacy settings, tracking protection and extensions are not in a capture.'],
  }
}

// ---------------------------------------------------------------------------------------------------------------- everything
export const ORDER = ['har', 'saml', 'oauth', 'tokens', 'certs', 'windows', 'cookies']

/** The combined overview: which tools have a report, and how many problems each found. */
export function overviewReport(reports, names) {
  const have = ORDER.map((id) => reports[id]).filter(Boolean)
  const sev = (r) => { const all = [...(r.sections || []).flatMap((s) => s.checks || [])]; return countOf(all) }
  const rows = ORDER.map((id) => ({ id, r: reports[id] }))
  const partsOf = (r) => { const c = sev(r); return SEV.map((s) => ({ value: c[s], tone: TONE[s], name: NAME[s] })) }
  const charts = have.length ? [{ title: 'Findings by tool', svg: stackBars(have.map((r) => ({ label: r.title, parts: partsOf(r) })), { title: 'Findings by tool', legend: LEGEND }), head: ['Tool', 'Critical', 'Warning', 'Note'], rows: have.map((r) => [r.title, ...SEV.map((s) => String(sev(r)[s]))]), note: 'Only tools with something to report appear.' }] : []
  return {
    id: 'overview', tool: 'all', title: 'Overview', subtitle: `${have.length} of ${ORDER.length} tools have something to report`,
    kpis: [{ label: 'Tools with data', value: `${have.length}/${ORDER.length}` }, { label: 'Critical', value: String(have.reduce((n, r) => n + sev(r).critical, 0)), tone: have.some((r) => sev(r).critical) ? 'crit' : 'good' }, { label: 'Warnings', value: String(have.reduce((n, r) => n + sev(r).warning, 0)), tone: have.some((r) => sev(r).warning) ? 'warn' : 'good' }],
    charts,
    sections: [{ title: 'What each tool found', table: { head: ['Tool', 'Status', 'Critical', 'Warning', 'Note'], rows: rows.map(({ id, r }) => { if (!r) return [names[id] || id, 'No data', '—', '—', '—']; const c = sev(r); return [r.title, 'Reported', String(c.critical), String(c.warning), String(c.info)] }) } }],
    notes: [],
  }
}

