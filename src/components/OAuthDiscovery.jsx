import { useEffect, useMemo, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCompass } from '@fortawesome/free-solid-svg-icons'
import { analyzeOAuth } from '../auth/oauth'
import { checkDiscovery, checkJwks, compareFlowWithDiscovery, parseDiscovery } from '../auth/discovery'
import { decodeJwt } from '../auth/jwt'
import { CheckList, KV } from './authui'
import { Card, Notice } from './ui'

/** /oauth/discovery: paste a provider's discovery document and its JWKS, check them, and compare them with the loaded sign-in and a token. */
export default function OAuthDiscovery({ har }) {
  const [docText, setDocText] = useState('')
  const [url, setUrl] = useState('')
  const [expectIssuer, setExpectIssuer] = useState('')
  const [jwksText, setJwksText] = useState('')
  const [tokenText, setTokenText] = useState('')
  const [flows, setFlows] = useState([])
  useEffect(() => {
    let live = true
    if (!har) { Promise.resolve().then(() => { if (live) setFlows([]) }); return () => { live = false } }
    analyzeOAuth(har).then((r) => { if (live) setFlows(r.flows) })
    return () => { live = false }
  }, [har])
  const parsed = useMemo(() => (docText.trim() ? parseDiscovery(docText) : null), [docText])
  const doc = parsed && parsed.doc
  const docChecks = useMemo(() => (doc ? checkDiscovery(doc, { issuer: expectIssuer.trim() || undefined, fetchedFrom: url.trim() || undefined }) : []), [doc, expectIssuer, url])
  const flowChecks = useMemo(() => (doc && flows.length ? compareFlowWithDiscovery(doc, flows) : []), [doc, flows])
  const token = useMemo(() => (tokenText.trim() ? decodeJwt(tokenText) : null), [tokenText])
  const jwks = useMemo(() => (jwksText.trim() ? checkJwks(jwksText, token) : null), [jwksText, token])
  return (
    <div className="stack">
      <Card title="Discovery document" aside={<FontAwesomeIcon icon={faCompass} className="dim" />}>
        <p className="lede">Open the provider&rsquo;s <span className="mono">/.well-known/openid-configuration</span> in a browser tab and paste what it shows. TraceLens makes no network requests, so it cannot fetch it for you.</p>
        <textarea className="saml-paste" rows={5} value={docText} spellCheck={false} onChange={(e) => setDocText(e.target.value)} placeholder={'{"issuer":"https://login.example.com/…","authorization_endpoint":"…","token_endpoint":"…","jwks_uri":"…"}'} aria-label="Discovery document" />
        <div className="saml-expect" style={{ marginTop: 10 }}>
          <label>The URL you opened it from (optional)<input type="text" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://login.example.com/tenant/v2.0/.well-known/openid-configuration" spellCheck={false} /></label>
          <label>The issuer your app expects (optional)<input type="text" value={expectIssuer} onChange={(e) => setExpectIssuer(e.target.value)} placeholder="https://login.example.com/tenant/v2.0" spellCheck={false} /></label>
        </div>
      </Card>
      {parsed && parsed.error && <Notice tone="crit">{parsed.error}</Notice>}
      {doc && (
        <Card title="What the document says">
          <CheckList checks={docChecks} />
          <KV rows={[['Issuer', doc.issuer], ['Authorize', doc.authorization_endpoint], ['Token', doc.token_endpoint], ['Keys (jwks_uri)', doc.jwks_uri], ['User info', doc.userinfo_endpoint], ['End session', doc.end_session_endpoint],
            ['Response types', (doc.response_types_supported || []).join(', ')], ['ID token algorithms', (doc.id_token_signing_alg_values_supported || []).join(', ')], ['PKCE methods', (doc.code_challenge_methods_supported || []).join(', ')],
            ['Client authentication', (doc.token_endpoint_auth_methods_supported || []).join(', ')], ['Scopes', (doc.scopes_supported || []).join(' ')]]}
          />
        </Card>
      )}
      {doc && (
        <Card title="Compared with the sign-in in your capture">
          {!har && <p className="hint" style={{ marginTop: 0 }}>No capture is loaded. Open a HAR of the sign-in on the Upload page to compare it with this document.</p>}
          {har && !flows.length && <p className="hint" style={{ marginTop: 0 }}>No OAuth or OpenID Connect sign-in was found in {har.fileName}.</p>}
          {flowChecks.length > 0 && <CheckList checks={flowChecks} />}
        </Card>
      )}
      <Card title="Signing keys (JWKS)">
        <p className="lede">Paste what the document&rsquo;s <span className="mono">jwks_uri</span> returns. Optionally paste a token too, to see whether its key is in the set (a missing key id is the signature of a key rotation).</p>
        <textarea className="saml-paste" rows={4} value={jwksText} spellCheck={false} onChange={(e) => setJwksText(e.target.value)} placeholder={'{"keys":[{"kty":"RSA","kid":"…","n":"…","e":"AQAB"}]}'} aria-label="JWKS" />
        <textarea className="saml-paste" rows={2} style={{ marginTop: 10 }} value={tokenText} spellCheck={false} onChange={(e) => setTokenText(e.target.value)} placeholder="A token to look up in this key set (optional)" aria-label="Token to look up" />
        {jwks && jwks.error && <Notice tone="crit">{jwks.error}</Notice>}
        {jwks && jwks.checks && <div className="saml-sec"><CheckList checks={jwks.checks} /></div>}
        {jwks && jwks.keys && jwks.keys.length > 0 && (
          <table className="tbl saml-attrs"><thead><tr><th>Key id</th><th>Type</th><th>Algorithm</th><th>Use</th><th>Size</th></tr></thead>
            <tbody>{jwks.keys.map((k, i) => <tr key={i} className={token && !token.error && token.header.kid === k.kid ? 'row-hit' : ''}><td className="mono">{k.kid || '(none)'}</td><td>{k.kty}</td><td>{k.alg || '—'}</td><td>{k.use || '—'}</td><td>{k.size || k.crv || '—'}</td></tr>)}</tbody></table>
        )}
      </Card>
    </div>
  )
}
