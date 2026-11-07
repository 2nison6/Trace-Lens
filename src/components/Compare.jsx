import { useContext, useMemo, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faArrowTrendDown, faArrowTrendUp, faCodeCompare, faCopy, faDownload, faEquals, faShuffle, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons'
import { compareMulti } from '../harParser'
import { analyzeCached, healthScore } from '../analyzer'
import { compareMarkdown, diffRows, findingsDiff, isNotable, looseKey, verdict as makeVerdict } from '../compare'
import { InspectCtx } from '../context'
import Bars from './Bars'
import { PHASE_LABEL, SERIES_VAR } from '../theme'
import { copyText, fmtBytes, fmtDelta, fmtMs } from '../utils'
import { download } from '../scrub'
import Regression from './Regression'
import { Card, EmptyState, Notice, Segmented, StatusCode, Switch } from './ui'

const SLOT = ['A', 'B', 'C']
const VERDICT_ICON = { good: faArrowTrendDown, bad: faArrowTrendUp, mixed: faShuffle, same: faEquals }

function Delta({ a, b, fmt }) {
  if (a == null || b == null) return <span className="dim">—</span>
  const d = b - a
  const pct = a ? ` ${d >= 0 ? '+' : '-'}${Math.abs((d / a) * 100).toFixed(0)}%` : ''
  // smaller is better for time, size and error counts: an arrow keeps direction readable without colour
  return <span className={d < 0 ? 'tone-good' : d > 0 ? 'tone-crit' : 'dim'}>{d < 0 ? '↓ ' : d > 0 ? '↑ ' : ''}{fmtDelta(d, fmt)}{pct}</span>
}

// "Wait +120 ms": the phase that moved the most between the first and the last capture, so a slower request says why
function Why({ d }) {
  if (!d.topPhase || Math.abs(d.phaseDelta[d.topPhase]) < 20) return <span className="dim">—</span>
  const v = d.phaseDelta[d.topPhase]
  return <span className={v > 0 ? 'tone-crit' : 'tone-good'} title="The phase that changed the most">{PHASE_LABEL[d.topPhase]} {fmtDelta(v, fmtMs)}</span>
}

export default function Compare({ hars, toast }) {
  const inspect = useContext(InspectCtx)
  const [sel, setSel] = useState([0, Math.min(1, hars.length - 1), -1])
  const [show, setShow] = useState('changed')
  const [loose, setLoose] = useState(true)
  const [fshow, setFshow] = useState('') // which findings list is open: '', 'added', 'fixed' or 'kept'

  // index in `hars` of each active slot, so a click can open the request from the right capture
  const activeIdx = sel.filter((i) => i >= 0 && hars[i])
  const active = activeIdx.map((i) => hars[i])
  const names = SLOT.slice(0, active.length)
  const rows = useMemo(() => {
    const list = sel.filter((i) => i >= 0 && hars[i]).map((i) => hars[i])
    return list.length >= 2 ? compareMulti(list, loose ? looseKey : undefined) : []
  }, [sel, hars, loose])
  const diffs = useMemo(() => diffRows(rows), [rows])
  const first = active[0]
  const last = active[active.length - 1]

  // Cheap, and analyzeCached remembers each capture's findings, so no manual memoisation is needed here
  const v = active.length >= 2 ? makeVerdict(first, last, diffs, [names[0], names[names.length - 1]]) : null
  const fa = first ? analyzeCached(first) : []
  const fb = last ? analyzeCached(last) : []
  const fd = active.length >= 2 ? findingsDiff(fa, fb) : null

  if (hars.length < 2) return <EmptyState title="Add a second capture to compare" icon={faCodeCompare}>Use “Add file” in the toolbar, or drop another HAR file anywhere on the page.</EmptyState>

  const open = (slot, row) => {
    const it = row.items[slot]
    if (it) inspect(it.id, activeIdx[slot])
  }
  const setSlot = (slot) => (e) => setSel(sel.map((x, i) => (i === slot ? Number(e.target.value) : x)))

  const notable = diffs.filter(isNotable)
  const view = [...(show === 'all' ? diffs : notable)].sort((x, y) => Math.abs(y.dt) - Math.abs(x.dt))
  const names2 = [names[0], names[names.length - 1]]
  const scoreA = healthScore(fa)
  const scoreB = healthScore(fb)

  const markdown = () => compareMarkdown({ hars: active, names, verdict: v, diffs, fd })
  const copyMd = async () => toast?.((await copyText(markdown())) ? 'Comparison copied as Markdown' : 'Copy failed')
  const saveMd = () => { download('har-comparison.md', markdown(), 'text/markdown'); toast?.('Comparison downloaded') }

  const metrics = [
    ['Requests', (h) => h.summary.count, (x) => x],
    ['Total time', (h) => h.summary.totalTime, fmtMs],
    ['Transferred', (h) => h.summary.totalBytes, fmtBytes],
    ['Avg request', (h) => h.summary.avgTime, fmtMs],
    ['Errors', (h) => h.summary.errors, (x) => x],
    ['Hosts', (h) => h.summary.hosts.length, (x) => x],
    ['Health score', (h) => healthScore(analyzeCached(h)), (x) => x],
  ]

  return (
    <div className="stack">
      <div className="slots">
        {SLOT.map((s, slot) => (
          <label className="slot-pick" key={s}>
            <span className="slot" style={{ background: SERIES_VAR[slot] }}>{s}</span>
            <select value={sel[slot]} onChange={setSlot(slot)} aria-label={`Capture ${s}`}>
              {slot === 2 && <option value={-1}>None (compare two)</option>}
              {hars.map((h, i) => <option key={i} value={i}>{h.fileName}</option>)}
            </select>
          </label>
        ))}
      </div>
      {active.length < 2 || new Set(sel.filter((x) => x >= 0)).size < active.length ? <Notice tone="warn" icon={faTriangleExclamation}>Pick a different file for each slot.</Notice> : null}

      {v && (
        <div className={`verdict ${v.tone}`} role="status">
          <FontAwesomeIcon icon={VERDICT_ICON[v.tone]} />
          <div>
            <h2>{v.title}</h2>
            <p>{v.text}</p>
            <div className="toolrow">
              <button type="button" className="btn sm" onClick={copyMd}><FontAwesomeIcon icon={faCopy} /> <span>Copy as Markdown</span></button>
              <button type="button" className="btn sm" onClick={saveMd}><FontAwesomeIcon icon={faDownload} /> <span>Download .md</span></button>
            </div>
          </div>
        </div>
      )}
      {v && active.length >= 2 && <Regression a={first} b={last} names={names2} />}

      <div className="page-grid two">
        <Card title="Summary" flush>
          <table className="tbl sum">
            <thead>
              <tr><th></th>{active.map((h, i) => <th key={i} className="num">{SLOT[i]}</th>)}<th className="num">Δ {names2[0]}→{names2[1]}</th></tr>
            </thead>
            <tbody>
              {metrics.map(([label, get, fmt]) => (
                <tr key={label}>
                  <td>{label}</td>
                  {active.map((h, i) => <td key={i} className="num">{fmt(get(h))}</td>)}
                  {/* a higher health score is better, the reverse of every other row */}
                  <td className="num">{label === 'Health score' ? <ScoreDelta a={scoreA} b={scoreB} /> : <Delta a={get(first)} b={get(last)} fmt={fmt} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card title="Load time">
          <Bars fmt={fmtMs} rows={active.map((h, i) => ({ label: SLOT[i], title: `${SLOT[i]} · ${h.fileName}`, value: h.summary.totalTime, color: SERIES_VAR[i], entries: h.entries, harIndex: activeIdx[i], tip: false }))} />
          <div className="match-stats">
            <span><b className="num">{diffs.filter((d) => !d.only).length}</b> in both</span>
            <span><b className="num">{diffs.filter((d) => d.only === 'last').length}</b> only in {names2[1]}</span>
            <span><b className="num">{diffs.filter((d) => d.only === 'first').length}</b> only in {names2[0]}</span>
          </div>
          <div className="toolrow">
            <Switch checked={loose} onChange={setLoose} label="Match renamed files" hint="Treats main.a1b2c3d4.js and main.e5f6a7b8.js as the same file" />
          </div>
        </Card>
      </div>

      {fd && (
        <Card title="Findings" aside={<span className="t-cap">{names2[0]} → {names2[1]}</span>}>
          <div className="pillrow" style={{ marginTop: 0 }} role="group" aria-label="Show findings that are">
            {[
              ['added', fd.added.length, 'new', fd.added.length ? ' bad' : ''],
              ['fixed', fd.fixed.length, 'fixed', fd.fixed.length ? ' good' : ''],
              ['kept', fd.same, 'unchanged', ''],
            ].map(([key, n, label, tone]) => (
              <button key={key} type="button" className={`pill pill-btn${tone}${fshow === key ? ' on' : ''}`} aria-pressed={fshow === key} disabled={!n} onClick={() => setFshow(fshow === key ? '' : key)}>
                <b>{n}</b> {label}
              </button>
            ))}
          </div>
          {fshow === 'added' && <FindingList items={fd.added} tone="crit" word="New" />}
          {fshow === 'fixed' && <FindingList items={fd.fixed} tone="good" word="Fixed" />}
          {fshow === 'kept' && <FindingList items={fd.kept} tone="dim" word="Unchanged" kept />}
          {!fshow && (fd.added.length > 0 || fd.fixed.length > 0 || fd.same > 0) && <p className="hint">Select a count to see which findings it is.</p>}
          {!fd.added.length && !fd.fixed.length && !fd.same && <p className="hint">Neither capture raises any findings.</p>}
          {!fd.added.length && !fd.fixed.length && fd.same > 0 && !fshow && <p className="hint">Both captures raise the same findings.</p>}
        </Card>
      )}

      <Card title="Requests" flush aside={<Segmented size="s" label="Which requests to show" value={show} onChange={setShow} options={[{ value: 'changed', label: 'Changes' }, { value: 'all', label: 'All' }]} />}>
        <table className="tbl cmp">
          <thead>
            <tr>
              <th>Request</th>
              {active.map((h, i) => <th key={i} className="num">{SLOT[i]} time</th>)}
              <th className="num">Δ time</th><th>Biggest change</th><th className="num">Δ size</th><th>Status</th>
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
                <td>{d.phaseDelta ? <Why d={d} /> : <span className="dim">—</span>}</td>
                <td className="num"><Delta a={d.a && d.a.transfer} b={d.b && d.b.transfer} fmt={fmtBytes} /></td>
                <td className={d.sc ? 'tone-crit' : ''}>{d.only === 'last' ? 'New' : d.only === 'first' ? 'Removed' : d.sc ? `${d.a.status} → ${d.b.status}` : <StatusCode status={d.a.status} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!view.length && <p className="pad dim">No notable differences.</p>}
        {view.length > 200 && <p className="hint pad-h">Showing first 200 of {view.length}.</p>}
      </Card>
      <p className="hint">Click a row to inspect the newest capture's version of that request, or click a time cell to inspect that capture's version.</p>
    </div>
  )
}

function ScoreDelta({ a, b }) {
  const d = b - a
  return <span className={d > 0 ? 'tone-good' : d < 0 ? 'tone-crit' : 'dim'}>{d > 0 ? '↑ +' : d < 0 ? '↓ -' : ''}{d === 0 ? '0' : Math.abs(d)}</span>
}

function FindingList({ items, tone, word, kept = false }) {
  return (
    <ul className="list-plain" style={{ marginTop: 10 }}>
      {items.map((f) => (
        <li key={f.id}>
          <span className={`tone-${tone}`}>{word}</span> · {f.title} <span className="dim">({f.severity}){kept && f.before !== f.now ? `, ${f.before} → ${f.now} requests` : ''}</span>
        </li>
      ))}
    </ul>
  )
}
