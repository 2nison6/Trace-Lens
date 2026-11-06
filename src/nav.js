import {
  faBarsStaggered, faChartPie, faCodeCompare, faKey, faLightbulb, faListCheck, faMagnifyingGlass, faNetworkWired, faRoute, faShieldHalved, faStamp, faToolbox, faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons'

// TraceLens is a set of troubleshooting tools that share one place to drop captures. Each SECTION is a tool with its own menu
// of pages. One list drives the section switcher, the sidebar menu, the tab bar and the number shortcuts.
//
// A page's `needs` is how many loaded HAR files it requires before it opens (1 when omitted). `needs: 0` means it also works
// on pasted text with no file loaded.
//
// Adding a page or a section means adding its path to public/_redirects and public/_headers too, or reloading it would 404
// (scripts/check-routes.mjs checks this).
export const SECTIONS = [
  {
    id: 'har',
    label: 'Network',
    title: 'HAR analyzer',
    blurb: 'Waterfall, request flow, errors, slow requests and side-by-side comparison of HAR captures.',
    icon: faNetworkWired,
    pages: [
      { to: '/har/overview', label: 'Overview', icon: faChartPie, filters: true },
      { to: '/har/issues', label: 'Issues', icon: faTriangleExclamation },
      { to: '/har/waterfall', label: 'Waterfall', icon: faBarsStaggered, filters: true },
      { to: '/har/flow', label: 'Flow', icon: faNetworkWired, filters: true },
      { to: '/har/insights', label: 'Insights', icon: faLightbulb },
      { to: '/har/compare', label: 'Compare', icon: faCodeCompare, needs: 2 },
      { to: '/har/tools', label: 'Tools', icon: faToolbox },
    ],
  },
  {
    id: 'saml',
    label: 'SAML',
    title: 'SAML analyzer',
    blurb: 'Decode SAML sign-in messages and SAML-tracer exports, and check them for the usual causes of a broken sign-in.',
    icon: faKey,
    pages: [
      { to: '/saml/messages', label: 'Messages', icon: faKey, needs: 0 },
    ],
  },
  {
    id: 'oauth',
    label: 'OAuth / OIDC',
    title: 'OAuth and OpenID Connect analyzer',
    blurb: 'Follow an OAuth or OpenID Connect sign-in through a HAR, check each step, and look up what an error means.',
    icon: faRoute,
    pages: [
      { to: '/oauth/flow', label: 'Flow', icon: faRoute },
      { to: '/oauth/errors', label: 'Error lookup', icon: faMagnifyingGlass, needs: 0 },
    ],
  },
  {
    id: 'tokens',
    label: 'Tokens',
    title: 'Token inspector',
    blurb: 'Decode a JWT and check its expiry, audience, issuer and algorithm. Finds the tokens in a HAR too.',
    icon: faStamp,
    pages: [
      { to: '/tokens/inspect', label: 'Inspect', icon: faShieldHalved, needs: 0 },
      { to: '/tokens/capture', label: 'In capture', icon: faListCheck },
    ],
  },
]

const needs = (page) => page.needs ?? 1
export const isLocked = (page, fileCount) => fileCount < needs(page)

export const PAGES = SECTIONS.flatMap((s) => s.pages.map((p) => ({ ...p, section: s.id })))
export const sectionOf = (pathname) => SECTIONS.find((s) => pathname === `/${s.id}` || pathname.startsWith(`/${s.id}/`)) || null
export const pageOf = (pathname) => PAGES.find((p) => p.to === pathname) || null
// The page a tool opens on: its first page that can open with what is loaded, else its first page (which then explains itself)
export const entryPage = (section, fileCount) => section.pages.find((p) => !isLocked(p, fileCount)) || section.pages[0]


// Why `page` can't be opened with `fileCount` files loaded, or '' when it can. Every entry point (sidebar, tab bar,
// More sheet, number keys) asks this one function, so they can never disagree. The copy covers pages that need 1 or 2 files.
export function lockReason(page, fileCount) {
  if (!isLocked(page, fileCount)) return ''
  if (needs(page) === 1) return `Upload a HAR file to open ${page.label}.`
  return fileCount === 0 ? `Upload two HAR files to use ${page.label}.` : `${page.label} needs two HAR files. Add one more to unlock it.`
}

// How many pages of the current section the bottom tab bar shows on small screens; the rest live behind "More"
export const TAB_COUNT = 4

export const SHORTCUTS = [
  ['1 – 9', 'Go to a page of the current section'],
  ['O', 'Open files'],
  ['/', 'Search requests'],
  ['T', 'Switch light / dark'],
  ['B', 'Hide or show the sidebar'],
  ['Space  ← →', 'Flow: play or pause, step through'],
  ['P', 'Waterfall: pin the focused request'],
  ['Esc', 'Close the inspector or a dialog'],
  ['?', 'Show this help'],
]
