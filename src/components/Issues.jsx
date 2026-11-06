import { useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faChevronDown, faCircleCheck, faCircleExclamation, faCircleInfo, faCopy, faDownload, faEyeSlash, faRotateLeft, faTriangleExclamation, faWrench } from '@fortawesome/free-solid-svg-icons'
import { analyzeCached, findingKey, healthScore } from '../analyzer'
import { InspectCtx } from '../context'
import { copyText, fmtBytes, fmtMs, ratingOf } from '../utils'
import { download } from '../scrub'
import { findingsMarkdown } from '../findingsExport'
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

function Finding({ f, har, onDismiss }) {
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
          {onDismiss && <button type="button" className="btn sm" tabIndex={open ? 0 : -1} onClick={onDismiss}><FontAwesomeIcon icon={faEyeSlash} /> <span>Dismiss: expected</span></button>}
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

const DISMISS_KEY = 'harlens-dismissed'
// Findings the user marked "expected" are remembered on this device by their kind (not their count), so they stay quiet
// for every capture. This is a preference, not capture data, so it is stored whatever the "keep files" setting is.
function readDismissed() {
  try { return new Set(JSON.parse(localStorage.getItem(DISMISS_KEY) || '[]')) } catch { return new Set() }
}

export default function Issues({ har, toast }) {
  const findings = useMemo(() => analyzeCached(har), [har])
  const [sev, setSev] = useState('all')
  const [group, setGroup] = useState('severity')
  const [dismissed, setDismissed] = useState(readDismissed)
  const [showDismissed, setShowDismissed] = useState(false)
  useEffect(() => {
    try { localStorage.setItem(DISMISS_KEY, JSON.stringify([...dismissed])) } catch { /* storage unavailable: dismissals just won't persist */ }
  }, [dismissed])
  const dismiss = useCallback((f) => setDismissed((d) => new Set(d).add(findingKey(f))), [])
  const restore = (f) => setDismissed((d) => { const n = new Set(d); n.delete(findingKey(f)); return n })

  const active = findings.filter((f) => !dismissed.has(findingKey(f)))
  const hidden = findings.filter((f) => dismissed.has(findingKey(f)))
  const score = healthScore(findings, dismissed)
  const counts = { critical: 0, warning: 0, info: 0 }
  for (const f of active) counts[f.severity]++
  const shown = sev === 'all' ? active : active.filter((f) => f.severity === sev)
  const r = ratingOf(score)

  // Grouped views keep the within-group order of the severity-sorted list
  const groups = useMemo(() => {
    if (group === 'severity') return [{ name: '', items: shown }]
    const map = new Map()
    for (const f of shown) {
      const name = group === 'category' ? f.category : [...new Set(f.ids.map((id) => har.entries[id]?.host).filter(Boolean))].slice(0, 1)[0] || '(no request)'
      ;(map.get(name) || map.set(name, []).get(name)).push(f)
    }
    return [...map.entries()].map(([name, items]) => ({ name, items })).sort((a, b) => b.items.length - a.items.length)
  }, [shown, group, har])

  const md = () => findingsMarkdown(har, findings, { score, label: r.label, dismissed, keyOf: findingKey })
  const copyMd = async () => toast?.((await copyText(md())) ? 'Findings copied as Markdown' : 'Copy failed')
  const saveMd = () => { download(`${har.fileName.replace(/\.(har|json)$/i, '')}.findings.md`, md(), 'text/markdown'); toast?.('Findings downloaded') }

  return (
    <div className="issues">
      <Card className="issues-top">
        <Score score={score} />
        <div className="issues-sum">
          <h2 className="t-title">{!active.length ? 'This capture looks healthy' : `${active.length} thing${active.length === 1 ? '' : 's'} to look at`}</h2>
          <p className="dim ellipsis" title={har.fileName}>{har.fileName}</p>
          <Segmented label="Show findings by severity" value={sev} onChange={setSev} options={[
            { value: 'all', label: `All ${active.length}` },
            { value: 'critical', label: `Critical ${counts.critical}` },
            { value: 'warning', label: `Warnings ${counts.warning}` },
            { value: 'info', label: `Notes ${counts.info}` },
          ]} />
          <div className="toolrow">
            <Segmented size="s" label="Group findings" value={group} onChange={setGroup} options={[{ value: 'severity', label: 'Severity' }, { value: 'category', label: 'Category' }, { value: 'host', label: 'Host' }]} />
            <span className="grow" />
            <button type="button" className="btn sm" onClick={copyMd}><FontAwesomeIcon icon={faCopy} /> <span>Copy as Markdown</span></button>
            <button type="button" className="btn sm" onClick={saveMd}><FontAwesomeIcon icon={faDownload} /> <span>Download .md</span></button>
          </div>
          <p className="hint">Rule-based checks on status codes, redirects, timings, payloads, caching, headers and cookies. Treat them as leads; confirm in server logs.</p>
        </div>
      </Card>
      {!shown.length && <EmptyState icon={faCircleCheck} title={`No ${sev === 'all' ? '' : `${WORD[sev].toLowerCase()} `}issues found`} />}
      {groups.map((g) => (
        <section key={g.name || 'all'} className="findings" aria-label={g.name || undefined}>
          {g.name && <h3 className="group-h">{g.name} <span className="dim">· {g.items.length}</span></h3>}
          {g.items.map((f) => <Finding key={f.id} f={f} har={har} onDismiss={() => dismiss(f)} />)}
        </section>
      ))}

      {hidden.length > 0 && (
        <Card title={`Dismissed (${hidden.length})`} aside={<button type="button" className="btn sm" aria-expanded={showDismissed} onClick={() => setShowDismissed((v) => !v)}>{showDismissed ? 'Hide' : 'Show'}</button>}>
          <p className="hint" style={{ marginTop: 0 }}>Marked as expected on this device. They do not count toward the score.</p>
          {showDismissed && (
            <ul className="list-plain">
              {hidden.map((f) => (
                <li key={f.id} className="toolrow">
                  <span className="grow">{f.title} <span className="dim">({f.category})</span></span>
                  <button type="button" className="btn sm" onClick={() => restore(f)}><FontAwesomeIcon icon={faRotateLeft} /> <span>Restore</span></button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  )
}
