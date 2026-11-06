# HAR.lens

Analyze HAR files entirely in your browser: replay request flow, find errors and slow requests, inspect headers and compare captures. Nothing is uploaded.

Live at <https://har-analyzer.2nison6.com>.

## Features

- **Upload** by drag and drop or file picker, several files at once, with a progress overlay that shows each stage (reading, parsing, checking, building the view)
- **Overview** with totals, phase timing, content types, hosts and status codes; click a bar to list its requests
- **Issues** found by rule-based checks (errors, redirects, slow phases, payload size, caching, security headers, cookies) with a health score
- **Waterfall** with sortable columns and filters by text, status, type, host, size and time
- **Packet flow**: animated replay of requests and responses, with real-time mode and a Follow mode that isolates one request
- **Insights**: timing estimates, critical path, third-party cost, potential savings, latency distribution, protocols, concurrency, cache lifetime and endpoint latency
- **Compare** up to three captures
- **Request inspector** with headers, cookies, params, response preview and copy as cURL
- **SAML**: finds the SAML sign-in and logout messages in a capture (redirect, form post, auto-submit page and SOAP), decodes them, and shows the issuer, user, attributes, audience, validity window, status and signing certificate. It checks them for the usual causes of a broken sign-in (expired or not-yet-valid assertion, audience or ACS URL mismatch, denied status, unsigned or SHA-1 signed messages, an expired or soon-to-expire certificate) and links each response to its request. It also reads exports from the **SAML-tracer** browser extension (the JSON file from its Export button; current and pre-1.0 formats): drop one in like a HAR, or add one when the app offers to after you open a HAR that contains SAML. A SAML-tracer export records no time for each request, so the checks use the time each message says it was issued. You can also paste a `SAMLRequest` / `SAMLResponse` value, a URL, or XML with no file loaded. It reads messages; it cannot prove a signature is valid, because that needs your identity provider's key
- **Tools**: redact secrets from a HAR, export an HTML or JSON report
- Light and dark themes, keyboard shortcuts (press `?`)

### Locked pages

**Samples.** The start screen has "Try a sample" buttons: a working and a broken load of the same page (open both for Compare), a HAR with a working SAML sign-in, and a SAML-tracer export of a failed one. They live in `public/demo/` and are made by `node scripts/make-demo-data.mjs`. Every host, user and token in them is invented, and the XML signatures are placeholders (the certificates' private keys were discarded), so the app can read them but nothing could verify them.

Every page except SAML needs data, so the sidebar, tab bar and shortcuts are locked until a HAR is loaded, and **Compare** stays locked until two are loaded. SAML also works on a pasted message, so it is always open. Clicking a locked page, or pressing its number key (1 to 7), shows an error toast at the top right and does not navigate.

## Getting started

Needs Node 20.19+ or 22.12+ (`.nvmrc` pins 22).

```bash
npm install
npm run dev      # start the dev server
npm run build    # production build in dist/
npm run lint
```

Export a HAR from DevTools: Network tab, then "Save all as HAR with content".

## How loading works

`index.html` ships a static splash (`#boot`), so something is on screen while the JavaScript bundle downloads. The app removes it after its first painted frame (`src/boot.js`). If the bundle has not started after 10 seconds, the splash turns into a message with a Reload button.

Opening a file (`src/ingest.js`) is a queue: read, parse, analyze, then add the captures and open Overview in one transition. Parsing is synchronous, so the overlay is committed and painted before it runs, and it is animated by CSS so it keeps moving while the main thread is busy. It appears after 100 ms (a fast load never flashes it), stays at least 250 ms once shown, and goes away only after the new page has painted.

## Deploying (Netlify)

The site builds from this repository: build command `npm run build`, publish directory `dist` (both set in `netlify.toml`), Node version from `.nvmrc`.

**No environment variables are required.** The canonical site URL defaults to the production origin in `vite.config.js`. Set `VITE_SITE_URL` in Netlify (Site configuration, Environment variables) only to override it, for example on a staging site. Do not mark it as a secret: the value is public and appears in the built HTML.

- `public/_headers`: security headers and CSP, immutable caching for `/assets/*`, the manifest content type, and `X-Robots-Tag: noindex` for the app pages.
- `public/_redirects`: the single-page-app routes (including `/saml`), listed explicitly. There is deliberately no `/* /index.html 200` catch-all, so an unknown URL returns a real 404 with `public/404.html` instead of a "soft 404" that search engines distrust. **When you add a page, add its path to `_redirects` (and `_headers`) as well, or reloading it will 404.**
- Other hosts need the same security headers, the same route fallbacks to `index.html`, and a 404 page.

## SEO and search

Already in place: title and description, canonical link and `og:url`, absolute Open Graph and Twitter images, structured data (`WebSite` and `WebApplication`), per-page titles, one `<h1>` per page, and `noindex` on the app pages (they are empty shells without a file). `sitemap.xml` and `robots.txt` are generated at build time for the site origin, so the domain is written in one place only.

After the first deploy, in [Google Search Console](https://search.google.com/search-console):

1. Add the site as a property (a Domain property covers every subdomain; a URL-prefix property for `https://har-analyzer.2nison6.com/` is quicker) and verify ownership.
2. Submit `https://har-analyzer.2nison6.com/sitemap.xml` under Sitemaps.
3. Open URL Inspection, enter the home page and choose Request indexing.
4. Check the page with the Rich Results Test, and import the site into Bing Webmaster Tools.
5. Link to it from your own site and profiles. New sites can take days to weeks to appear, and no one can guarantee a ranking.

## Stack

React, Vite, React Router, Framer Motion, Font Awesome Free.

## Privacy

HAR files are parsed in memory in your browser and are never sent anywhere. Files are not saved, so a reload clears them. HAR files often contain live tokens and cookies; use Tools > Scrubber before sharing one.
