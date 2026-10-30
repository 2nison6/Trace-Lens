import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { AnimatePresence, MotionConfig, motion } from 'framer-motion'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faCircleHalfStroke, faDesktop, faEllipsis, faFolderOpen, faKeyboard, faLock, faMoon, faNetworkWired, faSun,
  faTriangleExclamation, faXmark,
} from '@fortawesome/free-solid-svg-icons'
import { DEFAULT_FILTERS, InspectCtx, ListCtx, SelectedCtx } from './context'
import { filterHar, parseHar } from './harParser'
import { NAV, SHORTCUTS, TAB_PRIMARY } from './nav'
import useMediaQuery from './hooks/useMediaQuery'
import DropZone, { AddFiles } from './components/DropZone'
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
import Footer from './components/Footer'
import { EmptyState, Kbd, Notice, Segmented } from './components/ui'
import './styles/index.css'

const THEMES = [
  { value: 'system', label: 'Auto', icon: <FontAwesomeIcon icon={faDesktop} /> },
  { value: 'light', label: 'Light', icon: <FontAwesomeIcon icon={faSun} /> },
  { value: 'dark', label: 'Dark', icon: <FontAwesomeIcon icon={faMoon} /> },
]
const FILTERED = new Set(NAV.filter((n) => n.filters).map((n) => n.to))

function readPref(key, fallback) {
  try { return localStorage.getItem(key) || fallback } catch { return fallback }
}
function writePref(key, value) {
  try { localStorage.setItem(key, value) } catch { /* storage unavailable: the preference just won't persist */ }
}

// Page change: a short fade + 8px rise. Skipped for keyboard navigation (used all day) and under reduced motion.
const pageMotion = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.2, ease: [0.23, 1, 0.32, 1] } },
  exit: { opacity: 0, transition: { duration: 0.1 } },
}
const Page = ({ children }) => <motion.div {...pageMotion}>{children}</motion.div>

function Home({ onFiles, hasFiles, error, onDismiss }) {
  return (
    <Page>
      <section className="start">
        <p className="start-eyebrow"><FontAwesomeIcon icon={faLock} /> Runs entirely in your browser</p>
        <h1 className="t-display">Read your network, request by request.</h1>
        <p className="start-lede">Drop a HAR file and HAR.lens replays the traffic, flags what went wrong, and lets you compare captures side by side.</p>
        <DropZone onFiles={onFiles} />
        {error && <Notice tone="crit" icon={faTriangleExclamation} onDismiss={() => onDismiss()}>{error}</Notice>}
        <ol className="how">
          <li><b>Export</b><span>In DevTools, open Network, then choose “Save all as HAR with content”.</span></li>
          <li><b>Drop it here</b><span>Nothing is uploaded. Files stay in this tab and disappear when you close it.</span></li>
          <li><b>Explore</b><span>{hasFiles ? 'Your files are loaded: pick a page from the sidebar.' : 'Load two or more to unlock Compare.'}</span></li>
        </ol>
      </section>
    </Page>
  )
}

