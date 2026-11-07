import { useMemo, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faWindows } from '@fortawesome/free-brands-svg-icons'
import { KERBEROS_ERRORS, NTLM_NAMES, analyzeWindowsAuth, inspectToken, lookupKerberosError } from '../auth/windows'
import { CheckList } from './authui'
import { toneOf, worstOf, wordOf } from './severity'
import { Card, EmptyState, StatusCode } from './ui'

const KIND = { kerberos: 'Kerberos ticket', ntlm: 'NTLM', 'spnego-ntlm': 'NTLM inside SPNEGO', spnego: 'SPNEGO offer', empty: 'no token', unknown: 'unknown', invalid: 'not base64', 'kerberos-error-or-ap': 'Kerberos' }
const describeToken = (t) => `${KIND[t.kind] || t.kind}${t.ntlmType ? `, message ${t.ntlmType}: ${NTLM_NAMES[t.ntlmType] || ''}` : ''}${t.bytes ? ` · ${t.bytes} bytes` : ''}${t.offersKerberos || t.offersNtlm ? ` · offers ${[t.offersKerberos && 'Kerberos', t.offersNtlm && 'NTLM'].filter(Boolean).join(' + ')}` : ''}`

/** /windows/exchange: the Negotiate / NTLM handshakes found in a capture. */
export function WindowsExchange({ har }) {
  const result = useMemo(() => (har ? analyzeWindowsAuth(har) : null), [har])
  const [open, setOpen] = useState('')
  if (!har) return <EmptyState icon={faWindows} title="No capture loaded">Open a HAR file to look for Windows integrated authentication (Negotiate, Kerberos, NTLM).</EmptyState>
  return (
    <div className="stack">
      <section className="saml-capture" aria-label="Windows authentication in the loaded capture">
        <h2 className="t-title saml-h">{result.length ? `Windows authentication with ${result.length} host${result.length === 1 ? '' : 's'} in ${har.fileName}` : `No Windows authentication found in ${har.fileName}`}</h2>
        {!result.length && <p className="dim">It shows up as a <span className="mono">401</span> with <span className="mono">WWW-Authenticate: Negotiate</span> or <span className="mono">NTLM</span>, followed by a request with an <span className="mono">Authorization: Negotiate …</span> header. Chrome&rsquo;s default HAR export removes Authorization headers: use &ldquo;Save all as HAR with sensitive data&rdquo;, and treat the file as secret.</p>}
      </section>
      <div className="saml-list">
        {result.map((r) => {
          const worst = worstOf(r.checks)
          const isOpen = open === r.host
          return (
            <article key={r.host} className={`finding saml-item${isOpen ? ' open' : ''} sev-${toneOf(worst)}`}>
              <button type="button" className="f-head" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? '' : r.host)}>
                <FontAwesomeIcon icon={faWindows} className={`f-ic tone-${toneOf(worst)}`} />
                <span className="f-title">{r.host}<span className="dim saml-sub"> · {r.steps.length} step{r.steps.length === 1 ? '' : 's'}</span></span>
                <span className="f-meta"><span className={`sev tone-${toneOf(worst)}`}>{wordOf(worst)}</span></span>
              </button>
              <div className="f-collapse" data-open={isOpen}>
                <div className="f-inner">
                  {isOpen && (
                    <div className="saml-detail">
                      <div className="saml-sec"><h4>Checks</h4><CheckList checks={r.checks} /></div>
                      <div className="saml-sec">
                        <h4>The exchange</h4>
                        <ol className="saml-seq">
                          {r.steps.map((s, i) => (
                            <li key={i} className="has">
                              <span className="num dim">{i + 1}</span>
                              <span className="mono dim">{s.dir === 'server' ? '◀ server' : 'client ▶'}</span>
                              <span className="ellipsis" title={describeToken(s.token)}>{s.scheme}{s.token.kind !== 'empty' ? ` · ${describeToken(s.token)}` : ''}<span className="dim"> · {s.method} {s.path}</span></span>
                              <span className="num"><StatusCode status={s.status} /></span>
                              <span />
                            </li>
                          ))}
                        </ol>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </article>
          )
        })}
      </div>
    </div>
  )
}

/** /windows/lookup: paste a token or a Kerberos error code. Works with nothing loaded. */
export function WindowsLookup() {
  const [token, setToken] = useState('')
  const [code, setCode] = useState('')
  const t = useMemo(() => (token.trim() ? inspectToken(token.replace(/^\s*(authorization:|www-authenticate:)?\s*(negotiate|ntlm)\s+/i, '').trim()) : null), [token])
  const k = useMemo(() => (code.trim() ? lookupKerberosError(code.replace(/\D/g, '')) : null), [code])
  return (
    <div className="stack">
      <Card title="Decode a Negotiate or NTLM token" aside={<FontAwesomeIcon icon={faWindows} className="dim" />}>
        <p className="lede">Paste the base64 after <span className="mono">Negotiate</span> or <span className="mono">NTLM</span> in an <span className="mono">Authorization</span> or <span className="mono">WWW-Authenticate</span> header. It says what kind of token it is and its size. (It cannot read the inside of a Kerberos ticket: that is encrypted for the service.)</p>
        <textarea className="saml-paste" rows={3} value={token} spellCheck={false} onChange={(e) => setToken(e.target.value)} placeholder="YIIE…  or  TlRMTVNTUAAB…" aria-label="Negotiate or NTLM token" />
        {t && <div className="verdict verdict-info" role="status"><b>{KIND[t.kind] || t.kind}</b><p>{describeToken(t)}</p></div>}
      </Card>
      <Card title="Look up a Kerberos error code">
        <p className="lede">The number from an event log, a <span className="mono">KRB_AP_ERR_…</span> message, or a network trace.</p>
        <input className="saml-code" type="text" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} placeholder="7" aria-label="Kerberos error code" />
        {code.trim() && !k && <p className="dim">No entry for that code.</p>}
        {k && <div className="verdict verdict-warn" role="status"><b>{k.code} · {k.name}</b><p>{k.meaning}</p></div>}
        <table className="tbl saml-attrs"><thead><tr><th>Code</th><th>Name</th><th>What it means</th></tr></thead>
          <tbody>{KERBEROS_ERRORS.map((e) => <tr key={e.code}><td>{e.code}</td><td className="mono">{e.name}</td><td>{e.meaning}</td></tr>)}</tbody></table>
      </Card>
    </div>
  )
}
