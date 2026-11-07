import { useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCircleCheck, faCircleExclamation, faCircleInfo, faLightbulb, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons'
import { explain } from '../../lib/explain'

// Small pieces the auth tools (tokens, OAuth, cookies) share: a list of check results and a label/value list.
// A check is { severity: 'critical' | 'warning' | 'info' | 'ok', title, detail?, fix? }.
import { toneOf, wordOf } from './severity'

const ICON = { critical: faCircleExclamation, warning: faTriangleExclamation, info: faCircleInfo, ok: faCircleCheck }

function Check({ f }) {
  const [open, setOpen] = useState(false)
  const ex = open ? explain(f) : null
  return (
    <li className={`saml-check sev-${toneOf(f.severity)}`}>
      <FontAwesomeIcon icon={ICON[f.severity]} className={`tone-${toneOf(f.severity)}`} />
      <div>
        <b>{f.title}</b>
        {f.detail && <p>{f.detail}</p>}
        {f.fix && <p className="fix"><span className="dim">Fix:</span> {f.fix}</p>}
        <button type="button" className="explain-btn" aria-expanded={open} onClick={() => setOpen(!open)}>
          <FontAwesomeIcon icon={faLightbulb} /> {open ? 'Hide explanation' : 'Explain this'}
        </button>
        {ex && (
          <div className="explain" role="note">
            <p><b>What it means.</b> {ex.what}</p>
            <p><b>Why it matters.</b> {ex.why}</p>
            <p><b>Look at first.</b> {ex.first}</p>
          </div>
        )}
      </div>
      <span className={`sev tone-${toneOf(f.severity)}`}>{wordOf(f.severity)}</span>
    </li>
  )
}

export function CheckList({ checks }) {
  return <ul className="saml-checks">{checks.map((f, i) => <Check key={i} f={f} />)}</ul>
}

export function KV({ rows }) {
  const shown = rows.filter(([, v]) => v !== '' && v != null && v !== false)
  if (!shown.length) return null
  return <dl className="kvlist saml-kv">{shown.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
}
