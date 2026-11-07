import { useMemo, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCookieBite } from '@fortawesome/free-solid-svg-icons'
import { analyzeCookies, cookieBudget, sessionLifetimes } from '../auth/cookies'
import { PROFILES, PROFILES_CHECKED, thirdPartyDependencies } from '../auth/browsers'
import { CheckList } from './authui'
import { toneOf, worstOf, wordOf } from './severity'
import { Card, EmptyState, Notice, Segmented } from './ui'

const STATE = { stored: 'Stored', rejected: 'Rejected', deleted: 'Deleted', earlier: 'Set before the capture' }
const STATE_TONE = { stored: 'good', rejected: 'crit', deleted: 'info', earlier: 'info' }

function Empty({ result, har }) {
  if (result.stats.sanitized) {
    return (
      <Notice tone="warn">
        No cookies at all in {har.fileName}. Chrome&rsquo;s default &ldquo;Save all as HAR&rdquo; <b>removes cookies</b> (it is called sanitizing). In DevTools, Network tab, use <b>Save all as HAR with sensitive data</b> to keep them, then treat the file as secret. Cookies can also be missing when the capture was scrubbed.
      </Notice>
    )
  }
  return null
}

function attrText(a) {
  if (!a) return '—'
  const bits = []
  if (a.secure) bits.push('Secure')
  if (a.httpOnly) bits.push('HttpOnly')
  bits.push(a.sameSite ? `SameSite=${a.sameSite[0].toUpperCase()}${a.sameSite.slice(1)}` : 'no SameSite')
  if (a.partitioned) bits.push('Partitioned')
  return bits.join(' · ')
}

/** /cookies/all */
export function CookiesAll({ har }) {
  const result = useMemo(() => (har ? analyzeCookies(har) : null), [har])
  const [show, setShow] = useState('all')
  const [open, setOpen] = useState('')
  if (!har) return <EmptyState icon={faCookieBite} title="No capture loaded">Open a HAR file to see the cookies in it.</EmptyState>
  const list = result.cookies.filter((c) => show === 'all' || (show === 'problems' ? c.checks.some((k) => k.severity === 'critical' || k.severity === 'warning') || c.state === 'rejected' : c.state === show))
  return (
    <div className="stack">
      <section className="saml-capture" aria-label="Cookies in the loaded capture">
        <div className="toolrow">
          <h2 className="t-title saml-h">{result.cookies.length ? `${result.cookies.length} cookie${result.cookies.length === 1 ? '' : 's'} in ${har.fileName}` : `No cookies in ${har.fileName}`}</h2>
          <span className="grow" />
          {result.cookies.length > 0 && <Segmented size="s" label="Show" value={show} onChange={setShow} options={[{ value: 'all', label: 'All' }, { value: 'problems', label: 'With problems' }, { value: 'rejected', label: 'Rejected' }]} />}
        </div>
      </section>
      <Empty result={result} har={har} />
      {result.stats.suppressedMissed && <Notice tone="info">Cookies were set but no request in this capture sent any back. That usually means the capture removed the Cookie headers, so this page does not report cookies as &ldquo;not sent&rdquo;.</Notice>}
      <div className="saml-list">
        {list.map((c) => {
          const worst = c.checks.length ? worstOf(c.checks) : 'ok'
          const isOpen = open === c.key
          return (
            <article key={c.key} className={`finding saml-item${isOpen ? ' open' : ''} sev-${worst === 'ok' ? 'info' : toneOf(worst)}`}>
              <button type="button" className="f-head" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? '' : c.key)}>
                <FontAwesomeIcon icon={faCookieBite} className={`f-ic tone-${worst === 'ok' ? STATE_TONE[c.state] : toneOf(worst)}`} />
                <span className="f-title"><span className="mono">{c.name || '(no name)'}</span><span className="dim saml-sub"> · {c.domain}{c.path}{c.hostOnly ? '' : ' (and subdomains)'}</span></span>
                <span className="f-meta">
                  <span className={`sev tone-${STATE_TONE[c.state]}`}>{STATE[c.state]}</span>
                  <span className="dim num">set {c.sets.length}× · sent {c.sends.length}×</span>
                </span>
              </button>
              <div className="f-collapse" data-open={isOpen}>
                <div className="f-inner">
                  {isOpen && (
                    <div className="saml-detail">
                      <dl className="kvlist saml-kv">
                        <div><dt>Flags</dt><dd>{attrText(c.attrs)}</dd></div>
                        <div><dt>Scope</dt><dd>{c.domain}{c.path} {c.hostOnly ? '(this host only)' : '(this domain and its subdomains)'}</dd></div>
                        <div><dt>Set by</dt><dd>{c.sets.length ? [...new Set(c.sets.map((s) => s.host))].join(', ') : '—'}</dd></div>
                        <div><dt>Sent to</dt><dd>{c.sends.length ? [...new Set(c.sends.map((s) => s.host))].join(', ') : 'never, in this capture'}</dd></div>
                      </dl>
                      {c.checks.length > 0 && <div className="saml-sec"><h4>Problems</h4><CheckList checks={c.checks} /></div>}
                      {c.sets.length > 0 && <div className="saml-sec"><h4>Set-Cookie</h4><pre className="saml-xml" tabIndex={0}>{c.sets.map((s) => s.raw.replace(/^([^=]+=)([^;]{24})[^;]*/, '$1$2…')).join('\n')}</pre></div>}
                    </div>
                  )}
                </div>
              </div>
            </article>
          )
        })}
      </div>
      <p className="hint">Values are shortened. The browser&rsquo;s own settings (blocking third-party cookies, Safari and Firefox tracking protection, extensions) are not in a HAR, so a cookie that should have been sent and was not may have been blocked by one of them.</p>
    </div>
  )
}

