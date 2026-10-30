import { useMemo, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCircleCheck, faDownload, faFileCode, faFileLines, faPrint, faShieldHalved } from '@fortawesome/free-solid-svg-icons'
import { reportHtml, reportJson } from '../report'
import { download, scrubHar } from '../scrub'
import { Card, Notice } from './ui'

export default function Tools({ har, toast }) {
  const [result, setResult] = useState(null)
  const base = har.fileName.replace(/\.(har|json)$/i, '')
  const found = useMemo(() => scrubHar(har.raw).stats, [har])
  const total = Object.values(found).reduce((a, b) => a + b, 0)

  const scrub = () => {
    const { har: clean, stats } = scrubHar(har.raw)
    download(`${base}.scrubbed.har`, JSON.stringify(clean, null, 2))
    setResult(stats)
    toast('Scrubbed HAR downloaded')
  }

  return (
    <div className="page-grid two">
      <Card title="Remove secrets before sharing" aside={<FontAwesomeIcon icon={faShieldHalved} className="dim" />}>
        <p className="lede">HAR files often contain live tokens, cookies and passwords. Redact them before you send the file to anyone.</p>
        <dl className="found">
          <div><dt>Auth, cookie and API-key headers</dt><dd className="num">{found.headers}</dd></div>
          <div><dt>Cookies</dt><dd className="num">{found.cookies}</dd></div>
          <div><dt>Secret query or form parameters</dt><dd className="num">{found.params}</dd></div>
          <div><dt>Secret fields in JSON bodies</dt><dd className="num">{found.bodies}</dd></div>
        </dl>
        <div className="actions"><button type="button" className="btn primary" onClick={scrub}><FontAwesomeIcon icon={faDownload} /> Download scrubbed copy</button></div>
        {result && <Notice tone="good" icon={faCircleCheck}>Redacted {Object.values(result).reduce((a, b) => a + b, 0)} values. Your original file was not changed.</Notice>}
        {total === 0 && <p className="hint">Nothing sensitive found by the built-in rules. Still read the file before you share it.</p>}
        <p className="hint">Matching is pattern based, so unusual secret names or secrets inside non-JSON bodies can be missed.</p>
      </Card>

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
