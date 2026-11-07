import { useContext, useMemo } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faArrowRight, faCircleCheck, faCircleExclamation, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons'
import { InspectCtx, ListCtx } from '../../app/context'
import {
  biggestWins, cachePolicy, concurrency, connectionSetup, criticalPath, endpoints, heaviest, latencyBuckets,
  optimizations, protocols, renderBlocking, thirdParty, vitals, withoutThirdParty,
} from '../../har/insights'
import { fmtBytes, fmtMs } from '../../lib/utils'
import Bars, { HoverTip } from './parts/Bars'
import { Card, EmptyState, StatusCode } from '../../components/shared/ui'

const PROTO_COLOR = { 'HTTP/3': 'var(--good-mark)', 'HTTP/2': 'var(--c-ssl)', 'HTTP/1.1': 'var(--warn)', 'HTTP/1.0': 'var(--crit-mark)' }
const CACHE_COLOR = ['var(--crit-mark)', 'var(--crit-mark)', 'var(--warn)', 'var(--c-ssl)', 'var(--good-mark)']
const RATING = { good: { icon: faCircleCheck, word: 'Good' }, warn: { icon: faTriangleExclamation, word: 'Needs work' }, bad: { icon: faCircleExclamation, word: 'Poor' } }
const byTime = (e) => e.time
const byBytes = (e) => e.transfer

