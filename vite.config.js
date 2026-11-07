import process from 'node:process'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// Canonical origin of the production site. Builds use it when VITE_SITE_URL is not set, so Netlify needs no environment
// variable. Set VITE_SITE_URL (shell or Netlify UI) to override it, for example for a staging site.
const PRODUCTION_SITE_URL = 'https://tracelens.2nison6.com'

// Search and social crawlers need absolute URLs: a canonical link must be absolute, and Open Graph / Twitter ignore
// relative images. Given the deployed origin this
//   - replaces __SITE_URL__ in index.html (structured data),
//   - adds canonical + og:url and makes og:image / twitter:image absolute,
//   - emits sitemap.xml and robots.txt for that origin, so the domain lives in exactly one place.
// With no origin (the dev server) the page still works; link previews just may not show the image.
function siteUrls(siteUrl) {
  const base = (siteUrl || '').trim().replace(/\/+$/, '')
  return {
    name: 'site-urls',
    transformIndexHtml(html) {
      const out = html.replaceAll('__SITE_URL__', base)
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
