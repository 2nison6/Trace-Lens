import { useMemo, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faMagnifyingGlass, faSliders, faXmark } from '@fortawesome/free-solid-svg-icons'
import { DEFAULT_FILTERS } from '../../../app/context'
import { isFilterActive } from '../../../har/harParser'
import { Kbd } from '../../../components/shared/ui'

const STATUS = [
  ['all', 'Any status'], ['ok', 'Success (2xx)'], ['3xx', 'Redirect (3xx)'], ['4xx', 'Client error (4xx)'], ['5xx', 'Server error (5xx)'], ['failed', 'No response'], ['errors', 'All errors'],
]
const TYPES = ['all', 'html', 'js', 'css', 'img', 'font', 'data', 'media', 'other']

export default function FilterBar({ filters, setFilters, har, shown, searchRef }) {
  const [open, setOpen] = useState(false)
  const hosts = useMemo(() => har.summary.hosts.map((h) => h.host), [har])
  const set = (k) => (e) => setFilters({ ...filters, [k]: e.target.value })
  const active = isFilterActive(filters)
  const chips = [
    filters.status !== 'all' && ['status', STATUS.find((s) => s[0] === filters.status)?.[1]],
    filters.type !== 'all' && ['type', filters.type],
    filters.host !== 'all' && ['host', filters.host],
    filters.minKB && ['minKB', `≥ ${filters.minKB} KB`],
    filters.minMs && ['minMs', `≥ ${filters.minMs} ms`],
  ].filter(Boolean)

  return (
    <div className="filters">
      <div className="filters-row">
        <label className="search">
          <FontAwesomeIcon icon={faMagnifyingGlass} aria-hidden="true" />
          <input ref={searchRef} type="search" placeholder="Filter requests" aria-label="Filter requests" value={filters.q} onChange={set('q')} />
          <Kbd>/</Kbd>
        </label>
        <button type="button" className={`btn${open || chips.length ? ' on' : ''}`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <FontAwesomeIcon icon={faSliders} /> <span>Filters{chips.length ? ` · ${chips.length}` : ''}</span>
        </button>
        <span className="filters-count num" aria-live="polite">{shown} of {har.entries.length}</span>
      </div>

      {chips.length > 0 && (
        <div className="chips">
          {chips.map(([k, label]) => (
            <button key={k} type="button" className="chip-f" onClick={() => setFilters({ ...filters, [k]: DEFAULT_FILTERS[k] })} aria-label={`Remove filter ${label}`}>
              {label} <FontAwesomeIcon icon={faXmark} />
            </button>
          ))}
          <button type="button" className="link" onClick={() => setFilters(DEFAULT_FILTERS)}>Clear all</button>
        </div>
      )}

      {open && (
        <div className="filters-panel">
          <label>Status
            <select value={filters.status} onChange={set('status')}>{STATUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </label>
          <label>Type
            <select value={filters.type} onChange={set('type')}>{TYPES.map((t) => <option key={t} value={t}>{t === 'all' ? 'Any type' : t}</option>)}</select>
          </label>
          <label>Host
            <select value={filters.host} onChange={set('host')}>
              <option value="all">Any host</option>
              {hosts.map((h) => <option key={h} value={h}>{h}</option>)}
            </select>
          </label>
          <label>Min size (KB)
            <input type="number" min="0" inputMode="numeric" value={filters.minKB} onChange={set('minKB')} />
          </label>
          <label>Min time (ms)
            <input type="number" min="0" inputMode="numeric" value={filters.minMs} onChange={set('minMs')} />
          </label>
          {active && <button type="button" className="btn" onClick={() => setFilters(DEFAULT_FILTERS)}>Clear all</button>}
        </div>
      )}
    </div>
  )
}
