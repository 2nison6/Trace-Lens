import { startTransition, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { AnimatePresence, MotionConfig, motion } from 'framer-motion'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faChevronDown, faCircleHalfStroke, faDesktop, faEllipsis, faFolderOpen, faKeyboard, faKey, faLock, faMagnifyingGlassChart, faMoon, faSun,
  faTriangleExclamation, faXmark,
} from '@fortawesome/free-solid-svg-icons'
import { DEFAULT_FILTERS, InspectCtx, ListCtx, SelectedCtx } from './context'
import { filterHar } from './harParser'
import { ingest } from './ingest'
import { loadStore } from './loadStore'
import { deleteSaved } from './persist'
import { isReady, signalReady } from './boot'
import { PAGES, SECTIONS, SHORTCUTS, TAB_COUNT, landingPage, numbered, pageOf, sectionOf } from './nav'
import useMediaQuery from './hooks/useMediaQuery'
import usePicker from './hooks/usePicker'
import { AddFiles } from './components/DropZone'
import ToolStart from './components/ToolStart'
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
import Saml from './components/Saml'
import SamlPrompt from './components/SamlPrompt'
import SamlMetadata from './components/SamlMetadata'
import Certificates from './components/Certificates'
import { WindowsExchange, WindowsLookup } from './components/WindowsAuth'
import { TokenInspect, TokensInCapture } from './components/Tokens'
import { OAuthErrors, OAuthFlow } from './components/OAuth'
import OAuthDiscovery from './components/OAuthDiscovery'
import { CookiesAll, CookiesProblems } from './components/Cookies'
import Footer from './components/Footer'
import LoadOverlay from './components/LoadOverlay'
import { Kbd, Notice, Segmented } from './components/ui'
import './styles/index.css'

const THEMES = [
  { value: 'system', label: 'Auto', icon: <FontAwesomeIcon icon={faDesktop} /> },
  { value: 'light', label: 'Light', icon: <FontAwesomeIcon icon={faSun} /> },
  { value: 'dark', label: 'Dark', icon: <FontAwesomeIcon icon={faMoon} /> },
]
const FILTERED = new Set(PAGES.filter((n) => n.filters).map((n) => n.to))

function readPref(key, fallback) {
  try { return localStorage.getItem(key) || fallback } catch { return fallback }
}
function writePref(key, value) {
  try { localStorage.setItem(key, value) } catch { /* storage unavailable: the preference just won't persist */ }
}

// A page fades and rises in with a CSS animation (.page in layout.css; reduced motion is handled globally in tokens.css).
// There is deliberately no exit animation: AnimatePresence mode="wait" would hold the next page back for ~100 ms, and the
// upload overlay (which stays until the new page has painted) could not tell when the page had really arrived.
function Page({ children }) {
  // The first page is part of the boot: it appears as the splash goes away instead of fading in behind it
  const [enter] = useState(() => isReady())
  return <div className={enter ? 'page' : undefined}>{children}</div>
}

// Loaded captures and which one is selected, kept together so adding or removing files updates both atomically.
function library(state, action) {
  switch (action.type) {
    case 'add': return { ...state, hars: [...state.hars, ...action.parsed], active: action.parsed.length ? state.hars.length : state.active, traces: [...state.traces, ...(action.traces || [])] }
    case 'select': return { ...state, active: action.index }
    case 'removeTrace': return { ...state, traces: state.traces.filter((t) => t.uid !== action.uid) }
    case 'remove': {
      const hars = state.hars.filter((_, j) => j !== action.index)
      const a = state.active
      return { ...state, hars, active: a > action.index ? a - 1 : Math.max(0, Math.min(a, state.hars.length - 2)) }
    }
    default: return state
  }
}

// The home screen lists the analyzers. Picking one opens that tool's own start page (its upload prompt and menu).
function Home() {
  return (
    <Page>
      <section className="start">
        <p className="start-eyebrow"><FontAwesomeIcon icon={faLock} /> Runs entirely in your browser</p>
        <h1 className="t-display">Find out why the sign-in broke.</h1>
        <p className="start-lede">TraceLens is a set of troubleshooting tools for network and sign-in problems. Pick one to start. Nothing you open is uploaded.</p>
        <div className="tools-grid" role="list">
          {SECTIONS.map((s) => (
            <NavLink key={s.id} to={s.pages[0].to} className="tool-card" data-section={s.id} role="listitem">
              <span className="tool-ic"><FontAwesomeIcon icon={s.icon} /></span>
              <b>{s.title}</b>
              <span>{s.blurb}</span>
              <small>{s.pages.filter((p) => !p.start).map((p) => p.label).join(' · ')}</small>
            </NavLink>
          ))}
        </div>
      </section>
    </Page>
  )
}

