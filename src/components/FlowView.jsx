import { useContext, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { PHASES, PHASE_COLORS, TYPE_COLORS } from '../harParser'
import { InspectCtx } from '../context'
import { fmtBytes, fmtMs, statusClass } from '../utils'

const W = 1000
const BROWSER_X = 120
const SERVER_X = 840
const MAX_HOSTS = 10
const TOP = 50
const ROW = 52
const PHASE_LABEL = { dns: 'DNS', connect: 'TCP', ssl: 'TLS', send: 'REQ' }
const clip = (str, n) => (str.length > n ? `${str.slice(0, n - 1)}…` : str)

const phaseAt = (e, t) => {
  for (const p of ['dns', 'connect', 'ssl', 'send']) {
    if (e.phases[p] > 0 && t >= e.span[p].start && t < e.span[p].end) return PHASE_LABEL[p]
  }
  return 'REQ'
}

// Animated replay. Outlined tags travel browser -> server (DNS/TCP/TLS/send); filled tags travel back (response).
export default function FlowView({ har, initialFollow = '' }) {
  const inspect = useContext(InspectCtx)
  const startAt = (() => {
    const e = initialFollow === '' ? null : har.entries.find((x) => x.id === Number(initialFollow))
    return e ? e.startMs : 0
  })()
  const [t, setT] = useState(startAt)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [realtime, setRealtime] = useState(false)
  const [follow, setFollow] = useState(String(initialFollow))
  const tRef = useRef(startAt)

  // Following a request isolates it: only that request is drawn and the replay window shrinks to its lifetime.
  const fe = follow === '' ? null : har.entries.find((e) => e.id === Number(follow)) || null
  const scope = useMemo(() => (fe ? [fe] : har.entries), [fe, har])
  const fullTotal = Math.max(1, har.summary.totalTime)
  const winStart = fe ? fe.startMs : 0
  const winEnd = fe ? winStart + Math.max(1, fe.endMs - fe.startMs) : fullTotal
  const span = winEnd - winStart

  const nodes = useMemo(() => {
    const top = fe ? [fe.host] : har.summary.hosts.slice(0, MAX_HOSTS).map((h) => h.host)
    const list = !fe && har.summary.hosts.length > MAX_HOSTS ? [...top, 'other hosts'] : top
    const index = new Map(list.map((h, i) => [h, i]))
    return { list, of: (host) => (index.has(host) ? index.get(host) : list.length - 1) }
  }, [har, fe])

  const events = useMemo(() => {
    const list = []
    for (const e of scope) {
      list.push({ t: e.span.blocked.end, kind: 'req', e })
      list.push({ t: e.span.receive.start, kind: 'res', e })
    }
    return list.sort((a, b) => a.t - b.t)
  }, [scope])

  const H = TOP + nodes.list.length * ROW + 20
  const yOf = (i) => TOP + i * ROW + ROW / 2
  const browserY = H / 2

  useEffect(() => {
    if (!playing) return
    let raf
    let last = performance.now()
    // compressed: the visible window replays in ~15 s (~6 s when following one request). real time: 1 ms per 1 ms.
    const rate = realtime ? 1 : span / (fe ? 6000 : 15000)
    const tick = (now) => {
      tRef.current = Math.min(winEnd, tRef.current + (now - last) * rate * speed)
      last = now
      setT(tRef.current)
      if (tRef.current >= winEnd) setPlaying(false)
      else raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, speed, span, winEnd, realtime, fe])

  const seek = (v) => {
    tRef.current = v
    setT(v)
  }
  const togglePlay = () => {
    if (!playing && tRef.current >= winEnd) seek(winStart)
    setPlaying((p) => !p)
  }
  const pickFollow = (v) => {
    setPlaying(false)
    setFollow(v)
    const e = v === '' ? null : har.entries.find((x) => x.id === Number(v))
    seek(e ? e.startMs : 0)
  }

  let lo = 0
  let hi = events.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (events[mid].t <= t) lo = mid + 1
    else hi = mid
  }
  const feed = events.slice(Math.max(0, lo - 8), lo).reverse()

  const minVis = span / 45
  const dots = []
  const pulses = new Map()
  let inFlight = 0
  let done = 0
  let bytesDone = 0
  const followId = fe ? fe.id : -1

  for (const e of scope) {
    if (e.endMs <= t) {
      done++
      bytesDone += e.transfer
    } else if (e.startMs <= t) inFlight++

    const ni = nodes.of(e.host)
    const y = yOf(ni)
    const color = TYPE_COLORS[e.type] || TYPE_COLORS.other
    const r = Math.min(9, 3 + Math.log10(1 + e.transfer) * 0.9)
    const lane = fe ? 0 : ((e.id % 3) - 1) * 13
    const focus = e.id === followId

    const outStart = e.span.blocked.end
    const outLen = Math.max(e.span.send.end - outStart, minVis)
    if (t >= outStart && t <= outStart + outLen) {
      const p = (t - outStart) / outLen
      dots.push({ key: `o${e.id}`, x: BROWSER_X + (SERVER_X - BROWSER_X) * p, y: browserY + (y - browserY) * p + lane, color, r: 3.5, dir: 'out', e, focus, label: `${e.method} ${clip(e.name, 16)} · ${phaseAt(e, t)}` })
    }
    if (t >= e.span.wait.start && t <= e.span.receive.start + minVis) pulses.set(ni, (pulses.get(ni) || 0) + 1)

    const inLen = Math.max(e.phases.receive, minVis)
    if (t >= e.span.receive.start && t <= e.span.receive.start + inLen) {
      const p = (t - e.span.receive.start) / inLen
      dots.push({ key: `i${e.id}`, x: SERVER_X - (SERVER_X - BROWSER_X) * p, y: y + (browserY - y) * p + lane, color, r, dir: 'in', e, focus, label: `${e.status || 'ERR'} · ${fmtBytes(e.transfer)} · ${e.type}` })
    }
  }

  // followed request first so it always gets a full label
  dots.sort((a, b) => Number(b.focus) - Number(a.focus))
  const shown = dots.slice(0, 400)
  let fstage = ''
  if (fe) {
    if (t < fe.startMs) fstage = 'not started'
    else if (t >= fe.endMs) fstage = 'complete'
    else if (t < fe.span.wait.start) fstage = phaseAt(fe, t)
    else if (t < fe.span.receive.start) fstage = 'waiting for server'
    else fstage = 'receiving response'
  }

  return (
    <div>
      <div className="toolbar">
        <button className="btn primary" onClick={togglePlay}>{playing ? '❚❚ Pause' : t >= winEnd ? '↻ Replay' : '▶ Play'}</button>
        <button className="btn" onClick={() => { setPlaying(false); seek(winStart) }}>⏮ Reset</button>
        <label className="check">Speed
          <select className="input" value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
            {[0.25, 0.5, 1, 2, 4].map((s) => <option key={s} value={s}>{s}×</option>)}
          </select>
        </label>
        <label className="check"><input type="checkbox" checked={realtime} onChange={(e) => setRealtime(e.target.checked)} /> Real time</label>
        <label className="check">Follow
          <select className="input" value={follow} onChange={(e) => pickFollow(e.target.value)}>
            <option value="">— all requests —</option>
            {har.entries.map((e) => <option key={e.id} value={e.id}>{e.method} {clip(e.name, 28)}</option>)}
          </select>
        </label>
        <div className="clock">{fmtMs(t - winStart)} / {fmtMs(span)}{fe ? ` · starts at ${fmtMs(winStart)}` : ''}</div>
      </div>

      <input className="scrub" type="range" aria-label="Replay position" min={winStart} max={winEnd} step={span / 1000} value={Math.min(Math.max(t, winStart), winEnd)} onChange={(e) => { setPlaying(false); seek(Number(e.target.value)) }} />

      {fe && (
        <div className="follow-card card">
          <b className={statusClass(fe.status)}>{fe.status || 'ERR'}</b> <span className="mono">{fe.method}</span>{' '}
          <button className="link-btn" onClick={() => inspect(fe.id)}>{fe.host}{fe.path}</button>
          <span className="stage">{fstage}</span>
          <button className="btn sm" onClick={() => pickFollow('')}>Show all</button>
          <div className="fstrip" aria-label="Phase timeline for the followed request">
            {PHASES.map((p) => fe.phases[p] > 0 && (
              <i key={p} title={`${p}: ${fmtMs(fe.phases[p])}`} style={{ width: `${(fe.phases[p] / span) * 100}%`, background: PHASE_COLORS[p] }} />
            ))}
            <u style={{ left: `${Math.min(100, Math.max(0, ((t - winStart) / span) * 100))}%` }} />
          </div>
          <div className="fkey">{PHASES.filter((p) => fe.phases[p] > 0).map((p) => <span key={p}><i style={{ background: PHASE_COLORS[p] }} />{p} {fmtMs(fe.phases[p])}</span>)}</div>
        </div>
      )}

      <div className="flow-stats">
        <span>In flight <b>{inFlight}</b></span>
        <span>Completed <b>{done}/{scope.length}</b></span>
        <span>Received <b>{fmtBytes(bytesDone)}</b></span>
        <span className="legend">{!fe && Object.entries(TYPE_COLORS).map(([k, c]) => <span key={k}><i style={{ background: c }} />{k}</span>)}</span>
      </div>

      <svg className="flow" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="Animated request flow between browser and servers">
        <text x={BROWSER_X} y={24} className="svg-cap" textAnchor="middle">CLIENT</text>
        <text x={SERVER_X} y={24} className="svg-cap" textAnchor="middle">SERVERS</text>
        {nodes.list.map((h, i) => <line key={h} x1={BROWSER_X} y1={browserY} x2={SERVER_X} y2={yOf(i)} className="link" />)}
        <g>
          <circle cx={BROWSER_X} cy={browserY} r={34} className="node browser" />
          <text x={BROWSER_X} y={browserY + 5} textAnchor="middle" className="svg-node">Browser</text>
        </g>
        {nodes.list.map((h, i) => {
          const active = pulses.get(i) || 0
          return (
            <g key={h}>
              {active > 0 && <circle cx={SERVER_X} cy={yOf(i)} r={16 + Math.min(active, 6) * 2} className="pulse" />}
              <circle cx={SERVER_X} cy={yOf(i)} r={12} className={`node server${active ? ' busy' : ''}`} />
              <text x={SERVER_X + 22} y={yOf(i) + 4} className="svg-host">{clip(h, 30)}</text>
            </g>
          )
        })}
        {shown.map((d, i) => {
          const tag = i < 14
          const w = d.label.length * 5.8 + 18
          return (
            <g key={d.key} style={{ cursor: 'pointer' }} onClick={() => inspect(d.e.id)}>
              {tag ? (
                <g transform={`translate(${d.x} ${d.y})`}>
                  <rect x={-w / 2} y={-9} width={w} height={18} rx={9} fill={d.dir === 'in' ? d.color : '#10131f'} stroke={d.focus ? '#fff' : d.color} strokeWidth={d.focus ? 2.5 : 1.5} />
                  <text textAnchor="middle" y={3.5} className="pk-text" fill={d.dir === 'in' ? '#0b0d16' : d.color}>{d.label}</text>
                </g>
              ) : (
                <circle cx={d.x} cy={d.y} r={d.dir === 'in' ? d.r : 3} fill={d.color} opacity={0.85} />
              )}
              <title>{`${d.dir === 'out' ? 'request' : 'response'}: ${d.e.method} ${d.e.url} (${fmtBytes(d.e.transfer)})`}</title>
            </g>
          )
        })}
      </svg>

      <div className="hint">Outlined tags = requests heading out with their stage (DNS → TCP → TLS → REQ). Filled tags = responses: status, size, type. Click any tag to inspect it. Pick a request in Follow to isolate just its flow.</div>

      <div className="card wire">
        <h3>Live wire log</h3>
        <ul className="wire-list">
          <AnimatePresence initial={false}>
            {feed.map((ev) => (
              <motion.li key={`${ev.kind}${ev.e.id}`} layout initial={{ opacity: 0, x: -14 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className={ev.kind} onClick={() => inspect(ev.e.id)}>
                <span className="w-dir">{ev.kind === 'req' ? '→ OUT' : '← IN'}</span>
                <span className="w-time">{fmtMs(ev.t)}</span>
                {ev.kind === 'req' ? (
                  <span className="ellipsis" title={ev.e.url}><b>{ev.e.method}</b> {ev.e.host}{ev.e.path}</span>
                ) : (
                  <span className="ellipsis" title={ev.e.url}><b className={statusClass(ev.e.status)}>{ev.e.status || 'ERR'}</b> {ev.e.mime || ev.e.type} · {fmtBytes(ev.e.transfer)} · {ev.e.name}</span>
                )}
              </motion.li>
            ))}
          </AnimatePresence>
          {!feed.length && <li className="dim">{fe ? 'Press play to watch this request.' : 'Press play to watch traffic.'}</li>}
        </ul>
      </div>
    </div>
  )
}
