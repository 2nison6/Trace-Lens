import { useContext, useMemo } from 'react'
import { motion } from 'framer-motion'
import { InspectCtx, ListCtx } from '../context'
import {
  cachePolicy, concurrency, connectionSetup, criticalPath, endpoints, heaviest, latencyBuckets,
  optimizations, protocols, renderBlocking, thirdParty, vitals,
} from '../insights'
import { fmtBytes, fmtMs, statusClass } from '../utils'
import Bars, { HoverTip } from './Bars'

const PROTO_COLOR = { 'HTTP/3': 'var(--lime)', 'HTTP/2': 'var(--blue-l)', 'HTTP/1.1': 'var(--warn)', 'HTTP/1.0': 'var(--bad)' }
const CACHE_COLOR = ['var(--bad)', 'var(--bad)', 'var(--warn)', 'var(--blue-l)', 'var(--good)']
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

  const totalBytes = tp.firstBytes + tp.thirdBytes || 1
  const share = (tp.thirdBytes / totalBytes) * 100
  const maxT = Math.max(1, ...tp.rows.map((r) => r.time))
  const maxHeavy = Math.max(1, ...heavy.map((e) => e.transfer))
  const savingTotal = opts.reduce((s, o) => s + o.saving, 0)
  const cacheCount = cache.reduce((s, g) => s + g.entries.length, 0)

  if (!har.entries.length) return <div className="empty">Nothing to analyse in this capture.</div>

  return (
    <div>
      {vit && (
        <section className="card">
          <h3>Timing estimates</h3>
          <div className="vitals">
            {vit.map((v, i) => (
              <motion.div key={v.key} className={`vital ${v.rating}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} title={v.note}>
                <div className="v-val">{fmtMs(v.value)}</div>
                <div className="v-key">{v.key}</div>
                <div className="v-note">{v.note}</div>
              </motion.div>
            ))}
          </div>
          <div className="hint">Estimates derived from HAR timings, not real Core Web Vitals. Use Lighthouse or field data to confirm.</div>
        </section>
      )}

      {opts.length > 0 && (
        <section className="card">
          <h3>Potential savings</h3>
          <p className="dim">Rough estimates of what fixing each item could save: about <b>{fmtBytes(savingTotal)}</b> in total. They use typical ratios, not measurements, and some overlap.</p>
          <div className="opt-grid">
            {opts.map((o) => (
              <button key={o.key} className="opt" onClick={() => showList(o.title, o.entries)}>
                <span className="opt-save">{fmtBytes(o.saving)}</span>
                <b>{o.title}</b>
                <span className="dim">{o.note}</span>
                <span className="opt-n">{o.entries.length} request{o.entries.length === 1 ? '' : 's'} →</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <div className="panel-grid">
        <section className="card">
          <h3>Response-time distribution</h3>
          <Bars fmt={(v) => v} rows={lat.map((b) => ({ label: b.label, value: b.entries.length, color: b.color, entries: b.entries, rank: byTime, fmtRank: fmtMs }))} />
          <div className="hint">Click a bucket to list its requests.</div>
        </section>

        <section className="card">
          <h3>Protocols</h3>
          <Bars fmt={(v) => v} rows={protos.map((p) => ({ label: p.label, value: p.entries.length, color: PROTO_COLOR[p.label] || 'var(--dim)', entries: p.entries, rank: byTime, fmtRank: fmtMs }))} />
          <div className="hint">HTTP/1.x limits a browser to about 6 parallel connections per host.</div>
        </section>
      </div>

      <section className="card">
        <h3>Concurrency over time</h3>
        <p className="dim">Peak of <b>{conc.peak}</b> requests in flight at once. Tall stretches mean the page is busy; flat gaps mean it is waiting.</p>
        <div className="spark" role="img" aria-label="Requests in flight over time">
          {conc.bins.map((b, i) => (
            <HoverTip
              key={i}
              className="spark-col"
              title={`${fmtMs(b.from)} – ${fmtMs(b.to)}`}
              entries={b.entries}
              footer="Click to list these requests"
              onClick={b.entries.length ? () => showList(`In flight ${fmtMs(b.from)} – ${fmtMs(b.to)}`, b.entries) : undefined}
            >
              <i style={{ height: `${conc.peak ? (b.entries.length / conc.peak) * 100 : 0}%` }} />
            </HoverTip>
          ))}
        </div>
        <div className="spark-axis"><span>0</span><span>{fmtMs(conc.total / 2)}</span><span>{fmtMs(conc.total)}</span></div>
      </section>

      <div className="panel-grid">
        <section className="card">
          <h3>Heaviest requests</h3>
          <div className="bars">
            {heavy.map((e) => (
              <div key={e.id} className="bar-row pick" role="button" tabIndex={0} title={e.url} onClick={() => inspect(e.id)} onKeyDown={(ev) => ev.key === 'Enter' && inspect(e.id)}>
                <div className="bar-label">{e.name}</div>
                <div className="bar-track"><div className="bar-fill" style={{ width: `${(e.transfer / maxHeavy) * 100}%`, background: 'var(--blue-l)' }} /></div>
                <div className="bar-val">{fmtBytes(e.transfer)}</div>
              </div>
            ))}
          </div>
          <div className="hint">Click a bar to inspect that request.</div>
        </section>

        <section className="card">
          <h3>Cache lifetime of GET responses</h3>
          {cacheCount ? (
            <Bars fmt={(v) => v} rows={cache.map((g, i) => ({ label: g.label, value: g.entries.length, color: CACHE_COLOR[i], entries: g.entries, rank: byBytes, fmtRank: fmtBytes }))} />
          ) : (
            <div className="empty">No cacheable GET responses.</div>
          )}
          <div className="hint">Red means the browser cannot reuse the response, so repeat visits pay for it again.</div>
        </section>
      </div>

      <section className="card">
        <h3>Connection setup cost</h3>
        {setup.rows.length ? (
          <>
            <p className="dim">
              <b>{fmtMs(setup.total)}</b> spent on DNS, TCP and TLS across <b>{setup.connections}</b> new connection{setup.connections === 1 ? '' : 's'} ({(setup.share * 100).toFixed(0)}% of summed request time).
              Fewer hosts, preconnect hints and HTTP/2+ all reduce this.
            </p>
            <Bars fmt={fmtMs} rows={setup.rows.slice(0, 8).map((r) => ({ label: r.host, value: r.total, color: 'var(--lime)', entries: r.entries, rank: (e) => e.phases.dns + e.phases.connect + e.phases.ssl, fmtRank: fmtMs }))} />
          </>
        ) : (
          <div className="empty good">No connection setup recorded. Everything reused existing connections.</div>
        )}
      </section>

      <section className="card">
        <h3>Render-blocking candidates</h3>
        {block.entries.length ? (
          <>
            <p className="dim">
              <b>{block.entries.length}</b> stylesheets and scripts were requested right alongside the page. Unless they are async, deferred or non-critical, the first render waits until about <b>{fmtMs(block.endsAt)}</b>.
            </p>
            <table className="tbl">
              <tbody>
                {block.entries.map((e) => (
                  <tr key={e.id} className="clickable" onClick={() => inspect(e.id)}>
                    <td className="w60"><span className="tag">{e.type}</span></td>
                    <td className="ellipsis" title={e.url}>{e.host}{e.path}</td>
                    <td className="num w90">{fmtBytes(e.transfer)}</td>
                    <td className="num w90">{fmtMs(e.endMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="hint">A HAR does not record async/defer, so this is a heuristic. Check the HTML before acting.</div>
          </>
        ) : (
          <div className="empty good">No CSS or scripts found next to the page request.</div>
        )}
      </section>

      <section className="card">
        <h3>Endpoint latency</h3>
        <p className="dim">Grouped by method and URL path, ordered by total time spent. Click a row to list that endpoint's calls.</p>
        <table className="tbl ep">
          <thead><tr><th>Endpoint</th><th className="num w70">Calls</th><th className="num w90">p50</th><th className="num w90">p95</th><th className="num w90">Max</th><th className="num w70">Errors</th></tr></thead>
          <tbody>
            {eps.slice(0, 15).map((g) => (
              <tr key={g.key} className="clickable" tabIndex={0} onClick={() => showList(`${g.method} ${g.host}${g.path}`, g.entries, { filter: { q: g.path } })} onKeyDown={(ev) => ev.key === 'Enter' && showList(`${g.method} ${g.host}${g.path}`, g.entries, { filter: { q: g.path } })}>
                <td className="ellipsis" title={g.key}><span className="mono dim">{g.method}</span> {g.host}{g.path}</td>
                <td className="num">{g.count}</td>
                <td className="num">{fmtMs(g.p50)}</td>
                <td className="num">{fmtMs(g.p95)}</td>
                <td className="num">{fmtMs(g.max)}</td>
                <td className={`num ${g.errors ? 'bad' : 'dim'}`}>{g.errors}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {eps.length > 15 && <div className="hint">Showing top 15 of {eps.length} endpoints.</div>}
        {har.entries.length < 20 && <div className="hint">Percentiles are rough with so few calls per endpoint.</div>}
      </section>

      <section className="card">
        <h3>Critical path</h3>
        <p className="dim">
          {cp.usedInitiators ? 'Longest chain of requests, each discovered by the previous one.' : 'This HAR has no initiator data, so the chain is approximated by “started after the previous one finished”.'}{' '}
          It ends at <b>{fmtMs(cp.end)}</b>. Speeding up anything on this path shortens load time.
        </p>
        <ol className="cp">
          {cp.ids.map((id, i) => {
            const e = har.entries[id]
            return (
              <li key={id} className="clickable" onClick={() => inspect(id)}>
                <span className="cp-n">{i + 1}</span>
                <b className={statusClass(e.status)}>{e.status || 'ERR'}</b>
                <span className="ellipsis" title={e.url}>{e.method} {e.host}{e.path}</span>
                <span className="dim">{fmtMs(e.startMs)} → {fmtMs(e.endMs)}</span>
              </li>
            )
          })}
        </ol>
        {!cp.ids.length && <div className="empty">Nothing to analyse.</div>}
      </section>

      <section className="card">
        <h3>Third-party cost</h3>
        {tp.rows.length ? (
          <>
            <p className="dim">
              <b>{tp.count}</b> requests to other domains, {fmtBytes(tp.thirdBytes)} ({share.toFixed(0)}% of bytes), compared with first-party <b>{tp.first}</b>.
            </p>
            <div className="split"><i style={{ width: `${100 - share}%` }} /><i className="tp" style={{ width: `${share}%` }} /></div>
            <table className="tbl">
              <thead><tr><th>Domain</th><th className="num w70">Req</th><th className="num w90">Bytes</th><th className="num w90">Time</th><th className="num w100">Connect cost</th><th className="w120"></th></tr></thead>
              <tbody>
                {tp.rows.map((r) => {
                  const entries = r.ids.map((id) => har.entries[id])
                  return (
                    <tr key={r.domain} className="clickable" tabIndex={0} onClick={() => showList(r.domain, entries, { filter: { q: r.domain } })} onKeyDown={(ev) => ev.key === 'Enter' && showList(r.domain, entries, { filter: { q: r.domain } })}>
                      <td className="ellipsis">{r.domain}</td>
                      <td className="num">{r.count}</td>
                      <td className="num">{fmtBytes(r.bytes)}</td>
                      <td className="num">{fmtMs(r.time)}</td>
                      <td className="num">{fmtMs(r.blocking)}</td>
                      <td><div className="bar-track"><div className="bar-fill" style={{ width: `${(r.time / maxT) * 100}%`, background: 'var(--lime)' }} /></div></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <div className="hint">“Connect cost” = queueing + DNS + TCP + TLS spent reaching that domain. Click a row to list its requests.</div>
          </>
        ) : (
          <div className="empty good">No third-party requests found.</div>
        )}
      </section>
    </div>
  )
}
