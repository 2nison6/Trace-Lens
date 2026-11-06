import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCircleCheck, faCircleExclamation, faCircleInfo, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons'

// Small pieces the auth tools (tokens, OAuth, cookies) share: a list of check results and a label/value list.
// A check is { severity: 'critical' | 'warning' | 'info' | 'ok', title, detail?, fix? }.
import { toneOf, wordOf } from './severity'

const ICON = { critical: faCircleExclamation, warning: faTriangleExclamation, info: faCircleInfo, ok: faCircleCheck }

export function CheckList({ checks }) {
  return (
    <ul className="saml-checks">
      {checks.map((f, i) => (
        <li key={i} className={`saml-check sev-${toneOf(f.severity)}`}>
          <FontAwesomeIcon icon={ICON[f.severity]} className={`tone-${toneOf(f.severity)}`} />
          <div>
            <b>{f.title}</b>
            {f.detail && <p>{f.detail}</p>}
            {f.fix && <p className="fix"><span className="dim">Fix:</span> {f.fix}</p>}
          </div>
          <span className={`sev tone-${toneOf(f.severity)}`}>{wordOf(f.severity)}</span>
        </li>
      ))}
    </ul>
  )
}

export function KV({ rows }) {
  const shown = rows.filter(([, v]) => v !== '' && v != null && v !== false)
  if (!shown.length) return null
  return <dl className="kvlist saml-kv">{shown.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
}
