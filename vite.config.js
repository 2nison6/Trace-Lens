import process from 'node:process'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { SECTIONS } from './src/app/nav.js'

// Canonical origin of the production site. Builds use it when VITE_SITE_URL is not set, so Netlify needs no environment
// variable. Set VITE_SITE_URL (shell or Netlify UI) to override it, for example for a staging site.
const PRODUCTION_SITE_URL = 'https://tracelens.2nison6.com'

// Search and social crawlers need absolute URLs: a canonical link must be absolute, and Open Graph / Twitter ignore
// relative images. Given the deployed origin this
//   - replaces __SITE_URL__ in index.html (structured data),
//   - adds canonical + og:url and makes og:image / twitter:image absolute,
//   - emits sitemap.xml and robots.txt for that origin, so the domain lives in exactly one place.
// With no origin (the dev server) the page still works; link previews just may not show the image.
const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// The page is a client-rendered app, so before JavaScript runs #root is empty. Search engines and link checkers that read the raw
// HTML would see no heading, no text and no links. This writes a plain-HTML description of the site into #root at build time.
// React replaces it as soon as the app mounts (and the boot splash covers it until then), so users never see it.
// Tool names and descriptions come from src/app/nav.js, so this cannot drift from the menu.
function seoShell() {
  const tools = SECTIONS.map(
    (s) => `<li><a href="${s.pages[0].to}"><b>${escHtml(s.title)}</b></a>: ${escHtml(s.blurb)} Pages: ${escHtml(s.pages.filter((p) => !p.start).map((p) => p.label).join(', '))}.</li>`,
  ).join('\n')
  return `<main data-seo-shell>
<h1>TraceLens: find out why the sign-in broke</h1>
<p>TraceLens is a free set of troubleshooting tools for network and sign-in problems. Drop in a capture or paste a message, and it shows what went wrong and what to look at first. It runs entirely in your browser, so nothing you open is uploaded.</p>
<h2>Tools</h2>
<ul>
${tools}
</ul>
<h2>What you get</h2>
<p>Every finding has a short note in plain language: what it means, why it breaks things and what to check first. Each tool can write a report with charts, and there is one report for everything, as HTML, Markdown or JSON. Secrets can be redacted from a HAR file before you share it.</p>
<h2>Private by design</h2>
<p>Captures, tokens, keys and certificates are processed in memory in your browser and are never sent anywhere. The app makes no network requests once it has loaded.</p>
<h2>How to start</h2>
<p>Pick a tool above. Each one has its own start page with steps for capturing exactly what it needs from Chrome, Edge, Firefox or Safari. The <a href="/guide">guide</a> also has a checklist for each symptom, such as a redirect loop, a sign-in that works for some users, or a session cookie that does not come back.</p>
<p>Made by <a href="https://2nison6.com" rel="noopener">Nitish Soni</a>. The source is on <a href="https://github.com/2nison6/Trace-Lens" rel="noopener">GitHub</a>.</p>
</main>`
}

function siteUrls(siteUrl) {
  const base = (siteUrl || '').trim().replace(/\/+$/, '')
  return {
    name: 'site-urls',
    transformIndexHtml(html) {
      const out = html.replaceAll('__SITE_URL__', base).replace('<!--SEO_SHELL-->', seoShell())
      if (!base) return out
      return out
        .replace(/(<meta (?:property="og:image"|name="twitter:image") content=")\/([^"]*")/g, `$1${base}/$2`)
        .replace('</head>', `    <link rel="canonical" href="${base}/" />\n    <meta property="og:url" content="${base}/" />\n  </head>`)
    },
    generateBundle() {
      if (!base) return
      // Only the home page belongs here. The other routes need a file loaded, so on their own they are empty pages, and
      // they are marked noindex. No <lastmod>: a made-up date is worse than none.
      this.emitFile({
        type: 'asset',
        fileName: 'sitemap.xml',
        source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url>\n    <loc>${base}/</loc>\n  </url>\n</urlset>\n`,
      })
      this.emitFile({
        type: 'asset',
        fileName: 'robots.txt',
        source: `User-agent: *\nAllow: /\n\nSitemap: ${base}/sitemap.xml\n`,
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  // Only builds fall back to the production origin; the dev server stays origin-relative unless VITE_SITE_URL is set.
  const siteUrl = env.VITE_SITE_URL || (command === 'build' ? PRODUCTION_SITE_URL : '')
  return {
    plugins: [react(), siteUrls(siteUrl)],
  }
})
