import { useEffect, useMemo, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faArrowRight, faDownload, faFileCode, faFileLines, faPrint } from '@fortawesome/free-solid-svg-icons'
import { SECTIONS } from '../../app/nav'
import { download } from '../../lib/scrub'
import { ORDER, buildAll, buildReport, overviewReport } from '../../reports'
import { reportsHtml, reportsJson, reportsMarkdown } from '../../reports/render'
import { useReportInputs } from '../../reports/store'
import { Card, EmptyState, Notice, Switch } from '../../components/shared/ui'

const NAMES = Object.fromEntries(SECTIONS.map((s) => [s.id, s.label]))
const stamp = () => new Date().toISOString().slice(0, 10)

// The report as a page, in a frame: what is shown is exactly the file that gets downloaded.
function Preview({ html }) {
  const [h, setH] = useState(480)
  const fit = (e) => {
    const doc = e.target.contentDocument
    if (!doc) return
    const measure = () => setH(Math.max(320, doc.documentElement.scrollHeight + 4))
    measure()
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(measure).observe(doc.body)
  }
  return <iframe className="rep-frame" title="Report preview" srcDoc={html} sandbox="allow-same-origin" style={{ height: h }} onLoad={fit} />
}

function printHtml(html, toast) {
  const w = window.open('', '_blank')
  if (!w) { toast?.('Allow pop-ups to print or save as PDF', 'error'); return }
  w.document.write(html)
  w.document.close()
  w.focus()
  w.print()
}

function Downloads({ reports, base, theme, toast, explainChecks }) {
  const title = reports.length > 1 ? 'TraceLens report' : undefined
  const html = () => reportsHtml(reports, { title, theme: 'light', explainChecks })
  return (
    <div className="actions rep-actions">
      <button type="button" className="btn primary" onClick={() => { download(`${base}.html`, html(), 'text/html'); toast?.('HTML report downloaded') }}><FontAwesomeIcon icon={faFileCode} /> HTML</button>
      <button type="button" className="btn" onClick={() => { download(`${base}.md`, reportsMarkdown(reports, { title: title || reports[0].title }), 'text/markdown'); toast?.('Markdown report downloaded') }}><FontAwesomeIcon icon={faFileLines} /> Markdown</button>
      <button type="button" className="btn" onClick={() => { download(`${base}.json`, reportsJson(reports)); toast?.('JSON report downloaded') }}><FontAwesomeIcon icon={faDownload} /> JSON</button>
      <button type="button" className="btn" onClick={() => printHtml(html(), toast)} data-theme-hint={theme}><FontAwesomeIcon icon={faPrint} /> Print / PDF</button>
    </div>
  )
}

/** /<tool>/report: this tool's report on its own. */
export function ToolReport({ tool, har, traces, pasted, theme, toast }) {
  const inputs = useReportInputs()
  const [now] = useState(() => Date.now())
  const [explainChecks, setExplain] = useState(true)
  const [state, setState] = useState({ loading: true, report: null, error: '' })
  const sec = SECTIONS.find((s) => s.id === tool)
  useEffect(() => {
    let live = true
    buildReport(tool, { har, traces, pasted, inputs, now }).then(
      (report) => { if (live) setState({ loading: false, report, error: '' }) },
      (e) => { if (live) setState({ loading: false, report: null, error: String((e && e.message) || e) }) },
    )
    return () => { live = false }
  }, [tool, har, traces, pasted, inputs, now])
  const html = useMemo(() => (state.report ? reportsHtml([state.report], { theme, explainChecks }) : ''), [state.report, theme, explainChecks])
  if (state.loading) return <div className="stack"><p className="dim" role="status">Building the report…</p></div>
  if (state.error) return <div className="stack"><Notice tone="crit">The report could not be built: {state.error}</Notice></div>
  if (!state.report) {
    return (
      <div className="stack">
        <EmptyState icon={faFileLines} title={`Nothing to report yet for ${sec ? sec.label : 'this tool'}`}>
          {tool === 'certs' ? 'Paste a certificate on the Inspect page, and this page will turn it into a report.' : tool === 'tokens' ? 'Open a capture that carries tokens, or paste one on the Inspect page.' : tool === 'saml' ? 'Open a capture or a SAML-tracer export, or paste a message on the Messages page.' : 'Open a capture that contains this kind of traffic.'}
          {' '}A report only covers what this tool has been given.
        </EmptyState>
        <div className="actions rep-actions"><NavLink to="/report" className="btn primary">Combined report for every tool <FontAwesomeIcon icon={faArrowRight} /></NavLink></div>
      </div>
    )
  }
  const base = `${tool}-report-${stamp()}`
  return (
    <div className="stack">
      <Card title={`${sec ? sec.label : tool} report`} aside={<FontAwesomeIcon icon={faFileLines} className="dim" />}>
        <p className="lede">A report for this tool only, with charts and the findings it made. Send it to someone who does not use TraceLens: it opens in any browser and prints to PDF.</p>
        <Downloads reports={[state.report]} base={base} theme={theme} toast={toast} explainChecks={explainChecks} />
        <div className="rep-opts"><Switch checked={explainChecks} onChange={setExplain} label="Include an “Explain this” note under each finding" hint="Plain-language notes for readers who are not specialists. Off for a shorter report." /></div>
        <p className="hint">Secrets are left out: no token values, cookie values, SAML XML, user names, or the query part of addresses.</p>
        <div className="rep-combined">
          <div><b>Need more than this tool?</b><span>One report that covers every tool, with an overview first.</span></div>
          <NavLink to="/report" className="btn">Combined report for every tool <FontAwesomeIcon icon={faArrowRight} /></NavLink>
        </div>
      </Card>
      <Preview html={html} />
    </div>
  )
}

