import process from 'node:process'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// Canonical origin of the production site. Builds use it when VITE_SITE_URL is not set, so Netlify needs no environment
// variable. Set VITE_SITE_URL (shell or Netlify UI) to override it, for example for a staging site.
const PRODUCTION_SITE_URL = 'https://har-analyzer.2nison6.com'

// Social crawlers (Open Graph / Twitter) ignore relative URLs, and a canonical link must be absolute. Given the deployed
// origin this adds canonical + og:url and makes og:image / twitter:image absolute. With no origin (the dev server) the
// page still works; previews just may not show the image.
function siteUrls(siteUrl) {
  const base = (siteUrl || '').trim().replace(/\/+$/, '')
  return {
    name: 'site-urls',
    transformIndexHtml(html) {
      if (!base) return html
      return html
        .replace(/(<meta (?:property="og:image"|name="twitter:image") content=")\/([^"]*")/g, `$1${base}/$2`)
        .replace('</head>', `    <link rel="canonical" href="${base}/" />\n    <meta property="og:url" content="${base}/" />\n  </head>`)
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
