import { NavLink } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faArrowRight, faBookOpen, faShieldHalved } from '@fortawesome/free-solid-svg-icons'
import { CAPTURE, GUIDE_CHECKED, LIMITS, PRIVACY, SYMPTOMS } from '../guide'
import { SECTIONS } from '../nav'
import { resolveRef } from '../guideRefs'
import { Card } from './ui'

function Ref({ to, children }) {
  return to ? <NavLink to={to} className="guide-ref">{children} <FontAwesomeIcon icon={faArrowRight} /></NavLink> : <b>{children}</b>
}

/** /guide: how to capture each kind of trace, a checklist per symptom, and what the tools can and cannot do. */
export default function Guide() {
  return (
    <div className="stack guide">
      <Card title="Start with the symptom" aside={<FontAwesomeIcon icon={faBookOpen} className="dim" />}>
        <p className="lede">Find what you are seeing, and follow the tools in order.</p>
        <div className="guide-sym">
          {SYMPTOMS.map((s) => (
            <details key={s.id} id={s.id}>
              <summary>{s.title}</summary>
              <ol>{s.check.map(([where, why]) => <li key={where}><Ref to={resolveRef(where)}>{where}</Ref><span>{why}</span></li>)}</ol>
            </details>
          ))}
        </div>
      </Card>
      <Card title="How to capture what the tools need" aside={<span className="t-cap">checked {GUIDE_CHECKED}</span>}>
        {CAPTURE.map((c) => (
          <details key={c.id} id={c.id} className="guide-cap">
            <summary>{c.title}<small className="dim"> · for {c.for.join(', ')}</small></summary>
            <ol>{c.steps.map((x) => <li key={x}>{x}</li>)}</ol>
            {c.sensitive.length > 0 && <div className="guide-warn"><b><FontAwesomeIcon icon={faShieldHalved} /> Sensitive data</b><ul>{c.sensitive.map((x) => <li key={x}>{x}</li>)}</ul></div>}
          </details>
        ))}
      </Card>
      <Card title="Your data">
        <ul className="bullets">{PRIVACY.map((x) => <li key={x}>{x}</li>)}</ul>
      </Card>
      <Card title="What these tools cannot tell you">
        <ul className="bullets">{LIMITS.map((x) => <li key={x}>{x}</li>)}</ul>
      </Card>
      <Card title="All the pages">
        <div className="guide-index">
          {SECTIONS.map((s) => (
            <div key={s.id}>
              <h4><FontAwesomeIcon icon={s.icon} fixedWidth /> {s.title}</h4>
              <p className="dim">{s.blurb}</p>
              <ul>{s.pages.filter((p) => !p.start).map((p) => <li key={p.to}><NavLink to={p.to}>{p.label}</NavLink></li>)}</ul>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}