export default function Insights({ har }) {
  const inspect = useContext(InspectCtx)
  const showList = useContext(ListCtx)
  const tp = useMemo(() => thirdParty(har), [har])
  const cp = useMemo(() => criticalPath(har), [har])
  const vit = useMemo(() => vitals(har), [har])
  const lat = useMemo(() => latencyBuckets(har), [har])
  const conc = useMemo(() => concurrency(har), [har])
  const heavy = useMemo(() => heaviest(har), [har])
  const eps = useMemo(() => endpoints(har), [har])
  const protos = useMemo(() => protocols(har), [har])
  const setup = useMemo(() => connectionSetup(har), [har])
  const cache = useMemo(() => cachePolicy(har), [har])
  const opts = useMemo(() => optimizations(har), [har])
  const block = useMemo(() => renderBlocking(har), [har])
  const wins = useMemo(() => biggestWins(har), [har])
  const noThird = useMemo(() => withoutThirdParty(har), [har])

  const totalBytes = tp.firstBytes + tp.thirdBytes || 1
  const share = (tp.thirdBytes / totalBytes) * 100
  const maxT = Math.max(1, ...tp.rows.map((r) => r.time))
  const savingTotal = opts.reduce((s, o) => s + o.saving, 0)
  const cacheCount = cache.reduce((s, g) => s + g.entries.length, 0)

  if (!har.entries.length) return <EmptyState title="Nothing to analyse">This capture has no requests.</EmptyState>

  return (
    <div className="page-grid">
      {wins.length > 0 && (
        <Card className="span-3" title="Biggest wins" aside={<span className="t-cap">estimated, largest first</span>}>
          <div className="wins">
            {wins.map((w, i) => (
              <button key={w.key} type="button" className="win" onClick={() => showList(w.title, w.entries)}>
                <span className="win-n">{i + 1}. {w.upTo ? 'up to' : 'about'} {fmtBytes(w.bytes)}</span>
                <b>{w.title}</b>
                <span className="dim">{w.note}</span>
                <span className="opt-n">{w.entries.length} request{w.entries.length === 1 ? '' : 's'} <FontAwesomeIcon icon={faArrowRight} /></span>
              </button>
            ))}
          </div>
          <p className="hint">Start here. These are the changes that would save the most data; the cards below show every estimate in full.</p>
        </Card>
      )}

      {vit && (
        <Card className="span-3" title="Timing estimates" aside={<span className="t-cap">estimated from HAR timings</span>}>
          <div className="vitals">
            {vit.map((v) => (
              <div key={v.key} className={`vital rate-${v.rating}`}>
                <span className="v-key">{v.key}</span>
                <span className="v-val">{fmtMs(v.value)}</span>
                <span className="v-rate"><FontAwesomeIcon icon={RATING[v.rating].icon} /> {RATING[v.rating].word}</span>
                <span className="v-note">{v.note}</span>
              </div>
            ))}
          </div>
          <p className="hint">These are estimates, not real Core Web Vitals. Confirm with Lighthouse or field data.</p>
        </Card>
      )}

      {opts.length > 0 && (
        <Card className="span-3" title="Potential savings" aside={<span className="t-cap">about {fmtBytes(savingTotal)} in total</span>}>
          <div className="opt-grid">
            {[...opts].sort((a, b) => b.saving - a.saving).map((o) => (
              <button key={o.key} type="button" className="opt" onClick={() => showList(o.title, o.entries)}>
                <span className="opt-save num">{fmtBytes(o.saving)}</span>
                <b>{o.title}</b>
                <span className="dim">{o.note}</span>
                <span className="opt-n">{o.entries.length} request{o.entries.length === 1 ? '' : 's'} <FontAwesomeIcon icon={faArrowRight} /></span>
              </button>
            ))}
          </div>
          <p className="hint">Estimates use typical ratios, not measurements, and some overlap.</p>
        </Card>
      )}

      <Card title="Response times">
        <Bars fmt={(v) => v} rows={lat.map((b) => ({ label: b.label, value: b.entries.length, color: b.color, entries: b.entries, rank: byTime, fmtRank: fmtMs }))} />
      </Card>

      <Card title="Protocols">
        <Bars fmt={(v) => v} rows={protos.map((p) => ({ label: p.label, value: p.entries.length, color: PROTO_COLOR[p.label] || 'var(--c-blocked)', entries: p.entries, rank: byTime, fmtRank: fmtMs }))} />
        <p className="hint">HTTP/1.x limits a browser to about 6 parallel connections per host.</p>
      </Card>

      <Card title="Cache lifetime" aside={<span className="t-cap">GET responses</span>}>
        {cacheCount
          ? <Bars fmt={(v) => v} rows={cache.map((g, i) => ({ label: g.label, value: g.entries.length, color: CACHE_COLOR[i], entries: g.entries, rank: byBytes, fmtRank: fmtBytes }))} />
          : <p className="dim">No cacheable GET responses.</p>}
        <p className="hint">Red means the browser can’t reuse the response, so repeat visits pay for it again.</p>
      </Card>

      <Card className="span-3" title="Requests in flight" aside={<span className="t-cap">peak {conc.peak}</span>}>
        <div className="spark" role="img" aria-label={`Requests in flight over time, peak ${conc.peak}`}>
          {conc.bins.map((b, i) => (
            <HoverTip key={i} className="spark-col" title={`${fmtMs(b.from)} – ${fmtMs(b.to)}`} entries={b.entries} footer="Click to list these requests"
              onClick={b.entries.length ? () => showList(`In flight ${fmtMs(b.from)} – ${fmtMs(b.to)}`, b.entries) : undefined} label={`${b.entries.length} in flight`}>
              <i style={{ height: `${conc.peak ? (b.entries.length / conc.peak) * 100 : 0}%` }} />
            </HoverTip>
          ))}
        </div>
        <div className="spark-axis"><span>0</span><span>{fmtMs(conc.total / 2)}</span><span>{fmtMs(conc.total)}</span></div>
        <p className="hint">Tall stretches mean the page is busy; gaps mean it’s waiting.</p>
      </Card>

      <Card title="Heaviest requests" className="span-2">
        <Bars fmt={fmtBytes} rows={heavy.map((e) => ({ label: e.name, value: e.transfer, entries: [e], tip: false, onPick: () => inspect(e.id), pickHint: '' }))} />
      </Card>

      <Card title="Connection setup" aside={<span className="t-cap">DNS + TCP + TLS</span>}>
        {setup.rows.length ? (
          <>
            <p className="lede"><b className="num">{fmtMs(setup.total)}</b> across {setup.connections} new connection{setup.connections === 1 ? '' : 's'} ({(setup.share * 100).toFixed(0)}% of summed request time).</p>
            <Bars fmt={fmtMs} rows={setup.rows.slice(0, 6).map((r) => ({ label: r.host, value: r.total, entries: r.entries, rank: (e) => e.phases.dns + e.phases.connect + e.phases.ssl, fmtRank: fmtMs }))} />
          </>
        ) : <p className="dim">Every request reused an existing connection.</p>}
      </Card>

      <Card className="span-3" title="Endpoint latency" flush aside={<span className="t-cap">grouped by method and path</span>}>
        <table className="tbl ep">
          <thead><tr><th>Endpoint</th><th className="num w70">Calls</th><th className="num w90">Median</th><th className="num w90">p95</th><th className="num w90">Max</th><th className="num w70">Errors</th></tr></thead>
          <tbody>
            {eps.slice(0, 15).map((g) => (
              <tr key={g.key} className="clickable" tabIndex={0} onClick={() => showList(`${g.method} ${g.host}${g.path}`, g.entries, { filter: { q: g.path } })} onKeyDown={(ev) => ev.key === 'Enter' && showList(`${g.method} ${g.host}${g.path}`, g.entries, { filter: { q: g.path } })}>
                <td className="ellipsis" title={g.key}><span className="mono dim">{g.method}</span> {g.host}{g.path}</td>
                <td className="num">{g.count}</td><td className="num">{fmtMs(g.p50)}</td><td className="num">{fmtMs(g.p95)}</td><td className="num">{fmtMs(g.max)}</td>
                <td className={`num ${g.errors ? 'tone-crit' : 'dim'}`}>{g.errors ? <><FontAwesomeIcon icon={faCircleExclamation} /> {g.errors}</> : 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {eps.length > 15 && <p className="hint pad-h">Showing the top 15 of {eps.length} endpoints.</p>}
        {har.entries.length < 20 && <p className="hint pad-h">Percentiles are rough with so few calls per endpoint.</p>}
      </Card>

      <Card className="span-3" title="Critical path" aside={<span className="t-cap">ends at {fmtMs(cp.end)}</span>}>
        <p className="lede">{cp.usedInitiators ? 'The longest chain of requests, each discovered by the one before it.' : 'This HAR has no initiator data, so the chain is approximated by “started after the previous one finished”.'} Speeding up anything here shortens the load.</p>
        <ol className="cp">
          {cp.ids.map((id, i) => {
            const e = har.entries[id]
            return (
              <li key={id} tabIndex={0} onClick={() => inspect(id)} onKeyDown={(ev) => ev.key === 'Enter' && inspect(id)}>
                <span className="cp-n num">{i + 1}</span>
                <StatusCode status={e.status} />
                <span className="ellipsis" title={e.url}>{e.method} {e.host}{e.path}</span>
                <span className="dim num">{fmtMs(e.startMs)} → {fmtMs(e.endMs)}</span>
              </li>
            )
          })}
        </ol>
        {!cp.ids.length && <p className="dim">Nothing to analyse.</p>}
      </Card>

      <Card className="span-3" title="Render-blocking candidates" flush>
        {block.entries.length ? (
          <>
            <p className="lede pad-h">{block.entries.length} stylesheets and scripts were requested right alongside the page. Unless they’re async, deferred or non-critical, first render waits until about <b className="num">{fmtMs(block.endsAt)}</b>.</p>
            <table className="tbl">
              <tbody>
                {block.entries.map((e) => (
                  <tr key={e.id} className="clickable" tabIndex={0} onClick={() => inspect(e.id)} onKeyDown={(ev) => ev.key === 'Enter' && inspect(e.id)}>
                    <td className="w70"><span className="tag">{e.type}</span></td>
                    <td className="ellipsis" title={e.url}>{e.host}{e.path}</td>
                    <td className="num w90">{fmtBytes(e.transfer)}</td>
                    <td className="num w90">{fmtMs(e.endMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="hint pad-h">A HAR doesn’t record async or defer, so this is a heuristic. Check the HTML before acting on it.</p>
          </>
        ) : <p className="pad dim">No CSS or scripts found next to the page request.</p>}
      </Card>

      <Card className="span-3" title="Third parties" flush aside={tp.rows.length ? <span className="t-cap">{tp.count} requests · {fmtBytes(tp.thirdBytes)} · {share.toFixed(0)}% of bytes</span> : null}>
        {tp.rows.length ? (
          <>
            <div className="split pad-h" role="img" aria-label={`${share.toFixed(0)}% of bytes come from third parties`}>
              <i style={{ width: `${100 - share}%` }} /><i className="tp" style={{ width: `${share}%` }} />
            </div>
            <div className="split-key pad-h"><span><i />{tp.first} (your site)</span><span><i className="tp" />Third parties</span></div>
            {noThird && noThird.saved > 0 && (
              <p className="whatif">
                <b>What if they were blocked?</b>
                <span>Your own requests would finish by about <b className="num">{fmtMs(noThird.end)}</b> instead of <b className="num">{fmtMs(noThird.total)}</b>, up to <b className="num">{fmtMs(noThird.saved)}</b> sooner.</span>
                <span className="dim">A best case: it assumes nothing waits on a third party.</span>
              </p>
            )}
            <table className="tbl">
              <thead><tr><th>Domain</th><th className="num w70">Req</th><th className="num w90">Bytes</th><th className="num w90">Time</th><th className="num w110">Connect cost</th><th className="w120"><span className="sr">Share</span></th></tr></thead>
              <tbody>
                {tp.rows.map((r) => {
                  const entries = r.ids.map((id) => har.entries[id])
                  const open = () => showList(r.domain, entries, { filter: { q: r.domain } })
                  return (
                    <tr key={r.domain} className="clickable" tabIndex={0} onClick={open} onKeyDown={(ev) => ev.key === 'Enter' && open()}>
                      <td className="ellipsis">{r.domain}</td><td className="num">{r.count}</td><td className="num">{fmtBytes(r.bytes)}</td><td className="num">{fmtMs(r.time)}</td><td className="num">{fmtMs(r.blocking)}</td>
                      <td><span className="bar-track"><i className="bar-fill" style={{ width: `${(r.time / maxT) * 100}%`, background: 'var(--c-series-1)' }} /></span></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <p className="hint pad-h">Connect cost is queueing plus DNS, TCP and TLS spent reaching that domain.</p>
          </>
        ) : <p className="pad dim">No third-party requests found.</p>}
      </Card>
    </div>
  )
}
