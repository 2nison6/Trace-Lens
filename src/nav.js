import {
  faBarsStaggered, faChartPie, faCodeCompare, faLightbulb, faNetworkWired, faToolbox, faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons'

// One list drives the sidebar, the tab bar and the number shortcuts
export const NAV = [
  { to: '/overview', label: 'Overview', icon: faChartPie, filters: true },
  { to: '/issues', label: 'Issues', icon: faTriangleExclamation },
  { to: '/waterfall', label: 'Waterfall', icon: faBarsStaggered, filters: true },
  { to: '/flow', label: 'Flow', icon: faNetworkWired, filters: true },
  { to: '/insights', label: 'Insights', icon: faLightbulb },
  { to: '/compare', label: 'Compare', icon: faCodeCompare },
  { to: '/tools', label: 'Tools', icon: faToolbox },
]

// Shown in the bottom tab bar on small screens; the rest live behind "More"
export const TAB_PRIMARY = ['/overview', '/issues', '/waterfall', '/flow']

export const SHORTCUTS = [
  ['1 – 7', 'Go to a page'],
  ['O', 'Open HAR files'],
  ['/', 'Search requests'],
  ['T', 'Switch light / dark'],
  ['B', 'Hide or show the sidebar'],
  ['Esc', 'Close the inspector or a dialog'],
  ['?', 'Show this help'],
]
