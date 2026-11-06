import { useMemo, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCircleCheck, faDownload, faFileCode, faFileCsv, faFileLines, faObjectGroup, faPrint, faScissors, faShieldHalved } from '@fortawesome/free-solid-svg-icons'
import { reportHtml, reportJson } from '../report'
import { requestsCsv } from '../csv'
import { KINDS, KIND_LABEL, download, mergeHars, parsePatterns, scrubHar, subsetHar } from '../scrub'
import { fmtMs } from '../utils'
import { Card, Notice } from './ui'

const stem = (name) => name.replace(/\.(har|json)$/i, '')

function Redact({ har, toast }) {
  const [skip, setSkip] = useState(() => new Set())
  const [patterns, setPatterns] = useState('')
  const [result, setResult] = useState(null)
  const custom = useMemo(() => parsePatterns(patterns), [patterns])
  // The preview scan: nothing is changed, it only lists what would be redacted
  const scan = useMemo(() => scrubHar(har.raw, { apply: false, skip, custom: custom.list }), [har, skip, custom])
  const total = Object.entries(scan.stats).reduce((a, [, n]) => a + n, 0)

  const toggle = (key) => setSkip((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n })
  const groups = KINDS.map((kind) => ({ kind, items: scan.found.filter((f) => f.kind === kind) })).filter((g) => g.items.length)

  const run = () => {
    const { har: clean, stats } = scrubHar(har.raw, { skip, custom: custom.list })
    download(`${stem(har.fileName)}.scrubbed.har`, JSON.stringify(clean, null, 2))
    setResult(Object.values(stats).reduce((a, b) => a + b, 0))
    toast('Scrubbed HAR downloaded')
  }

  return (
    <Card title="Remove secrets before sharing" aside={<FontAwesomeIcon icon={faShieldHalved} className="dim" />}>
      <p className="lede">HAR files often contain live tokens, cookies and passwords. Check what will be redacted, untick anything you want to keep, then download a clean copy.</p>

      {groups.length > 0 ? (
        <div className="redact-groups">
          {groups.map((g) => (
            <fieldset key={g.kind} className="redact-group">
              <legend>{KIND_LABEL[g.kind]} <span className="dim">· {g.items.reduce((n, f) => n + f.count, 0)}</span></legend>
              {g.items.map((f) => {
                const key = `${f.kind}:${f.name}`
                return (
                  <label key={key} className="redact-item">
                    <input type="checkbox" checked={!skip.has(key)} onChange={() => toggle(key)} />
                    <span className="mono ellipsis" title={f.name}>{f.name}</span>
                    <span className="num dim">{f.count}</span>
                  </label>
                )
              })}
            </fieldset>
          ))}
        </div>
      ) : <p className="hint">Nothing sensitive found by the built-in rules. Still read the file before you share it.</p>}

      <label className="redact-custom">
        <span>Your own patterns <span className="dim">(one per line; wrap in /slashes/ for a regular expression)</span></span>
        <textarea rows={3} value={patterns} onChange={(e) => setPatterns(e.target.value)} spellCheck={false} placeholder={'internal.example.com\n/user-\\d+/i'} />
      </label>
      {custom.errors.map((m) => <p key={m} className="hint tone-crit">{m}</p>)}
      {custom.list.length > 0 && <p className="hint">Your patterns match <b className="num">{scan.stats.custom}</b> place{scan.stats.custom === 1 ? '' : 's'} in URLs, headers, cookies, parameters and bodies.</p>}

      <div className="actions"><button type="button" className="btn primary" onClick={run}><FontAwesomeIcon icon={faDownload} /> Download scrubbed copy{total ? ` (${total})` : ''}</button></div>
      {result != null && <Notice tone="good" icon={faCircleCheck}>Redacted {result} values. Your original file was not changed.</Notice>}
      <p className="hint">Matching is pattern based, so unusual secret names or secrets inside non-JSON bodies can be missed. Add your own patterns above for those.</p>
    </Card>
  )
}

