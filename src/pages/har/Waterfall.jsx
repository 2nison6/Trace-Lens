import { useContext, useMemo, useRef, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faChevronDown, faChevronRight, faFileCsv, faSortDown, faSortUp, faThumbtack } from '@fortawesome/free-solid-svg-icons'
import { PHASES } from '../../har/harParser'
import { InspectCtx, SelectedCtx } from '../../app/context'
import { PHASE_HELP, PHASE_LABEL, PHASE_VAR } from '../../lib/theme'
import { fmtAxis, fmtBytes, fmtMs, niceTicks } from '../../lib/utils'
import { requestsCsv } from '../../lib/csv'
import { download } from '../../lib/scrub'
import { EmptyState, Segmented, StatusCode } from '../../components/shared/ui'

const COLS = [
  ['status', 'Status', (e) => e.status],
  ['name', 'Request', (e) => e.name.toLowerCase()],
  ['size', 'Size', (e) => e.transfer],
  ['timeline', 'Timeline', (e) => e.startMs],
  ['time', 'Time', (e) => e.time],
]
const ROW_H = 34
const OVERSCAN = 8

// optional columns the user can switch on or off (Status, Request, Timeline and Time are always shown)
const OPTIONAL = [
  ['host', 'Host', (e) => e.host],
  ['type', 'Type', (e) => e.type],
  ['proto', 'Protocol', (e) => e.httpVersion || '—'],
]
const PREF = 'harlens-wf-cols'
function readCols() {
  try { return new Set(JSON.parse(localStorage.getItem(PREF) || '[]')) } catch { return new Set() }
}

