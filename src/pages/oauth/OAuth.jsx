import { useEffect, useMemo, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faArrowRight, faMagnifyingGlass, faRoute } from '@fortawesome/free-solid-svg-icons'
import { analyzeOAuth, analyzeTokenRequests, flowSteps } from '../../auth/oauth'
import { EXAMPLES, lookupError } from '../../auth/errors'
import { fmtMs } from '../../lib/utils'
import { CheckList, KV } from '../../components/shared/authui'
import { toneOf, worstOf, wordOf } from '../../components/shared/severity'
import { Card, EmptyState, StatusCode } from '../../components/shared/ui'

const FLOW = { code: 'Authorization code', implicit: 'Implicit', hybrid: 'Hybrid' }

function Params({ params, hide = [] }) {
  const rows = Object.entries(params).filter(([k]) => !hide.includes(k))
  return (
    <table className="tbl saml-attrs">
      <thead><tr><th>Parameter</th><th>Value</th></tr></thead>
      <tbody>{rows.map(([k, v]) => <tr key={k}><td className="mono">{k}</td><td className="mono">{String(v)}</td></tr>)}</tbody>
    </table>
  )
}

// codes, tokens and secrets are shown, since you are debugging with them, but shortened so a screenshot does not hold a whole credential
const SECRET = /^(code|access_token|id_token|refresh_token|client_secret|code_verifier|assertion|client_assertion)$/
const mask = (params) => Object.fromEntries(Object.entries(params).map(([k, v]) => [k, SECRET.test(k) && String(v).length > 24 ? `${String(v).slice(0, 12)}…${String(v).slice(-6)} (${String(v).length} chars)` : v]))

function FlowCard({ fl, open, setOpen }) {
  const worst = worstOf(fl.checks)
  const steps = flowSteps(fl)
  const a = fl.authorize.params
  const isOpen = open === fl.id
  return (
    <article className={`finding saml-item${isOpen ? ' open' : ''} sev-${toneOf(worst)}`}>
      <button type="button" className="f-head" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? '' : fl.id)}>
        <FontAwesomeIcon icon={faRoute} className={`f-ic tone-${toneOf(worst)}`} />
        <span className="f-title">
          {fl.protocol === 'oidc' ? 'OpenID Connect' : 'OAuth 2.0'} sign-in · {FLOW[fl.flow]}
          <span className="dim saml-sub"> · {fl.authorize.entry.host} · client {a.client_id}</span>
        </span>
        <span className="f-meta">
          <span className={`sev tone-${toneOf(worst)}`}>{wordOf(worst)}</span>
          {Number.isFinite(fl.authorize.entry.startMs) && <span className="dim num">{fmtMs(fl.authorize.entry.startMs)}</span>}
        </span>
        <FontAwesomeIcon icon={faArrowRight} className="f-chev" />
      </button>
      <div className="f-collapse" data-open={isOpen}>
        <div className="f-inner">
          {isOpen && (
            <div className="saml-detail">
              <div className="saml-sec">
                <h4>Steps</h4>
                <ol className="saml-seq">
                  {steps.map((s) => (
                    <li key={s.n} className="has">
                      <span className="num dim">{s.n}</span>
                      <span>{s.name}</span>
                      <span className="ellipsis dim" title={s.detail}>{s.detail}</span>
                      <span className="num"><StatusCode status={s.status} /></span>
                      <span />
                    </li>
                  ))}
                </ol>
              </div>
              <div className="saml-sec"><h4>Checks</h4><CheckList checks={fl.checks} /></div>
              <div className="saml-sec">
                <h4>Summary</h4>
                <KV rows={[['Provider', fl.authorize.entry.host], ['Client id', a.client_id], ['Flow', FLOW[fl.flow]], ['Scopes', fl.scopes.join(' ')], ['Redirect URI', a.redirect_uri], ['PKCE', a.code_challenge ? (a.code_challenge_method || 'plain') : 'not used']]} />
              </div>
              <div className="saml-sec"><h4>Authorization request</h4><Params params={mask(a)} /></div>
              {fl.callback && <div className="saml-sec"><h4>Response to the app <span className="dim">· {fl.callback.where}</span></h4><Params params={mask(fl.callback.params)} /></div>}
              {fl.token && <div className="saml-sec"><h4>Token request</h4><Params params={mask(fl.token.form)} /></div>}
              {fl.token && fl.token.body && <div className="saml-sec"><h4>Token response</h4><Params params={mask(Object.fromEntries(Object.entries(fl.token.body).map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : v])))} /></div>}
            </div>
          )}
        </div>
      </div>
    </article>
  )
}