/** /report: every tool's report, picked and exported together or one by one. */
export function AllReports({ har, traces, pasted, theme, toast }) {
  const inputs = useReportInputs()
  const [now] = useState(() => Date.now())
  const [built, setBuilt] = useState(null)
  const [off, setOff] = useState(() => new Set())
  const [explainChecks, setExplain] = useState(true)
  useEffect(() => {
    let live = true
    buildAll({ har, traces, pasted, inputs, now }).then((r) => { if (live) setBuilt(r) })
    return () => { live = false }
  }, [har, traces, pasted, inputs, now])
  const have = built ? ORDER.filter((id) => built[id]) : []
  const chosen = have.filter((id) => !off.has(id))
  const reports = useMemo(() => (built ? [overviewReport(Object.fromEntries(chosen.map((id) => [id, built[id]])), NAMES), ...chosen.map((id) => built[id])] : []), [built, chosen])
  const html = useMemo(() => (chosen.length ? reportsHtml(reports, { title: 'TraceLens report', theme, explainChecks }) : ''), [chosen.length, reports, theme, explainChecks])
  const toggle = (id) => setOff((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n })
  if (!built) return <div className="stack"><p className="dim" role="status">Building the reports…</p></div>
  return (
    <div className="stack">
      <Card title="Export everything" aside={<FontAwesomeIcon icon={faFileLines} className="dim" />}>
        <p className="lede">One report that covers every tool that has something to show, with an overview first. Tick the tools to include, or download each tool&rsquo;s report as its own file.</p>
        <ul className="rep-pick" aria-label="Tools to include">
          {ORDER.map((id) => {
            const ok = !!built[id]
            return (
              <li key={id} className={ok ? '' : 'none'}>
                <label>
                  <input type="checkbox" disabled={!ok} checked={ok && !off.has(id)} onChange={() => toggle(id)} />
                  <span>{NAMES[id]}</span>
                </label>
                <span className="dim">{ok ? built[id].subtitle : 'nothing to report yet'}</span>
                <NavLink to={`/${id}/report`} className="btn sm rep-go" aria-label={`${ok ? 'Open' : 'Set up'} the ${NAMES[id]} report`}>{ok ? 'Open' : 'Set up'} <FontAwesomeIcon icon={faArrowRight} /></NavLink>
              </li>
            )
          })}
        </ul>
        {have.length === 0 && <Notice tone="info">Nothing to export yet. Open a capture (a HAR file or a SAML-tracer export) or paste a token or certificate into its tool, and it will show up here.</Notice>}
        {chosen.length > 0 && <Downloads reports={reports} base={`tracelens-report-${stamp()}`} theme={theme} toast={toast} explainChecks={explainChecks} />}
        {chosen.length > 0 && (
          <div className="actions rep-actions rep-each">
            <span className="dim">Or one file per tool:</span>
            {chosen.map((id) => <button key={id} type="button" className="btn sm" onClick={() => { download(`${id}-report-${stamp()}.html`, reportsHtml([built[id]], { theme: 'light', explainChecks }), 'text/html'); toast?.(`${NAMES[id]} report downloaded`) }}><FontAwesomeIcon icon={faDownload} /> {NAMES[id]}</button>)}
          </div>
        )}
        <div className="rep-opts"><Switch checked={explainChecks} onChange={setExplain} label="Include an “Explain this” note under each finding" hint="Plain-language notes for readers who are not specialists. Off for a shorter report." /></div>
        <p className="hint">Secrets are left out: no token values, cookie values, SAML XML, user names, or the query part of addresses. Host names, paths, entity IDs and client IDs are in the report, so read it before it leaves your organisation.</p>
      </Card>
      {html && <Preview html={html} />}
    </div>
  )
}
