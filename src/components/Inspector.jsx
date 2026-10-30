import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCopy, faTerminal, faXmark } from '@fortawesome/free-solid-svg-icons'
import { PHASES, PHASE_COLORS } from '../harParser'
import { copyText, fmtBytes, fmtMs, statusClass, toCurl } from '../utils'

const TABS = ['Headers', 'Cookies', 'Params', 'Response', 'Timing']
function Rows({ items, empty }) {
  if (!items.length) return <div className="dim pad">{empty}</div>
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

function Preview({ e }) {
  const b = e.body
  const text = b && typeof b.text === 'string' ? b.text : null
  if (!b || text == null) return <div className="dim pad">No response body was saved in this HAR (many tools strip bodies). Size: {fmtBytes(e.contentSize)}.</div>
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
      <pre className="code">{cut ? out.slice(0, 8000) : out}</pre>
      {cut && <div className="hint">Showing first 8,000 of {out.length.toLocaleString()} characters.</div>}
    </>
  )
}

function Body({ e, tab }) {
  if (tab === 'Headers') {
    return (
      <>
        <h4>General</h4>
        <Rows items={[
          { name: 'URL', value: e.url }, { name: 'Method', value: e.method },
          { name: 'Status', value: `${e.status || 'no response'} ${e.statusText}`.trim() },
          { name: 'Protocol', value: e.httpVersion || '—' }, { name: 'Server IP', value: e.ip || '—' },
          ...(e.redirectUrl ? [{ name: 'Redirects to', value: e.redirectUrl }] : []),
          ...(e.initiator ? [{ name: 'Initiator', value: e.initiator }] : []),
          ...(e.errorText ? [{ name: 'Error', value: e.errorText }] : []),
        ]} empty="" />
        <h4>Response headers ({e.resHeaderList.length})</h4>
        <Rows items={e.resHeaderList} empty="No response headers recorded." />
        <h4>Request headers ({e.reqHeaderList.length})</h4>
        <Rows items={e.reqHeaderList} empty="No request headers recorded." />
      </>
    )
  }
  if (tab === 'Cookies') {
    return (
      <>
        <h4>Sent ({e.reqCookies.length})</h4>
        <Rows items={e.reqCookies} empty="No cookies sent." />
        <h4>Set by server ({e.setCookies.length})</h4>
        <Rows items={e.setCookies.map((c, i) => ({ name: `Set-Cookie #${i + 1}`, value: c }))} empty="No cookies set." />
      </>
    )
  }
  if (tab === 'Params') {
    return (
      <>
        <h4>Query string ({e.query.length})</h4>
        <Rows items={e.query} empty="No query parameters." />
        <h4>Request body</h4>
        {e.postData && e.postData.text ? <pre className="code">{e.postData.text}</pre> : <div className="dim pad">No request body.</div>}
      </>
    )
  }
  if (tab === 'Response') return <Preview e={e} />
  const total = Math.max(1, e.time)
  return (
    <>
      <div className="tbar">
        {PHASES.map((p) => e.phases[p] > 0 && <i key={p} title={`${p}: ${fmtMs(e.phases[p])}`} style={{ width: `${(e.phases[p] / total) * 100}%`, background: PHASE_COLORS[p] }} />)}
      </div>
      <Rows items={[{ name: 'Started at', value: fmtMs(e.startMs) }, ...PHASES.map((p) => ({ name: p, value: `${fmtMs(e.phases[p])}  (${((e.phases[p] / total) * 100).toFixed(0)}%)` })), { name: 'Total', value: fmtMs(e.time) }, { name: 'Transferred', value: fmtBytes(e.transfer) }, { name: 'Content size', value: fmtBytes(e.contentSize) }]} empty="" />
    </>
  )
}

export default function Inspector({ entry, source, onClose, toast }) {
  const [tab, setTab] = useState('Headers')
  const curl = useMemo(() => (entry ? toCurl(entry) : ''), [entry])
  const copy = async (text, label) => toast((await copyText(text)) ? `${label} copied` : 'Copy failed')

  return (
    <AnimatePresence>
      {entry && (
        <>
          <motion.div className="scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.aside
            className="drawer" role="dialog" aria-label="Request inspector"
            initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', stiffness: 320, damping: 34 }}
          >
            <header>
              <div className="dr-title">
                <b className={`st ${statusClass(entry.status)}`}>{entry.status || 'ERR'}</b>
                <span className="mono dim">{entry.method}</span>
                <span className="ellipsis" title={entry.url}>{entry.name}</span>
                <button className="icon-btn" onClick={onClose} aria-label="Close"><FontAwesomeIcon icon={faXmark} /></button>
              </div>
              {source && <div className="dr-src">From capture: <b>{source}</b></div>}
              <div className="dr-url" title={entry.url}>{entry.url}</div>
              <div className="dr-actions">
                <button className="btn sm" onClick={() => copy(entry.url, 'URL')}><FontAwesomeIcon icon={faCopy} /> URL</button>
                <button className="btn sm" onClick={() => copy(curl, 'cURL')}><FontAwesomeIcon icon={faTerminal} /> cURL</button>
                <span className="dim">{fmtMs(entry.time)} · {fmtBytes(entry.transfer)}</span>
              </div>
              <div className="tabs" role="tablist">
                {TABS.map((t) => <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t}</button>)}
              </div>
            </header>
            <div className="dr-body"><Body e={entry} tab={tab} key={entry.id} /></div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}
