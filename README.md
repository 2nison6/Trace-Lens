# TraceLens

Troubleshoot network and sign-in problems entirely in your browser. Analyze HAR files, decode SAML and SAML-tracer exports, follow OAuth 2.0 / OpenID Connect sign-ins, inspect JWTs and certificates, follow Windows sign-in (Kerberos and NTLM), and find out why a cookie did not stick. Each finding can be explained in plain language, and each tool can export its own report. Nothing is uploaded.

(Formerly HAR.lens.)

Live at <https://tracelens.2nison6.com>.

## Tools

TraceLens is a set of eight tools. The home screen shows them as a 4 × 2 grid; picking one opens its own start page (where you drop files, with instructions for capturing what that tool needs) and its menu. In the sidebar each tool is a dropdown that holds its pages, and the one you are in is open. Number keys `1` to `9` open the pages of the current tool. A page that needs a capture, opened with none loaded, shows its tool's upload prompt.

### Network (HAR analyzer)

- **Upload** by drag and drop or file picker, several files at once, with an overlay that shows progress
- **Overview** with totals, phase timing, content types, hosts and status codes; click a bar to list its requests
- **Issues** found by rule-based checks with a health score: errors, redirects, slow phases, payload size, caching and validators, security headers, cookies, rate limiting (429) and retry storms, duplicate calls, large JSON, `Authorization` header mistakes, and CORS pitfalls
- **Waterfall** with sortable columns and filters by text, status, type, host, size and time
- **Flow**: animated replay of requests and responses, with real-time mode and a Follow mode that isolates one request
- **Insights**: timing estimates, critical path, third-party cost, potential savings, latency distribution, protocols, concurrency, cache lifetime and endpoint latency
- **Compare** up to three captures, with a **regression check**: a pass/fail against a budget you set (load time, bytes, requests, new errors, health score)
- **Request inspector** with headers, cookies, params, response preview and copy as cURL
- **Tools**: redact secrets from a HAR (including OAuth codes, PKCE verifiers and URLs in redirect headers), trim and merge, and export the full request-level HTML or JSON report (the **Report** page makes a shorter, shareable one)

### SAML

- **Messages**: finds the SAML sign-in and logout messages in a capture (redirect, form post, auto-submit page and SOAP), decodes them, and shows the issuer, user, attributes, audience, validity window, status and signing certificate. Reads **SAML-tracer** exports (current and pre-1.0 formats), or a pasted value, URL or XML.
- **Checks** for the usual causes of a broken sign-in: expired or not-yet-valid assertion, audience, ACS and Recipient mismatches, denied status, unsigned or SHA-1 signed messages, expired or soon-to-expire certificates, NameID and attribute problems (empty values, Microsoft Entra group overage), and the sign-in as a whole (SP- or IdP-initiated, request and response agreement, timing, clock skew), with hints for Entra ID, Okta, ADFS, Keycloak, Shibboleth, Google and others.
- **Verify signature**: checks an XML signature in the browser against the identity provider's certificate you paste (exclusive canonicalization, RSA and ECDSA). It refuses duplicate IDs, signatures placed in the wrong element, and unsupported transforms, which are how signature-wrapping attacks work.
- **Metadata**: paste IdP or SP metadata; it checks expiry, endpoints and certificates, and compares them with the messages in the trace (entity ID, ACS URL, audience, Recipient, signing certificate not in the published metadata).

### OAuth / OpenID Connect

- **Flow**: finds each sign-in in a HAR (authorization request, the response to the app, the token request) and compares the steps: `redirect_uri` that differs, `state` that does not come back, a PKCE verifier that does not match its challenge, a missing or wrong `nonce`, dropped scopes, a client secret sent from the browser, an ID token with the wrong audience. Also every token request: refresh-token reuse, device flow, client credentials, the password grant.
- **Discovery & keys**: paste `/.well-known/openid-configuration` and the JWKS; checks them, compares them with the sign-in, and tells you whether a token's `kid` is in the key set (a missing one means the keys rotated).
- **Error lookup**: `invalid_grant`, `redirect_uri_mismatch`, `AADSTS…` and about sixty other errors, with usual causes and fixes. Works with nothing loaded.

The browser only shows its own side: when the app's server makes the token request, it is not in a browser capture, and the tool says so.

### Tokens

