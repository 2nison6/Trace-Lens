import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faBug, faChartPie, faCodeCompare, faFileCircleXmark, faHouse, faKeyboard, faLightbulb,
  faMoon, faNetworkWired, faScrewdriverWrench, faSun, faTrash, faWaterLadder,
} from '@fortawesome/free-solid-svg-icons'
import { DEFAULT_FILTERS, InspectCtx, ListCtx } from './context'
import { filterHar, isFilterActive, parseHar } from './harParser'
import DropZone from './components/DropZone'
import FilterBar from './components/FilterBar'
import Inspector from './components/Inspector'
import RequestList from './components/RequestList'
import Overview from './components/Overview'
import Waterfall from './components/Waterfall'
import FlowView from './components/FlowView'
import Compare from './components/Compare'
import Issues from './components/Issues'
import Insights from './components/Insights'
import Tools from './components/Tools'
import './App.css'

const NAV = [
  ['/', 'Upload', faHouse, true],
  ['/overview', 'Overview', faChartPie],
  ['/issues', 'Issues', faBug],
  ['/waterfall', 'Waterfall', faWaterLadder],
  ['/flow', 'Flow', faNetworkWired],
  ['/insights', 'Insights', faLightbulb],
  ['/compare', 'Compare', faCodeCompare],
  ['/tools', 'Tools', faScrewdriverWrench],
]
const FILTERED = new Set(['/overview', '/waterfall', '/flow'])
const SHORTCUTS = [['1 – 8', 'Go to page'], ['/', 'Focus search'], ['t', 'Toggle light / dark'], ['Esc', 'Close inspector / dialogs'], ['?', 'This help']]

function readTheme() {
  try {
    return localStorage.getItem('harlens-theme') || 'dark'
  } catch {
    return 'dark'
  }
}

const page = {
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.25 } },
  exit: { opacity: 0, y: -8, transition: { duration: 0.15 } },
}
const Page = ({ children }) => <motion.div {...page}>{children}</motion.div>

function NoData() {
  return (
    <div className="empty">
      No HAR file loaded yet (files are kept in memory, so a reload clears them). <NavLink to="/">Go to Upload</NavLink>
    </div>
  )
}

function Home({ onFiles, hars, error }) {
  return (
    <Page>
      <section className="hero">
        <h1>See exactly what your <span>network</span> did.</h1>
        <p>Drop a HAR file to replay traffic, find errors and compare captures. Everything is analysed locally in your browser; nothing is uploaded.</p>
      </section>
      <DropZone onFiles={onFiles} />
      {error && <div className="notice bad"><FontAwesomeIcon icon={faFileCircleXmark} /> {error}</div>}
      {!hars.length && <p className="hint center">Export from DevTools: Network tab → “Save all as HAR with content”. Load two or more to use Compare.</p>}
    </Page>
  )
}

