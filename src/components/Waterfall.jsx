import { useContext, useMemo, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faSortDown, faSortUp } from '@fortawesome/free-solid-svg-icons'
import { PHASES, PHASE_COLORS } from '../harParser'
import { InspectCtx } from '../context'
import { fmtBytes, fmtMs, statusClass } from '../utils'

const COLS = [
  ['status', 'Status', (e) => e.status],
  ['name', 'Name', (e) => e.name.toLowerCase()],
  ['size', 'Size', (e) => e.transfer],
  ['timeline', 'Waterfall', (e) => e.startMs],
  ['time', 'Time', (e) => e.time],
]

export default function Waterfall({ har }) {
  const inspect = useContext(InspectCtx)
  const [sort, setSort] = useState({ key: 'timeline', dir: 1 })
  const total = Math.max(1, har.summary.totalTime)

  const rows = useMemo(() => {
    const get = COLS.find((c) => c[0] === sort.key)[2]
    return [...har.entries].sort((a, b) => {
      const x = get(a)
      const y = get(b)
      return (x < y ? -1 : x > y ? 1 : a.id - b.id) * sort.dir
    })
  }, [har, sort])

  const toggle = (key) => setSort((s) => (s.key === key ? { key, dir: -s.dir } : { key, dir: key === 'name' ? 1 : -1 }))

  return (
    <div>
      <div className="legend wf-legend">
        {PHASES.map((p) => <span key={p}><i style={{ background: PHASE_COLORS[p] }} />{p}</span>)}
      </div>
      <div className="wf">
        <div className="wf-row wf-head">
          {COLS.map(([key, label]) => (
            <button key={key} className={`th-btn${key === 'size' || key === 'time' ? ' r' : ''}`} onClick={() => toggle(key)} aria-label={`Sort by ${label}`}>
              {label}
              {sort.key === key && <FontAwesomeIcon icon={sort.dir === 1 ? faSortUp : faSortDown} />}
            </button>
          ))}
        </div>
        {rows.map((e) => (
          <div key={e.id} className="wf-row clickable" onClick={() => inspect(e.id)} tabIndex={0} onKeyDown={(ev) => ev.key === 'Enter' && inspect(e.id)}>
            <div className={`wf-status ${statusClass(e.status)}`}>{e.status || 'ERR'}</div>
            <div className="wf-name ellipsis" title={e.url}>
              <span className="mono dim">{e.method}</span> {e.name}
              <span className="dim"> {e.host}</span>
            </div>
            <div className="wf-size">{fmtBytes(e.transfer)}</div>
            <div className="wf-track">
              {har.markers.map((m) => <span key={m.label} className="wf-mark" title={`${m.label} ${fmtMs(m.ms)}`} style={{ left: `${Math.min(100, (m.ms / total) * 100)}%`, background: m.color }} />)}
              {PHASES.map((p) => {
                const w = e.phases[p]
                if (!w) return null
                return <div key={p} className="wf-seg" title={`${p}: ${fmtMs(w)}`} style={{ left: `${(e.span[p].start / total) * 100}%`, width: `max(2px, ${(w / total) * 100}%)`, background: PHASE_COLORS[p] }} />
              })}
            </div>
            <div className="wf-time">{fmtMs(e.time)}</div>
          </div>
        ))}
        {!rows.length && <div className="empty">No requests match the current filters.</div>}
      </div>
      <div className="hint">Click a column to sort, click a row to open the inspector. Vertical lines are DOMContentLoaded / Load markers.</div>
    </div>
  )
}
