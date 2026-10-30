import { useContext } from 'react'
import { useNavigate } from 'react-router-dom'
import { PHASES, PHASE_COLORS, TYPE_COLORS } from '../harParser'
import { DEFAULT_FILTERS, InspectCtx } from '../context'
import { fmtBytes, fmtMs } from '../utils'
import Bars, { HoverTip } from './Bars'

const byTime = (e) => e.time
const byBytes = (e) => e.transfer
const PHASE_RANK = Object.fromEntries(PHASES.map((p) => [p, (e) => e.phases[p]]))
const groupOf = (e) => (e.status >= 500 ? '5xx' : e.status >= 400 ? '4xx' : e.status >= 300 ? '3xx' : e.status >= 200 ? '2xx' : 'failed')
const STATUS_FILTER = { '2xx': 'ok', '3xx': '3xx', '4xx': '4xx', '5xx': '5xx', failed: 'failed' }
const STATUS_COLOR = { '2xx': 'var(--good)', '3xx': 'var(--blue-l)', '4xx': 'var(--warn)', '5xx': 'var(--bad)', failed: 'var(--bad)' }

function Stat({ label, value, tone, entries, onPick, hint }) {
  const body = (
    <>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </>
  )
  if (!entries) {
    if (!onPick) return <div className={`stat ${tone || ''}`}>{body}</div>
    return (
      <div className={`stat ${tone || ''} pick`} role="button" tabIndex={0} title={hint} onClick={onPick} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onPick())}>
        {body}
      </div>
    )
  }
  return (
    <HoverTip className={`stat ${tone || ''}${onPick ? ' pick' : ''}`} title={label} entries={entries} rank={byTime} footer={hint} onClick={onPick}>
      {body}
    </HoverTip>
  )
}

export default function Overview({ har, filters, setFilters }) {
  const inspect = useContext(InspectCtx)
  const navigate = useNavigate()
  const s = har.summary
  const all = har.entries

  // Requests / Errors cards filter the Waterfall directly
  const go = (patch) => {
    setFilters(patch ? { ...filters, ...patch } : DEFAULT_FILTERS)
    navigate('/waterfall')
  }

  const errors = all.filter((e) => e.error)
  const typeRows = Object.entries(s.byType)
    .map(([k, v]) => ({ label: `${k} (${v.count})`, value: v.bytes, color: TYPE_COLORS[k], entries: all.filter((e) => e.type === k), rank: byBytes, fmtRank: fmtBytes, filter: { type: k } }))
    .sort((a, b) => b.value - a.value)
  const phaseRows = PHASES.map((p) => ({ label: p, value: s.phaseTotals[p], color: PHASE_COLORS[p], entries: all.filter((e) => e.phases[p] > 0), rank: PHASE_RANK[p], fmtRank: fmtMs }))
  const hostRows = s.hosts.slice(0, 8).map((h) => ({ label: h.host, value: h.count, entries: all.filter((e) => e.host === h.host), rank: byTime, fmtRank: fmtMs, filter: { host: h.host } }))
  const statusRows = Object.entries(s.statusGroups).map(([k, v]) => ({ label: k, value: v, color: STATUS_COLOR[k], entries: all.filter((e) => groupOf(e) === k), rank: byTime, fmtRank: fmtMs, filter: { status: STATUS_FILTER[k] } }))

  return (
    <div className="panel-grid">
      <div className="stats">
        <Stat label="Requests" value={s.count} onPick={() => go(null)} hint="Click to clear filters and open the Waterfall" />
        <Stat label="Total time" value={fmtMs(s.totalTime)} />
        <Stat label="Transferred" value={fmtBytes(s.totalBytes)} />
        <Stat label="Avg request" value={fmtMs(s.avgTime)} />
        <Stat label="Errors" value={s.errors} tone={s.errors ? 'bad' : 'good'} entries={errors} onPick={errors.length ? () => go({ status: 'errors' }) : undefined} hint="Click to filter the Waterfall to errors" />
        <Stat label="Hosts" value={s.hosts.length} />
      </div>

      <section className="card"><h3>Time per phase (summed)</h3><Bars rows={phaseRows} fmt={fmtMs} /></section>
      <section className="card"><h3>Bytes by content type</h3><Bars rows={typeRows} fmt={fmtBytes} /></section>
      <section className="card"><h3>Top hosts by requests</h3><Bars rows={hostRows} color="var(--blue-l)" fmt={(v) => v} /></section>
      <section className="card"><h3>Status codes</h3><Bars rows={statusRows} fmt={(v) => v} /></section>

      <section className="card wide">
        <h3>Slowest requests</h3>
        <table className="tbl">
          <tbody>
            {s.slowest.map((e) => (
              <tr key={e.id} className="clickable" onClick={() => inspect(e.id)}>
                <td className="w60 mono">{e.method}</td>
                <td className="ellipsis" title={e.url}>{e.host}{e.path}</td>
                <td className="w60">{e.status || 'ERR'}</td>
                <td className="num w90">{fmtBytes(e.transfer)}</td>
                <td className="num w90">{fmtMs(e.time)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!s.slowest.length && <div className="empty">Nothing matches the current filters.</div>}
        <div className="hint">Click any bar to list the requests behind it (the panel has a button to filter the Waterfall). The Requests and Errors cards filter the Waterfall directly.</div>
      </section>
    </div>
  )
}
