import { useContext } from 'react'
import { useNavigate } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCircleCheck, faCircleExclamation } from '@fortawesome/free-solid-svg-icons'
import { PHASES, TYPE_ORDER } from '../harParser'
import { DEFAULT_FILTERS, InspectCtx } from '../context'
import { PHASE_LABEL, PHASE_VAR, STATUS_GROUPS, groupOfStatus } from '../theme'
import { fmtBytes, fmtMs } from '../utils'
import Bars, { HoverTip } from './Bars'
import { Card, StatusCode } from './ui'

const byTime = (e) => e.time
const byBytes = (e) => e.transfer
const STATUS_FILTER = { '2xx': 'ok', '3xx': '3xx', '4xx': '4xx', '5xx': '5xx', failed: 'failed' }

function Stat({ label, value, sub, tone, entries, onPick, hint, icon }) {
  const body = (
    <>
      <span className="stat-label">{icon && <FontAwesomeIcon icon={icon} />} {label}</span>
      <span className={`stat-value${tone ? ` tone-${tone}` : ''}`}>{value}</span>
      {sub && <span className="stat-sub">{sub}</span>}
    </>
  )
  if (entries) {
    return <HoverTip className={`stat${onPick ? ' pick' : ''}`} title={label} entries={entries} rank={byTime} footer={hint} onClick={onPick}>{body}</HoverTip>
  }
  if (onPick) {
    return <div className="stat pick" role="button" tabIndex={0} title={hint} onClick={onPick} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onPick())}>{body}</div>
  }
  return <div className="stat">{body}</div>
}

export default function Overview({ har, filters, setFilters }) {
  const inspect = useContext(InspectCtx)
  const navigate = useNavigate()
  const s = har.summary
  const all = har.entries

  const go = (patch) => {
    setFilters(patch ? { ...filters, ...patch } : DEFAULT_FILTERS)
    navigate('/waterfall')
  }

  const errors = all.filter((e) => e.error)
  const phaseTotal = PHASES.reduce((n, p) => n + s.phaseTotals[p], 0) || 1
  const phaseRows = PHASES.filter((p) => s.phaseTotals[p] > 0).map((p) => ({ key: p, label: PHASE_LABEL[p], value: s.phaseTotals[p], color: PHASE_VAR[p], entries: all.filter((e) => e.phases[p] > 0), rank: (e) => e.phases[p], fmtRank: fmtMs }))
  const typeRows = TYPE_ORDER.filter((k) => s.byType[k]).map((k) => ({ label: `${k} · ${s.byType[k].count}`, value: s.byType[k].bytes, entries: all.filter((e) => e.type === k), rank: byBytes, fmtRank: fmtBytes, filter: { type: k } })).sort((a, b) => b.value - a.value)
  const hostRows = s.hosts.slice(0, 8).map((h) => ({ label: h.host, value: h.count, entries: all.filter((e) => e.host === h.host), rank: byTime, fmtRank: fmtMs, filter: { host: h.host } }))
  const statusRows = Object.keys(STATUS_GROUPS).map((k) => ({ label: STATUS_GROUPS[k].label, value: s.statusGroups[k], color: STATUS_GROUPS[k].css, entries: all.filter((e) => groupOfStatus(e.status) === k), rank: byTime, fmtRank: fmtMs, filter: { status: STATUS_FILTER[k] } })).filter((r) => r.value > 0)

  return (
    <div className="page-grid">
      <div className="stats">
        <Stat label="Requests" value={s.count} sub={`${s.hosts.length} host${s.hosts.length === 1 ? '' : 's'}`} onPick={() => go(null)} hint="Open every request in the Waterfall" />
        <Stat label="Load time" value={fmtMs(s.totalTime)} sub={`avg request ${fmtMs(s.avgTime)}`} />
        <Stat label="Transferred" value={fmtBytes(s.totalBytes)} />
        <Stat label="Errors" icon={s.errors ? faCircleExclamation : faCircleCheck} value={s.errors} tone={s.errors ? 'crit' : 'good'} sub={s.errors ? 'failed or 4xx / 5xx' : 'none found'} entries={errors} onPick={errors.length ? () => go({ status: 'errors' }) : undefined} hint="Filter the Waterfall to errors" />
      </div>

      <Card title="Where the time goes" className="span-3" aside={<span className="t-cap">summed across all requests</span>}>
        <div className="phase-strip" role="img" aria-label={phaseRows.map((r) => `${r.label} ${fmtMs(r.value)}`).join(', ')}>
          {phaseRows.map((r) => (
            <HoverTip key={r.key} className="phase-seg" style={{ flexGrow: r.value }} title={r.label} entries={r.entries} rank={r.rank} fmtRank={r.fmtRank} footer="Click to list these requests" onClick={() => go(null)} label={`${r.label}: ${fmtMs(r.value)}`}>
              <i style={{ background: r.color }} />
            </HoverTip>
          ))}
        </div>
        <dl className="phase-key">
          {phaseRows.map((r) => (
            <div key={r.key}>
              <dt><i style={{ background: r.color }} />{r.label}</dt>
              <dd className="num">{fmtMs(r.value)} <small>{Math.round((r.value / phaseTotal) * 100)}%</small></dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card title="Responses"><Bars rows={statusRows} fmt={(v) => v} color="var(--c-series-1)" /></Card>
      <Card title="Bytes by type"><Bars rows={typeRows} fmt={fmtBytes} /></Card>
      <Card title="Busiest hosts"><Bars rows={hostRows} fmt={(v) => v} /></Card>

      <Card title="Slowest requests" className="span-3" flush>
        <table className="tbl">
          <thead><tr><th>Request</th><th className="num w90">Status</th><th className="num w90">Size</th><th className="num w90">Time</th></tr></thead>
          <tbody>
            {s.slowest.map((e) => (
              <tr key={e.id} className="clickable" tabIndex={0} onClick={() => inspect(e.id)} onKeyDown={(ev) => ev.key === 'Enter' && inspect(e.id)}>
                <td className="ellipsis" title={e.url}><span className="mono dim">{e.method}</span> {e.host}{e.path}</td>
                <td className="num"><StatusCode status={e.status} /></td>
                <td className="num">{fmtBytes(e.transfer)}</td>
                <td className="num">{fmtMs(e.time)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!s.slowest.length && <p className="pad dim">Nothing matches the current filters.</p>}
      </Card>
    </div>
  )
}
