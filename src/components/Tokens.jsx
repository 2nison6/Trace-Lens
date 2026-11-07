import { useEffect, useMemo, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faClipboard, faCopy, faShieldHalved, faSignature } from '@fortawesome/free-solid-svg-icons'
import { checkJwt, decodeJwt, describeClaims, findTokens } from '../auth/jwt'
import { describeKeys, verifyJwt } from '../auth/verify'
import { copyText } from '../utils'
import { CheckList, KV } from './authui'
import { toneOf, worstOf, wordOf } from './severity'
import { Card, EmptyState, Notice, Switch } from './ui'

const json = (o) => JSON.stringify(o, null, 2)

/** Header, claims and checks for one decoded token. */
function TokenDetail({ dec, now, expect, notify, basis }) {
  const checks = useMemo(() => checkJwt(dec, { now, expect }), [dec, now, expect])
  const claims = useMemo(() => (dec.payload ? describeClaims(dec.payload) : []), [dec])
  if (dec.error) {
    return (
      <div className="saml-detail">
        <Notice tone={dec.kind === 'empty' ? 'info' : 'warn'}>{dec.error}</Notice>
        {dec.header && <pre className="saml-xml" tabIndex={0}>{json(dec.header)}</pre>}
      </div>
    )
  }
  return (
    <div className="saml-detail">
      <div className="saml-sec">
        <h4>Checks</h4>
        <p className="hint" style={{ marginTop: 0 }}>{basis}</p>
        <CheckList checks={checks} />
      </div>
      <div className="saml-sec">
        <h4>Header</h4>
        <KV rows={[['Algorithm', dec.header.alg], ['Type', dec.header.typ], ['Key id (kid)', dec.header.kid], ['Signature', dec.signature ? `${dec.signatureBytes} bytes, not verified here` : 'none']]} />
      </div>
      <div className="saml-sec">
        <h4>Claims <span className="dim">· {claims.length}</span></h4>
        <table className="tbl saml-attrs">
          <thead><tr><th>Claim</th><th>Value</th></tr></thead>
          <tbody>
            {claims.map((c) => (
              <tr key={c.claim}>
                <td><span className="mono">{c.claim}</span>{c.label && <small className="dim"> {c.label}</small>}</td>
                <td className="mono">{c.value}{c.when && <small className="dim"> · {c.when}</small>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="saml-sec">
        <h4>Raw</h4>
        <div className="toolrow">
          <button type="button" className="btn sm" onClick={async () => notify?.((await copyText(json(dec.payload))) ? 'Claims copied' : 'Copy failed')}><FontAwesomeIcon icon={faCopy} /> <span>Copy claims</span></button>
        </div>
        <pre className="saml-xml" tabIndex={0}>{json({ header: dec.header, payload: dec.payload })}</pre>
      </div>
    </div>
  )
}

function Expectations({ expect, setExpect }) {
  return (
    <Card title="Check against what you expect" aside={<span className="t-cap">optional</span>}>
      <div className="saml-expect">
        <label>Issuer you trust (iss)<input type="text" value={expect.issuer} onChange={(e) => setExpect({ ...expect, issuer: e.target.value })} placeholder="https://login.example.com/" spellCheck={false} /></label>
        <label>Audience of your API (aud)<input type="text" value={expect.audience} onChange={(e) => setExpect({ ...expect, audience: e.target.value })} placeholder="api://my-api" spellCheck={false} /></label>
        <label>Scopes you need<input type="text" value={expect.scope} onChange={(e) => setExpect({ ...expect, scope: e.target.value })} placeholder="read write" spellCheck={false} /></label>
      </div>
      <p className="hint">A token cannot know what your API expects. Enter these to find a mismatch, the usual cause of 401 and 403 responses from an API that is otherwise working.</p>
    </Card>
  )
}


const VERDICT_TONE = { valid: 'good', invalid: 'crit', refused: 'crit', error: 'warn', 'no-key': 'info', unsupported: 'info' }

/** Paste a key, get a verdict on a token's signature. The key never leaves the browser. */
export function VerifyCard({ dec }) {
  const [key, setKey] = useState('')
  const [result, setResult] = useState(null)
  const keys = useMemo(() => describeKeys(key), [key])
  useEffect(() => {
    let live = true
    if (!key.trim() || !dec || dec.error) { Promise.resolve().then(() => { if (live) setResult(null) }); return () => { live = false } }
    verifyJwt(dec, key).then((r) => { if (live) setResult(r) })
    return () => { live = false }
  }, [dec, key])
  return (
    <Card title="Verify the signature" aside={<FontAwesomeIcon icon={faSignature} className="dim" />}>
      <p className="lede">Paste the issuer&rsquo;s <b>public key</b>, a <b>certificate</b>, a <b>JWK</b> or a whole <b>JWKS</b> (what <span className="mono">jwks_uri</span> returns). For HS256 tokens, paste the shared secret. Checked in your browser; nothing is sent.</p>
      <textarea className="saml-paste" rows={4} value={key} spellCheck={false} onChange={(e) => setKey(e.target.value)} placeholder={'-----BEGIN PUBLIC KEY-----\n…\n-----END PUBLIC KEY-----\n\nor  {"keys":[{"kty":"RSA","kid":"…","n":"…","e":"AQAB"}]}'} aria-label="Key to verify with" />
      {keys.length > 0 && (
        <table className="tbl saml-attrs"><thead><tr><th>Key id</th><th>Type</th><th>Algorithm</th><th>Size</th></tr></thead>
          <tbody>{keys.map((k, i) => <tr key={i} className={dec && !dec.error && dec.header.kid === k.kid ? 'row-hit' : ''}><td className="mono">{k.kid || '(none)'}{dec && !dec.error && dec.header.kid === k.kid && <small className="dim"> · this token</small>}</td><td>{k.kty}</td><td>{k.alg || '—'}</td><td>{k.size}{k.private && <span className="tone-crit"> · contains a PRIVATE part</span>}</td></tr>)}</tbody></table>
      )}
      {result && result.status !== 'no-key' && (
        <div className={`verdict verdict-${VERDICT_TONE[result.status]}`} role="status">
          <b>{result.title}</b>
          {result.detail && <p>{result.detail}</p>}
        </div>
      )}
      {result && result.status === 'no-key' && result.title !== 'Paste a key to verify' && <Notice tone="warn">{result.title}. {result.detail}</Notice>}
    </Card>
  )
}

const NO_EXPECT = { issuer: '', audience: '', scope: '' }

/** /tokens/inspect: paste a token. */
export function TokenInspect({ toast: notify }) {
  const [text, setText] = useState('')
  const [expect, setExpect] = useState(NO_EXPECT)
  const [loadedAt] = useState(() => Date.now())
  const dec = useMemo(() => (text.trim() ? decodeJwt(text) : null), [text])
  const paste = async () => {
    try { setText(await navigator.clipboard.readText()) } catch { notify?.('The browser did not allow reading the clipboard. Paste with Ctrl/Cmd+V instead.', 'error') }
  }
  return (
    <div className="stack">
      <Card title="Paste a token" aside={<FontAwesomeIcon icon={faShieldHalved} className="dim" />}>
        <p className="lede">Paste a JWT (an access token, ID token or similar), or a whole <span className="mono">Authorization: Bearer …</span> header. It is decoded here in your browser and nothing is sent anywhere.</p>
        <textarea className="saml-paste" rows={4} value={text} spellCheck={false} onChange={(e) => setText(e.target.value)} placeholder="eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.…" aria-label="Token" />
        <div className="actions">
          <button type="button" className="btn" onClick={paste}><FontAwesomeIcon icon={faClipboard} /> Paste from clipboard</button>
          {text && <button type="button" className="btn" onClick={() => setText('')}>Clear</button>}
        </div>
      </Card>
      <Expectations expect={expect} setExpect={setExpect} />
      {dec && !dec.error && <VerifyCard dec={dec} />}
      {dec && !dec.error && <Card title="Token"><TokenDetail dec={dec} now={loadedAt} expect={expect} notify={notify} basis={`Dates are checked against the time this page was opened (${new Date(loadedAt).toISOString().replace('T', ' ').replace(/\.\d+Z$/, 'Z')}).`} /></Card>}
      {dec && dec.error && <Card title="Token"><TokenDetail dec={dec} now={loadedAt} expect={expect} notify={notify} /></Card>}
      <p className="hint">Decoding a token proves nothing: anyone can write one. Paste the issuer&rsquo;s key above to check the signature, and check the issuer, audience and expiry too.</p>
    </div>
  )
}

const short = (t) => (t.length > 34 ? `${t.slice(0, 16)}…${t.slice(-10)}` : t)

/** /tokens/capture: the tokens a loaded HAR carries. */
export function TokensInCapture({ har, toast: notify }) {
  const [expect, setExpect] = useState(NO_EXPECT)
  const [atCapture, setAtCapture] = useState(true)
  const [loadedAt] = useState(() => Date.now())
  const [open, setOpen] = useState('')
  const tokens = useMemo(() => (har ? findTokens(har) : []), [har])
  if (!har) return <EmptyState icon={faShieldHalved} title="No capture loaded">Open a HAR file to list the tokens in it.</EmptyState>
  return (
    <div className="stack">
      <section className="saml-capture" aria-label="Tokens in the loaded capture">
        <h2 className="t-title saml-h">{tokens.length ? `${tokens.length} token${tokens.length === 1 ? '' : 's'} in ${har.fileName}` : `No tokens found in ${har.fileName}`}</h2>
        {!tokens.length && <p className="dim">Looked in Authorization headers, token parameters in URLs and form bodies, JSON responses and cookies. If you expected one, check that the capture was saved with content and was not scrubbed.</p>}
      </section>
      <div className="saml-list">
        {tokens.map((t) => {
          const dec = t.decoded
          const first = t.uses.find((u) => u.at != null)
          const now = atCapture && first ? first.at : loadedAt
          const checks = dec && !dec.error ? checkJwt(dec, { now, expect }) : []
          const worst = checks.length ? worstOf(checks) : 'info'
          const isOpen = open === t.token
          return (
            <article key={t.token} className={`finding saml-item${isOpen ? ' open' : ''} sev-${toneOf(worst)}`}>
              <button type="button" className="f-head" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? '' : t.token)}>
                <FontAwesomeIcon icon={faShieldHalved} className={`f-ic tone-${toneOf(worst)}`} />
                <span className="f-title">
                  {t.kind === 'opaque' ? 'Opaque token' : dec?.error ? 'Token that could not be read' : `${dec.payload.typ || dec.header.typ || 'Token'} · ${dec.payload.sub ? `for ${String(dec.payload.sub).slice(0, 40)}` : dec.header.alg}`}
                  <span className="dim saml-sub"> · <span className="mono">{short(t.token)}</span></span>
                </span>
                <span className="f-meta">
                  {checks.length > 0 && <span className={`sev tone-${toneOf(worst)}`}>{wordOf(worst)}</span>}
                  <span className="dim num">{t.uses.length} use{t.uses.length === 1 ? '' : 's'}</span>
                </span>
              </button>
              <div className="f-collapse" data-open={isOpen}>
                <div className="f-inner">
                  <div className="saml-sec">
                    <h4>Where it appears</h4>
                    <ul className="saml-uses">
                      {t.uses.map((u, i) => <li key={i}><span className="mono dim">{u.method}</span> <span className="ellipsis">{u.host}{u.path}</span> <span className="dim">· {u.where}</span></li>)}
                    </ul>
                  </div>
                  {isOpen && dec && !dec.error && <VerifyCard dec={dec} />}
                  {isOpen && dec && <TokenDetail dec={dec} now={now} expect={expect} notify={notify} basis={atCapture && first ? `Dates are checked as of when the token was first used in the capture (${new Date(first.at).toISOString().replace('T', ' ').replace(/\.\d+Z$/, 'Z')}).` : 'Dates are checked against now.'} />}
                  {t.kind === 'opaque' && <p className="hint">An opaque token is a reference only the issuer can look up. To inspect it, use the issuer&rsquo;s introspection endpoint.</p>}
                </div>
              </div>
            </article>
          )
        })}
      </div>
      <Expectations expect={expect} setExpect={setExpect} />
      {tokens.length > 0 && (
        <Card>
          <Switch checked={atCapture} onChange={setAtCapture} label="Check as of the time of the capture" hint="On (default): dates are checked when the token was first used, so an old capture does not make every token look expired. Off: checked against now." />
        </Card>
      )}
      <p className="hint">Tokens are shown so you can debug with them. Treat the capture as sensitive, and use Tools &rarr; Scrub on the Network tool before sharing it.</p>
    </div>
  )
}
