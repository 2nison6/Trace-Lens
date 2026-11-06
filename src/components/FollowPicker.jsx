import { memo, useEffect, useId, useMemo, useRef, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faMagnifyingGlass, faXmark } from '@fortawesome/free-solid-svg-icons'

const LIMIT = 50 // rows rendered at once, however large the capture is

const label = (e) => `${e.method} ${e.host}${e.path}`

/**
 * Search-as-you-type picker for the request Flow should follow.
 *
 * It replaces a <select> with one <option> per request. That was slow to mount for big captures and, because Flow re-renders on
 * every animation frame during playback, slow to keep alive: this component is memoised and only renders the first LIMIT
 * matches, so playback never touches it.
 */
function FollowPicker({ entries, value, onPick }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const listId = useId()
  const rootRef = useRef(null)
  const selected = useMemo(() => (value === '' ? null : entries.find((e) => e.id === Number(value)) || null), [entries, value])

  const { rows, total } = useMemo(() => {
    if (!open) return { rows: [], total: 0 }
    const needle = q.trim().toLowerCase()
    const out = []
    let n = 0
    for (const e of entries) {
      if (needle && !label(e).toLowerCase().includes(needle)) continue
      n++
      if (out.length < LIMIT) out.push(e)
    }
    return { rows: out, total: n }
  }, [entries, q, open])

  // "All requests" is the first row of the list, so index 0 means "clear", and index i + 1 is rows[i]
  const count = rows.length + 1

  useEffect(() => {
    if (!open) return undefined
    const away = (ev) => { if (rootRef.current && !rootRef.current.contains(ev.target)) setOpen(false) }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [open])

  const choose = (index) => {
    onPick(index === 0 ? '' : String(rows[index - 1].id))
    setOpen(false)
    setQ('')
  }
  const onKeyDown = (ev) => {
    if (ev.key === 'ArrowDown') { ev.preventDefault(); setOpen(true); setActive((a) => Math.min(count - 1, a + 1)) }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); setActive((a) => Math.max(0, a - 1)) }
    else if (ev.key === 'Enter' && open) { ev.preventDefault(); choose(Math.min(active, count - 1)) }
    else if (ev.key === 'Escape' && open) { ev.preventDefault(); ev.stopPropagation(); setOpen(false) }
  }

  return (
    <div className="follow-pick" ref={rootRef}>
      <label className="follow-in">
        <FontAwesomeIcon icon={faMagnifyingGlass} aria-hidden="true" />
        <span className="vh">Follow a request</span>
        <input
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open ? `${listId}-${active}` : undefined}
          autoComplete="off"
          spellCheck={false}
          placeholder={selected ? label(selected) : 'Follow a request…'}
          value={q}
          onChange={(ev) => { setQ(ev.target.value); setActive(0); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
      </label>
      {selected && (
        <button type="button" className="icon-btn follow-x" aria-label="Stop following, show all requests" onClick={() => { onPick(''); setQ('') }}>
          <FontAwesomeIcon icon={faXmark} />
        </button>
      )}
      {open && (
        <ul className="follow-list" role="listbox" id={listId} aria-label="Requests">
          <li id={`${listId}-0`} role="option" aria-selected={value === ''} className={active === 0 ? 'on' : ''} onMouseDown={(ev) => ev.preventDefault()} onClick={() => choose(0)} onMouseEnter={() => setActive(0)}>
            All requests
          </li>
          {rows.map((e, i) => (
            <li key={e.id} id={`${listId}-${i + 1}`} role="option" aria-selected={String(e.id) === value} className={active === i + 1 ? 'on' : ''} onMouseDown={(ev) => ev.preventDefault()} onClick={() => choose(i + 1)} onMouseEnter={() => setActive(i + 1)}>
              <b>{e.method}</b> <span className="ellipsis">{e.host}{e.path}</span> <small className={e.error ? 'bad' : ''}>{e.status || 'ERR'}</small>
            </li>
          ))}
          {!rows.length && <li className="none" role="presentation">No request matches “{q}”</li>}
          {total > rows.length && <li className="none" role="presentation">Showing {rows.length} of {total}. Keep typing to narrow it down.</li>}
        </ul>
      )}
    </div>
  )
}

export default memo(FollowPicker)
