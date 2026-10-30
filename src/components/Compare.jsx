import { useContext, useMemo, useState } from 'react'
import { compareMulti } from '../harParser'
import { InspectCtx } from '../context'
import Bars from './Bars'
import { fmtBytes, fmtDelta, fmtMs } from '../utils'

const SLOT = ['A', 'B', 'C']
const COLORS = ['var(--blue-l)', 'var(--lime)', '#f472b6']

function Delta({ a, b, fmt }) {
  if (a == null || b == null) return <span className="dim">—</span>
  const d = b - a
  const pct = a ? ` ${d >= 0 ? '+' : '-'}${Math.abs((d / a) * 100).toFixed(0)}%` : ''
  return <span className={d < 0 ? 'good' : d > 0 ? 'bad' : 'dim'}>{fmtDelta(d, fmt)}{pct}</span>
}

export default function Compare({ hars }) {
  const inspect = useContext(InspectCtx)
  const [sel, setSel] = useState([0, Math.min(1, hars.length - 1), -1])
  const [show, setShow] = useState('changed')

  // index in `hars` of each active slot, so a click can open the request from the right capture
  const activeIdx = sel.filter((i) => i >= 0 && hars[i])
  const active = activeIdx.map((i) => hars[i])
  const rows = useMemo(() => {
    const list = sel.filter((i) => i >= 0 && hars[i]).map((i) => hars[i])
    return list.length >= 2 ? compareMulti(list) : []
  }, [sel, hars])

  if (hars.length < 2) return <div className="empty">Load at least two HAR files to compare them. Drop another one in the bar above.</div>

  const open = (slot, row) => {
    const it = row.items[slot]
    if (it) inspect(it.id, activeIdx[slot])
  }
  const setSlot = (slot) => (e) => setSel(sel.map((v, i) => (i === slot ? Number(e.target.value) : v)))
  const first = active[0]
  const last = active[active.length - 1]

  const diffs = rows.map((r) => {
    const itemsA = r.items
    const a = itemsA[0]
    const b = itemsA[itemsA.length - 1]
    return { ...r, a, b, dt: a && b ? b.time - a.time : 0, ds: a && b ? b.transfer - a.transfer : 0, sc: a && b && a.status !== b.status, only: !a ? 'last' : !b ? 'first' : '' }
  })
  const notable = diffs.filter((d) => d.only || d.sc || Math.abs(d.dt) > 50 || Math.abs(d.ds) > 1024)
  const view = (show === 'all' ? diffs : notable).sort((x, y) => Math.abs(y.dt) - Math.abs(x.dt))

  const metrics = [
    ['Requests', (h) => h.summary.count, (v) => v],
    ['Total time', (h) => h.summary.totalTime, fmtMs],
    ['Transferred', (h) => h.summary.totalBytes, fmtBytes],
    ['Avg request', (h) => h.summary.avgTime, fmtMs],
    ['Errors', (h) => h.summary.errors, (v) => v],
    ['Hosts', (h) => h.summary.hosts.length, (v) => v],
  ]

  return (
    <div>
      <div className="toolbar">
        {SLOT.map((s, slot) => (
          <label className="check" key={s}>
            <span className="slot" style={{ background: COLORS[slot] }}>{s}</span>
            <select className="input" value={sel[slot]} onChange={setSlot(slot)}>
              {slot === 2 && <option value={-1}>— none (2-way) —</option>}
              {hars.map((h, i) => <option key={i} value={i}>{h.fileName}</option>)}
            </select>
          </label>
        ))}
      </div>
      {active.length < 2 || new Set(sel.filter((v) => v >= 0)).size < active.length ? <div className="notice">Pick different files for each slot.</div> : null}

      <div className="panel-grid">
        <section className="card">
          <h3>Summary</h3>
          <table className="tbl">
            <thead>
              <tr><th></th>{active.map((h, i) => <th key={i} className="num">{SLOT[i]}</th>)}<th className="num">Δ {SLOT[0]}→{SLOT[active.length - 1]}</th></tr>
            </thead>
            <tbody>
              {metrics.map(([label, get, fmt]) => (
                <tr key={label}>
                  <td>{label}</td>
                  {active.map((h, i) => <td key={i} className="num">{fmt(get(h))}</td>)}
                  <td className="num"><Delta a={get(first)} b={get(last)} fmt={fmt} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="card">
          <h3>Timeline length</h3>
          <Bars fmt={fmtMs} rows={active.map((h, i) => ({ label: SLOT[i], title: `${SLOT[i]} · ${h.fileName}`, value: h.summary.totalTime, color: COLORS[i], entries: h.entries, harIndex: activeIdx[i], tip: false }))} />
          <div className="match-stats">
            <span><b>{diffs.filter((d) => !d.only).length}</b> matched A↔{SLOT[active.length - 1]}</span>
            <span className="good"><b>{diffs.filter((d) => d.only === 'last').length}</b> only in {SLOT[active.length - 1]}</span>
            <span className="bad"><b>{diffs.filter((d) => d.only === 'first').length}</b> only in A</span>
          </div>
        </section>
      </div>

      <section className="card">
        <div className="toolbar tight">
          <h3>Requests (method + URL path)</h3>
          <select className="input" value={show} onChange={(e) => setShow(e.target.value)}>
            <option value="changed">Notable changes</option>
            <option value="all">All requests</option>
          </select>
        </div>
        <table className="tbl cmp">
          <thead>
            <tr>
              <th>Request</th>
              {active.map((h, i) => <th key={i} className="num">{SLOT[i]} time</th>)}
              <th className="num">Δ time</th><th className="num">Δ size</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            {view.slice(0, 200).map((d) => (
              <tr key={d.key} className="clickable" tabIndex={0} onClick={() => open(d.items.length - 1 - [...d.items].reverse().findIndex(Boolean), d)} onKeyDown={(ev) => ev.key === 'Enter' && open(d.items.length - 1 - [...d.items].reverse().findIndex(Boolean), d)}>
                <td className="ellipsis" title={d.label}>{d.label}</td>
                {d.items.map((it, i) => (
                  <td key={i} className={`num${it ? ' cell-link' : ''}`} onClick={it ? (ev) => { ev.stopPropagation(); open(i, d) } : undefined} title={it ? `Open ${SLOT[i]}'s version` : ''}>
                    {it ? fmtMs(it.time) : <span className="dim">—</span>}
                  </td>
                ))}
                <td className="num"><Delta a={d.a && d.a.time} b={d.b && d.b.time} fmt={fmtMs} /></td>
                <td className="num"><Delta a={d.a && d.a.transfer} b={d.b && d.b.transfer} fmt={fmtBytes} /></td>
                <td className={d.sc ? 'bad' : ''}>{d.only === 'last' ? 'new' : d.only === 'first' ? 'removed' : d.sc ? `${d.a.status} → ${d.b.status}` : d.a.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!view.length && <div className="empty">No notable differences.</div>}
        {view.length > 200 && <div className="hint">Showing first 200 of {view.length}.</div>}
        <div className="hint">Click a row to inspect the newest capture's version of that request, or click a time cell to inspect that specific capture's version.</div>
      </section>
    </div>
  )
}
