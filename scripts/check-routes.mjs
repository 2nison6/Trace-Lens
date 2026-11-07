// Fails when a page in src/nav.js is missing from public/_redirects or public/_headers (it would 404 on reload in production,
// or be indexable by search engines). Run: npm run check:routes
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { PAGES, REPORT_PAGE } from '../src/nav.js'
import { GUIDES } from '../src/guides/index.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const redirects = readFileSync(path.join(root, 'public/_redirects'), 'utf8').split('\n').filter((l) => l.trim() && !l.trim().startsWith('#')).map((l) => l.trim().split(/\s+/)[0])
const headers = readFileSync(path.join(root, 'public/_headers'), 'utf8').split('\n').filter((l) => l.startsWith('/') && !l.startsWith('/*') && !l.startsWith('/assets')).map((l) => l.trim())
const missing = []
// pages from the nav, and one /guide/<topic> page per topic guide
const routes = [...PAGES.map((p) => p.to), REPORT_PAGE.to, ...GUIDES.map((g) => `/guide/${g.id}`)]
for (const to of routes) {
  if (!redirects.includes(to)) missing.push(`public/_redirects has no rule for ${to}`)
  if (!headers.includes(to)) missing.push(`public/_headers has no noindex block for ${to}`)
}
if (missing.length) { console.error(missing.join('\n')); process.exit(1) }
console.log(`ok: ${routes.length} pages covered`)
