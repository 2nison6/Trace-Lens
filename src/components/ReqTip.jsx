import { useMemo } from 'react'
import { fmtMs, statusClass } from '../utils'

const MAX_ROWS = 8
const TIP_W = 340

// Floating list of the requests behind a bar / card. Positioned in viewport coordinates.
export default function ReqTip({ x, y, title, entries, rank, fmtRank = fmtMs, footer }) {
  const list = useMemo(() => [...entries].sort((a, b) => rank(b) - rank(a)).slice(0, MAX_ROWS), [entries, rank])
  const w = Math.min(TIP_W, window.innerWidth - 16)
  const est = 56 + list.length * 24 + (footer ? 22 : 0)
  const left = Math.max(8, Math.min(x + 14, window.innerWidth - w - 8))
  const top = y + 18 + est <= window.innerHeight ? y + 18 : Math.max(8, y - 18 - est)

  return (
    <div className="reqtip" role="tooltip" style={{ left, top, width: w }}>
      <div className="rt-title">
        {title} <span className="dim">· {entries.length} request{entries.length === 1 ? '' : 's'}</span>
      </div>
      {list.map((e) => (
        <div className="rt-row" key={e.id}>
          <b className={statusClass(e.status)}>{e.status || 'ERR'}</b>
          <span className="ellipsis">{e.method} {e.host}{e.path}</span>
          <span className="rt-val">{fmtRank(rank(e))}</span>
        </div>
      ))}
      {!list.length && <div className="dim">No requests.</div>}
      {entries.length > list.length && <div className="rt-more">+{entries.length - list.length} more</div>}
      {footer && <div className="rt-foot">{footer}</div>}
    </div>
  )
}
