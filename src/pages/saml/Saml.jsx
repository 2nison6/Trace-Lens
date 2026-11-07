import { useCallback, useEffect, useMemo, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faArrowRight, faCircleCheck, faCircleExclamation, faCircleInfo, faClipboard, faCopy, faSignature, faDownload, faFileImport, faKey, faTriangleExclamation, faWandMagicSparkles,
} from '@fortawesome/free-solid-svg-icons'
import { analyzeFlow, checkAttributes, checkMessage, linkExchange } from '../../saml/checks'
import { extractSaml, fromPasted } from '../../saml/extract'
import { parseSamlXml } from '../../saml/parse'
import { fingerprints } from '../../formats/x509'
import { countSignatures, verifyXmlSignature } from '../../saml/signature'
import { copyText, fmtMs } from '../../lib/utils'
import { download } from '../../lib/scrub'
import usePicker from '../../hooks/usePicker'
import { CheckList } from '../../components/shared/authui'
import { Card, EmptyState, Notice, Segmented, Switch } from '../../components/shared/ui'

const ICON = { critical: faCircleExclamation, warning: faTriangleExclamation, info: faCircleInfo, ok: faCircleCheck }
const TONE = { critical: 'crit', warning: 'warn', info: 'info', ok: 'good' }
const WORD = { critical: 'Critical', warning: 'Warning', info: 'Note', ok: 'OK' }
const TITLE = {
  AuthnRequest: 'Sign-in request', Response: 'Sign-in response', LogoutRequest: 'Logout request', LogoutResponse: 'Logout response',
  ArtifactResolve: 'Artifact request', ArtifactResponse: 'Artifact response', Assertion: 'Assertion',
}
const fmtTime = (iso) => { const t = Date.parse(iso); return Number.isNaN(t) ? iso || '—' : `${new Date(t).toISOString().replace('T', ' ').replace(/\.\d+Z$/, 'Z')}` }

