import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faFilter, faXmark } from '@fortawesome/free-solid-svg-icons'
import { fmtBytes, fmtMs, statusClass } from '../utils'

const SORTS = {
  slow: ['Slowest first', (a, b) => b.time - a.time],
  big: ['Largest first', (a, b) => b.transfer - a.transfer],
  order: ['Request order', (a, b) => a.id - b.id],
}
const MAX_ROWS = 300

// Side panel listing the requests behind a clicked bar or card. Rows open the request inspector on top of it.
export default function RequestList({ panel, entries, source, onClose, onOpen, onFilter }) {
  const [sort, setSort] = useState('slow')
  const rows = useMemo(() => [...entries].sort(SORTS[sort][1]), [entries, sort])
  const bytes = entries.reduce((s, e) => s + e.transfer, 0)
  const avg = entries.length ? entries.reduce((s, e) => s + e.time, 0) / entries.length : 0

  return (
    <AnimatePresence>
      {panel && (
        <>
          <motion.div className="scrim list-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.aside
            className="drawer list-drawer" role="dialog" aria-label={`Requests: ${panel.title}`}
            initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', stiffness: 320, damping: 34 }}
          >
            <header>
              <div className="dr-title">
                <span className="ellipsis" title={panel.title}>{panel.title}</span>
                <button className="icon-btn" onClick={onClose} aria-label="Close"><FontAwesomeIcon icon={faXmark} /></button>
              </div>
              {source && <div className="dr-src">From capture: <b>{source}</b></div>}
              <div className="dr-actions rl-meta">
                <span><b>{entries.length}</b> request{entries.length === 1 ? '' : 's'}</span>
                <span className="dim">{fmtBytes(bytes)} · avg {fmtMs(avg)}</span>
              </div>
              <div className="dr-actions">
                <select className="input" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort requests">
                  {Object.entries(SORTS).map(([k, [label]]) => <option key={k} value={k}>{label}</option>)}
                </select>
                {panel.filter && (
                  <button className="btn sm" onClick={() => onFilter(panel.filter)}>
                    <FontAwesomeIcon icon={faFilter} /> Filter Waterfall to these
                  </button>
                )}
              </div>
            </header>
            <div className="dr-body rl-body">
              {rows.slice(0, MAX_ROWS).map((e) => (
                <button key={e.id} className="rl-row" onClick={() => onOpen(e.id)} title={e.url}>
                  <b className={statusClass(e.status)}>{e.status || 'ERR'}</b>
                  <span className="ellipsis"><span className="mono dim">{e.method}</span> {e.host}{e.path}</span>
                  <span className="num">{fmtBytes(e.transfer)}</span>
                  <span className="num">{fmtMs(e.time)}</span>
                </button>
              ))}
              {!rows.length && <div className="empty">No requests.</div>}
              {rows.length > MAX_ROWS && <div className="hint">Showing first {MAX_ROWS} of {rows.length}.</div>}
              <div className="hint">Click a request to inspect it.</div>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}