export default function App() {
  const [hars, setHars] = useState([])
  const [active, setActive] = useState(0)
  const [error, setError] = useState('')
  const [filters, setFilters] = useState(DEFAULT_FILTERS)
  const [inspected, setInspected] = useState(null) // { harIndex, id }
  const [listPanel, setListPanel] = useState(null) // { title, harIndex, ids, filter }
  const layers = useRef({ inspected: null, listPanel: null })
  const [toastMsg, setToastMsg] = useState('')
  const [help, setHelp] = useState(false)
  const [theme, setTheme] = useState(readTheme)
  const navigate = useNavigate()
  const location = useLocation()
  const searchRef = useRef(null)
  const toastTimer = useRef(0)

  const toast = useCallback((m) => {
    setToastMsg(m)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToastMsg(''), 2200)
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem('harlens-theme', theme)
    } catch {
      /* storage unavailable: theme just won't persist */
    }
  }, [theme])

  const addParsed = useCallback((parsed) => {
    if (!parsed.length) return
    setActive(hars.length)
    setHars([...hars, ...parsed])
    setFilters(DEFAULT_FILTERS)
    if (location.pathname === '/') navigate('/overview')
  }, [hars, navigate, location.pathname])

  const onFiles = useCallback(async (files) => {
    setError('')
    const parsed = []
    for (const f of files) {
      try {
        parsed.push(parseHar(await f.text(), f.name))
      } catch (e) {
        setError(`${f.name}: ${e.message}`)
      }
    }
    addParsed(parsed)
  }, [addParsed])

  const remove = (i) => {
    setHars(hars.filter((_, j) => j !== i))
    setActive((a) => (a > i ? a - 1 : Math.max(0, Math.min(a, hars.length - 2))))
    setInspected(null)
    setListPanel(null)
  }

  const har = hars[active] || hars[0]
  const filtered = useMemo(() => (har ? filterHar(har, filters) : null), [har, filters])
  const inspect = useCallback((id, harIndex) => setInspected({ harIndex: typeof harIndex === 'number' ? harIndex : active, id }), [active])
  const showList = useCallback((title, entries, opts = {}) => {
    setListPanel({ title, harIndex: typeof opts.harIndex === 'number' ? opts.harIndex : active, ids: entries.map((e) => e.id), filter: opts.filter || null })
  }, [active])
  const listEntries = useMemo(() => {
    const src = listPanel && hars[listPanel.harIndex]
    return src ? listPanel.ids.map((id) => src.entries[id]).filter(Boolean) : []
  }, [listPanel, hars])
  useEffect(() => {
    layers.current = { inspected, listPanel }
  })
  const entry = inspected && hars[inspected.harIndex] ? hars[inspected.harIndex].entries[inspected.id] : null

  useEffect(() => {
    const onKey = (e) => {
      const tag = (e.target.tagName || '').toLowerCase()
      const typing = tag === 'input' || tag === 'textarea' || tag === 'select'
      if (e.key === 'Escape') {
        // close one layer at a time: help, then the inspector, then the request list
        if (layers.current.inspected) setInspected(null)
        else if (layers.current.listPanel) setListPanel(null)
        setHelp(false)
        if (typing) e.target.blur()
        return
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === '?') setHelp((h) => !h)
      else if (e.key === 't') setTheme((v) => (v === 'dark' ? 'light' : 'dark'))
      else if (e.key === '/') { e.preventDefault(); searchRef.current && searchRef.current.focus() }
      else if (/^[1-8]$/.test(e.key)) navigate(NAV[Number(e.key) - 1][0])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate])

  const need = (el) => (har ? <Page>{el}</Page> : <Page><NoData /></Page>)
  const showFilters = har && FILTERED.has(location.pathname)

  return (
    <InspectCtx.Provider value={inspect}>
      <ListCtx.Provider value={showList}>
      <div className="aurora" aria-hidden="true" />
      <div className="shell">
        <aside className="side">
          <div className="brand">
            <span className="logo"><FontAwesomeIcon icon={faNetworkWired} /></span>
            <span>HAR<b>.</b>lens</span>
          </div>
          <nav aria-label="Pages">
            {NAV.map(([to, label, icon, end]) => (
              <NavLink key={to} to={to} end={end}><FontAwesomeIcon icon={icon} /><span>{label}</span></NavLink>
            ))}
          </nav>
          <div className="side-foot">
            <button className="icon-btn" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Toggle theme" title="Toggle theme (t)">
              <FontAwesomeIcon icon={theme === 'dark' ? faSun : faMoon} />
            </button>
            <button className="icon-btn" onClick={() => setHelp(true)} aria-label="Keyboard shortcuts" title="Shortcuts (?)">
              <FontAwesomeIcon icon={faKeyboard} />
            </button>
          </div>
        </aside>

        <div className="content">
          {hars.length > 0 && (
            <div className="files">
              <AnimatePresence initial={false}>
                {hars.map((h, i) => (
                  <motion.div key={`${h.fileName}-${i}`} layout initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.85 }}
                    className={`chip${i === active ? ' on' : ''}`} onClick={() => { setActive(i); setFilters(DEFAULT_FILTERS); setListPanel(null) }}>
                    <span className="ellipsis">{h.fileName}</span> <span className="dim">· {h.summary.count}</span>
                    <button className="chip-x" title="Remove" aria-label={`Remove ${h.fileName}`} onClick={(e) => { e.stopPropagation(); remove(i) }}><FontAwesomeIcon icon={faTrash} /></button>
                  </motion.div>
                ))}
              </AnimatePresence>
              <DropZone compact onFiles={onFiles} />
            </div>
          )}

          {error && location.pathname !== '/' && <div className="notice bad"><FontAwesomeIcon icon={faFileCircleXmark} /> {error}</div>}
          {showFilters && <FilterBar filters={filters} setFilters={setFilters} har={har} shown={filtered.entries.length} searchRef={searchRef} />}
          {showFilters && isFilterActive(filters) && !filtered.entries.length && <div className="notice">No requests match these filters.</div>}

          <main>
            <AnimatePresence mode="wait">
              <Routes location={location} key={location.pathname}>
                <Route path="/" element={<Home onFiles={onFiles} hars={hars} error={error} />} />
                <Route path="/overview" element={need(<Overview har={filtered} filters={filters} setFilters={setFilters} />)} />
                <Route path="/issues" element={need(<Issues har={har} key={active} />)} />
                <Route path="/waterfall" element={need(<Waterfall har={filtered} key={active} />)} />
                <Route path="/flow" element={need(<FlowView har={filtered} key={`${active}-${filtered ? filtered.entries.length : 0}`} />)} />
                <Route path="/insights" element={need(<Insights har={har} key={active} />)} />
                <Route path="/compare" element={hars.length ? <Page><Compare hars={hars} key={hars.length} /></Page> : <Page><NoData /></Page>} />
                <Route path="/tools" element={need(<Tools har={har} toast={toast} key={active} />)} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </AnimatePresence>
          </main>
        </div>
      </div>

      <RequestList
        panel={listPanel}
        entries={listEntries}
        source={hars.length > 1 && listPanel && hars[listPanel.harIndex] ? hars[listPanel.harIndex].fileName : ''}
        onClose={() => setListPanel(null)}
        onOpen={(id) => inspect(id, listPanel.harIndex)}
        onFilter={(patch) => { setFilters({ ...filters, ...patch }); setListPanel(null); navigate('/waterfall') }}
      />
      <Inspector entry={entry} source={hars.length > 1 && inspected ? hars[inspected.harIndex].fileName : ''} onClose={() => setInspected(null)} toast={toast} />

      <AnimatePresence>
        {help && (
          <motion.div className="modal-wrap" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setHelp(false)}>
            <div className="modal card" role="dialog" aria-label="Keyboard shortcuts" onClick={(e) => e.stopPropagation()}>
              <h3>Keyboard shortcuts</h3>
              <dl className="kvlist">{SHORTCUTS.map(([k, d]) => <div key={k}><dt><kbd>{k}</kbd></dt><dd>{d}</dd></div>)}</dl>
            </div>
          </motion.div>
        )}
        {toastMsg && (
          <motion.div className="toast" role="status" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}>{toastMsg}</motion.div>
        )}
      </AnimatePresence>
      </ListCtx.Provider>
    </InspectCtx.Provider>
  )
}
