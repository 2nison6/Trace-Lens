import { useEffect, useMemo, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCertificate } from '@fortawesome/free-solid-svg-icons'
import { checkCertificate, checkChain, fingerprints, orderChain, readCertificates, shortName } from '../../auth/certs'
import { CheckList, KV } from '../../components/shared/authui'
import { reportInputs } from '../../reports/store'
import { Card, Notice } from '../../components/shared/ui'
import { toneOf, worstOf, wordOf } from '../../components/shared/severity'

const day = (t) => new Date(t).toISOString().slice(0, 10)
const ROLE = (i, n, c) => (c.selfSigned && i === n - 1 ? 'root' : i === 0 ? 'leaf' : 'intermediate')

function CertCard({ c, role, host, now, fps }) {
  const checks = useMemo(() => checkCertificate(c, { now, role, host }), [c, now, role, host])
  const worst = worstOf(checks)
  const e = c.ext
  return (
    <Card title={shortName(c)} aside={<span className={`sev tone-${toneOf(worst)}`}>{role === 'leaf' ? 'Leaf' : role === 'root' ? 'Root' : 'Intermediate'} · {wordOf(worst)}</span>}>
      <CheckList checks={checks} />
      <KV rows={[
        ['Subject', c.subject], ['Issuer', c.selfSigned ? `${c.issuer} (self-signed)` : c.issuer], ['Valid', `${day(c.notBefore)} to ${day(c.notAfter)}`],
        ['Key', `${c.key.algorithm} ${c.key.curve || c.key.bits}${c.key.algorithm === 'RSA' ? ' bit' : ''}`], ['Signed with', c.signatureAlgorithm], ['Serial', c.serial],
        ['Names (SAN)', e && e.san.length ? e.san.map((s) => (s.type === 'DNS' ? s.value : `${s.type}:${s.value}`)).join(', ') : ''],
        ['Is a CA', e && e.basic ? (e.basic.ca ? `yes${e.basic.pathLen != null ? `, up to ${e.basic.pathLen} intermediate(s) below` : ''}` : 'no') : ''],
        ['Key usage', e && e.keyUsage.join(', ')], ['Extended key usage', e && e.extKeyUsage.join(', ')],
        ['SHA-256', fps[c.base64] && fps[c.base64].sha256], ['SHA-1', fps[c.base64] && fps[c.base64].sha1],
      ]}
      />
    </Card>
  )
}

/** /certs/inspect: paste certificates (a chain, a server's chain file, a SAML signing cert) and see what is wrong. */
export default function Certificates() {
  const [text, setText] = useState('')
  const [host, setHost] = useState('')
  const [now] = useState(() => Date.now())
  const [fps, setFps] = useState({})
  const read = useMemo(() => readCertificates(text), [text])
  const { chain, extra } = useMemo(() => orderChain(read.certs), [read])
  const broken = read.certs.filter((c) => c.error)
  const chainChecks = useMemo(() => (chain.length ? checkChain(chain, extra, { now }) : []), [chain, extra, now])
  useEffect(() => {
    let live = true
    Promise.all(read.certs.filter((c) => c.der).map(async (c) => [c.base64, await fingerprints(c.der)])).then((p) => { if (live) setFps(Object.fromEntries(p.filter(([, v]) => v))) })
    return () => { live = false }
  }, [read])
  useEffect(() => { reportInputs.set('certs', chain.length ? { chain, chainChecks, host, fps } : null) }, [chain, chainChecks, host, fps])
  return (
    <div className="stack">
      <Card title="Paste certificates" aside={<FontAwesomeIcon icon={faCertificate} className="dim" />}>
        <p className="lede">Paste one certificate or a whole chain (a server&rsquo;s <span className="mono">fullchain.pem</span>, the output of <span className="mono">openssl s_client -showcerts</span>, a SAML signing certificate, or just the base64 body). Order does not matter. Checked in your browser; nothing is sent.</p>
        <textarea className="saml-paste" rows={8} value={text} spellCheck={false} onChange={(e) => setText(e.target.value)} placeholder={'-----BEGIN CERTIFICATE-----\n…\n-----END CERTIFICATE-----'} aria-label="Certificates" />
        <div className="saml-expect" style={{ marginTop: 10 }}>
          <label>Hostname it should be valid for (optional)<input type="text" value={host} onChange={(e) => setHost(e.target.value)} placeholder="app.example.com" spellCheck={false} /></label>
        </div>
      </Card>
      {read.notes.map((n) => <Notice key={n} tone="warn">{n}</Notice>)}
      {broken.length > 0 && <Notice tone="crit">{broken.length} certificate{broken.length === 1 ? '' : 's'} could not be read: {broken[0].error}</Notice>}
      {chain.length > 0 && (
        <Card title={chain.length > 1 ? `Chain · ${chain.length} certificates` : 'The certificate'} aside={<span className="t-cap">{chain.map(shortName).join(' → ')}</span>}>
          <CheckList checks={chainChecks.length ? chainChecks : [{ severity: 'ok', title: 'Nothing to report about the chain', detail: '' }]} />
          <p className="hint">This checks that each certificate names the next as its issuer and that the dates, names and usages are in order. It does not check signatures between certificates, revocation, or whether your system trusts the root.</p>
        </Card>
      )}
      {chain.map((c, i) => <CertCard key={c.base64} c={c} role={ROLE(i, chain.length, c)} host={i === 0 ? host : ''} now={now} fps={fps} />)}
      {extra.length > 0 && <h3 className="t-title">Not part of the chain</h3>}
      {extra.map((c) => <CertCard key={c.base64} c={c} role="leaf" host="" now={now} fps={fps} />)}
    </div>
  )
}
