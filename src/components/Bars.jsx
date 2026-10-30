import { useContext, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ListCtx } from '../context'
import { fmtMs } from '../utils'
import ReqTip from './ReqTip'

const byTime = (e) => e.time
const DELAY = 220 // ms of deliberate hovering before the card appears

// Shows the requests behind an element on hover (after a short delay) or keyboard focus.
// The card hides as soon as the element is clicked and stays hidden until the pointer leaves and re-enters.
export function HoverTip({ title, entries, rank = byTime, fmtRank = fmtMs, footer, onClick, className, tip = true, children }) {
  const [pos, setPos] = useState(null)
  const timer = useRef(0)
  const last = useRef({ x: 0, y: 0 })
  const quiet = useRef(false)

  useEffect(() => () => clearTimeout(timer.current), [])

  const hide = () => {
    clearTimeout(timer.current)
    setPos(null)
  }
  const enter = (e) => {
    quiet.current = false
    last.current = { x: e.clientX, y: e.clientY }
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setPos({ ...last.current }), DELAY)
  }
  const move = (e) => {
    last.current = { x: e.clientX, y: e.clientY }
    if (pos && !quiet.current) setPos({ ...last.current })
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
    setPos({ x: r.left + r.width / 2, y: r.bottom - 6 })
  }

  return (
    <div
      className={className}
      onMouseEnter={tip ? enter : undefined}
      onMouseMove={tip ? move : undefined}
      onMouseLeave={hide}
      onFocus={tip ? focus : undefined}
      onBlur={hide}
      onClick={onClick ? click : undefined}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), click()) : undefined}
    >
      {children}
      {tip && pos && entries.length > 0 && createPortal(<ReqTip x={pos.x} y={pos.y} title={title} entries={entries} rank={rank} fmtRank={fmtRank} footer={footer} />, document.body)}
    </div>
  )
}

// rows: { label, value, color?, entries?, rank?, fmtRank?, title?, filter?, harIndex?, tip?, onPick?, pickHint? }
// Clicking any row with requests opens the request list (onPick overrides that).
export default function Bars({ rows, color, fmt }) {
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
            className={`bar-row${open ? ' pick' : ''}`}
            title={r.title || r.label}
            entries={r.entries || []}
            rank={r.rank}
            fmtRank={r.fmtRank}
            footer={hint}
            tip={r.tip !== false}
            onClick={open}
          >
            <div className="bar-label">{r.label}</div>
            <div className="bar-track">
              <div className="bar-fill" style={{ width: `${(r.value / max) * 100}%`, background: r.color || color }} />
            </div>
            <div className="bar-val">{fmt(r.value)}</div>
          </HoverTip>
        )
      })}
      {!rows.length && <div className="dim">No data.</div>}
    </div>
  )
}
