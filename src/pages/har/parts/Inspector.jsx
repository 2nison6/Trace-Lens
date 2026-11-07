import { useMemo, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCopy, faTerminal, faXmark } from '@fortawesome/free-solid-svg-icons'
import { PHASES } from '../../../har/harParser'
import { PHASE_LABEL, PHASE_VAR } from '../../../lib/theme'
import { copyText, fmtBytes, fmtMs, toCurl } from '../../../lib/utils'
import { Segmented, StatusCode } from '../../../components/shared/ui'

const TABS = ['Headers', 'Cookies', 'Params', 'Response', 'Timing']

function Rows({ items, empty }) {
  if (!items.length) return <p className="dim pad-s">{empty}</p>
  return (
    <dl className="kvlist">
      {items.map((h, i) => (
        <div key={`${h.name}${i}`}>
          <dt>{h.name}</dt>
          <dd>{h.value === '' ? <span className="dim">(empty)</span> : String(h.value)}</dd>
        </div>
      ))}
    </dl>
  )
}

function Section({ title, count, children }) {
  return (
    <section className="insp-sec">
      <h4>{title}{count != null && <small>{count}</small>}</h4>
      {children}
    </section>
  )
}

function Preview({ e }) {
  const b = e.body
  const text = b && typeof b.text === 'string' ? b.text : null
  if (!b || text == null) return <p className="dim pad-s">No response body was saved in this HAR (many tools strip bodies). Size: {fmtBytes(e.contentSize)}.</p>
  if (b.encoding === 'base64' && /^image\//.test(b.mimeType || '')) {
    return <img className="prev-img" alt={e.name} src={`data:${b.mimeType};base64,${text}`} />
  }
  let out = text
  if (/json/i.test(b.mimeType || '')) {
    try { out = JSON.stringify(JSON.parse(text), null, 2) } catch { /* show raw */ }
  }
  const cut = out.length > 8000
  return (
    <>
      <pre className="codeblock">{cut ? out.slice(0, 8000) : out}</pre>
      {cut && <p className="hint">Showing first 8,000 of {out.length.toLocaleString()} characters.</p>}
    </>
  )
}

function Body({ e, tab }) {
  if (tab === 'Headers') {
    return (
      <>
        <Section title="General">
          <Rows empty="" items={[
            { name: 'URL', value: e.url }, { name: 'Method', value: e.method },
            { name: 'Status', value: `${e.status || 'no response'} ${e.statusText}`.trim() },
            { name: 'Protocol', value: e.httpVersion || '—' }, { name: 'Server IP', value: e.ip || '—' },
            ...(e.redirectUrl ? [{ name: 'Redirects to', value: e.redirectUrl }] : []),
            ...(e.initiator ? [{ name: 'Started by', value: e.initiator }] : []),
            ...(e.errorText ? [{ name: 'Error', value: e.errorText }] : []),
          ]} />
        </Section>
        <Section title="Response headers" count={e.resHeaderList.length}><Rows items={e.resHeaderList} empty="No response headers recorded." /></Section>
        <Section title="Request headers" count={e.reqHeaderList.length}><Rows items={e.reqHeaderList} empty="No request headers recorded." /></Section>
      </>
    )
  }
  if (tab === 'Cookies') {
    return (
      <>
        <Section title="Sent" count={e.reqCookies.length}><Rows items={e.reqCookies} empty="No cookies sent." /></Section>
        <Section title="Set by the server" count={e.setCookies.length}><Rows items={e.setCookies.map((c, i) => ({ name: `Set-Cookie ${i + 1}`, value: c }))} empty="No cookies set." /></Section>
      </>
    )
  }
  if (tab === 'Params') {
    return (
      <>
        <Section title="Query string" count={e.query.length}><Rows items={e.query} empty="No query parameters." /></Section>
        <Section title="Request body">{e.postData && e.postData.text ? <pre className="codeblock">{e.postData.text}</pre> : <p className="dim pad-s">No request body.</p>}</Section>
      </>
    )
  }
  if (tab === 'Response') return <Preview e={e} />
  const total = Math.max(1, e.time)
  return (
    <>
      <div className="tbar" role="img" aria-label="Phase timeline">
        {PHASES.map((p) => e.phases[p] > 0 && <i key={p} title={`${PHASE_LABEL[p]}: ${fmtMs(e.phases[p])}`} style={{ width: `${(e.phases[p] / total) * 100}%`, background: PHASE_VAR[p] }} />)}
      </div>
      <dl className="kvlist">
        <div><dt>Started at</dt><dd>{fmtMs(e.startMs)}</dd></div>
        {PHASES.filter((p) => e.phases[p] > 0).map((p) => (
          <div key={p}><dt><i className="key-dot" style={{ background: PHASE_VAR[p] }} />{PHASE_LABEL[p]}</dt><dd>{fmtMs(e.phases[p])} <small className="dim">{((e.phases[p] / total) * 100).toFixed(0)}%</small></dd></div>
        ))}
        <div><dt>Total</dt><dd>{fmtMs(e.time)}</dd></div>
        <div><dt>Transferred</dt><dd>{fmtBytes(e.transfer)}</dd></div>
        <div><dt>Content size</dt><dd>{fmtBytes(e.contentSize)}</dd></div>
      </dl>
    </>
  )
}

/** Request inspector. Rendered inside the dock (a side panel on wide screens, a sheet on small ones). */
export default function Inspector({ entry, source, onClose, toast }) {
  const [tab, setTab] = useState('Headers')
  const curl = useMemo(() => (entry ? toCurl(entry) : ''), [entry])
  const copy = async (text, label) => toast((await copyText(text)) ? `${label} copied` : 'Copy failed')
  if (!entry) return null

  return (
    <div className="dock-in">
      <header className="dock-h">
        <div className="dock-title">
          <StatusCode status={entry.status} icon />
          <span className="mono dim">{entry.method}</span>
          <h2 className="ellipsis" title={entry.url}>{entry.name}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close inspector"><FontAwesomeIcon icon={faXmark} /></button>
        </div>
        {source && <p className="dock-src">From <b>{source}</b></p>}
        <p className="dock-url" title={entry.url}>{entry.url}</p>
        <div className="dock-actions">
          <button type="button" className="btn sm" onClick={() => copy(entry.url, 'URL')}><FontAwesomeIcon icon={faCopy} /> Copy URL</button>
          <button type="button" className="btn sm" onClick={() => copy(curl, 'cURL')}><FontAwesomeIcon icon={faTerminal} /> Copy as cURL</button>
          <span className="dim num">{fmtMs(entry.time)} · {fmtBytes(entry.transfer)}</span>
        </div>
        <Segmented size="s" label="Inspector section" value={tab} onChange={setTab} options={TABS.map((t) => ({ value: t, label: t }))} />
      </header>
      <div className="dock-body" key={`${entry.id}-${tab}`}><Body e={entry} tab={tab} /></div>
    </div>
  )
}
