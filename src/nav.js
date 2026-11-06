import {
  faBarsStaggered, faChartPie, faCodeCompare, faLightbulb, faNetworkWired, faToolbox, faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons'

// One list drives the sidebar, the tab bar and the number shortcuts.
// `needs` is how many loaded HAR files a page requires before it opens (1 when omitted).
export const NAV = [
  { to: '/overview', label: 'Overview', icon: faChartPie, filters: true },
  { to: '/issues', label: 'Issues', icon: faTriangleExclamation },
  { to: '/waterfall', label: 'Waterfall', icon: faBarsStaggered, filters: true },
  { to: '/flow', label: 'Flow', icon: faNetworkWired, filters: true },
  { to: '/insights', label: 'Insights', icon: faLightbulb },
  { to: '/compare', label: 'Compare', icon: faCodeCompare, needs: 2 },
  { to: '/tools', label: 'Tools', icon: faToolbox },
]

const needs = (page) => page.needs || 1

export const isLocked = (page, fileCount) => fileCount < needs(page)

// Why `page` can't be opened with `fileCount` files loaded, or '' when it can. Every entry point (sidebar, tab bar,
// More sheet, 1-7 keys) asks this one function, so they can never disagree. The copy covers pages that need 1 or 2 files.
export function lockReason(page, fileCount) {
  if (!isLocked(page, fileCount)) return ''
  if (needs(page) === 1) return `Upload a HAR file to open ${page.label}.`
  return fileCount === 0 ? `Upload two HAR files to use ${page.label}.` : `${page.label} needs two HAR files. Add one more to unlock it.`
}

// Shown in the bottom tab bar on small screens; the rest live behind "More"
export const TAB_PRIMARY = ['/overview', '/issues', '/waterfall', '/flow']

export const SHORTCUTS = [
  ['1 – 7', 'Go to a page'],
  ['O', 'Open HAR files'],
  ['/', 'Search requests'],
  ['T', 'Switch light / dark'],
  ['B', 'Hide or show the sidebar'],
  ['Space  ← →', 'Flow: play or pause, step through'],
  ['P', 'Waterfall: pin the focused request'],
  ['Esc', 'Close the inspector or a dialog'],
  ['?', 'Show this help'],
]
