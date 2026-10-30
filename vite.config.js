import process from 'node:process'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// Social crawlers (Open Graph / Twitter) ignore relative URLs, and a canonical link must be absolute. Set VITE_SITE_URL
// (for example in .env.production) to the deployed origin and this adds canonical + og:url and makes og:image /
// twitter:image absolute. Without it the page still works; previews just may not show the image.
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
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  return {
    plugins: [react(), siteUrls(env.VITE_SITE_URL)],
  }
})