function KV({ rows }) {
  const shown = rows.filter(([, v]) => v !== '' && v != null && v !== false)
  if (!shown.length) return null
  return <dl className="kvlist saml-kv">{shown.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
}

function Check({ f }) {
  return (
    <li className={`saml-check sev-${TONE[f.severity]}`}>
      <FontAwesomeIcon icon={ICON[f.severity]} className={`tone-${TONE[f.severity]}`} />
      <div>
        <b>{f.title}</b>
        {f.detail && <p>{f.detail}</p>}
        {f.fix && <p className="fix"><span className="dim">Fix:</span> {f.fix}</p>}
      </div>
      <span className={`sev tone-${TONE[f.severity]}`}>{WORD[f.severity]}</span>
    </li>
  )
}

function Cert({ sig, fp }) {
  const c = sig && sig.certificate
  if (!c) return null
  if (c.error) return <p className="hint tone-warn">{c.error}</p>
  const day = (t) => new Date(t).toISOString().slice(0, 10)
  return (
    <KV rows={[
      ['Certificate', c.subject], ['Issuer', c.selfSigned ? `${c.issuer} (self-signed)` : c.issuer],
      ['Valid', `${day(c.notBefore)} to ${day(c.notAfter)}`], ['Key', `${c.key.algorithm} ${c.key.curve || c.key.bits}${c.key.algorithm === 'RSA' ? ' bit' : ''}`],
      ['Signed with', c.signatureAlgorithm], ['Serial', c.serial], ['SHA-256', fp && fp.sha256], ['SHA-1', fp && fp.sha1],
    ]}
    />
  )
}

function Assertion({ a, index, total, fps }) {
  const c = a.conditions
  return (
    <div className="saml-sec">
      <h4>{total > 1 ? `Assertion ${index + 1}` : 'Assertion'}</h4>
      <KV rows={[
        ['Issuer', a.issuer], ['ID', a.id], ['Issued', fmtTime(a.issueInstant)],
        ['User (NameID)', a.nameId && (a.nameId.encrypted ? 'encrypted' : a.nameId.value)], ['NameID format', a.nameId && a.nameId.formatName],
        ['Audience', c && c.audiences.join(', ')], ['Valid from', c && c.notBefore && fmtTime(c.notBefore)], ['Valid until', c && c.notOnOrAfter && fmtTime(c.notOnOrAfter)],
        ['Recipient (ACS)', a.confirmations[0] && a.confirmations[0].recipient], ['In response to', a.confirmations[0] && a.confirmations[0].inResponseTo],
        ['Signed in at', a.authn && fmtTime(a.authn.instant)], ['Session index', a.authn && a.authn.sessionIndex], ['Auth method', a.authn && a.authn.context && a.authn.context.split(':').pop()],
      ]}
      />
      {a.attributes.length > 0 && (
        <>
          <h5>Attributes <span className="dim">· {a.attributes.length}</span></h5>
          <table className="tbl saml-attrs">
            <thead><tr><th>Name</th><th>Value{a.attributes.some((x) => x.values.length > 1) ? 's' : ''}</th></tr></thead>
            <tbody>
              {a.attributes.map((x, i) => (
                <tr key={`${x.name}-${i}`}>
                  <td title={x.name}><span className="ellipsis">{x.friendlyName || x.name.split(/[/:]/).pop()}</span>{x.friendlyName && <small className="dim"> {x.name.split(/[/:]/).pop()}</small>}</td>
                  <td className="mono">{x.values.length ? x.values.join(', ') : <span className="dim">(empty)</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {a.signature && (
        <>
          <h5>Assertion signature</h5>
          <KV rows={[['Algorithm', a.signature.signatureMethod.split('#').pop()], ['Digest', a.signature.digestMethod.split('#').pop()], ['Signs', a.signature.referenceUri]]} />
          <Cert sig={a.signature} fp={a.signature.certificate && fps[a.signature.certificate.base64]} />
        </>
      )}
    </div>
  )
}


const VTONE = { valid: 'good', invalid: 'crit', refused: 'crit', error: 'warn', 'no-key': 'info' }

/** Check a message's signature against a certificate the user pastes (the identity provider's, from its metadata). */
function VerifyBox({ xml, cert, setCert }) {
  const n = useMemo(() => countSignatures(xml), [xml])
  const [which, setWhich] = useState(0)
  const [result, setResult] = useState(null)
  useEffect(() => {
    let live = true
    if (!n) { Promise.resolve().then(() => { if (live) setResult(null) }); return () => { live = false } }
    verifyXmlSignature(xml, cert, { which }).then((r) => { if (live) setResult(r) })
    return () => { live = false }
  }, [xml, cert, which, n])
  if (!n) return <Notice tone="warn" icon={faTriangleExclamation}>This message is not signed, so there is nothing to verify. Most service providers require the response or its assertion to be signed.</Notice>
  return (
    <div className="saml-sec">
      <h4>Verify the signature</h4>
      <p className="hint" style={{ marginTop: 0 }}>Paste the identity provider&rsquo;s <b>signing certificate</b> (from its metadata, or the one it gave you). Without it, only the certificate carried inside the message is used, which shows the message is consistent but not who signed it. Checked in your browser; nothing is sent.</p>
      {n > 1 && <Segmented size="s" label="Signature" value={String(which)} onChange={(v) => setWhich(Number(v))} options={Array.from({ length: n }, (_, i) => ({ value: String(i), label: `Signature ${i + 1} of ${n}` }))} />}
      <textarea className="saml-paste" rows={4} value={cert} spellCheck={false} onChange={(e) => setCert(e.target.value)} placeholder={'-----BEGIN CERTIFICATE-----\n…\n-----END CERTIFICATE-----'} aria-label="Identity provider certificate" />
      {result && (
        <div className={`verdict verdict-${VTONE[result.status]}`} role="status">
          <b><FontAwesomeIcon icon={faSignature} /> {result.title}</b>
          {result.detail && <p>{result.detail}</p>}
          {result.signed && <p className="dim">Signed: {result.signed}</p>}
          {(result.weak || []).map((w) => <p key={w} className="tone-warn">{w}</p>)}
        </div>
      )}
    </div>
  )
}

function Detail({ item, parsed, link, fps, now, expect, notify, cert, setCert }) {
  const checks = useMemo(() => [...checkMessage(parsed, { now, expect, fingerprints: fps }), ...checkAttributes(parsed, { expect })].sort((a, b) => ['critical', 'warning', 'info', 'ok'].indexOf(a.severity) - ['critical', 'warning', 'info', 'ok'].indexOf(b.severity)), [parsed, now, expect, fps])
  const [tab, setTab] = useState('summary')
  const p = parsed
  const linked = link && link.request
  const counts = { critical: 0, warning: 0 }
  for (const f of checks) if (f.severity in counts) counts[f.severity]++

  return (
    <div className="saml-detail">
      {item.steps && <p className="hint saml-steps">Decoded: {item.steps.join(' → ')}</p>}
      <Segmented size="s" label="View" value={tab} onChange={setTab} options={[
        { value: 'summary', label: 'Summary' }, { value: 'verify', label: 'Verify signature' }, { value: 'checks', label: `Checks${counts.critical ? ` · ${counts.critical} critical` : counts.warning ? ` · ${counts.warning} to look at` : ''}` }, { value: 'xml', label: 'XML' },
      ]}
      />
      {tab === 'summary' && (
        <>
          <KV rows={[
            ['Type', TITLE[p.type] || p.type], ['ID', p.id], ['Issuer', p.issuer], ['Sent to', p.destination], ['Issued', fmtTime(p.issueInstant)],
            ['Answers request', p.inResponseTo && (linked ? `${p.inResponseTo} (${link.ms != null ? `sent ${fmtMs(link.ms)} earlier in this capture` : 'its request is in this capture'})` : `${p.inResponseTo} (request not in this capture)`)], ['RelayState', item.relayState],
          ]}
          />
          {p.request && p.type === 'AuthnRequest' && (
            <div className="saml-sec">
              <h4>Request</h4>
              <KV rows={[
                ['ACS URL', p.request.acsUrl], ['Binding wanted', p.request.protocolBinding && p.request.protocolBinding.split(':').pop()], ['NameID format', p.request.nameIdPolicy && p.request.nameIdPolicy.formatName],
                ['Auth context', p.request.authnContext && p.request.authnContext.classRefs.map((x) => x.split(':').pop()).join(', ')], ['Force re-login', p.request.forceAuthn && 'yes'], ['Passive (no UI)', p.request.isPassive && 'yes'], ['Provider name', p.request.providerName],
              ]}
              />
            </div>
          )}
          {p.request && p.type === 'LogoutRequest' && (
            <div className="saml-sec">
              <h4>Logout</h4>
              <KV rows={[['User (NameID)', p.request.nameId && p.request.nameId.value], ['Session indexes', p.request.sessionIndexes.join(', ')], ['Reason', p.request.reason && p.request.reason.split(':').pop()]]} />
            </div>
          )}
          {p.status && (
            <div className="saml-sec">
              <h4>Status</h4>
              <KV rows={[['Result', p.status.success ? 'Success' : `${p.status.codeName}${p.status.subCodeName ? ` / ${p.status.subCodeName}` : ''}`], ['Meaning', p.status.meaning], ['Message', p.status.message], ['Detail', p.status.detail]]} />
            </div>
          )}
          {p.signature && (
            <div className="saml-sec">
              <h4>Message signature</h4>
              <KV rows={[['Algorithm', p.signature.signatureMethod.split('#').pop()], ['Digest', p.signature.digestMethod.split('#').pop()], ['Signs', p.signature.referenceUri]]} />
              <Cert sig={p.signature} fp={p.signature.certificate && fps[p.signature.certificate.base64]} />
            </div>
          )}
          {p.encryptedAssertions > 0 && <Notice icon={faCircleInfo}>{p.encryptedAssertions} encrypted assertion{p.encryptedAssertions === 1 ? '' : 's'}: the user and attributes are encrypted for the service provider, so they cannot be shown here.</Notice>}
          {(p.assertions || []).map((a, i) => <Assertion key={a.id || i} a={a} index={i} total={p.assertions.length} fps={fps} />)}
        </>
      )}
      {tab === 'checks' && (
        <>
          <p className="hint" style={{ marginTop: 0 }}>
            Validity windows are checked as of {fmtTime(new Date(now).toISOString())}.{' '}
            {item.atIssued ? (now === item.at ? '' : 'A SAML-tracer export records no time for each request, so this is one second after the time the message says it was issued. The switch under the list checks against the current time instead.') : item.at == null ? 'A pasted message has no capture time, so it is checked against the current time.' : now === item.at ? 'That is when this message was captured. The switch under the list checks against the current time instead.' : 'That is the current time, not when the message was captured. The switch under the list changes it.'}
          </p>
          <ul className="saml-checks">{checks.map((f, i) => <Check key={i} f={f} />)}</ul>
        </>
      )}
      {tab === 'verify' && <VerifyBox xml={item.xml} cert={cert} setCert={setCert} />}
      {tab === 'xml' && (
        <>
          <div className="toolrow">
            <button type="button" className="btn sm" onClick={async () => notify?.((await copyText(p.xml)) ? 'XML copied' : 'Copy failed')}><FontAwesomeIcon icon={faCopy} /> <span>Copy XML</span></button>
          </div>
          <pre className="saml-xml" tabIndex={0}>{p.xml}</pre>
        </>
      )}
    </div>
  )
}

function TraceCard({ t, setOpen }) {
  const shown = t.requests.length > 400 ? t.requests.filter((r) => r.saml) : t.requests
  return (
    <Card title={`${t.name}`} aside={<span className="t-cap">SAML-tracer export · {t.total} request{t.total === 1 ? '' : 's'} · {t.items.length} with SAML</span>}>
      <KV rows={[['Exported', t.exportedAt && fmtTime(t.exportedAt)], ['Format', t.legacy ? 'older export (before v1.0.0)' : 'current']]} />
      {t.masked && (
        <Notice tone={t.maskedButDecoded ? 'info' : 'warn'} icon={faTriangleExclamation}>
          {t.maskedButDecoded
            ? 'This export was made with a cookie profile that masks form values, but SAML-tracer kept the decoded messages, so they can still be read. Treat the file as sensitive.'
            : 'This export was made with a cookie profile that masks form values, so the SAML messages in it are not readable. Export again with “no filtering”.'}
        </Notice>
      )}
      {!t.items.length && <p className="dim">No SAML messages in this export. SAML-tracer only records what happened while it was open: reproduce the whole sign-in with the tracer window open, then export.</p>}
      {t.requests.length > 0 && (
        <>
          <h4 className="saml-seq-h">Request sequence{shown.length < t.requests.length ? ` (showing the ${shown.length} with SAML of ${t.requests.length})` : ''}</h4>
          <ol className="saml-seq">
            {shown.map((r) => (
              <li key={r.n} className={r.saml ? 'has' : ''}>
                <span className="num dim">{r.n}</span>
                <span className="mono dim">{r.method}</span>
                <span className="ellipsis" title={`${r.host}${r.path}`}>{r.host}{r.path}</span>
                <span className={`num ${r.status >= 400 || r.status === 0 ? 'tone-crit' : 'dim'}`}>{r.status || '—'}</span>
                {r.saml ? <button type="button" className="pill pill-btn" onClick={() => setOpen(r.itemId)}><FontAwesomeIcon icon={faKey} /> {r.kind}</button> : <span />}
              </li>
            ))}
          </ol>
        </>
      )}
    </Card>
  )
}

export default function Saml({ har, traces = [], pasted, setPasted, onFiles, toast: notify }) {
  const [found, setFound] = useState(null) // null while scanning
  const [text, setText] = useState('')
  const [err, setErr] = useState('')
  const [open, setOpen] = useState('')
  // Validity is checked as of the moment each message was captured (a message is only ever valid at that time: a capture opened
  // tomorrow would otherwise look expired). Pasted messages have no capture time and are checked against now.
  const [atCapture, setAtCapture] = useState(true)
  const [loadedAt] = useState(() => Date.now()) // one fixed 'now' for the page, so the checks do not change while it is open
  const [expectIn, setExpect] = useState({ audience: '', acs: '', fingerprint: '', attributesText: '' })
  const expect = useMemo(() => ({ ...expectIn, attributes: expectIn.attributesText.split(/[\s,]+/).filter(Boolean) }), [expectIn])
  const [fps, setFps] = useState({})
  const [cert, setCert] = useState('') // the identity provider's certificate, pasted once and used to verify every message

  // scan the loaded capture whenever it changes
  useEffect(() => {
    let live = true
    if (!har) { Promise.resolve().then(() => { if (live) setFound([]) }); return () => { live = false } }
    extractSaml(har).then((r) => { if (live) { setFound(r); setOpen('') } })
    return () => { live = false }
  }, [har])

  const traceItems = useMemo(() => traces.flatMap((t) => t.items), [traces])
  const items = useMemo(() => {
    const all = [...(found || []), ...traceItems, ...pasted]
    return all.map((it) => ({ ...it, parsed: it.xml ? parseSamlXml(it.xml) : null }))
  }, [found, traceItems, pasted])
  const links = useMemo(() => linkExchange(items.filter((i) => i.parsed && !i.parsed.error && i.entry)), [items])
  const flow = useMemo(() => analyzeFlow(items), [items])

  // certificate fingerprints are computed once per certificate, for the details and the "expected fingerprint" check
  useEffect(() => {
    let live = true
    const certs = new Set()
    for (const it of items) {
      const p = it.parsed
      if (!p || p.error) continue
      if (p.signature && p.signature.certificate && p.signature.certificate.der) certs.add(p.signature.certificate)
      for (const a of p.assertions || []) if (a.signature && a.signature.certificate && a.signature.certificate.der) certs.add(a.signature.certificate)
    }
    Promise.all([...certs].map(async (c) => [c.base64, await fingerprints(c.der)])).then((pairs) => { if (live) setFps(Object.fromEntries(pairs.filter(([, v]) => v))) })
    return () => { live = false }
  }, [items])

  const submit = useCallback(async () => {
    const r = await fromPasted(text)
    if (r.error) { setErr(r.error); return }
    setErr('')
    setPasted((p) => [r, ...p])
    setOpen(r.id)
    setText('')
  }, [text, setPasted])
  const paste = async () => {
    try { setText(await navigator.clipboard.readText()) } catch { setErr('The browser did not allow reading the clipboard. Paste into the box with Ctrl/Cmd+V instead.') }
  }

  // - a HAR records when each request happened, so that is the time to check against;
  // - a SAML-tracer export records no time per request, so the best available is the moment the message says it was issued
  //   (a message is then never "expired" merely because the file is old; it is still flagged if its own window is wrong);
  // - a pasted message has neither, and is checked against now.
  const issuedAt = (it) => {
    const p = it.parsed
    const t = p && !p.error ? Date.parse(p.issueInstant || (p.assertions && p.assertions[0] && p.assertions[0].issueInstant) || '') : NaN
    return Number.isFinite(t) ? t + 1000 : null
  }
  const asOf = (it) => {
    if (!atCapture) return loadedAt
    if (it.at != null) return it.at
    if (it.atIssued) return issuedAt(it) ?? loadedAt
    return loadedAt
  }

  const exportMd = () => {
    const lines = ['## SAML messages', '']
    for (const it of items) {
      const p = it.parsed
      lines.push(`### ${TITLE[p && p.type] || 'Message'} (${it.hit.param}${it.entry ? `, ${it.entry.method} ${it.entry.host}${it.entry.path}` : ''})`)
      if (!p || p.error) { lines.push(`- Could not be read: ${(p && p.error) || it.error}`, ''); continue }
      lines.push(`- Issuer: ${p.issuer || '—'}`, `- ID: ${p.id}`, p.status ? `- Status: ${p.status.success ? 'Success' : `${p.status.codeName}${p.status.subCodeName ? ` / ${p.status.subCodeName}` : ''}`}` : '')
      for (const f of checkMessage(p, { now: asOf(it), expect, fingerprints: fps }).filter((x) => x.severity === 'critical' || x.severity === 'warning')) lines.push(`- ${WORD[f.severity]}: ${f.title}`)
      lines.push('')
    }
    download('saml-messages.md', `${lines.filter((l) => l !== '').join('\n')}\n`, 'text/markdown')
    notify?.('SAML summary downloaded')
  }

  const scanning = found === null
  const tracePicker = usePicker((files) => onFiles?.(files))

  return (
    <div className="stack">
      {har && (
        <section className="saml-capture" aria-label="SAML in the loaded capture">
          <div className="toolrow">
            <h2 className="t-title saml-h">{scanning ? 'Scanning the capture…' : (found || []).length ? `${(found || []).length} SAML message${(found || []).length === 1 ? '' : 's'} in ${har.fileName}` : `No SAML found in ${har.fileName}`}</h2>
            <span className="grow" />
            {items.length > 0 && <button type="button" className="btn sm" onClick={exportMd}><FontAwesomeIcon icon={faDownload} /> <span>Download summary</span></button>}
          </div>
          {scanning && <p className="dim">Looking through {har.entries.length.toLocaleString('en-US')} requests…</p>}
          {!scanning && !(found || []).length && <p className="dim">SAML travels as a <span className="mono">SAMLRequest</span> or <span className="mono">SAMLResponse</span> field in a redirect or a form post. If you expected one, check that the capture covers the whole sign-in and was taken with &ldquo;Preserve log&rdquo; on, because the redirects happen across page loads.</p>}
        </section>
      )}

      <div className="saml-list">
        {items.map((it) => {
          const p = it.parsed
          const bad = !p || p.error
          const isOpen = open === it.id
          const checks = !bad && isOpen ? [...checkMessage(p, { now: asOf(it), expect, fingerprints: fps }), ...checkAttributes(p, { expect })] : null
          const worst = checks ? (checks.find((f) => f.severity === 'critical') ? 'critical' : checks.find((f) => f.severity === 'warning') ? 'warning' : 'ok') : null
          const status = !bad && p.status ? (p.status.success ? 'Success' : p.status.subCodeName || p.status.codeName) : ''
          return (
            <article key={it.id} className={`finding saml-item${isOpen ? ' open' : ''} sev-${bad ? 'crit' : p.status && !p.status.success ? 'crit' : 'info'}`}>
              <button type="button" className="f-head" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? '' : it.id)}>
                <FontAwesomeIcon icon={bad ? faCircleExclamation : faKey} className={`f-ic tone-${bad ? 'crit' : 'info'}`} />
                <span className="f-title">{bad ? 'Could not be read' : TITLE[p.type] || p.type}<span className="dim saml-sub"> · {it.hit.param}{it.entry ? ` · ${it.entry.method} ${it.entry.host}` : ' · pasted'}{it.source === 'tracer' ? ` · #${it.seq}` : ''}</span></span>
                <span className="f-meta">
                  {status && <span className={`sev tone-${p.status.success ? 'good' : 'crit'}`}>{status}</span>}
                  {it.entry && Number.isFinite(it.entry.startMs) && <span className="dim num">{fmtMs(it.entry.startMs)}</span>}
                </span>
                <FontAwesomeIcon icon={faArrowRight} className="f-chev" />
              </button>
              <div className="f-collapse" data-open={isOpen}>
                <div className="f-inner">
                  {bad ? <Notice tone="crit" icon={faTriangleExclamation}>{(p && p.error) || it.error}</Notice>
                    : isOpen && <Detail item={it} parsed={p} link={links.get(it.id)} fps={fps} now={asOf(it)} expect={expect} notify={notify} cert={cert} setCert={setCert} />}
                </div>
              </div>
              {worst && <span className="vh">{worst}</span>}
            </article>
          )
        })}
      </div>



      {(flow.flow !== 'unknown' || flow.checks.length > 0 || flow.provider) && (
        <Card title="The sign-in as a whole" aside={<span className="t-cap">{flow.flow === 'sp' ? 'Started at the application (SP-initiated)' : flow.flow === 'idp' ? 'Started at the identity provider (IdP-initiated)' : ''}</span>}>
          {flow.checks.length > 0 && <CheckList checks={flow.checks} />}
          {flow.provider && (
            <div className="saml-sec">
              <h4>Looks like {flow.provider.name}</h4>
              <ul className="bullets">{flow.provider.tips.map((x) => <li key={x}>{x}</li>)}</ul>
              <p className="hint">Guessed from the issuer ({flow.provider.issuer}). These are the usual causes for this provider, not findings about your trace.</p>
            </div>
          )}
        </Card>
      )}
      {!har && !traces.length && !pasted.length && <EmptyState icon={faKey} title="No capture loaded">Open a HAR file or a SAML-tracer export, or paste a message below.</EmptyState>}

      <Card title="SAML-tracer export" aside={<FontAwesomeIcon icon={faFileImport} className="dim" />}>
        <p className="lede">If you recorded the sign-in with the <b>SAML-tracer</b> browser extension, use its Export button and add the JSON file here (or drop it anywhere on the page). It is analysed the same way as a HAR.</p>
        <div className="actions">
          <button type="button" className="btn primary" onClick={tracePicker.open}><FontAwesomeIcon icon={faFileImport} /> Add a SAML-tracer export</button>
        </div>
        {tracePicker.input}
        <p className="hint">In SAML-tracer: open the extension, reproduce the sign-in, click <b>Export</b>, choose a cookie profile, and save. Choosing the profile that masks form values hides the messages: use &ldquo;no filtering&rdquo; for the analysis, and remove secrets afterwards.</p>
      </Card>

      {traces.map((t) => <TraceCard key={t.uid} t={t} setOpen={setOpen} />)}

      <Card title="Paste a SAML message" aside={<FontAwesomeIcon icon={faKey} className="dim" />}>
        <p className="lede">Paste a SAMLRequest or SAMLResponse value, a whole URL or form body that contains one, or the XML itself. It is decoded here in your browser, and nothing is sent anywhere.</p>
        <textarea className="saml-paste" rows={4} value={text} spellCheck={false} onChange={(e) => { setText(e.target.value); setErr('') }} placeholder="PHNhbWxwOlJlc3BvbnNlIHhtbG5zOnNhbWxwPSJ1cm46b2FzaXM6bmFtZXM6dGM6U0FNTDoyLjA6cHJvdG9jb2wi…" aria-label="SAML message to decode" />
        {err && <Notice tone="crit" icon={faTriangleExclamation} onDismiss={() => setErr('')}>{err}</Notice>}
        <div className="actions">
          <button type="button" className="btn primary" disabled={!text.trim()} onClick={submit}><FontAwesomeIcon icon={faWandMagicSparkles} /> Decode</button>
          <button type="button" className="btn" onClick={paste}><FontAwesomeIcon icon={faClipboard} /> Paste from clipboard</button>
        </div>
      </Card>

      <Card title="Check against what you expect" aside={<span className="t-cap">optional</span>}>
        <div className="saml-expect">
          <label>Your SP entity ID (the audience)<input type="text" value={expectIn.audience} onChange={(e) => setExpect({ ...expectIn, audience: e.target.value })} placeholder="https://sp.example.com/metadata" spellCheck={false} /></label>
          <label>Your ACS URL<input type="text" value={expectIn.acs} onChange={(e) => setExpect({ ...expectIn, acs: e.target.value })} placeholder="https://sp.example.com/acs" spellCheck={false} /></label>
          <label>IdP certificate fingerprint<input type="text" value={expectIn.fingerprint} onChange={(e) => setExpect({ ...expectIn, fingerprint: e.target.value })} placeholder="SHA-256 or SHA-1, with or without colons" spellCheck={false} /></label>
          <label>Attributes your SP needs<input type="text" value={expectIn.attributesText} onChange={(e) => setExpect({ ...expectIn, attributesText: e.target.value })} placeholder="mail, department, groups" spellCheck={false} /></label>
        </div>
        <p className="hint">The checks cannot know your configuration. Enter these to find a mismatch with it, the usual cause of "audience restriction failed" and "invalid signature" errors.</p>
      </Card>

      {items.length > 0 && (
        <Card>
          <div className="toolrow">
            <Switch checked={atCapture} onChange={setAtCapture} label="Check as of the time of the capture" hint="On (default): validity is checked when each message was sent (for a SAML-tracer export, which records no times, when the message says it was issued). Off: against now, so an old capture looks expired." />
          </div>
        </Card>
      )}
      <p className="hint">This reads the message; it cannot prove a signature is valid, because that needs the identity provider&rsquo;s key. Treat the checks as leads, and confirm in the IdP and SP logs.</p>
    </div>
  )
}