/** /cookies/issues: every problem across all cookies, worst first. */
export function CookiesProblems({ har }) {
  const result = useMemo(() => (har ? analyzeCookies(har) : null), [har])
  if (!har) return <EmptyState icon={faCookieBite} title="No capture loaded">Open a HAR file to check its cookies.</EmptyState>
  const probs = result.problems
  return (
    <div className="stack">
      <section className="saml-capture" aria-label="Cookie problems">
        <h2 className="t-title saml-h">{probs.length ? `${probs.length} cookie problem${probs.length === 1 ? '' : 's'} in ${har.fileName}` : `No cookie problems found in ${har.fileName}`}</h2>
      </section>
      <Empty result={result} har={har} />
      {result.stats.suppressedMissed && <Notice tone="info">Cookies were set but none was ever sent back in this capture, so &ldquo;not sent&rdquo; problems cannot be judged. Re-capture with sensitive data included.</Notice>}
      {probs.length > 0 && (
        <Card>
          <ul className="saml-checks">
            {probs.map((p, i) => (
              <li key={i} className={`saml-check sev-${toneOf(p.severity)}`}>
                <FontAwesomeIcon icon={faCookieBite} className={`tone-${toneOf(p.severity)}`} />
                <div>
                  <b>{p.title}</b>
                  <p><span className="mono">{p.cookie}</span> on {p.domain}{p.count > 1 ? ` · ${p.count} requests` : ''}</p>
                  {p.detail && <p>{p.detail}</p>}
                  {p.fix && <p className="fix"><span className="dim">Fix:</span> {p.fix}</p>}
                </div>
                <span className={`sev tone-${toneOf(p.severity)}`}>{wordOf(p.severity)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {!probs.length && result.stats.hasAny && !result.stats.suppressedMissed && <Card><p className="dim" style={{ margin: 0 }}>Every cookie that was set was accepted by the rules checked here, and every one that should have been sent was sent.</p></Card>}
    </div>
  )
}

const OUT_TONE = { works: 'good', partitioned: 'warn', blocked: 'crit' }
const OUT_TEXT = { works: 'Works', partitioned: 'Partitioned', blocked: 'Blocked' }

/** /cookies/browsers: how the same capture behaves in each browser's third-party cookie policy. */
export function CookiesBrowsers({ har }) {
  const result = useMemo(() => (har ? analyzeCookies(har) : null), [har])
  const deps = useMemo(() => (result ? thirdPartyDependencies(result) : []), [result])
  if (!har) return <EmptyState icon={faCookieBite} title="No capture loaded">Open a HAR file to see how its cookies behave in each browser.</EmptyState>
  return (
    <div className="stack">
      <section className="saml-capture"><h2 className="t-title saml-h">{deps.length ? `${deps.length} cookie${deps.length === 1 ? '' : 's'} depend on being a third party in ${har.fileName}` : `No third-party cookies in ${har.fileName}`}</h2>
        {!deps.length && <p className="dim">Every cookie in this capture was set by the site the user was on, so the browsers&rsquo; third-party rules do not apply. (A cookie set inside an embedded frame or by a cross-site request would show here.)</p>}
      </section>
      {deps.map((d) => (
        <Card key={`${d.name}-${d.domain}`} title={d.name} aside={<span className="t-cap">{d.domain}</span>}>
          {d.breaksIn.length > 0 && <Notice tone="crit">This cookie stops working in: {d.breaksIn.join(', ')}. Anything that relies on it (a sign-in, a session, a consent choice) fails there.</Notice>}
          <table className="tbl saml-attrs"><thead><tr><th>Browser</th><th>Result</th><th>Why</th></tr></thead>
            <tbody>{d.outcomes.map((o) => <tr key={o.id}><td>{o.label}</td><td><span className={`sev tone-${OUT_TONE[o.outcome]}`}>{OUT_TEXT[o.outcome]}</span></td><td>{o.detail}</td></tr>)}</tbody></table>
        </Card>
      ))}
      <Card title="The rules used" aside={<span className="t-cap">checked {PROFILES_CHECKED}</span>}>
        <ul className="bullets">{PROFILES.map((p) => <li key={p.id}><b>{p.label}.</b> {p.note}</li>)}</ul>
        <p className="hint">Browser policy changes often, and users and companies change the defaults. Treat this as a prompt to test in the browsers that matter to you, not as a guarantee.</p>
      </Card>
    </div>
  )
}

const fmtLife = (ms) => { const s = Math.round(ms / 1000); return s < 120 ? `${s} seconds` : s < 7200 ? `${Math.round(s / 60)} minutes` : s < 172800 ? `${(s / 3600).toFixed(1)} hours` : `${Math.round(s / 86400)} days` }

/** /cookies/size: the Cookie header per host, which cookies fill it, and the session cookies' lifetimes. */
export function CookiesSize({ har }) {
  const budget = useMemo(() => (har ? cookieBudget(har) : []), [har])
  const sessions = useMemo(() => (har ? sessionLifetimes(analyzeCookies(har)) : []), [har])
  if (!har) return <EmptyState icon={faCookieBite} title="No capture loaded">Open a HAR file to see how much cookie data each request carries.</EmptyState>
  return (
    <div className="stack">
      <section className="saml-capture"><h2 className="t-title saml-h">{budget.length ? `Cookie headers sent to ${budget.length} host${budget.length === 1 ? '' : 's'}` : `No Cookie headers in ${har.fileName}`}</h2></section>
      {budget.map((b) => (
        <Card key={b.host} title={b.host} aside={<span className={`sev tone-${b.status === 'ok' ? 'good' : toneOf(b.status)}`}>{(b.maxBytes / 1024).toFixed(1)} KB · {b.count} cookies</span>}>
          {b.status === 'critical' && <Notice tone="crit">{b.rejectedWith.length ? `The server answered ${b.rejectedWith.join(' / ')} (header too large). ` : ''}The Cookie header is {(b.maxBytes / 1024).toFixed(1)} KB. Most servers refuse headers over about 8 KB, with 400, 413 or 431 or just by closing the connection. Remove cookies that are no longer needed, shrink the large ones, and scope the rest to the paths that need them.</Notice>}
          {b.status === 'warning' && <Notice tone="warn">{(b.maxBytes / 1024).toFixed(1)} KB is getting large. Some servers and proxies limit headers to 4 KB.</Notice>}
          <table className="tbl saml-attrs"><thead><tr><th>Cookie</th><th>Size</th><th>Share</th></tr></thead>
            <tbody>{b.cookies.slice(0, 10).map((c) => <tr key={c.name}><td className="mono">{c.name}</td><td>{c.bytes} B</td><td><span className="bar-inline"><i style={{ width: `${Math.max(2, Math.round(c.share * 100))}%` }} /></span> {Math.round(c.share * 100)}%</td></tr>)}</tbody></table>
        </Card>
      ))}
      <Card title="Session cookies and how long they last">
        {!sessions.length && <p className="dim" style={{ margin: 0 }}>No session-looking cookie was set in this capture.</p>}
        {sessions.map((s) => <KVRow key={`${s.name}${s.domain}`} s={s} />)}
        <p className="hint">&ldquo;Sliding&rdquo; means the server sets the cookie again as the user works, so it expires after a period of inactivity. &ldquo;Absolute&rdquo; means it expires at a fixed time after sign-in, however active the user is.</p>
      </Card>
    </div>
  )
}

function KVRow({ s }) {
  return (
    <div className="saml-sec">
      <h4><span className="mono">{s.name}</span> <span className="dim">· {s.domain}</span></h4>
      <p style={{ margin: 0 }}>{s.kind === 'session' ? 'Lasts until the browser is closed.' : `Lasts ${fmtLife(s.lifetimeMs)}.`} {s.note}</p>
    </div>
  )
}
