import { useMemo } from 'react'
import { fmtMs } from '../utils'
import { StatusCode } from './ui'

const MAX_ROWS = 8
const TIP_W = 340

// Floating list of the requests behind a bar / card. Positioned in viewport coordinates and scaled from the pointer.
export default function ReqTip({ x, y, title, entries, rank, fmtRank = fmtMs, footer, instant }) {
  const list = useMemo(() => [...entries].sort((a, b) => rank(b) - rank(a)).slice(0, MAX_ROWS), [entries, rank])
  const w = Math.min(TIP_W, window.innerWidth - 16)
  const est = 56 + list.length * 24 + (footer ? 28 : 0)
  const left = Math.max(8, Math.min(x + 14, window.innerWidth - w - 8))
  const below = y + 18 + est <= window.innerHeight
  const top = below ? y + 18 : Math.max(8, y - 18 - est)
  const originX = Math.max(0, Math.min(100, ((x - left) / w) * 100))

  return (
    <div
      className={`reqtip${instant ? ' instant' : ''}`}
      role="tooltip"
      style={{ left, top, width: w, transformOrigin: `${originX}% ${below ? '0%' : '100%'}` }}
    >
      <div className="rt-title">
        {title} <span className="dim">· {entries.length} request{entries.length === 1 ? '' : 's'}</span>
      </div>
      {list.map((e) => (
        <div className="rt-row" key={e.id}>
          <StatusCode status={e.status} />
          <span className="ellipsis">{e.method} {e.host}{e.path}</span>
          <span className="rt-val num">{fmtRank(rank(e))}</span>
        </div>
      ))}
      {entries.length > list.length && <div className="rt-more">+{entries.length - list.length} more</div>}
      {footer && <div className="rt-foot">{footer}</div>}
    </div>
  )
}