// A link to a page of a tool. The page you are on is marked current by NavLink.
function PageLink({ item, hint, onClick, children, ...rest }) {
  return (
    <NavLink {...rest} to={item.to} end onClick={onClick}>
      {children}
      {hint}
    </NavLink>
  )
}

export default function App() {
  const [{ hars, active, traces }, dispatch] = useReducer(library, { hars: [], active: 0, traces: [] })
  const [error, setError] = useState('')
  const [filters, setFilters] = useState(DEFAULT_FILTERS)
  const [dock, setDock] = useState(null) // { type: 'inspect' | 'list', ... }
  const [toastMsg, setToastMsg] = useState(null) // { id, text, tone } or null
  const [help, setHelp] = useState(false)
  const [pastedSaml, setPastedSaml] = useState([]) // SAML messages pasted in by hand, shared by the SAML pages
  const [samlAsk, setSamlAsk] = useState(null) // { found: [{ name, n }], hadTrace } after a HAR with SAML in it was opened
  const [more, setMore] = useState(false)
  const [manual, setManual] = useState({}) // sidebar groups the user opened or closed by hand; the current tool's group is open otherwise
  const [seenTool, setSeenTool] = useState(null)
  const [themePref, setThemePref] = useState(() => readPref('harlens-theme', 'system'))
  const [collapsed, setCollapsed] = useState(() => readPref('harlens-side', '0') === '1')
  const navigate = useNavigate()
  const location = useLocation()
  const searchRef = useRef(null)
  const toastTimer = useRef(0)
  const toastSeq = useRef(0)
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

  // tone: 'info' (default) or 'error'. A fresh id on every call re-mounts the pill, so repeating a message replays it.
  const toast = useCallback((text, tone = 'info') => {
    setToastMsg({ id: ++toastSeq.current, text, tone })
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToastMsg(null), tone === 'error' ? 3200 : 2200)
  }, [])

  // The page the user is on right now, readable from async code without a stale closure
  const pathRef = useRef(location.pathname)
  const readyRef = useRef(null)
  useEffect(() => { pathRef.current = location.pathname }, [location.pathname])

  // Adds freshly parsed captures and opens Overview in ONE transition, so data and route commit together. Resolves once
  // that commit has happened; the upload overlay waits for it (and for the next paint) before it goes away.
  const commit = useCallback(({ hars: parsed, traces: opened }) => new Promise((resolve) => {
    readyRef.current = resolve
    startTransition(() => {
      dispatch({ type: 'add', parsed, traces: opened })
      setFilters(DEFAULT_FILTERS)
      setDock(null)
      // Where to go once files are open. A tool's start page (or the home screen) moves on to that tool's first real page, so you
      // see the result of what you just opened; a page that was already showing data stays where it is. A SAML-tracer export
      // has no Overview to show, so opening one with no HAR takes you to the SAML tool wherever you are.
      const here = sectionOf(pathRef.current)
      const onStart = pathRef.current === '/' || (here && pathRef.current === `/${here.id}`)
      if (!parsed.length && opened.length) {
        if (here?.id !== 'saml' || onStart) navigate('/saml/messages')
      } else if (onStart) navigate(here ? landingPage(here) : '/har/overview')
    })
  }), [navigate])
  useEffect(() => {
    readyRef.current?.()
    readyRef.current = null
  }, [hars, traces, location.pathname])

  // Reading, parsing and the overlay live in ingest.js
  const onFiles = useCallback((files) => {
    setError('')
    ingest(files, {
      commit,
      report: (failed) => setError(failed.join(' · ')),
      // a HAR that carries SAML: offer to add the matching SAML-tracer export
      finish: ({ samlFound }) => setSamlAsk({ found: samlFound }),
    })
  }, [commit])

  // Dropping a file anywhere on the page opens it, so the start screen is never the only way in
  useEffect(() => {
    const over = (e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault() }
    // A drop on the start screen's drop zone or the Add file button is already handled by React (which calls preventDefault): don't open it twice
    const drop = (e) => { if (!e.defaultPrevented && e.dataTransfer?.files?.length) { e.preventDefault(); onFiles([...e.dataTransfer.files]) } }
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    return () => { window.removeEventListener('dragover', over); window.removeEventListener('drop', drop) }
  }, [onFiles])

  // A page that just became locked (the last file went, or Compare lost its second one) stays open and shows its own
  // empty state, which says what to do next and offers the button for it.
  const removeTrace = (t) => { deleteSaved(t.name); dispatch({ type: 'removeTrace', uid: t.uid }) }
  const remove = (i) => {
    if (hars[i]) deleteSaved(hars[i].fileName)
    dispatch({ type: 'remove', index: i })
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

  const fileCount = hars.length
  // One picker that is always mounted: the toolbar's Add file only exists once a file is loaded, but the O key and the
  // More sheet's "Open HAR file" must work from an empty start too.
  const pickerRef = useRef(null)
  const picker = usePicker(onFiles, pickerRef)
  useEffect(() => {
    const onKey = (e) => {
      if (loadStore.get()) return // a file is being opened: shortcuts would act on a half-loaded app
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
      else if (/^[1-9]$/.test(k)) {
        const sec = sectionOf(pathRef.current)
        const page = sec && numbered(sec)[Number(k) - 1]
        if (page) navigate(page.to)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate, help, more, theme, toggleSide])

  // A page that needs a capture, with none loaded, shows its tool's upload prompt (with a line saying why) instead of an empty page
  const section = sectionOf(location.pathname)
  const need = (el) => (har ? <Page>{el}</Page> : <Page><ToolStart section={section} onFiles={onFiles} fileCount={fileCount} toast={toast} why={`${pageOf(location.pathname)?.label || 'This page'} needs a capture. Open ${section?.accepts || 'a file'} below.`} /></Page>)
  const startPage = (sec) => <Page><ToolStart section={sec} onFiles={onFiles} fileCount={fileCount} toast={toast} /></Page>
  const showFilters = har && FILTERED.has(location.pathname)
  const current = pageOf(location.pathname)
  const sectionLabel = section ? section.label : ''
  // Home keeps the title and robots rule index.html ships with. Every other page is named after itself and asks search
  // engines not to index it: they are tools that need a file, so on their own they are empty pages.
  const [homeTitle] = useState(() => document.title)
  const [homeRobots] = useState(() => document.querySelector('meta[name="robots"]')?.getAttribute('content') || 'index, follow')
  useEffect(() => {
    document.title = current ? `${current.label} · ${sectionLabel} · TraceLens` : homeTitle
    document.querySelector('meta[name="robots"]')?.setAttribute('content', current ? 'noindex, follow' : homeRobots)
  }, [current, sectionLabel, homeTitle, homeRobots])
  useEffect(() => { signalReady() }, []) // the first frame is on screen: the static splash in index.html can go
  const Title = location.pathname === '/' ? 'p' : 'h1' // Home has its own <h1>, and one page should have only one
  const toastError = toastMsg?.tone === 'error'
  // Entering another tool forgets what was opened or closed by hand, so the tool you are in is always the open one
  if (seenTool !== (section ? section.id : null)) { setSeenTool(section ? section.id : null); setManual({}) }
  const pageList = section ? section.pages : []
  const tabItems = pageList.slice(0, TAB_COUNT)
  const moreItems = pageList.slice(TAB_COUNT)
  const toolTabs = SECTIONS.slice(0, TAB_COUNT)

  return (
    <MotionConfig reducedMotion="user">
      <InspectCtx.Provider value={inspect}>
        <ListCtx.Provider value={showList}>
          <SelectedCtx.Provider value={selected}>
            <a className="skip" href="#main">Skip to content</a>
            {picker.input}
            <div className={`app${collapsed && !narrow ? ' side-collapsed' : ''}${docked ? ' has-dock' : ''}`}>
              <aside className="side glass" aria-label="Sidebar">
                <NavLink to="/" className="brand" aria-label="TraceLens home">
                  <span className="logo"><FontAwesomeIcon icon={faMagnifyingGlassChart} /></span>
                  <span className="brand-t">Trace<b>Lens</b></span>
                </NavLink>
                <nav className="tree" aria-label="Tools">
                  {SECTIONS.map((s) => {
                    const cur = section?.id === s.id
                    const isOpen = manual[s.id] ?? cur
                    let n = 0
                    return (
                      <div key={s.id} className={`grp${cur ? ' current' : ''}`}>
                        <button
                          type="button" className="grp-h" aria-expanded={isOpen} aria-controls={`grp-${s.id}`} data-section={s.id} title={collapsed ? s.title : undefined}
                          onClick={() => { if (!cur) { navigate(s.pages[0].to); setManual((m) => ({ ...m, [s.id]: true })) } else setManual((m) => ({ ...m, [s.id]: !isOpen })) }}
                        >
                          <FontAwesomeIcon icon={s.icon} fixedWidth />
                          <span>{s.label}</span>
                          <FontAwesomeIcon icon={faChevronDown} className="grp-chev" />
                        </button>
                        <div id={`grp-${s.id}`} className="grp-body" data-open={isOpen} inert={!isOpen}>
                          <div className="grp-in">
                            {s.pages.map((p) => {
                              const key = p.start ? null : ++n
                              return (
                                <PageLink key={p.to} item={p} hint={key && key <= 9 ? <Kbd>{key}</Kbd> : null} title={collapsed ? p.label : undefined}>
                                  <FontAwesomeIcon icon={p.icon} fixedWidth />
                                  <span>{p.label}</span>
                                </PageLink>
                              )
                            })}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </nav>

                {(hars.length > 0 || traces.length > 0) && (
                  <div className="files" aria-label="Loaded files">
                    <h2 className="side-h">Files</h2>
                    {hars.map((h, i) => (
                      <div key={`${h.fileName}-${i}`} className={`file${i === active ? ' on' : ''}`}>
                        <button type="button" className="file-b" aria-pressed={i === active} onClick={() => { dispatch({ type: 'select', index: i }); setFilters(DEFAULT_FILTERS); setDock(null) }} title={h.fileName}>
                          <span className="ellipsis">{h.fileName}</span>
                          <small className="num">{h.summary.count}</small>
                        </button>
                        <button type="button" className="file-x" onClick={() => remove(i)} aria-label={`Remove ${h.fileName}`}><FontAwesomeIcon icon={faXmark} /></button>
                      </div>
                    ))}
                    {traces.map((t) => (
                      <div key={t.uid} className="file trace">
                        <NavLink className="file-b" to="/saml/messages" title={`${t.name}: a SAML-tracer export`}>
                          <span className="ellipsis"><FontAwesomeIcon icon={faKey} /><span className="ellipsis">{t.name}</span></span>
                          <small className="num">{t.items.length}</small>
                        </NavLink>
                        <button type="button" className="file-x" onClick={() => removeTrace(t)} aria-label={`Remove ${t.name}`}><FontAwesomeIcon icon={faXmark} /></button>
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
                    <Title className="page-title">{current ? current.label : 'Open a file'}</Title>
                    {har && current && <span className="page-sub ellipsis" title={har.fileName}>{har.fileName}</span>}
                  </div>
                  {hars.length > 0 && <div className="top-actions"><AddFiles onFiles={onFiles} /></div>}
                </header>

                <main id="main" className="content">
                  {error && <Notice tone="crit" icon={faTriangleExclamation} onDismiss={() => setError('')}>{error}</Notice>}
                  {showFilters && <FilterBar filters={filters} setFilters={setFilters} har={har} shown={filtered.entries.length} searchRef={searchRef} />}
                  <Routes location={location} key={location.pathname}>
                    <Route path="/" element={<Home />} />
                    {SECTIONS.map((s) => <Route key={s.id} path={`/${s.id}`} element={startPage(s)} />)}
                    <Route path="/har/overview" element={need(<Overview har={filtered} full={har} filters={filters} setFilters={setFilters} toast={toast} />)} />
                    <Route path="/har/issues" element={need(<Issues har={har} toast={toast} key={active} />)} />
                    <Route path="/har/waterfall" element={need(<Waterfall har={filtered} toast={toast} key={active} />)} />
                    <Route path="/har/flow" element={need(<FlowView har={filtered} key={`${active}-${filtered ? filtered.entries.length : 0}`} />)} />
                    <Route path="/har/insights" element={need(<Insights har={har} key={active} />)} />
                    <Route path="/har/compare" element={need(<Compare hars={hars} toast={toast} key={hars.length} />)} />
                    <Route path="/har/tools" element={need(<Tools har={har} hars={hars} toast={toast} key={active} />)} />
                    <Route path="/saml/messages" element={<Page><Saml har={har} traces={traces} pasted={pastedSaml} setPasted={setPastedSaml} onFiles={onFiles} toast={toast} key={active} /></Page>} />
                    <Route path="/saml/metadata" element={<Page><SamlMetadata har={har} traces={traces} pasted={pastedSaml} key={active} /></Page>} />
                    <Route path="/oauth/flow" element={need(<OAuthFlow har={har} key={active} />)} />
                    <Route path="/oauth/discovery" element={<Page><OAuthDiscovery har={har} key={active} /></Page>} />
                    <Route path="/oauth/errors" element={<Page><OAuthErrors /></Page>} />
                    <Route path="/certs/inspect" element={<Page><Certificates /></Page>} />
                    <Route path="/windows/exchange" element={need(<WindowsExchange har={har} key={active} />)} />
                    <Route path="/windows/lookup" element={<Page><WindowsLookup /></Page>} />
                    <Route path="/cookies/all" element={need(<CookiesAll har={har} key={active} />)} />
                    <Route path="/cookies/problems" element={need(<CookiesProblems har={har} key={active} />)} />
                    <Route path="/tokens/inspect" element={<Page><TokenInspect toast={toast} /></Page>} />
                    <Route path="/tokens/capture" element={need(<TokensInCapture har={har} toast={toast} key={active} />)} />
                    {/* the old, un-prefixed addresses keep working for bookmarks */}
                    {['overview', 'issues', 'waterfall', 'flow', 'insights', 'compare', 'tools'].map((p) => <Route key={p} path={`/${p}`} element={<Navigate to={`/har/${p}`} replace />} />)}
                    <Route path="*" element={<Navigate to="/" replace />} />
                  </Routes>
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
                      : <RequestList panel={dock} entries={listEntries} source={source} onClose={() => setDock(null)} onOpen={(id) => inspect(id, dock.harIndex)} onFilter={(patch) => { setFilters({ ...filters, ...patch }); setDock(null); navigate('/har/waterfall') }} />}
                  </motion.aside>
                )}
              </AnimatePresence>
              {narrow && dock && <div className="scrim" onClick={() => setDock(null)} aria-hidden="true" />}

              {narrow && (
                <nav className="tabbar glass" aria-label="Pages">
                  {(section ? tabItems : toolTabs.map((s) => ({ ...s.pages[0], label: s.label, icon: s.icon }))).map((n) => (
                    <PageLink key={n.to} item={n}><FontAwesomeIcon icon={n.icon} /><span>{n.label}</span></PageLink>
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
                      {moreItems.map((n) => <PageLink key={n.to} item={n} role="menuitem" onClick={() => setMore(false)}><FontAwesomeIcon icon={n.icon} fixedWidth /> {n.label}</PageLink>)}
                      {(section ? SECTIONS : SECTIONS.slice(TAB_COUNT)).filter((s) => s.id !== section?.id).map((s) => <PageLink key={s.id} item={s.pages[0]} role="menuitem" onClick={() => setMore(false)}><FontAwesomeIcon icon={s.icon} fixedWidth /> {s.title}</PageLink>)}
                      <button type="button" role="menuitem" onClick={() => { setMore(false); pickerRef.current?.click() }}><FontAwesomeIcon icon={faFolderOpen} fixedWidth /> Open files</button>
                      <div className="more-theme"><Segmented size="s" label="Appearance" value={themePref} onChange={changeTheme} options={THEMES.map((t) => ({ value: t.value, label: t.label, icon: t.icon }))} /></div>
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>

            <LoadOverlay />
            <AnimatePresence>
              {samlAsk && !loadStore.get() && (
                <SamlPrompt found={samlAsk.found} hasTrace={traces.length > 0} onFiles={onFiles} onClose={() => setSamlAsk(null)} onOpen={() => { setSamlAsk(null); navigate('/saml/messages') }} />
              )}
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
                <motion.div key={toastMsg.id} className={`toast${toastError ? ' toast-error' : ''}`} role={toastError ? 'alert' : 'status'} initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}>
                  {toastError && <FontAwesomeIcon icon={faTriangleExclamation} />}
                  {toastMsg.text}
                </motion.div>
              )}
            </AnimatePresence>
          </SelectedCtx.Provider>
        </ListCtx.Provider>
      </InspectCtx.Provider>
    </MotionConfig>
  )
}
