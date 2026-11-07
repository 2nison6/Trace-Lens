import { SECTIONS } from './nav'

// "SAML → Messages → Verify signature" -> a link to the SAML Messages page. Matches the first two parts against the nav.
// A tool may be named by its label ("SAML analyzer"), its full title, its id ("saml"), or its short name ("SAML", "Network", "Tokens", "Cookies")
const SHORT = { har: ['network'], saml: ['saml'], oauth: ['oauth', 'oauth / oidc'], tokens: ['tokens', 'token'], cookies: ['cookies'], windows: ['windows sign-in', 'windows'], certs: ['certificate inspector', 'certificates'], guide: ['guide'] }
const SECTION_NAMES = new Map(SECTIONS.flatMap((s) => [[s.label.toLowerCase(), s], [s.title.toLowerCase(), s], [s.id, s], ...(SHORT[s.id] || []).map((n) => [n, s])]))
/** Turn a reference like "SAML → Messages → Verify signature" into the route of the page it names (the first two parts), or null. */
export function resolveRef(ref) {
  const parts = String(ref).split('→').map((x) => x.trim())
  const sec = SECTION_NAMES.get(parts[0].toLowerCase())
  if (!sec) return null
  if (parts.length === 1) return sec.pages[0].to
  const page = sec.pages.find((p) => p.label.toLowerCase() === parts[1].toLowerCase())
  return page ? page.to : sec.pages[0].to
}

