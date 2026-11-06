import { useMemo, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCookieBite } from '@fortawesome/free-solid-svg-icons'
import { analyzeCookies } from '../auth/cookies'
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
