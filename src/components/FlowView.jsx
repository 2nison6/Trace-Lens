import { useContext, useEffect, useMemo, useRef, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faBackwardStep, faPause, faPlay, faRotateRight } from '@fortawesome/free-solid-svg-icons'
import { PHASES } from '../harParser'
import { InspectCtx } from '../context'
import { PHASE_LABEL, PHASE_VAR } from '../theme'
import { fmtBytes, fmtMs } from '../utils'
import { Card, Segmented, StatusCode, Switch } from './ui'

const W = 1000
const CLIENT_X = 96
const SERVER_X = 770
const EDGE = CLIENT_X + 36 // packet tags travel between the two nodes' edges, never over a node or its label
const LANES = 5
const tagWidth = (label) => label.length * 5.7 + 20
const MAX_HOSTS = 9
const TOP = 54
const ROW = 50
const clip = (str, n) => (str.length > n ? `${str.slice(0, n - 1)}…` : str)
const SETUP = ['dns', 'connect', 'ssl']
const STAGE = { dns: 'DNS', connect: 'TCP', ssl: 'TLS', send: 'Sent' }

// Which stage a request is in at time t. Used for the packet label and the follow card.
function stageAt(e, t) {
  if (t < e.startMs) return { key: 'idle', text: 'Not started' }
  if (t >= e.endMs) return { key: 'done', text: 'Complete' }
  for (const p of [...SETUP, 'send']) {
    if (e.phases[p] > 0 && t >= e.span[p].start && t < e.span[p].end) return { key: p, text: p === 'send' ? 'Sending request' : `${STAGE[p]} handshake`, short: STAGE[p] }
  }
  if (t < e.span.wait.start) return { key: 'blocked', text: 'Queued in the browser', short: 'Queued' }
  if (t < e.span.receive.start) return { key: 'wait', text: 'Waiting for the server', short: 'Waiting' }
  return { key: 'receive', text: 'Downloading the response', short: 'Download' }
}

const pctOf = (v, a, b) => Math.min(100, Math.max(0, ((v - a) / (b - a || 1)) * 100))

/**
 * Animated replay of a capture: requests travel from the browser to each server and the responses travel back.
 * Following one request isolates it. A scrubber and a per-host lane view sit beside it so the same story is also readable without motion.
 */
