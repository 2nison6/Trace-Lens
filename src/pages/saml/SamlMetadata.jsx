import { useEffect, useMemo, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faFileCode } from '@fortawesome/free-solid-svg-icons'
import { extractSaml } from '../../saml/extract'
import { parseSamlXml } from '../../saml/parse'
import { checkMetadata, compareWithMessages, parseMetadata } from '../../saml/metadata'
import { fingerprints } from '../../formats/x509'
import { reportInputs } from '../../reports/store'
import { CheckList, KV } from '../../components/shared/authui'
import { Card, Notice } from '../../components/shared/ui'

const day = (t) => new Date(t).toISOString().slice(0, 10)
const labelOf = (b) => b.bindingName

function Endpoints({ title, list }) {
  if (!list || !list.length) return null
  return (
    <div className="saml-sec">
      <h4>{title}</h4>
      <table className="tbl saml-attrs"><thead><tr><th>Binding</th><th>URL</th></tr></thead>
        <tbody>{list.map((e, i) => <tr key={i}><td>{labelOf(e)}{e.isDefault && <small className="dim"> · default</small>}{e.index != null && <small className="dim"> · index {e.index}</small>}</td><td className="mono">{e.location}</td></tr>)}</tbody></table>
    </div>
  )
}

function Keys({ keys, fps }) {
  if (!keys.length) return null
  return (
    <div className="saml-sec">
      <h4>Certificates</h4>
      {keys.map((k, i) => {
        const c = k.certificate
        if (!c) return <p key={i} className="dim">A key with no certificate.</p>
        if (c.error) return <p key={i} className="tone-warn">{c.error}</p>
        const fp = fps[c.base64]
        return <KV key={i} rows={[['Use', k.useText], ['Subject', c.subject], ['Valid', `${day(c.notBefore)} to ${day(c.notAfter)}`], ['Key', `${c.key.algorithm} ${c.key.curve || c.key.bits}`], ['SHA-256', fp && fp.sha256]]} />
      })}
    </div>
  )
}

function EntityView({ entity, items, fps, now }) {
  const own = useMemo(() => checkMetadata(entity, { now }), [entity, now])
  const cmp = useMemo(() => compareWithMessages(entity, items, { fps }), [entity, items, fps])
  const role = entity.idp || entity.sp
  return (
    <Card title={entity.entityId || '(no entityID)'} aside={<span className="t-cap">{entity.idp ? 'Identity provider' : ''}{entity.idp && entity.sp ? ' + ' : ''}{entity.sp ? 'Service provider' : ''}</span>}>
      <div className="saml-sec"><h4>About this metadata</h4><CheckList checks={own} /></div>
      <div className="saml-sec">
        <h4>Compared with the messages in your trace</h4>
        {items.length === 0 && <p className="hint" style={{ marginTop: 0 }}>No SAML messages are loaded. Open a HAR or a SAML-tracer export on the Messages page, or from the SAML start page, to compare it with this metadata.</p>}
        <CheckList checks={cmp} />
      </div>
      <KV rows={[['Valid until', entity.validUntil], ['Cache duration', entity.cacheDuration], ['Organisation', entity.organization], ['Metadata is signed', entity.signed ? 'yes' : '']]} />
      {entity.idp && <Endpoints title="Sign-in endpoints" list={entity.idp.singleSignOn} />}
      {entity.sp && <Endpoints title="ACS endpoints (where responses are sent)" list={entity.sp.acs} />}
      {role && role.singleLogout.length > 0 && <Endpoints title="Logout endpoints" list={role.singleLogout} />}
      {role && <Keys keys={role.keys} fps={fps} />}
      {role && role.nameIdFormats.length > 0 && <KV rows={[['NameID formats', role.nameIdFormats.map((x) => x.split(':').pop()).join(', ')]]} />}
    </Card>
  )
}

/** /saml/metadata: paste IdP or SP metadata, check it, and compare it with the messages in the loaded trace. */
export default function SamlMetadata({ har, traces = [], pasted = [] }) {
  const [text, setText] = useState('')
  const [found, setFound] = useState([])
  const [fps, setFps] = useState({})
  const [loadedAt] = useState(() => Date.now())
  useEffect(() => {
    let live = true
    if (!har) { Promise.resolve().then(() => { if (live) setFound([]) }); return () => { live = false } }
    extractSaml(har).then((r) => { if (live) setFound(r) })
    return () => { live = false }
  }, [har])
  const items = useMemo(() => [...found, ...traces.flatMap((t) => t.items), ...pasted].map((it) => ({ ...it, parsed: it.xml ? parseSamlXml(it.xml) : null })), [found, traces, pasted])
  const md = useMemo(() => (text.trim() ? parseMetadata(text) : null), [text])
  useEffect(() => {
    let live = true
    const certs = []
    if (md && !md.error) for (const e of md.entities) for (const r of [e.idp, e.sp]) if (r) for (const k of r.keys) if (k.certificate && k.certificate.der) certs.push(k.certificate)
    for (const it of items) { const p = it.parsed; if (p && !p.error) for (const s of [p.signature, ...(p.assertions || []).map((a) => a.signature)]) if (s && s.certificate && s.certificate.der) certs.push(s.certificate) }
    Promise.all(certs.map(async (c) => [c.base64, await fingerprints(c.der)])).then((pairs) => { if (live) setFps(Object.fromEntries(pairs.filter(([, v]) => v))) })
    return () => { live = false }
  }, [md, items])
  useEffect(() => {
    if (!md || md.error) { reportInputs.set('metadata', null); return }
    const all = md.entities.flatMap((e) => [...checkMetadata(e, { now: loadedAt }), ...compareWithMessages(e, items, { fps })])
    reportInputs.set('metadata', all.length ? all : null)
  }, [md, items, fps, loadedAt])
  return (
    <div className="stack">
      <Card title="Paste SAML metadata" aside={<FontAwesomeIcon icon={faFileCode} className="dim" />}>
        <p className="lede">Paste the metadata XML of an <b>identity provider</b> or a <b>service provider</b> (the file you download from Okta, Entra ID, ADFS, Shibboleth, Keycloak or the app, or the contents of its metadata URL). It is checked for expiry and for problems, and compared with the SAML messages in your loaded trace. Nothing is sent anywhere.</p>
        <textarea className="saml-paste" rows={6} value={text} spellCheck={false} onChange={(e) => setText(e.target.value)} placeholder={'<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID="…">\n…'} aria-label="SAML metadata" />
        <div className="actions">{text && <button type="button" className="btn" onClick={() => setText('')}>Clear</button>}</div>
      </Card>
      {md && md.error && <Notice tone="crit">{md.error}</Notice>}
      {md && !md.error && md.entities.map((e, i) => <EntityView key={`${e.entityId}-${i}`} entity={e} items={items} fps={fps} now={loadedAt} />)}
      <p className="hint">Metadata describes what a provider says about itself. A message that disagrees with it is the usual cause of &ldquo;audience restriction failed&rdquo;, &ldquo;invalid signature&rdquo; and &ldquo;unknown service provider&rdquo; errors. Fetching metadata from a URL is not done here, because TraceLens never makes network requests: open the URL yourself and paste what it shows.</p>
    </div>
  )
}
