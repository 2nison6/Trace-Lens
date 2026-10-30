import { useContext, useMemo, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faChevronDown, faCircleCheck, faCircleExclamation, faCircleInfo, faTriangleExclamation, faWrench } from '@fortawesome/free-solid-svg-icons'
import { analyzeCached, healthScore } from '../analyzer'
import { InspectCtx } from '../context'
import { fmtBytes, fmtMs, ratingOf } from '../utils'
import { Card, EmptyState, Segmented, StatusCode } from './ui'

const ICON = { critical: faCircleExclamation, warning: faTriangleExclamation, info: faCircleInfo }
const TONE = { critical: 'crit', warning: 'warn', info: 'info' }
const WORD = { critical: 'Critical', warning: 'Warning', info: 'Note' }

function Score({ score }) {
  const r = ratingOf(score)
  const c = 2 * Math.PI * 44
  return (
    <div className={`score tone-${r.tone}`} role="img" aria-label={`Health score ${score} out of 100: ${r.label}`}>
      <svg viewBox="0 0 100 100" width="116" height="116">
        <circle cx="50" cy="50" r="44" className="score-bg" />
        <circle cx="50" cy="50" r="44" className="score-fg" strokeDasharray={c} strokeDashoffset={c * (1 - score / 100)} transform="rotate(-90 50 50)" />
      </svg>
      <div className="score-in"><b className="num">{score}</b><span>{r.label}</span></div>
    </div>
  )
}

function Finding({ f, har }) {
  const inspect = useContext(InspectCtx)
  const [open, setOpen] = useState(f.severity === 'critical')
  const rows = f.ids.slice(0, 25).map((id) => har.entries[id])
  return (
    <article className={`finding sev-${TONE[f.severity]}${open ? ' open' : ''}`}>
      <button type="button" className="f-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <FontAwesomeIcon icon={ICON[f.severity]} className={`f-ic tone-${TONE[f.severity]}`} />
        <span className="f-title">{f.title}</span>
        <span className="f-meta"><span className={`sev tone-${TONE[f.severity]}`}>{WORD[f.severity]}</span><span className="dim">{f.category}</span></span>
        {f.ids.length > 0 && <span className="count num">{f.ids.length}</span>}
        <FontAwesomeIcon icon={faChevronDown} className="f-chev" />
      </button>
      <div className="f-collapse" data-open={open}>
        <div className="f-inner">
          <p>{f.detail}</p>
          <p className="fix"><FontAwesomeIcon icon={faWrench} /> {f.fix}</p>
          {rows.length > 0 && (
            <table className="tbl">
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id} className="clickable" tabIndex={open ? 0 : -1} onClick={() => inspect(e.id)} onKeyDown={(ev) => ev.key === 'Enter' && inspect(e.id)}>
                    <td className="w70"><StatusCode status={e.status} /></td>
                    <td className="ellipsis" title={e.url}><span className="mono dim">{e.method}</span> {e.host}{e.path}</td>
                    <td className="num w90">{fmtBytes(e.transfer)}</td>
                    <td className="num w90">{fmtMs(e.time)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {f.ids.length > rows.length && <p className="hint">Showing first {rows.length} of {f.ids.length}.</p>}
        </div>
      </div>
    </article>
  )
}

export default function Issues({ har }) {
  const findings = useMemo(() => analyzeCached(har), [har])
  const [sev, setSev] = useState('all')
  const score = healthScore(findings)
  const counts = { critical: 0, warning: 0, info: 0 }
  for (const f of findings) counts[f.severity]++
  const shown = sev === 'all' ? findings : findings.filter((f) => f.severity === sev)
  const r = ratingOf(score)

  return (
    <div className="issues">
      <Card className="issues-top">
        <Score score={score} />
        <div className="issues-sum">
          <h2 className="t-title">{r.label === 'Good' ? 'This capture looks healthy' : `${findings.length} thing${findings.length === 1 ? '' : 's'} to look at`}</h2>
          <p className="dim ellipsis" title={har.fileName}>{har.fileName}</p>
          <Segmented label="Show findings by severity" value={sev} onChange={setSev} options={[
            { value: 'all', label: `All ${findings.length}` },
            { value: 'critical', label: `Critical ${counts.critical}` },
            { value: 'warning', label: `Warnings ${counts.warning}` },
            { value: 'info', label: `Notes ${counts.info}` },
          ]} />
          <p className="hint">Rule-based checks on status codes, redirects, timings, payloads, caching, headers and cookies. Treat them as leads; confirm in server logs.</p>
        </div>
      </Card>
      {!shown.length && <EmptyState icon={faCircleCheck} title={`No ${sev === 'all' ? '' : `${WORD[sev].toLowerCase()} `}issues found`} />}
      <div className="findings">{shown.map((f) => <Finding key={f.id} f={f} har={har} />)}</div>
    </div>
  )
}
