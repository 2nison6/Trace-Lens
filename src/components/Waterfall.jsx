import { useContext, useMemo, useRef, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faSortDown, faSortUp } from '@fortawesome/free-solid-svg-icons'
import { PHASES } from '../harParser'
import { InspectCtx, SelectedCtx } from '../context'
import { PHASE_HELP, PHASE_LABEL, PHASE_VAR } from '../theme'
import { fmtAxis, fmtBytes, fmtMs, niceTicks } from '../utils'
import { EmptyState, StatusCode } from './ui'

const COLS = [
  ['status', 'Status', (e) => e.status],
  ['name', 'Request', (e) => e.name.toLowerCase()],
  ['size', 'Size', (e) => e.transfer],
  ['timeline', 'Timeline', (e) => e.startMs],
  ['time', 'Time', (e) => e.time],
]
const ROW_H = 34
const OVERSCAN = 8

export default function Waterfall({ har }) {
  const inspect = useContext(InspectCtx)
  const selected = useContext(SelectedCtx)
  const [sort, setSort] = useState({ key: 'timeline', dir: 1 })
  const [scroll, setScroll] = useState({ top: 0, h: 600 })
  const [hoverId, setHoverId] = useState(null)
  const bodyRef = useRef(null)
  const total = Math.max(1, har.summary.totalTime)
  const { ticks } = useMemo(() => niceTicks(total, 6), [total])

  const rows = useMemo(() => {
    const get = COLS.find((c) => c[0] === sort.key)[2]
    return [...har.entries].sort((a, b) => {
      const x = get(a)
      const y = get(b)
      return (x < y ? -1 : x > y ? 1 : a.id - b.id) * sort.dir
    })
  }, [har, sort])

  // Only rows near the viewport are rendered, so very large captures stay smooth
  const first = Math.max(0, Math.floor(scroll.top / ROW_H) - OVERSCAN)
  const last = Math.min(rows.length, Math.ceil((scroll.top + scroll.h) / ROW_H) + OVERSCAN)
  const visible = rows.slice(first, last)

  const toggle = (key) => setSort((s) => (s.key === key ? { key, dir: -s.dir } : { key, dir: key === 'name' ? 1 : -1 }))
  const pct = (ms) => `${Math.min(100, (ms / total) * 100)}%`

  const onScroll = (e) => setScroll({ top: e.currentTarget.scrollTop, h: e.currentTarget.clientHeight })
  const onKey = (e, i) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inspect(rows[i].id); return }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const next = Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))
    const body = bodyRef.current
    if (next * ROW_H < body.scrollTop) body.scrollTop = next * ROW_H
    else if ((next + 1) * ROW_H > body.scrollTop + body.clientHeight) body.scrollTop = (next + 1) * ROW_H - body.clientHeight
    requestAnimationFrame(() => body.querySelector(`[data-i="${next}"]`)?.focus())
  }

  if (!rows.length) return <EmptyState title="No requests match">Clear a filter to see requests again.</EmptyState>

  return (
    <div className="wf-wrap">
      <div className="wf-legend" aria-label="Phases">
        {PHASES.map((p) => (
          <span key={p} title={PHASE_HELP[p]}><i style={{ background: PHASE_VAR[p] }} />{PHASE_LABEL[p]}</span>
        ))}
        {har.markers.map((m) => <span key={m.label} className={`wf-mk-key ${m.tone}`}><i />{m.label} {fmtMs(m.ms)}</span>)}
      </div>

      <div className="wf" role="grid" aria-rowcount={rows.length + 1} aria-label="Requests">
        <div className="wf-head" role="row">
          {COLS.map(([key, label]) => (
            <div key={key} role="columnheader" aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'} className={key === 'timeline' ? 'wf-axis' : key === 'size' || key === 'time' ? 'r' : ''}>
              <button type="button" className="th" onClick={() => toggle(key)}>
                {label}
                {sort.key === key && <FontAwesomeIcon icon={sort.dir === 1 ? faSortUp : faSortDown} />}
              </button>
              {key === 'timeline' && (
                <div className="wf-ticks" aria-hidden="true">
                  {ticks.map((t) => <span key={t} style={{ left: pct(t) }}>{fmtAxis(t)}</span>)}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="wf-body" ref={bodyRef} onScroll={onScroll} onMouseLeave={() => setHoverId(null)}>
          <div style={{ height: rows.length * ROW_H, position: 'relative' }}>
            {visible.map((e, k) => {
              const i = first + k
              const sel = selected && selected.id === e.id
              return (
                <div
                  key={e.id}
                  data-i={i}
                  role="row"
                  aria-rowindex={i + 2}
                  aria-selected={sel || undefined}
                  tabIndex={i === 0 ? 0 : -1}
                  className={`wf-row${sel ? ' sel' : ''}${hoverId === e.id ? ' hov' : ''}`}
                  style={{ transform: `translateY(${i * ROW_H}px)`, height: ROW_H }}
                  onMouseEnter={() => setHoverId(e.id)}
                  onClick={() => inspect(e.id)}
                  onKeyDown={(ev) => onKey(ev, i)}
                >
                  <div role="gridcell"><StatusCode status={e.status} /></div>
                  <div role="gridcell" className="wf-name ellipsis" title={e.url}>
                    <span className="mono dim">{e.method}</span> {e.name}
                    {e.name !== e.host && <span className="dim"> {e.host}</span>}
                  </div>
                  <div role="gridcell" className="r num">{fmtBytes(e.transfer)}</div>
                  <div role="gridcell" className="wf-track" aria-label={`Starts at ${fmtMs(e.startMs)}, takes ${fmtMs(e.time)}`}>
                    {ticks.map((t) => <b key={t} className="wf-grid" style={{ left: pct(t) }} />)}
                    {har.markers.map((m) => <b key={m.label} className={`wf-mark ${m.tone}`} style={{ left: pct(m.ms) }} />)}
                    {PHASES.map((p) => {
                      const w = e.phases[p]
                      if (!w) return null
                      return <i key={p} className="wf-seg" style={{ left: pct(e.span[p].start), width: `max(2px, ${(w / total) * 100}%)`, background: PHASE_VAR[p] }} />
                    })}
                    {hoverId === e.id && (
                      <span className="wf-tip" style={{ left: `clamp(0px, ${(e.startMs / total) * 100}%, calc(100% - 210px))` }}>
                        {PHASES.filter((p) => e.phases[p] > 0).map((p) => (
                          <span key={p}><i style={{ background: PHASE_VAR[p] }} />{PHASE_LABEL[p]} <b>{fmtMs(e.phases[p])}</b></span>
                        ))}
                      </span>
                    )}
                  </div>
                  <div role="gridcell" className="r num">{fmtMs(e.time)}</div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
      <p className="hint">Click a column to sort, click a row to inspect it, use ↑ ↓ to move between rows. Each bar is split into its phases.</p>
    </div>
  )
}