export default function Waterfall({ har, toast }) {
  const inspect = useContext(InspectCtx)
  const selected = useContext(SelectedCtx)
  const [sort, setSort] = useState({ key: 'timeline', dir: 1 })
  const [scroll, setScroll] = useState({ top: 0, h: 600 })
  const [hoverId, setHoverId] = useState(null)
  const [group, setGroup] = useState('none')
  const [collapsed, setCollapsed] = useState(() => new Set())
  const [pinned, setPinned] = useState(() => new Set())
  const [pinsOnly, setPinsOnly] = useState(false)
  const [extra, setExtra] = useState(readCols)
  const bodyRef = useRef(null)
  const total = Math.max(1, har.summary.totalTime)
  const { ticks } = useMemo(() => niceTicks(total, 6), [total])

  const sorted = useMemo(() => {
    const get = COLS.find((c) => c[0] === sort.key)[2]
    return [...har.entries].sort((a, b) => {
      const x = get(a)
      const y = get(b)
      return (x < y ? -1 : x > y ? 1 : a.id - b.id) * sort.dir
    })
  }, [har, sort])

  // Rows are either a request or, when grouped by host, a collapsible group header followed by its requests
  const rows = useMemo(() => {
    const base = pinsOnly ? sorted.filter((e) => pinned.has(e.id)) : sorted
    if (group === 'none') return base.map((e) => ({ kind: 'req', e }))
    const by = new Map()
    for (const e of base) (by.get(e.host) || by.set(e.host, []).get(e.host)).push(e)
    const out = []
    for (const [host, list] of [...by.entries()].sort((a, b) => b[1].length - a[1].length)) {
      const open = !collapsed.has(host)
      out.push({ kind: 'group', host, count: list.length, bytes: list.reduce((n, e) => n + e.transfer, 0), time: Math.max(...list.map((e) => e.endMs)) - Math.min(...list.map((e) => e.startMs)), open })
      if (open) for (const e of list) out.push({ kind: 'req', e })
    }
    return out
  }, [sorted, group, collapsed, pinned, pinsOnly])
  const requestCount = rows.filter((r) => r.kind === 'req').length

  // Only rows near the viewport are rendered, so very large captures stay smooth
  const first = Math.max(0, Math.floor(scroll.top / ROW_H) - OVERSCAN)
  const last = Math.min(rows.length, Math.ceil((scroll.top + scroll.h) / ROW_H) + OVERSCAN)
  const visible = rows.slice(first, last)

  const toggleGroup = (host) => setCollapsed((c) => { const n = new Set(c); if (n.has(host)) n.delete(host); else n.add(host); return n })
  const togglePin = (id) => setPinned((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const toggleCol = (key) => setExtra((x) => { const n = new Set(x); if (n.has(key)) n.delete(key); else n.add(key); try { localStorage.setItem(PREF, JSON.stringify([...n])) } catch { /* storage unavailable */ } return n })
  const exportCsv = () => { const list = rows.filter((r) => r.kind === 'req').map((r) => r.e); download(`${har.fileName.replace(/\.(har|json)$/i, '')}.waterfall.csv`, requestsCsv(list), 'text/csv'); toast?.(`CSV downloaded (${list.length} requests)`) }
  const toggle = (key) => setSort((s) => (s.key === key ? { key, dir: -s.dir } : { key, dir: key === 'name' ? 1 : -1 }))
  const pct = (ms) => `${Math.min(100, (ms / total) * 100)}%`

  const onScroll = (e) => setScroll({ top: e.currentTarget.scrollTop, h: e.currentTarget.clientHeight })
  const onKey = (e, i) => {
    const row = rows[i]
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (row.kind === 'group') toggleGroup(row.host); else inspect(row.e.id); return }
    if ((e.key === 'p' || e.key === 'P') && row.kind === 'req') { e.preventDefault(); togglePin(row.e.id); return }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const next = Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))
    const body = bodyRef.current
    if (next * ROW_H < body.scrollTop) body.scrollTop = next * ROW_H
    else if ((next + 1) * ROW_H > body.scrollTop + body.clientHeight) body.scrollTop = (next + 1) * ROW_H - body.clientHeight
    requestAnimationFrame(() => body.querySelector(`[data-i="${next}"]`)?.focus())
  }

  if (!sorted.length) return <EmptyState title="No requests match">Clear a filter to see requests again.</EmptyState>

  const extraCols = OPTIONAL.filter(([key]) => extra.has(key))
  // Status | Request | optional columns | Size | Timeline | Time
  const cols = `70px minmax(150px, 1.1fr) ${extraCols.map(() => 'minmax(70px, 0.5fr)').join(' ')} 78px minmax(220px, 2.6fr) 74px`.replace(/\s+/g, ' ')
  const gridStyle = { '--cols': cols, '--min': `${700 + extraCols.length * 110}px` }

  const head = (key, label) => (
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
  )

  return (
    <div className="wf-wrap">
      <div className="wf-legend" aria-label="Phases">
        {PHASES.map((p) => (
          <span key={p} title={PHASE_HELP[p]}><i style={{ background: PHASE_VAR[p] }} />{PHASE_LABEL[p]}</span>
        ))}
        {har.markers.map((m) => <span key={m.label} className={`wf-mk-key ${m.tone}`}><i />{m.label} {fmtMs(m.ms)}</span>)}
      </div>

      <div className="toolrow wf-tools">
        <Segmented size="s" label="Group requests" value={group} onChange={(v) => { setGroup(v); setCollapsed(new Set()) }} options={[{ value: 'none', label: 'No grouping' }, { value: 'host', label: 'By host' }]} />
        <div className="wf-colpick" role="group" aria-label="Optional columns">
          <span className="dim">Columns</span>
          {OPTIONAL.map(([key, label]) => (
            <label key={key} className="wf-colopt"><input type="checkbox" checked={extra.has(key)} onChange={() => toggleCol(key)} /> {label}</label>
          ))}
        </div>
        <span className="grow" />
        {pinned.size > 0 && (
          <label className="wf-colopt"><input type="checkbox" checked={pinsOnly} onChange={(e) => setPinsOnly(e.target.checked)} /> Pinned only ({pinned.size})</label>
        )}
        <button type="button" className="btn sm" onClick={exportCsv}><FontAwesomeIcon icon={faFileCsv} /> <span>Export CSV</span></button>
      </div>

      {!rows.length ? <EmptyState title="Nothing pinned yet">Press the pin on a request, or P while a row is focused.</EmptyState> : (
      <div className="wf" role="grid" aria-rowcount={rows.length + 1} aria-label="Requests" style={gridStyle}>
        <div className="wf-head" role="row">
          {head('status', 'Status')}
          {head('name', 'Request')}
          {extraCols.map(([key, label]) => <div key={key} role="columnheader" className="wf-xh">{label}</div>)}
          {head('size', 'Size')}
          {head('timeline', 'Timeline')}
          {head('time', 'Time')}
        </div>

        <div className="wf-body" ref={bodyRef} onScroll={onScroll} onMouseLeave={() => setHoverId(null)}>
          <div style={{ height: rows.length * ROW_H, position: 'relative' }}>
            {visible.map((row, k) => {
              const i = first + k
              if (row.kind === 'group') {
                return (
                  <div
                    key={`g-${row.host}`}
                    data-i={i}
                    role="row"
                    aria-rowindex={i + 2}
                    aria-expanded={row.open}
                    tabIndex={i === 0 ? 0 : -1}
                    className="wf-row wf-group"
                    style={{ transform: `translateY(${i * ROW_H}px)`, height: ROW_H }}
                    onClick={() => toggleGroup(row.host)}
                    onKeyDown={(ev) => onKey(ev, i)}
                  >
                    <div role="gridcell" className="wf-group-in">
                      <FontAwesomeIcon icon={row.open ? faChevronDown : faChevronRight} />
                      <b className="ellipsis" title={row.host}>{row.host}</b>
                      <span className="dim">{row.count} request{row.count === 1 ? '' : 's'} · {fmtBytes(row.bytes)} · {fmtMs(row.time)} span</span>
                    </div>
                  </div>
                )
              }
              const e = row.e
              const sel = selected && selected.id === e.id
              const pin = pinned.has(e.id)
              return (
                <div
                  key={e.id}
                  data-i={i}
                  role="row"
                  aria-rowindex={i + 2}
                  aria-selected={sel || undefined}
                  tabIndex={i === 0 ? 0 : -1}
                  className={`wf-row${sel ? ' sel' : ''}${hoverId === e.id ? ' hov' : ''}${pin ? ' pinned' : ''}`}
                  style={{ transform: `translateY(${i * ROW_H}px)`, height: ROW_H }}
                  onMouseEnter={() => setHoverId(e.id)}
                  onClick={() => inspect(e.id)}
                  onKeyDown={(ev) => onKey(ev, i)}
                >
                  <div role="gridcell" className="wf-status">
                    <StatusCode status={e.status} />
                    <button type="button" className={`wf-pin${pin ? ' on' : ''}`} tabIndex={-1} aria-label={pin ? 'Unpin request' : 'Pin request'} aria-pressed={pin} onClick={(ev) => { ev.stopPropagation(); togglePin(e.id) }}><FontAwesomeIcon icon={faThumbtack} /></button>
                  </div>
                  <div role="gridcell" className="wf-name ellipsis" title={e.url}>
                    <span className="mono dim">{e.method}</span> {e.name}
                    {group === 'none' && e.name !== e.host && !extra.has('host') && <span className="dim"> {e.host}</span>}
                  </div>
                  {extraCols.map(([key, , get]) => <div key={key} role="gridcell" className="ellipsis dim" title={String(get(e))}>{get(e)}</div>)}
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
      )}
      <p className="hint">Click a column to sort, click a row to inspect it, use ↑ ↓ to move between rows and P to pin the focused request. Each bar is split into its phases. {requestCount} request{requestCount === 1 ? '' : 's'} shown.</p>
    </div>
  )
}
