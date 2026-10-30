import { useContext, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faChevronDown,
  faChevronRight,
  faCircleCheck,
  faCircleExclamation,
  faCircleInfo,
  faTriangleExclamation,
  faWrench,
} from '@fortawesome/free-solid-svg-icons'
import { analyzeCached, healthScore } from '../analyzer'
import { InspectCtx } from '../context'
import { fmtBytes, fmtMs, statusClass } from '../utils'

const ICON = { critical: faCircleExclamation, warning: faTriangleExclamation, info: faCircleInfo }

function Score({ score }) {
  const tone = score >= 85 ? 'good' : score >= 60 ? 'warn' : 'bad'
  const c = 2 * Math.PI * 42
  return (
    <div className={`score ${tone}`}>
      <svg viewBox="0 0 100 100" width="110" height="110">
        <circle cx="50" cy="50" r="42" className="score-bg" />
        <motion.circle
          cx="50" cy="50" r="42" className="score-fg"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - score / 100) }}
          transition={{ duration: 0.8 }}
          transform="rotate(-90 50 50)"
        />
      </svg>
      <div className="score-num">{score}</div>
      <div className="score-cap">health</div>
    </div>
  )
}

function Finding({ f, har }) {
  const inspect = useContext(InspectCtx)
  const [open, setOpen] = useState(f.severity === 'critical')
  const rows = f.ids.slice(0, 25).map((id) => har.entries[id])

  return (
    <motion.div layout className={`finding ${f.severity}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <button className="f-head" onClick={() => setOpen(!open)}>
        <FontAwesomeIcon icon={ICON[f.severity]} className="f-icon" />
        <span className="f-title">{f.title}</span>
        <span className="tag">{f.category}</span>
        {f.ids.length > 0 && <span className="count">{f.ids.length}</span>}
        <FontAwesomeIcon icon={open ? faChevronDown : faChevronRight} className="dim" />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div className="f-body" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
            <p>{f.detail}</p>
            <p className="fix"><FontAwesomeIcon icon={faWrench} /> {f.fix}</p>
            {rows.length > 0 && (
              <table className="tbl">
                <tbody>
                  {rows.map((e) => (
                    <tr key={e.id} className="clickable" onClick={() => inspect(e.id)}>
                      <td className={`st ${statusClass(e.status)}`}>{e.status || 'ERR'}</td>
                      <td className="ellipsis" title={e.url}><span className="mono dim">{e.method}</span> {e.host}{e.path}</td>
                      <td className="num">{fmtBytes(e.transfer)}</td>
                      <td className="num">{fmtMs(e.time)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {f.ids.length > rows.length && <div className="hint">Showing first {rows.length} of {f.ids.length}.</div>}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

export default function Issues({ har }) {
  const findings = useMemo(() => analyzeCached(har), [har])
  const [sev, setSev] = useState('all')
  const score = healthScore(findings)
  const counts = { critical: 0, warning: 0, info: 0 }
  for (const f of findings) counts[f.severity]++
  const shown = sev === 'all' ? findings : findings.filter((f) => f.severity === sev)

  return (
    <div>
      <div className="issues-top card">
        <Score score={score} />
        <div className="issues-sum">
          <h3>{har.fileName}</h3>
          <div className="sev-row">
            {['all', 'critical', 'warning', 'info'].map((s) => (
              <button key={s} className={`sev-btn ${s}${sev === s ? ' on' : ''}`} onClick={() => setSev(s)}>
                {s === 'all' ? `All ${findings.length}` : `${counts[s]} ${s}`}
              </button>
            ))}
          </div>
          <div className="hint">Rule-based checks on status codes, redirects, timings, payloads, caching, headers and cookies. Findings are hints, not proof; confirm in server logs.</div>
        </div>
      </div>

      {!shown.length && (
        <div className="empty good"><FontAwesomeIcon icon={faCircleCheck} /> No {sev === 'all' ? '' : `${sev} `}issues found.</div>
      )}
      {shown.map((f) => <Finding key={f.id} f={f} har={har} />)}
    </div>
  )
}