export default function App() {
  const [hars, setHars] = useState([])
  const [active, setActive] = useState(0)
  const [error, setError] = useState('')
  const [filters, setFilters] = useState(DEFAULT_FILTERS)
  const [dock, setDock] = useState(null) // { type: 'inspect' | 'list', ... }
  const [toastMsg, setToastMsg] = useState('')
  const [help, setHelp] = useState(false)
  const [more, setMore] = useState(false)
  const [themePref, setThemePref] = useState(() => readPref('harlens-theme', 'system'))
  const [collapsed, setCollapsed] = useState(() => readPref('harlens-side', '0') === '1')
  const navigate = useNavigate()
  const location = useLocation()
  const searchRef = useRef(null)
  const toastTimer = useRef(0)
  const dockRef = useRef(dock)
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)')
  const narrow = useMediaQuery('(max-width: 760px)')
  const theme = themePref === 'system' ? (prefersDark ? 'dark' : 'light') : themePref

  useEffect(() => { dockRef.current = dock })
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#030407' : '#f4f6fa')
  }, [theme])
  const changeTheme = (v) => { setThemePref(v); writePref('harlens-theme', v) }
  const toggleSide = useCallback(() => setCollapsed((c) => { writePref('harlens-side', c ? '0' : '1'); return !c }), [])

  const toast = useCallback((m) => {
    setToastMsg(m)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToastMsg(''), 2200)
  }, [])

  const addParsed = useCallback((parsed) => {
    if (!parsed.length) return
    setActive(hars.length)
    setHars([...hars, ...parsed])
    setFilters(DEFAULT_FILTERS)
    setDock(null)
    if (location.pathname === '/') navigate('/overview')
  }, [hars, navigate, location.pathname])

  const onFiles = useCallback(async (files) => {
    setError('')
    const parsed = []
    for (const f of files) {
      try {
        parsed.push(parseHar(await f.text(), f.name))
      } catch (e) {
        setError(`${f.name}: ${e instanceof SyntaxError ? 'this file is not valid JSON' : e.message}`)
      }
    }
    addParsed(parsed)
  }, [addParsed])

  // Dropping a file anywhere on the page opens it, so the start screen is never the only way in
  useEffect(() => {
    const over = (e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault() }
    const drop = (e) => { if (e.dataTransfer?.files?.length) { e.preventDefault(); onFiles([...e.dataTransfer.files]) } }
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    return () => { window.removeEventListener('dragover', over); window.removeEventListener('drop', drop) }
  }, [onFiles])

  const remove = (i) => {
    setHars(hars.filter((_, j) => j !== i))
    setActive((a) => (a > i ? a - 1 : Math.max(0, Math.min(a, hars.length - 2))))
    setDock(null)
  }

  const har = hars[active] || hars[0]
  const filtered = useMemo(() => (har ? filterHar(har, filters) : null), [har, filters])
  const inspect = useCallback((id, harIndex) => setDock({ type: 'inspect', id, harIndex: typeof harIndex === 'number' ? harIndex : active }), [active])
  const showList = useCallback((title, entries, opts = {}) => {
    setDock({ type: 'list', title, harIndex: typeof opts.harIndex === 'number' ? opts.harIndex : active, ids: entries.map((e) => e.id), filter: opts.filter || null })
  }, [active])

  const dockHar = dock && hars[dock.harIndex]
  const entry = dock?.type === 'inspect' && dockHar ? dockHar.entries[dock.id] : null
  const listEntries = useMemo(() => (dock?.type === 'list' && hars[dock.harIndex] ? dock.ids.map((id) => hars[dock.harIndex].entries[id]).filter(Boolean) : []), [dock, hars])
  const selected = entry ? { id: entry.id, harIndex: dock.harIndex } : null
  const source = hars.length > 1 && dockHar ? dockHar.fileName : ''
  const docked = !!dock && !narrow // wide: the dock sits beside the page; narrow: it becomes a sheet

  const pickerRef = useRef(null)
  useEffect(() => {
    const onKey = (e) => {
      const tag = (e.target.tagName || '').toLowerCase()
      const typing = tag === 'input' || tag === 'textarea' || tag === 'select'
      if (e.key === 'Escape') {
        if (help) setHelp(false)
        else if (more) setMore(false)
        else if (dockRef.current) setDock(null)
        if (typing) e.target.blur()
        return
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return
      const k = e.key.toLowerCase()
      if (k === '?') setHelp((h) => !h)
      else if (k === 't') changeTheme(theme === 'dark' ? 'light' : 'dark')
      else if (k === 'b') toggleSide()
      else if (k === 'o') pickerRef.current?.click()
      else if (k === '/') { e.preventDefault(); searchRef.current?.focus() }
      else if (/^[1-7]$/.test(k)) navigate(NAV[Number(k) - 1].to)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate, help, more, theme, toggleSide])

  const need = (el) => (har ? <Page>{el}</Page> : <Page><EmptyState icon={faFolderOpen} title="No file loaded" action={<NavLink className="btn primary" to="/">Open a HAR file</NavLink>}>Files are kept in memory, so a reload clears them.</EmptyState></Page>)
  const showFilters = har && FILTERED.has(location.pathname)
  const current = NAV.find((n) => n.to === location.pathname)
  const tabItems = NAV.filter((n) => TAB_PRIMARY.includes(n.to))
  const moreItems = NAV.filter((n) => !TAB_PRIMARY.includes(n.to))

  return (
    <MotionConfig reducedMotion="user">
      <InspectCtx.Provider value={inspect}>
        <ListCtx.Provider value={showList}>
          <SelectedCtx.Provider value={selected}>
            <a className="skip" href="#main">Skip to content</a>
            <div className={`app${collapsed && !narrow ? ' side-collapsed' : ''}${docked ? ' has-dock' : ''}`}>
              <aside className="side glass" aria-label="Sidebar">
                <NavLink to="/" className="brand" aria-label="HAR.lens home">
                  <span className="logo"><FontAwesomeIcon icon={faNetworkWired} /></span>
                  <span className="brand-t">HAR<b>.</b>lens</span>
                </NavLink>
                <nav aria-label="Pages">
                  {NAV.map((n, i) => (
                    <NavLink key={n.to} to={n.to} title={collapsed ? `${n.label} (${i + 1})` : undefined}>
                      <FontAwesomeIcon icon={n.icon} fixedWidth />
                      <span>{n.label}</span>
                      <Kbd>{i + 1}</Kbd>
                    </NavLink>
                  ))}
                </nav>

                {hars.length > 0 && (
                  <div className="files" aria-label="Loaded files">
                    <h2 className="side-h">Files</h2>
                    {hars.map((h, i) => (
                      <div key={`${h.fileName}-${i}`} className={`file${i === active ? ' on' : ''}`}>
                        <button type="button" className="file-b" aria-pressed={i === active} onClick={() => { setActive(i); setFilters(DEFAULT_FILTERS); setDock(null) }} title={h.fileName}>
                          <span className="ellipsis">{h.fileName}</span>
                          <small className="num">{h.summary.count}</small>
                        </button>
                        <button type="button" className="file-x" onClick={() => remove(i)} aria-label={`Remove ${h.fileName}`}><FontAwesomeIcon icon={faXmark} /></button>
                      </div>
                    ))}
                    <AddFiles onFiles={onFiles} />
                  </div>
                )}

                <div className="side-foot">
                  <Segmented size="s" label="Appearance" value={themePref} onChange={changeTheme} options={THEMES.map((t) => ({ value: t.value, label: '', icon: t.icon }))} />
                  <button type="button" className="icon-btn" onClick={() => setHelp(true)} aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)"><FontAwesomeIcon icon={faKeyboard} /></button>
                </div>
              </aside>

              <div className="main-col">
                <header className="topbar glass">
                  <div className="crumbs">
                    <button type="button" className="icon-btn side-toggle" onClick={toggleSide} aria-label={collapsed ? 'Show sidebar' : 'Hide sidebar'} title="Toggle sidebar (B)"><FontAwesomeIcon icon={faCircleHalfStroke} /></button>
                    <h1 className="page-title">{current ? current.label : 'Open a file'}</h1>
                    {har && current && <span className="page-sub ellipsis" title={har.fileName}>{har.fileName}</span>}
                  </div>
                  {hars.length > 0 && <div className="top-actions"><AddFiles onFiles={onFiles} pickerRef={pickerRef} /></div>}
                </header>

                <main id="main" className="content">
                  {error && location.pathname !== '/' && <Notice tone="crit" icon={faTriangleExclamation} onDismiss={() => setError('')}>{error}</Notice>}
                  {showFilters && <FilterBar filters={filters} setFilters={setFilters} har={har} shown={filtered.entries.length} searchRef={searchRef} />}
                  <AnimatePresence mode="wait" initial={false}>
                    <Routes location={location} key={location.pathname}>
                      <Route path="/" element={<Home onFiles={onFiles} hasFiles={hars.length > 0} error={error} onDismiss={() => setError('')} />} />
                      <Route path="/overview" element={need(<Overview har={filtered} filters={filters} setFilters={setFilters} />)} />
                      <Route path="/issues" element={need(<Issues har={har} key={active} />)} />
                      <Route path="/waterfall" element={need(<Waterfall har={filtered} key={active} />)} />
                      <Route path="/flow" element={need(<FlowView har={filtered} key={`${active}-${filtered ? filtered.entries.length : 0}`} />)} />
                      <Route path="/insights" element={need(<Insights har={har} key={active} />)} />
                      <Route path="/compare" element={hars.length ? <Page><Compare hars={hars} key={hars.length} /></Page> : need(null)} />
                      <Route path="/tools" element={need(<Tools har={har} toast={toast} key={active} />)} />
                      <Route path="*" element={<Navigate to="/" replace />} />
                    </Routes>
                  </AnimatePresence>
                </main>
                <Footer />
              </div>

              <AnimatePresence initial={false}>
                {dock && (
                  <motion.aside
                    key="dock"
                    className={`dock glass${narrow ? ' sheet' : ''}`}
                    role="complementary"
                    aria-label={dock.type === 'inspect' ? 'Request inspector' : 'Request list'}
                    initial={narrow ? { y: '100%' } : { x: 28, opacity: 0 }}
                    animate={narrow ? { y: 0 } : { x: 0, opacity: 1 }}
                    exit={narrow ? { y: '100%' } : { x: 28, opacity: 0 }}
                    transition={{ duration: 0.26, ease: [0.32, 0.72, 0, 1] }}
                  >
                    {narrow && <button type="button" className="grabber" onClick={() => setDock(null)} aria-label="Close panel" />}
                    {dock.type === 'inspect'
                      ? <Inspector entry={entry} source={source} onClose={() => setDock(null)} toast={toast} />
                      : <RequestList panel={dock} entries={listEntries} source={source} onClose={() => setDock(null)} onOpen={(id) => inspect(id, dock.harIndex)} onFilter={(patch) => { setFilters({ ...filters, ...patch }); setDock(null); navigate('/waterfall') }} />}
                  </motion.aside>
                )}
              </AnimatePresence>
              {narrow && dock && <div className="scrim" onClick={() => setDock(null)} aria-hidden="true" />}

              {narrow && (
                <nav className="tabbar glass" aria-label="Pages">
                  {tabItems.map((n) => (
                    <NavLink key={n.to} to={n.to}><FontAwesomeIcon icon={n.icon} /><span>{n.label}</span></NavLink>
                  ))}
                  <button type="button" className={`tab-more${more || moreItems.some((n) => n.to === location.pathname) ? ' active' : ''}`} aria-expanded={more} onClick={() => setMore((m) => !m)}>
                    <FontAwesomeIcon icon={faEllipsis} /><span>More</span>
                  </button>
                </nav>
              )}
              <AnimatePresence>
                {narrow && more && (
                  <>
                    <motion.div className="scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setMore(false)} />
                    <motion.div className="more-sheet glass" role="menu" initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 24, opacity: 0 }} transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}>
                      {moreItems.map((n) => <NavLink key={n.to} to={n.to} role="menuitem" onClick={() => setMore(false)}><FontAwesomeIcon icon={n.icon} fixedWidth /> {n.label}</NavLink>)}
                      <button type="button" role="menuitem" onClick={() => { setMore(false); pickerRef.current?.click() }}><FontAwesomeIcon icon={faFolderOpen} fixedWidth /> Open HAR file</button>
                      <div className="more-theme"><Segmented size="s" label="Appearance" value={themePref} onChange={changeTheme} options={THEMES.map((t) => ({ value: t.value, label: t.label, icon: t.icon }))} /></div>
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>

            <AnimatePresence>
              {help && (
                <motion.div className="modal-wrap" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} onClick={() => setHelp(false)}>
                  <motion.div className="modal" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" onClick={(e) => e.stopPropagation()}
                    initial={{ opacity: 0, scale: 0.96, y: 6 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }} transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}>
                    <header><h2>Keyboard shortcuts</h2><button type="button" className="icon-btn" onClick={() => setHelp(false)} aria-label="Close"><FontAwesomeIcon icon={faXmark} /></button></header>
                    <dl className="kvlist">{SHORTCUTS.map(([k, d]) => <div key={k}><dt><Kbd>{k}</Kbd></dt><dd>{d}</dd></div>)}</dl>
                  </motion.div>
                </motion.div>
              )}
              {toastMsg && (
                <motion.div key="toast" className="toast" role="status" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}>{toastMsg}</motion.div>
              )}
            </AnimatePresence>
          </SelectedCtx.Provider>
        </ListCtx.Provider>
      </InspectCtx.Provider>
    </MotionConfig>
  )
}