/** /oauth/flow */
export function OAuthFlow({ har }) {
  const [result, setResult] = useState(null) // null while scanning
  const tokenReqs = useMemo(() => (har ? analyzeTokenRequests(har) : null), [har])
  const [open, setOpen] = useState('')
  useEffect(() => {
    let live = true
    if (!har) { Promise.resolve().then(() => { if (live) setResult({ flows: [], tokenOnly: [] }) }); return () => { live = false } }
    analyzeOAuth(har).then((r) => { if (live) { setResult(r); setOpen(r.flows.length === 1 ? r.flows[0].id : '') } })
    return () => { live = false }
  }, [har])
  if (!har) return <EmptyState icon={faRoute} title="No capture loaded">Open a HAR file of a sign-in to follow its OAuth or OpenID Connect steps.</EmptyState>
  const flows = result ? result.flows : []
  return (
    <div className="stack">
      <section className="saml-capture" aria-label="OAuth sign-ins in the loaded capture">
        <h2 className="t-title saml-h">{!result ? 'Scanning the capture…' : flows.length ? `${flows.length} OAuth / OpenID Connect sign-in${flows.length === 1 ? '' : 's'} in ${har.fileName}` : `No OAuth or OpenID Connect sign-in found in ${har.fileName}`}</h2>
        {result && !flows.length && <p className="dim">A sign-in starts with a request to an authorization endpoint with <span className="mono">response_type</span> and <span className="mono">client_id</span> in the URL. None was found. If the app signs in with SAML, use the SAML tool instead.</p>}
      </section>
      <div className="saml-list">{flows.map((fl) => <FlowCard key={fl.id} fl={fl} open={open} setOpen={setOpen} />)}</div>
      {tokenReqs && tokenReqs.requests.length > 0 && (
        <Card title={`Token requests · ${tokenReqs.requests.length}`} aside={<span className="t-cap">every call to a token endpoint, including refreshes</span>}>
          {tokenReqs.checks.length > 0 && <div className="saml-sec"><h4>Across requests</h4><CheckList checks={tokenReqs.checks} /></div>}
          <ul className="saml-uses tokreqs">
            {tokenReqs.requests.map((r) => (
              <li key={r.entry.id}>
                <span className="mono dim">{r.grant.replace('urn:ietf:params:oauth:grant-type:', '')}</span> <span className="ellipsis">{r.entry.host}{r.entry.path}</span> <span className="dim">· <StatusCode status={r.entry.status} /></span>
                {r.checks.length > 0 && <div className="tokreq-checks"><CheckList checks={r.checks} /></div>}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {result && flows.length > 0 && <p className="hint">The browser only shows its own side. If the app&rsquo;s server makes the token request, it is not in a browser capture, so check the server&rsquo;s logs for that step.</p>}
    </div>
  )
}

/** /oauth/errors: look an error up. Works with nothing loaded. */
export function OAuthErrors() {
  const [text, setText] = useState('')
  const results = useMemo(() => lookupError(text), [text])
  return (
    <div className="stack">
      <Card title="Look up an error" aside={<FontAwesomeIcon icon={faMagnifyingGlass} className="dim" />}>
        <p className="lede">Paste an error code, a callback URL that contains <span className="mono">error=…</span>, a JSON error response, or an <span className="mono">AADSTS</span> message from Microsoft Entra ID.</p>
        <textarea className="saml-paste" rows={3} value={text} spellCheck={false} onChange={(e) => setText(e.target.value)} placeholder="invalid_grant   or   AADSTS50011   or   https://app.example.com/callback?error=access_denied&error_description=…" aria-label="Error to look up" />
        <div className="actions">
          {EXAMPLES.map((x) => <button key={x} type="button" className="btn sm" onClick={() => setText(x)}>{x}</button>)}
        </div>
      </Card>
      {text.trim() && !results.length && <Card><p className="dim" style={{ margin: 0 }}>No entry for that. The list covers the standard OAuth 2.0 and OpenID Connect errors, the Microsoft Entra ID errors that come up most, and a few from Google. Anything else: read the provider&rsquo;s <span className="mono">error_description</span>, which usually names the parameter at fault.</p></Card>}
      {results.map((r) => (
        <Card key={r.code} title={r.code} aside={<span className="t-cap">{r.source}</span>}>
          <p className="lede"><b>{r.title}.</b> {r.meaning}</p>
          <p className="dim" style={{ margin: '0 0 6px' }}>{r.why}</p>
          <div className="saml-sec"><h4>Usual causes</h4><ul className="bullets">{r.causes.map((c) => <li key={c}>{c}</li>)}</ul></div>
          <div className="saml-sec"><h4>What to try</h4><ul className="bullets">{r.fix.map((c) => <li key={c}>{c}</li>)}</ul></div>
        </Card>
      ))}
    </div>
  )
}
