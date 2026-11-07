import {
  faArrowUpFromBracket, faBarsStaggered, faChartPie, faCircleExclamation, faCodeCompare, faCookieBite, faKey, faLightbulb, faListCheck, faMagnifyingGlass, faNetworkWired, faRoute, faShieldHalved, faStamp, faToolbox, faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons'

// TraceLens is a set of troubleshooting tools that share one place to drop captures. Each SECTION is a tool with its own menu
// of pages. One list drives the section switcher, the sidebar menu, the tab bar and the number shortcuts.
//
// Nothing is locked. A page that needs a capture and has none shows its tool's upload prompt instead. Each tool's first page
// (`start: true`, at /<id>) is that upload prompt; it is what you land on when you pick the tool from
// the home screen. `landing` is where it goes once files are opened. `accepts` is what the tool opens, in the words the upload prompt uses.
//
// Adding a page or a section means adding its path to public/_redirects and public/_headers too, or reloading it would 404
// (scripts/check-routes.mjs checks this).
export const SECTIONS = [
  {
    id: 'har',
    landing: '/har/overview',
    accepts: 'HAR files',
    label: 'HAR analyzer',
    title: 'HAR analyzer',
    blurb: 'Waterfall, request flow, errors, slow requests and side-by-side comparison of HAR captures.',
    icon: faNetworkWired,
    pages: [
      { to: '/har', label: 'Upload', addLabel: 'Add files', icon: faArrowUpFromBracket, start: true },
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
    landing: '/saml/messages',
    accepts: 'a HAR file or a SAML-tracer export',
    label: 'SAML analyzer',
    title: 'SAML analyzer',
    blurb: 'Decode SAML sign-in messages and SAML-tracer exports, and check them for the usual causes of a broken sign-in.',
    icon: faKey,
    pages: [
      { to: '/saml', label: 'Upload', addLabel: 'Add files', icon: faArrowUpFromBracket, start: true },
      { to: '/saml/messages', label: 'Messages', icon: faKey },
    ],
  },
  {
    id: 'oauth',
    landing: '/oauth/flow',
    accepts: 'a HAR file',
    label: 'OAuth / OIDC',
    title: 'OAuth and OpenID Connect analyzer',
    blurb: 'Follow an OAuth or OpenID Connect sign-in through a HAR, check each step, and look up what an error means.',
    icon: faRoute,
    pages: [
      { to: '/oauth', label: 'Upload', addLabel: 'Add files', icon: faArrowUpFromBracket, start: true },
      { to: '/oauth/flow', label: 'Flow', icon: faRoute },
      { to: '/oauth/errors', label: 'Error lookup', icon: faMagnifyingGlass },
    ],
  },
  {
    id: 'tokens',
    landing: '/tokens/capture',
    accepts: 'a HAR file',
    label: 'Token inspector',
    title: 'Token inspector',
    blurb: 'Decode a JWT and check its expiry, audience, issuer and algorithm. Finds the tokens in a HAR too.',
    icon: faStamp,
    pages: [
      { to: '/tokens', label: 'Upload', addLabel: 'Add files', icon: faArrowUpFromBracket, start: true },
      { to: '/tokens/inspect', label: 'Inspect', icon: faShieldHalved },
      { to: '/tokens/capture', label: 'In capture', icon: faListCheck },
    ],
  },
  {
    id: 'cookies',
    landing: '/cookies/all',
    accepts: 'a HAR file',
    label: 'Cookie analyzer',
    title: 'Cookie and session analyzer',
    blurb: 'Every cookie a capture sets or sends, what is wrong with it, and why a session cookie did not come back.',
    icon: faCookieBite,
    pages: [
      { to: '/cookies', label: 'Upload', addLabel: 'Add files', icon: faArrowUpFromBracket, start: true },
      { to: '/cookies/all', label: 'All cookies', icon: faCookieBite },
      { to: '/cookies/problems', label: 'Problems', icon: faCircleExclamation },
    ],
  },
]

export const PAGES = SECTIONS.flatMap((s) => s.pages.map((p) => ({ ...p, section: s.id })))
export const sectionOf = (pathname) => SECTIONS.find((s) => pathname === `/${s.id}` || pathname.startsWith(`/${s.id}/`)) || null
export const pageOf = (pathname) => PAGES.find((p) => p.to === pathname) || null
// Where a tool goes after files are opened in it
export const landingPage = (section) => section.landing
// Pages that number keys 1-9 reach (the upload page has no number)
export const numbered = (section) => section.pages.filter((p) => !p.start)

// How many pages of the current section the bottom tab bar shows on small screens; the rest live behind "More"
export const TAB_COUNT = 4

export const SHORTCUTS = [
  ['1 – 9', 'Go to a page of the current tool'],
  ['O', 'Open files'],
  ['/', 'Search requests'],
  ['T', 'Switch light / dark'],
  ['B', 'Hide or show the sidebar'],
  ['Space  ← →', 'Flow: play or pause, step through'],
  ['P', 'Waterfall: pin the focused request'],
  ['Esc', 'Close the inspector or a dialog'],
  ['?', 'Show this help'],
]
