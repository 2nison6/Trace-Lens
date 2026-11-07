# TraceLens

Troubleshoot network and sign-in problems entirely in your browser. Analyze HAR files, decode SAML and SAML-tracer exports, follow OAuth 2.0 / OpenID Connect sign-ins, inspect JWTs, and find out why a cookie did not stick. Nothing is uploaded.

(Formerly HAR.lens.)

Live at <https://har-analyzer.2nison6.com>.

## Tools

TraceLens is a set of tools. The home screen lists them; picking one opens its own start page (where you drop files, with samples for that tool) and its menu. In the sidebar each tool is a dropdown that holds its pages, and the one you are in is open. Number keys `1` to `9` open the pages of the current tool. A page that needs a capture, opened with none loaded, shows its tool's upload prompt.

### Network (HAR analyzer)

- **Upload** by drag and drop or file picker, several files at once, with an overlay that shows progress
- **Overview** with totals, phase timing, content types, hosts and status codes; click a bar to list its requests
- **Issues** found by rule-based checks (errors, redirects, slow phases, payload size, caching, security headers, cookies) with a health score
- **Waterfall** with sortable columns and filters by text, status, type, host, size and time
- **Flow**: animated replay of requests and responses, with real-time mode and a Follow mode that isolates one request
- **Insights**: timing estimates, critical path, third-party cost, potential savings, latency distribution, protocols, concurrency, cache lifetime and endpoint latency
- **Compare** up to three captures
- **Request inspector** with headers, cookies, params, response preview and copy as cURL
- **Tools**: redact secrets from a HAR, trim and merge, export an HTML or JSON report

### SAML

Finds the SAML sign-in and logout messages in a capture (redirect, form post, auto-submit page and SOAP), decodes them, and shows the issuer, user, attributes, audience, validity window, status and signing certificate. It checks them for the usual causes of a broken sign-in (expired or not-yet-valid assertion, audience or ACS URL mismatch, denied status, unsigned or SHA-1 signed messages, an expired or soon-to-expire certificate) and links each response to its request. It also reads exports from the **SAML-tracer** browser extension (the JSON file from its Export button; current and pre-1.0 formats): drop one in like a HAR, or add one when the app offers to after you open a HAR that contains SAML. A SAML-tracer export records no time for each request, so the checks use the time each message says it was issued. You can also paste a `SAMLRequest` / `SAMLResponse` value, a URL, or XML with no file loaded. It reads messages; it cannot prove a signature is valid, because that needs your identity provider's key.

### OAuth / OpenID Connect

Finds each sign-in in a HAR (authorization request, the response to the app, the token request) and compares the steps with each other: `redirect_uri` that differs between requests, `state` that does not come back, a PKCE verifier that does not match its challenge, a missing or wrong `nonce`, dropped scopes, a client secret sent from the browser, and an ID token with the wrong audience or an expired time. An **Error lookup** page explains `invalid_grant`, `redirect_uri_mismatch`, `AADSTS…` codes and about sixty other errors, and works with nothing loaded. The browser only shows its own side: when the app's server makes the token request, it is not in a browser capture, and the tool says so.

### Tokens

Paste a JWT, or list the tokens found in a loaded HAR (Authorization headers, URL and form parameters, JSON responses, cookies). Checks expiry, not-before, issued-at, issuer, audience, scopes, the algorithm (`none`, shared-secret tokens, embedded key sources), dates written in milliseconds instead of seconds, and a missing `exp`. It decodes; it cannot verify a signature, which needs the issuer's key.

### Cookies

Lists every cookie a capture sets or sends, judges whether a browser would have stored each one (Secure over HTTP, `SameSite=None` without `Secure`, `__Host-` and `__Secure-` prefixes, wrong `Domain`, third-party context, size), and replays the capture against a model of the browser's cookie jar to find cookies that should have been sent and were not. Chrome's default "Save all as HAR" removes cookies; the tool says so when it sees none. It cannot see the browser's own privacy settings, so a missing cookie may have been blocked by one of those.

### Everywhere

- Light and dark themes, keyboard shortcuts (press `?`)

## Getting started

Needs Node 20.19+ or 22.12+ (`.nvmrc` pins 22).

```bash
npm install
npm run dev      # start the dev server
npm run build    # production build in dist/
npm run lint
npm run check:routes   # every page in src/nav.js has a hosting rule and a noindex header
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
