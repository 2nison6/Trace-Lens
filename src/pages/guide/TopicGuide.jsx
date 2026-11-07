import { NavLink, Navigate, useParams } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faArrowRight, faMagnifyingGlass, faShieldHalved } from '@fortawesome/free-solid-svg-icons'
import { CAPTURE, GUIDE_CHECKED, SYMPTOMS } from '../../guides/general'
import { GUIDES, guideById } from '../../guides'
import { resolveRef } from '../../guides/refs'
import { SECTIONS } from '../../app/nav'
import { Card } from '../../components/shared/ui'

const toolOf = (g) => SECTIONS.find((s) => s.id === g.tool)

/** /guide/topics: one card per topic. */
export function GuideTopics() {
  return (
    <div className="stack">
      <Card title="Pick what you are troubleshooting">
        <p className="lede">Each guide explains how the thing works, what to capture, a walkthrough in the matching tool, the error messages people actually see and what causes them.</p>
        <div className="guide-index tools-grid home">
          {GUIDES.map((g) => {
            const s = toolOf(g)
            return (
              <NavLink key={g.id} to={`/guide/${g.id}`} className="tool-card" data-guide={g.id}>
                <span className="tool-ic"><FontAwesomeIcon icon={s.icon} /></span>
                <b>{g.title}</b>
                <span>{g.lead.split('. ')[0]}.</span>
                <small>{g.errors.length} common errors · {g.walk.length} steps</small>
              </NavLink>
            )
          })}
          <NavLink to="/guide/help" className="tool-card" data-guide="help">
            <span className="tool-ic"><FontAwesomeIcon icon={faMagnifyingGlass} /></span>
            <b>By symptom, privacy and limits</b>
            <span>Start from what you are seeing, then read what the tools can and cannot do.</span>
            <small>{SYMPTOMS.length} symptoms · what is kept private</small>
          </NavLink>
        </div>
      </Card>
    </div>
  )
}

/** /guide/<topic>: the full guide for one topic. */
export function TopicGuide() {
  const { topic } = useParams()
  const g = guideById(topic)
  if (!g) return <Navigate to="/guide/topics" replace />
  const s = toolOf(g)
  const caps = g.capture.map((id) => CAPTURE.find((c) => c.id === id)).filter(Boolean)
  return (
    <div className="stack guide" data-topic={g.id}>
      <Card title={g.title} aside={<NavLink className="btn sm primary" to={s.pages[0].to}>Open the tool <FontAwesomeIcon icon={faArrowRight} /></NavLink>}>
        <p className="lede" style={{ margin: 0 }}>{g.lead}</p>
        <nav className="guide-toc" aria-label="On this page">
          {['how', 'capture', 'walk', 'errors', 'mistakes', 'glossary'].map((k) => <a key={k} href={`#${k}`}>{{ how: 'How it works', capture: 'What to capture', walk: 'Step by step', errors: 'Errors and causes', mistakes: 'Common mistakes', glossary: 'Glossary' }[k]}</a>)}
        </nav>
      </Card>

      <Card title="How it works" className="anchor" id="how">
        <ol className="guide-flow">{g.how.map(([a, b], i) => <li key={a}><span className="guide-n">{i + 1}</span><div><b>{a}</b><p>{b}</p></div></li>)}</ol>
        {g.statuses && (
          <>
            <h4 className="guide-sub">Status codes you will meet</h4>
            <table className="tbl saml-attrs"><tbody>{g.statuses.map(([k, v]) => <tr key={k}><td className="mono">{k}</td><td>{v}</td></tr>)}</tbody></table>
          </>
        )}
      </Card>

      <Card title="What to capture" className="anchor" id="capture" aside={<span className="t-cap">checked {GUIDE_CHECKED}</span>}>
        {caps.map((c) => (
          <details key={c.id} className="guide-cap" open={caps.length === 1}>
            <summary>{c.title}</summary>
            <ol>{c.steps.map((x) => <li key={x}>{x}</li>)}</ol>
            {c.sensitive.length > 0 && <div className="guide-warn"><b><FontAwesomeIcon icon={faShieldHalved} /> Sensitive data</b><ul>{c.sensitive.map((x) => <li key={x}>{x}</li>)}</ul></div>}
          </details>
        ))}
      </Card>

      <Card title={`Step by step in ${s.label}`} className="anchor" id="walk">
        <ol className="guide-walk">
          {g.walk.map(([title, lines], i) => (
            <li key={title}><h4><span className="guide-n">{i + 1}</span>{title}</h4>{lines.map((x) => <p key={x}>{x}</p>)}</li>
          ))}
        </ol>
      </Card>

      <Card title="Errors and what causes them" className="anchor" id="errors">
        <p className="hint" style={{ marginTop: 0 }}>Wording varies by product and version; the cause behind it does not. Microsoft codes are quoted from Microsoft&rsquo;s published list.</p>
        <div className="guide-sym">
          {g.errors.map(([name, why, fix, where]) => {
            const to = resolveRef(where)
            return (
              <details key={name}>
                <summary>{name}</summary>
                <p><b>Why.</b> {why}</p>
                <p><b>What to do.</b> {fix}</p>
                {to && <p><NavLink to={to} className="guide-ref">{where} <FontAwesomeIcon icon={faArrowRight} /></NavLink></p>}
              </details>
            )
          })}
        </div>
      </Card>

      <Card title="Common mistakes" className="anchor" id="mistakes"><ul className="bullets">{g.mistakes.map((x) => <li key={x}>{x}</li>)}</ul></Card>

      <Card title="Glossary" className="anchor" id="glossary">
        <dl className="kvlist">{g.glossary.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      </Card>
    </div>
  )
}