- **Inspect**: paste a JWT; checks expiry, not-before, issuer, audience, scopes, the algorithm, dates written in milliseconds, and provider-specific claim gotchas (Entra v1 vs v2, group overage, Cognito, Okta, Auth0, Google).
- **Verify the signature** against a pasted public key, certificate, JWK or JWKS (RS/PS/ES/HS 256, 384, 512). A token that says HS256 is only checked against a pasted secret, never against a public key, and `alg: none` is never accepted.
- **In capture / Timeline**: the tokens found in a HAR (headers, URLs, forms, JSON responses, cookies), and when each was issued, valid, used and rejected.
- **Compare**: two tokens claim by claim, the differences that matter first.

### Certificates

Paste a certificate or a chain in any order. It orders the chain, finds a missing intermediate, and checks dates, names (SAN, wildcard rules), key strength, key usage and CA constraints. It does not check revocation or which roots your system trusts.

### Windows sign-in (Kerberos / NTLM)

Follows `Negotiate` and `NTLM` handshakes in a HAR: whether the browser answered the 401, Kerberos or NTLM, whether the NTLM handshake finished, oversized Kerberos tokens, and connection changes that break NTLM. A lookup page decodes tokens and Kerberos error codes.

### Cookies

Lists every cookie a capture sets or sends and judges whether a browser would have stored each one, then replays the capture against a model of the cookie jar to find cookies that should have been sent and were not. **Browsers** shows what happens to third-party cookies in Chrome, Edge, Firefox and Safari (the rules are dated). **Size & lifetime** shows which cookies fill the `Cookie` header and how long sessions last. Chrome's default export removes cookies; the tool says so when it sees none.

### Guide

How to capture each kind of trace in each browser (including the Chrome setting that keeps cookies and tokens), a checklist per symptom that links to the right pages, and what the tools cannot tell you. The same capture steps appear on each tool's start page.

Guides have their own page for each topic: how it works, what to capture, a walkthrough in the matching tool, the errors people meet and what causes them, common mistakes and a glossary. The guide index is a 4 × 2 grid of seven topics plus the symptom, privacy and limits page.

### Everywhere

- **Explain this**: every finding has a button that opens a short note in plain language: what it means, why it matters and what to look at first. Every finding title the checks can produce has a note; a test fails when a new check has none.
- **Reports**: each tool has a **Report** page at the end of its menu. It builds a report for that tool alone, with headline numbers, charts and the findings, and downloads it as HTML (no scripts, opens anywhere), Markdown, JSON, or through the print dialog as PDF. **All reports** in the sidebar (`/report`) gathers every tool that has something to show: tick the ones to include, get an overview first, and export everything or one file per tool. A switch leaves out the Explain notes.
- **Charts** in the reports: findings by severity per tool, message or certificate; time by phase; slowest requests; assertion, token and certificate validity on a timeline; cookie header size against the 4 KB and 8 KB limits; Kerberos token size. Each chart has a title and description for screen readers and a "Show the numbers" table behind it, and uses the same colours as the app in light and dark.
- **What a report leaves out**: token and cookie values, SAML XML and assertions, user names and NameIDs, authorization codes, and the query part of every address. It keeps host names, paths, entity IDs, client IDs and the findings, so read it before it leaves your organisation. The paste-in tools (certificates, a pasted token, discovery, metadata) feed their results to the report while the tab is open; nothing is stored.
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

Captures, tokens, keys and certificates are processed in memory in your browser and are never sent anywhere; the app makes no network requests once it has loaded, which is also why it cannot fetch a metadata document, discovery document or JWKS for you (open the URL and paste it). Files are not saved unless you turn on "Keep my files on this device", and then only in this browser. Captures often contain live tokens and cookies: use Network > Tools > Scrub before sharing one.

## What it cannot do

- It reads what the browser saw. A call the application's server makes (for example exchanging an authorization code for tokens) is not in a browser capture.
- It cannot see a browser's settings, extensions or policies, so a cookie that should have been sent and was not may have been blocked.
- Signature checks say whether the key you pasted signed the message, not whether you should trust that key.
- Findings are leads, not verdicts: confirm them in the identity provider's and the application's logs.
- Browser captures show only what the browser did, so reports only describe that.
- Firefox and Safari have not been tried on the newer pages (reports, Explain this, the guide grid); Chrome has.
- Tested with generated and spec-conformant data and with tokens, signatures and certificates made by independent tools (OpenSSL, Python `cryptography`, `signxml`, `pyspnego`, `impacket`). It has not been run against real Okta, Entra ID, Keycloak or ADFS captures.
