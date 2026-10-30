import { useMemo } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faFilter, faMagnifyingGlass, faXmark } from '@fortawesome/free-solid-svg-icons'
import { DEFAULT_FILTERS } from '../context'
import { isFilterActive } from '../harParser'

const STATUS = [
  ['all', 'Any status'], ['ok', '2xx OK'], ['3xx', '3xx redirect'], ['4xx', '4xx client'], ['5xx', '5xx server'], ['failed', 'Failed (no response)'], ['errors', 'All errors'],
]
const TYPES = ['all', 'html', 'js', 'css', 'img', 'font', 'data', 'media', 'other']

export default function FilterBar({ filters, setFilters, har, shown, searchRef }) {
  const hosts = useMemo(() => har.summary.hosts.map((h) => h.host), [har])
  const set = (k) => (e) => setFilters({ ...filters, [k]: e.target.value })
  const active = isFilterActive(filters)

  return (
    <div className="filterbar card">
      <label className="search">
        <FontAwesomeIcon icon={faMagnifyingGlass} />
        <input ref={searchRef} className="input" placeholder="Search URL, method, status, MIME…  ( / )" value={filters.q} onChange={set('q')} />
      </label>
      <select className="input" value={filters.status} onChange={set('status')} aria-label="Status filter">
        {STATUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      <select className="input" value={filters.type} onChange={set('type')} aria-label="Type filter">
        {TYPES.map((t) => <option key={t} value={t}>{t === 'all' ? 'Any type' : t}</option>)}
      </select>
      <select className="input" value={filters.host} onChange={set('host')} aria-label="Host filter">
        <option value="all">Any host</option>
        {hosts.map((h) => <option key={h} value={h}>{h}</option>)}
      </select>
      <input className="input num-in" type="number" min="0" placeholder="Min KB" value={filters.minKB} onChange={set('minKB')} />
      <input className="input num-in" type="number" min="0" placeholder="Min ms" value={filters.minMs} onChange={set('minMs')} />
      <span className="filter-count">
        <FontAwesomeIcon icon={faFilter} /> {shown}/{har.entries.length}
      </span>
      {active && (
        <button className="btn" onClick={() => setFilters(DEFAULT_FILTERS)}>
          <FontAwesomeIcon icon={faXmark} /> Clear
        </button>
      )}
    </div>
  )
}
