import { useContext, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ListCtx } from '../context'
import { fmtMs } from '../utils'
import ReqTip from './ReqTip'

const byTime = (e) => e.time
const DELAY = 220 // ms of deliberate hovering before the card appears
const SKIP_WINDOW = 350 // after one card closes, the next opens instantly (and without animation)
let lastClosed = 0

// Shows the requests behind an element on hover (after a short delay) or keyboard focus.
// The card hides as soon as the element is clicked and stays hidden until the pointer leaves and re-enters.
export function HoverTip({ title, entries, rank = byTime, fmtRank = fmtMs, footer, onClick, className, style, tip = true, children, label }) {
  const [pos, setPos] = useState(null)
  const timer = useRef(0)
  const last = useRef({ x: 0, y: 0 })
  const quiet = useRef(false)

  useEffect(() => () => clearTimeout(timer.current), [])

  const hide = () => {
    clearTimeout(timer.current)
    setPos((p) => {
      if (p) lastClosed = Date.now()
      return null
    })
  }
  const enter = (e) => {
    quiet.current = false
    last.current = { x: e.clientX, y: e.clientY }
    clearTimeout(timer.current)
    const instant = Date.now() - lastClosed < SKIP_WINDOW
    const show = () => setPos({ ...last.current, instant })
    if (instant) show()
    else timer.current = setTimeout(show, DELAY)
  }
  const move = (e) => {
    last.current = { x: e.clientX, y: e.clientY }
    if (pos && !quiet.current) setPos((p) => ({ ...last.current, instant: p.instant }))
  }
  const click = () => {
    quiet.current = true
    hide()
    if (onClick) onClick()
  }
  const focus = (e) => {
    // keyboard focus only; a mouse click also focuses the element and must not pop the card back up
    if (quiet.current || !e.currentTarget.matches(':focus-visible')) return
    const r = e.currentTarget.getBoundingClientRect()
    setPos({ x: r.left + r.width / 2, y: r.bottom - 6, instant: false })
  }

  return (
    <div
      className={className}
      style={style}
      onMouseEnter={tip ? enter : undefined}
      onMouseMove={tip ? move : undefined}
      onMouseLeave={hide}
      onFocus={tip ? focus : undefined}
      onBlur={hide}
      onClick={onClick ? click : undefined}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={label}
      onKeyDown={onClick ? (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), click()) : undefined}
    >
      {children}
      {tip && pos && entries.length > 0 && createPortal(<ReqTip x={pos.x} y={pos.y} instant={pos.instant} title={title} entries={entries} rank={rank} fmtRank={fmtRank} footer={footer} />, document.body)}
    </div>
  )
}

// rows: { label, value, color?, entries?, rank?, fmtRank?, title?, filter?, harIndex?, tip?, onPick?, pickHint?, sub? }
// Clicking any row with requests opens the request list (onPick overrides that).
// Single-series bars share one hue: colour must not repeat what bar length already says.
export default function Bars({ rows, color = 'var(--c-series-1)', fmt }) {
  const showList = useContext(ListCtx)
  const max = Math.max(1, ...rows.map((r) => r.value))
  return (
    <div className="bars">
      {rows.map((r) => {
        const has = !!(r.entries && r.entries.length)
        const open = r.onPick || (has ? () => showList(r.title || r.label, r.entries, { filter: r.filter, harIndex: r.harIndex }) : undefined)
        const hint = r.onPick ? r.pickHint : has ? 'Click to list these requests' : ''
        return (
          <HoverTip
            key={r.label}
            className={`bar${open ? ' pick' : ''}`}
            title={r.title || r.label}
            entries={r.entries || []}
            rank={r.rank}
            fmtRank={r.fmtRank}
            footer={hint}
            tip={r.tip !== false}
            onClick={open}
            label={`${r.label}: ${fmt(r.value)}`}
          >
            <span className="bar-label ellipsis" title={r.label}>{r.label}</span>
            <span className="bar-track">
              <i className="bar-fill" style={{ width: `${Math.max(r.value > 0 ? 1.5 : 0, (r.value / max) * 100)}%`, background: r.color || color }} />
            </span>
            <span className="bar-val num">{fmt(r.value)}</span>
          </HoverTip>
        )
      })}
      {!rows.length && <p className="dim">No data.</p>}
    </div>
  )
}