function Trim({ hars, har, toast }) {
  const [from, setFrom] = useState(0)
  const [to, setTo] = useState(Math.ceil(har.summary.totalTime))
  const [onlyErrors, setOnlyErrors] = useState(false)
  const [host, setHost] = useState('all')
  const [others, setOthers] = useState(() => new Set())
  const base = stem(har.fileName)
  const total = Math.ceil(har.summary.totalTime)
  const picked = useMemo(
    () => har.entries.filter((e) => e.endMs >= from && e.startMs <= to && (!onlyErrors || e.error) && (host === 'all' || e.host === host)),
    [har, from, to, onlyErrors, host],
  )
  const otherHars = hars.filter((h) => h !== har)
  const chosen = hars.filter((h) => h === har || others.has(h.fileName))

  const trim = () => {
    download(`${base}.trimmed.har`, JSON.stringify(subsetHar(har.raw, picked.map((e) => e.rawIndex)), null, 2))
    toast(`Trimmed HAR downloaded (${picked.length} requests)`)
  }
  const merge = () => {
    download(`${base}.merged.har`, JSON.stringify(mergeHars(chosen), null, 2))
    toast(`Merged HAR downloaded (${chosen.reduce((n, h) => n + h.entries.length, 0)} requests)`)
  }
  const csv = () => { download(`${base}.requests.csv`, requestsCsv(picked), 'text/csv'); toast(`CSV downloaded (${picked.length} requests)`) }

  return (
    <Card title="Trim, merge and convert" aside={<FontAwesomeIcon icon={faScissors} className="dim" />}>
      <p className="lede">Keep only the requests you need before you share a capture, combine several captures, or take the table to a spreadsheet.</p>
      <div className="trim-grid">
        <label>From (ms)<input type="number" min="0" max={total} value={from} onChange={(e) => setFrom(Math.max(0, Number(e.target.value) || 0))} /></label>
        <label>To (ms)<input type="number" min="0" max={total} value={to} onChange={(e) => setTo(Math.min(total, Number(e.target.value) || 0))} /></label>
        <label>Host
          <select value={host} onChange={(e) => setHost(e.target.value)}>
            <option value="all">Any host</option>
            {har.summary.hosts.map((h) => <option key={h.host} value={h.host}>{h.host}</option>)}
          </select>
        </label>
        <label className="trim-check"><input type="checkbox" checked={onlyErrors} onChange={(e) => setOnlyErrors(e.target.checked)} /> Only errors</label>
      </div>
      <p className="hint"><b className="num">{picked.length}</b> of {har.entries.length} requests selected{from > 0 || to < total ? ` between ${fmtMs(from)} and ${fmtMs(to)}` : ''}.</p>
      <div className="actions">
        <button type="button" className="btn primary" disabled={!picked.length} onClick={trim}><FontAwesomeIcon icon={faScissors} /> Download trimmed HAR</button>
        <button type="button" className="btn" disabled={!picked.length} onClick={csv}><FontAwesomeIcon icon={faFileCsv} /> Download CSV</button>
      </div>

      {otherHars.length > 0 && (
        <div className="merge-box">
          <h3 className="t-sub">Merge with other loaded files</h3>
          {otherHars.map((h) => (
            <label key={h.fileName} className="redact-item">
              <input type="checkbox" checked={others.has(h.fileName)} onChange={() => setOthers((s) => { const n = new Set(s); if (n.has(h.fileName)) n.delete(h.fileName); else n.add(h.fileName); return n })} />
              <span className="ellipsis" title={h.fileName}>{h.fileName}</span><span className="num dim">{h.entries.length}</span>
            </label>
          ))}
          <div className="actions"><button type="button" className="btn" disabled={chosen.length < 2} onClick={merge}><FontAwesomeIcon icon={faObjectGroup} /> Download merged HAR{chosen.length > 1 ? ` (${chosen.length} files)` : ''}</button></div>
        </div>
      )}
      <p className="hint">Trimming and merging do not redact secrets. Run the scrubber on the result before sharing it.</p>
    </Card>
  )
}

export default function Tools({ har, hars = [har], toast }) {
  const base = stem(har.fileName)
  return (
    <div className="page-grid two">
      <Redact har={har} toast={toast} />
      <Trim hars={hars} har={har} toast={toast} />
      <Card title="Export a report" aside={<FontAwesomeIcon icon={faFileLines} className="dim" />}>
        <p className="lede">Health score, timing estimates, every finding with its fix and affected URLs, third parties, critical path, endpoints, cache and protocol breakdowns, and the full request list.</p>
        <div className="actions">
          <button type="button" className="btn primary" onClick={() => { download(`${base}.report.html`, reportHtml(har), 'text/html'); toast('HTML report downloaded') }}><FontAwesomeIcon icon={faFileCode} /> HTML report</button>
          <button type="button" className="btn" onClick={() => { download(`${base}.report.json`, reportJson(har)); toast('JSON report downloaded') }}><FontAwesomeIcon icon={faDownload} /> JSON</button>
          <button type="button" className="btn" onClick={() => { const w = window.open('', '_blank'); if (w) { w.document.write(reportHtml(har)); w.document.close(); w.print() } else toast('Allow pop-ups to print or save as PDF') }}><FontAwesomeIcon icon={faPrint} /> Print / PDF</button>
        </div>
        <p className="hint">For PDF, choose Print / PDF, then “Save as PDF” in the print dialog.</p>
      </Card>
    </div>
  )
}
