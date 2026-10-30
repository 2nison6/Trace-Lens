import { useMemo, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCircleCheck, faDownload, faFileCode, faFileLines, faShieldHalved } from '@fortawesome/free-solid-svg-icons'
import { reportHtml, reportJson } from '../report'
import { download, scrubHar } from '../scrub'

export default function Tools({ har, toast }) {
  const [result, setResult] = useState(null)
  const base = har.fileName.replace(/\.(har|json)$/i, '')
  const hasSecrets = useMemo(() => scrubHar(har.raw).stats, [har])
  const total = Object.values(hasSecrets).reduce((a, b) => a + b, 0)

  const scrub = () => {
    const { har: clean, stats } = scrubHar(har.raw)
    download(`${base}.scrubbed.har`, JSON.stringify(clean, null, 2))
    setResult(stats)
    toast('Scrubbed HAR downloaded')
  }

  return (
    <div className="panel-grid">
      <section className="card">
        <h3><FontAwesomeIcon icon={faShieldHalved} /> Sensitive-data scrubber</h3>
        <p className="dim">HAR files often contain live tokens, cookies and passwords. Redact them before sharing the file with anyone.</p>
        <ul className="plain">
          <li>Auth / Cookie / Set-Cookie / API-key headers: <b>{hasSecrets.headers}</b></li>
          <li>Cookies: <b>{hasSecrets.cookies}</b></li>
          <li>Secret query or form parameters: <b>{hasSecrets.params}</b></li>
          <li>Secret fields in JSON bodies: <b>{hasSecrets.bodies}</b></li>
        </ul>
        <button className="btn primary" onClick={scrub}><FontAwesomeIcon icon={faDownload} /> Download scrubbed HAR</button>
        {result && <div className="notice ok"><FontAwesomeIcon icon={faCircleCheck} /> Redacted {Object.values(result).reduce((a, b) => a + b, 0)} values. Your original file was not changed.</div>}
        {total === 0 && <div className="hint">Nothing sensitive detected by the built-in rules. Still review the file before sharing.</div>}
        <div className="hint">Pattern based: unusual secret names or secrets inside non-JSON bodies can be missed.</div>
      </section>

      <section className="card">
        <h3><FontAwesomeIcon icon={faFileLines} /> Export report</h3>
        <p className="dim">Health score, timing estimates, every finding with its fix, and the third-party breakdown.</p>
        <div className="btn-row">
          <button className="btn primary" onClick={() => { download(`${base}.report.html`, reportHtml(har), 'text/html'); toast('HTML report downloaded') }}><FontAwesomeIcon icon={faFileCode} /> HTML report</button>
          <button className="btn" onClick={() => { download(`${base}.report.json`, reportJson(har)); toast('JSON report downloaded') }}><FontAwesomeIcon icon={faDownload} /> JSON</button>
          <button className="btn" onClick={() => { const w = window.open('', '_blank'); if (w) { w.document.write(reportHtml(har)); w.document.close(); w.print() } else toast('Allow pop-ups to print / save as PDF') }}>Print / PDF</button>
        </div>
        <div className="hint">For PDF: choose Print / PDF, then “Save as PDF” in the print dialog.</div>
      </section>
    </div>
  )
}