export default function FlowView({ har, initialFollow = '' }) {
  const inspect = useContext(InspectCtx)
  const startAt = (() => {
    const e = initialFollow === '' ? null : har.entries.find((x) => x.id === Number(initialFollow))
    return e ? e.startMs : 0
  })()
  const [t, setT] = useState(startAt)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState('1')
  const [realtime, setRealtime] = useState(false)
  const [follow, setFollow] = useState(String(initialFollow))
  const tRef = useRef(startAt)

  const fe = follow === '' ? null : har.entries.find((e) => e.id === Number(follow)) || null
  const scope = useMemo(() => (fe ? [fe] : har.entries), [fe, har])
  const winStart = fe ? fe.startMs : 0
  const winEnd = fe ? winStart + Math.max(1, fe.endMs - fe.startMs) : Math.max(1, har.summary.totalTime)
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

  const H = TOP + nodes.list.length * ROW + 26
  const yOf = (i) => TOP + i * ROW + ROW / 2
  const clientY = H / 2

  useEffect(() => {
    if (!playing) return undefined
    let raf
    let last = performance.now()
    // compressed: the visible window replays in ~15 s (~6 s for one request). real time: 1 ms per 1 ms.
    const rate = (realtime ? 1 : span / (fe ? 6000 : 15000)) * Number(speed)
    const tick = (now) => {
      tRef.current = Math.min(winEnd, tRef.current + (now - last) * rate)
      last = now
      setT(tRef.current)
      if (tRef.current >= winEnd) setPlaying(false)
      else raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, speed, span, winEnd, realtime, fe])

  const seek = (v) => { tRef.current = v; setT(v) }
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
  const feed = events.slice(Math.max(0, lo - 7), lo).reverse()

  const minVis = span / 45
  const dots = []
  const pulses = new Map()
  let inFlight = 0
  let done = 0
  let bytesDone = 0
  const followId = fe ? fe.id : -1

  for (const e of scope) {
    if (e.endMs <= t) { done++; bytesDone += e.transfer } else if (e.startMs <= t) inFlight++

    const ni = nodes.of(e.host)
    const y = yOf(ni)
    const lane = fe ? 0 : ((e.id % LANES) - (LANES - 1) / 2) * 9
    const focus = e.id === followId
    const r = Math.min(8, 3.5 + Math.log10(1 + e.transfer) * 0.8)

    const outStart = e.span.blocked.end
    const outLen = Math.max(e.span.send.end - outStart, minVis)
    if (t >= outStart && t <= outStart + outLen) {
      const p = (t - outStart) / outLen
      const st = stageAt(e, t)
      const label = `${e.method} ${clip(e.name, 15)} · ${st.short || 'Sent'}`
      const w = tagWidth(label)
      const x = EDGE + w / 2 + (SERVER_X - 16 - EDGE - w) * p
      dots.push({ key: `o${e.id}`, x, y: clientY + (y - clientY) * ((x - CLIENT_X) / (SERVER_X - CLIENT_X)) + lane, dir: 'out', e, focus, stage: st.key, label, w })
    }
    if (t >= e.span.wait.start && t <= e.span.receive.start + minVis) pulses.set(ni, (pulses.get(ni) || 0) + 1)

    const inLen = Math.max(e.phases.receive, minVis)
    if (t >= e.span.receive.start && t <= e.span.receive.start + inLen) {
      const p = (t - e.span.receive.start) / inLen
      const label = `${e.status || 'ERR'} · ${fmtBytes(e.transfer)}`
      const w = tagWidth(label)
      const x = SERVER_X - 16 - w / 2 - (SERVER_X - 16 - EDGE - w) * p
      dots.push({ key: `i${e.id}`, x, y: y + (clientY - y) * ((SERVER_X - x) / (SERVER_X - CLIENT_X)) + lane, dir: 'in', e, focus, r, label, w })
    }
  }
  dots.sort((a, b) => Number(b.focus) - Number(a.focus))
  const shown = dots.slice(0, 400)
  const stage = fe ? stageAt(fe, t) : null
  const at = pctOf(t, winStart, winEnd)

  return (
    <div className="flow-page">
      <div className="transport">
        <button type="button" className="play" onClick={togglePlay} aria-label={playing ? 'Pause' : t >= winEnd ? 'Replay' : 'Play'}>
          <FontAwesomeIcon icon={playing ? faPause : t >= winEnd ? faRotateRight : faPlay} />
        </button>
        <button type="button" className="icon-btn" onClick={() => { setPlaying(false); seek(winStart) }} aria-label="Back to start"><FontAwesomeIcon icon={faBackwardStep} /></button>
        <div className="scrubber">
          <input type="range" aria-label="Replay position" min={winStart} max={winEnd} step={span / 1000} value={Math.min(Math.max(t, winStart), winEnd)} style={{ '--p': `${at}%` }}
            onChange={(e) => { setPlaying(false); seek(Number(e.target.value)) }} />
          <div className="scrub-marks" aria-hidden="true">
            {!fe && har.markers.map((m) => <i key={m.label} className={m.tone} style={{ left: `${pctOf(m.ms, winStart, winEnd)}%` }} title={`${m.label} ${fmtMs(m.ms)}`} />)}
          </div>
        </div>
        <output className="clock num">{fmtMs(t - winStart)} <span className="dim">/ {fmtMs(span)}</span></output>
      </div>

      <div className="transport-opts">
        <Segmented size="s" label="Playback speed" value={speed} onChange={setSpeed} options={[{ value: '0.5', label: '0.5×' }, { value: '1', label: '1×' }, { value: '2', label: '2×' }, { value: '4', label: '4×' }]} />
        <Switch checked={realtime} onChange={setRealtime} label="Real time" />
        <label className="follow-pick">Follow
          <select value={follow} onChange={(e) => pickFollow(e.target.value)}>
            <option value="">All requests</option>
            {har.entries.map((e) => <option key={e.id} value={e.id}>{e.method} {clip(e.name, 30)}</option>)}
          </select>
        </label>
      </div>

      {fe && (
        <Card className="follow">
          <div className="follow-h">
            <StatusCode status={fe.status} icon />
            <span className="mono dim">{fe.method}</span>
            <button type="button" className="link" onClick={() => inspect(fe.id)}>{fe.host}{fe.path}</button>
            <span className="follow-stage">{stage.text}</span>
            <button type="button" className="btn sm" onClick={() => pickFollow('')}>Show all</button>
          </div>
          <div className="fstrip" role="img" aria-label="Phase timeline for the followed request">
            {PHASES.filter((p) => fe.phases[p] > 0).map((p) => <i key={p} title={`${PHASE_LABEL[p]}: ${fmtMs(fe.phases[p])}`} style={{ width: `${(fe.phases[p] / span) * 100}%`, background: PHASE_VAR[p] }} />)}
            <u style={{ left: `${at}%` }} />
          </div>
          <dl className="fkey">
            {PHASES.filter((p) => fe.phases[p] > 0).map((p) => <div key={p}><dt><i style={{ background: PHASE_VAR[p] }} />{PHASE_LABEL[p]}</dt><dd className="num">{fmtMs(fe.phases[p])}</dd></div>)}
          </dl>
        </Card>
      )}

      <div className="flow-stats" aria-live="off">
        <span>In flight <b className="num">{inFlight}</b></span>
        <span>Completed <b className="num">{done}/{scope.length}</b></span>
        <span>Received <b className="num">{fmtBytes(bytesDone)}</b></span>
      </div>

      <div className="flow-scroll">
      <svg className="flow" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="Animated request flow between the browser and servers">
        <defs>
          <radialGradient id="flow-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--c-wait)" stopOpacity="0.4" /><stop offset="100%" stopColor="var(--c-wait)" stopOpacity="0" />
          </radialGradient>
        </defs>
        <text x={CLIENT_X} y={26} className="svg-cap" textAnchor="middle">YOUR BROWSER</text>
        <text x={SERVER_X} y={26} className="svg-cap" textAnchor="start" dx="-9">SERVERS</text>
        {nodes.list.map((h, i) => <line key={h} x1={CLIENT_X} y1={clientY} x2={SERVER_X} y2={yOf(i)} className="link" />)}
        <circle cx={CLIENT_X} cy={clientY} r={26} className="node client" />
        <text x={CLIENT_X} y={clientY + 3.5} textAnchor="middle" className="svg-node">You</text>
        {nodes.list.map((h, i) => {
          const n = pulses.get(i) || 0
          return (
            <g key={h}>
              {n > 0 && <circle cx={SERVER_X} cy={yOf(i)} r={13 + Math.min(n, 6) * 2.5} fill="url(#flow-glow)" />}
              <circle cx={SERVER_X} cy={yOf(i)} r={9} className={`node server${n ? ' busy' : ''}`} />
              <text x={SERVER_X + 18} y={yOf(i) + 4} className="svg-host">{clip(h, 30)}</text>
            </g>
          )
        })}
        {shown.map((d, i) => {
          const tag = i < 8
          const w = d.w
          const col = d.dir === 'in' ? 'var(--c-receive)' : d.stage === 'wait' ? 'var(--c-wait)' : `var(--c-${d.stage === 'idle' || d.stage === 'done' ? 'send' : d.stage})`
          return (
            <g key={d.key} className="pk" onClick={() => inspect(d.e.id)}>
              {tag ? (
                <g transform={`translate(${d.x} ${d.y})`}>
                  <rect x={-w / 2} y={-10} width={w} height={20} rx={10} className={`pk-bg ${d.dir}${d.focus ? ' focus' : ''}`} style={{ '--pk': col }} />
                  <text textAnchor="middle" y={3.7} className={`pk-t ${d.dir}`}>{d.label}</text>
                </g>
              ) : (
                <circle cx={d.x} cy={d.y} r={d.dir === 'in' ? d.r : 3} fill={col} opacity={0.9} />
              )}
              <title>{`${d.dir === 'out' ? 'Request' : 'Response'}: ${d.e.method} ${d.e.url} (${fmtBytes(d.e.transfer)})`}</title>
            </g>
          )
        })}
      </svg>
      </div>
      <p className="hint">Outlined tags are requests on their way out, with their stage. Filled tags are responses coming back: status and size. Click a tag to inspect it.</p>

      <Card title="Wire log" aside={<span className="t-cap">latest first</span>}>
        <ol className="wire">
          {feed.map((ev) => (
            <li key={`${ev.kind}${ev.e.id}`} className={ev.kind} onClick={() => inspect(ev.e.id)} tabIndex={0} onKeyDown={(k) => k.key === 'Enter' && inspect(ev.e.id)}>
              <span className="w-dir">{ev.kind === 'req' ? 'Out' : 'In'}</span>
              <span className="w-time num">{fmtMs(ev.t)}</span>
              {ev.kind === 'req'
                ? <span className="ellipsis" title={ev.e.url}><b>{ev.e.method}</b> {ev.e.host}{ev.e.path}</span>
                : <span className="ellipsis" title={ev.e.url}><StatusCode status={ev.e.status} /> {ev.e.mime || ev.e.type} · {fmtBytes(ev.e.transfer)} · {ev.e.name}</span>}
            </li>
          ))}
          {!feed.length && <li className="dim idle">{fe ? 'Press play to watch this request.' : 'Press play to watch traffic.'}</li>}
        </ol>
      </Card>
    </div>
  )
}
