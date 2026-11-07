// Building every report from what the app has open. `ctx`: { har, traces, pasted, inputs, now }.
import { extractSaml } from '../saml/extract'
import { parseSamlXml } from '../saml/parse'
import { certsReport, cookiesReport, harReport, oauthReport, overviewReport, samlReport, tokensReport, windowsReport, ORDER } from './build'

export { ORDER }

export async function buildReport(id, ctx) {
  const { har, traces = [], pasted = [], inputs = {}, now = Date.now() } = ctx
  switch (id) {
    case 'har': return harReport(har)
    case 'saml': {
      const found = har ? await extractSaml(har) : []
      const all = [...found, ...traces.flatMap((t) => t.items), ...pasted].map((it) => ({ ...it, parsed: it.xml ? parseSamlXml(it.xml) : null }))
      return samlReport(all, { now, metadata: inputs.metadata })
    }
    case 'oauth': return oauthReport(har, { discovery: inputs.discovery })
    case 'tokens': return tokensReport(har, { loadedAt: now, inspected: inputs.tokenInspect })
    case 'certs': return inputs.certs ? certsReport({ ...inputs.certs, now }) : null
    case 'windows': return windowsReport(har)
    case 'cookies': return cookiesReport(har)
    default: return null
  }
}

/** { har: report|null, saml: ..., ... } for every tool. */
export async function buildAll(ctx) {
  const out = {}
  for (const id of ORDER) {
    try { out[id] = await buildReport(id, ctx) } catch (e) { out[id] = null; out[`${id}Error`] = String(e.message || e) }
  }
  return out
}

export { overviewReport }
