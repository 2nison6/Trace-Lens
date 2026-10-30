import { useMemo, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faFilter, faXmark } from '@fortawesome/free-solid-svg-icons'
import { fmtBytes, fmtMs } from '../utils'
import { StatusCode } from './ui'

const SORTS = {
  slow: ['Slowest first', (a, b) => b.time - a.time],
  big: ['Largest first', (a, b) => b.transfer - a.transfer],
  order: ['Request order', (a, b) => a.id - b.id],
}
const MAX_ROWS = 300

/** The requests behind a clicked bar or card. Rendered inside the dock; rows open the inspector. */
export default function RequestList({ panel, entries, source, onClose, onOpen, onFilter }) {
  const [sort, setSort] = useState('slow')
  const rows = useMemo(() => [...entries].sort(SORTS[sort][1]), [entries, sort])
  if (!panel) return null
  const bytes = entries.reduce((s, e) => s + e.transfer, 0)
  const avg = entries.length ? entries.reduce((s, e) => s + e.time, 0) / entries.length : 0

  return (
    <div className="dock-in">
      <header className="dock-h">
        <div className="dock-title">
          <h2 className="ellipsis" title={panel.title}>{panel.title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close list"><FontAwesomeIcon icon={faXmark} /></button>
        </div>
        {source && <p className="dock-src">From <b>{source}</b></p>}
        <p className="dim num">{entries.length} request{entries.length === 1 ? '' : 's'} · {fmtBytes(bytes)} · avg {fmtMs(avg)}</p>
        <div className="dock-actions">
          <select aria-label="Sort requests" value={sort} onChange={(e) => setSort(e.target.value)}>
            {Object.entries(SORTS).map(([k, [label]]) => <option key={k} value={k}>{label}</option>)}
          </select>
          {panel.filter && (
            <button type="button" className="btn sm" onClick={() => onFilter(panel.filter)}>
              <FontAwesomeIcon icon={faFilter} /> Filter Waterfall
            </button>
          )}
        </div>
      </header>
      <div className="dock-body">
        {rows.slice(0, MAX_ROWS).map((e) => (
          <button key={e.id} type="button" className="rl-row" onClick={() => onOpen(e.id)} title={e.url}>
            <StatusCode status={e.status} />
            <span className="ellipsis"><span className="mono dim">{e.method}</span> {e.host}{e.path}</span>
            <span className="num">{fmtBytes(e.transfer)}</span>
            <span className="num">{fmtMs(e.time)}</span>
          </button>
        ))}
        {!rows.length && <p className="dim pad-s">No requests.</p>}
        {rows.length > MAX_ROWS && <p className="hint">Showing first {MAX_ROWS} of {rows.length}.</p>}
      </div>
    </div>
  )
}
