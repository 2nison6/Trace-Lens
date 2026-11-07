import { NavLink } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faLock } from '@fortawesome/free-solid-svg-icons'
import DropZone from './DropZone'
import KeepFiles from './KeepFiles'
import { CAPTURE, GUIDE_CHECKED } from '../guide'

// Which tool a capture guide's `for` entries belong to, by the start of the name used in src/guide.js
const FOR = { har: ['network'], saml: ['saml'], oauth: ['oauth'], tokens: ['tokens'], cookies: ['cookies'], windows: ['windows'] }

// The first page of every tool (/har, /saml, ...): what it does, where to drop files and its other
// pages. It is also what a page that needs a capture shows when none is loaded, so nothing is ever a dead end.
export default function ToolStart({ section, onFiles, fileCount, toast, why }) {
  const pages = section.pages.filter((p) => !p.start)
  const howTo = CAPTURE.filter((c) => c.for.some((n) => FOR[section.id] && FOR[section.id].some((k) => n.toLowerCase().startsWith(k))))
  return (
    <section className="start" data-tool={section.id}>
      <p className="start-eyebrow"><FontAwesomeIcon icon={section.icon} /> {section.label}</p>
      <h1 className="t-display">{section.title}</h1>
      <p className="start-lede">{section.blurb}</p>
      {why && <p className="start-why" role="status">{why}</p>}
      {!section.pasteOnly && <DropZone onFiles={onFiles} title={fileCount ? `Drop more ${section.accepts} here` : `Drop ${section.accepts} here`} />}
      {section.pasteOnly && <p className="start-why">This tool works on pasted text, so there is nothing to upload. Open <b>Inspect</b> and paste.</p>}
      {!section.pasteOnly && <KeepFiles onFiles={onFiles} fileCount={fileCount} toast={toast} />}
      {howTo.length > 0 && (
        <>
          <h2 className="tools-h">How to capture it</h2>
          <div className="guide guide-inline">
            {howTo.map((c) => (
              <details key={c.id}>
                <summary>{c.title}</summary>
                <ol>{c.steps.map((x) => <li key={x}>{x}</li>)}</ol>
                {c.sensitive.length > 0 && <div className="guide-warn"><b>Sensitive data</b><ul>{c.sensitive.map((x) => <li key={x}>{x}</li>)}</ul></div>}
              </details>
            ))}
            <p className="hint">Steps checked {GUIDE_CHECKED}. <NavLink to="/guide/help">The full troubleshooting guide</NavLink> has a checklist for each symptom.</p>
          </div>
        </>
      )}
      <h2 className="tools-h">In this tool</h2>
      <ul className="tool-pages">
        {pages.map((p) => (
          <li key={p.to}>
            <NavLink to={p.to} end><FontAwesomeIcon icon={p.icon} fixedWidth /> {p.label}</NavLink>
          </li>
        ))}
      </ul>
      <p className="start-note"><FontAwesomeIcon icon={faLock} /> Runs entirely in your browser. Nothing is uploaded.</p>
    </section>
  )
}
