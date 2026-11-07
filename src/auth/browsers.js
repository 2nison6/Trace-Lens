// How different browsers treat cookies in a third-party context, as a table the cookie analyzer can apply to the same capture.
//
// Sources (checked 2026-11): Chrome keeps third-party cookies ON by default (Google dropped the phase-out in 2024-2025) and blocks
// them in Incognito and when the user or an enterprise policy turns them off. Safari (WebKit ITP) "blocks all third-party cookies"
// with no exceptions except the Storage Access API, and caps cookies written by JavaScript to 7 days without interaction. Firefox
// partitions third-party storage per top-level site by default since version 103 (State Partitioning); a partitioned cookie is not
// lost, but a third party sees a separate jar on every site, so it cannot recognise the user across sites.
//
// Browser behaviour changes. The "checked" date is shown in the UI, and anything not listed here is not claimed.

export const PROFILES = [
  { id: 'chrome', label: 'Chrome (default)', thirdParty: 'allow', note: 'Third-party cookies are allowed by default. SameSite defaults to Lax. Cookies are capped at 400 days.' },
  { id: 'chrome-incognito', label: 'Chrome Incognito / third-party cookies off', thirdParty: 'block', note: 'Third-party cookies are blocked. CHIPS (Partitioned) cookies still work.', allowPartitioned: true },
  { id: 'firefox', label: 'Firefox (default)', thirdParty: 'partition', note: 'Third-party cookies are partitioned by the top-level site since Firefox 103: they work, but each site sees its own separate copy.' },
  { id: 'safari', label: 'Safari / WebKit', thirdParty: 'block', note: 'All third-party cookies are blocked. Only the Storage Access API can grant access. Script-written cookies expire after 7 days without interaction.', jsCap7: true },
  { id: 'edge', label: 'Edge (default)', thirdParty: 'allow', note: 'Like Chrome. Its Strict tracking-prevention mode blocks most third-party cookies and blocks known trackers in Balanced.' },
]
export const PROFILES_CHECKED = '2026-11'

/**
 * What a third-party cookie (one set or sent in a context from another site than the page the user is on) does in each browser.
 * Returns [{ id, label, outcome: 'works' | 'blocked' | 'partitioned', detail }] for a cookie with these attributes.
 */
export function thirdPartyOutcome(cookie) {
  const none = cookie.sameSite === 'none' && cookie.secure
  return PROFILES.map((p) => {
    if (!none) return { id: p.id, label: p.label, outcome: 'blocked', detail: 'Without SameSite=None; Secure, no browser sends or accepts it in a third-party context.' }
    if (p.thirdParty === 'allow') return { id: p.id, label: p.label, outcome: 'works', detail: 'Allowed by default.' }
    if (p.thirdParty === 'partition') return { id: p.id, label: p.label, outcome: 'partitioned', detail: 'Works inside one site, but the third party cannot see it from any other site.' }
    if (p.allowPartitioned && cookie.partitioned) return { id: p.id, label: p.label, outcome: 'partitioned', detail: 'Allowed because it is Partitioned (CHIPS).' }
    return { id: p.id, label: p.label, outcome: 'blocked', detail: p.id === 'safari' ? 'Blocked. Only the Storage Access API can grant access.' : 'Blocked in this mode.' }
  })
}

/** Summary of what depends on third-party cookies in an analysis. Returns [{ name, domain, outcomes, breaksIn: [labels] }]. */
export function thirdPartyDependencies(analysis) {
  const out = []
  for (const c of analysis.cookies) {
    if (!c.attrs || c.state !== 'stored') continue
    const tp = c.sets.some((s) => s.thirdParty)
    if (!tp) continue
    const outcomes = thirdPartyOutcome(c.attrs)
    out.push({ name: c.name, domain: c.domain, outcomes, breaksIn: outcomes.filter((o) => o.outcome === 'blocked').map((o) => o.label), partitionedIn: outcomes.filter((o) => o.outcome === 'partitioned').map((o) => o.label), attrs: c.attrs })
  }
  return out
}
