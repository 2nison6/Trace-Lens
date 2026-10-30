# HAR.lens

Analyze HAR files entirely in your browser: replay request flow, find errors and slow requests, inspect headers and compare captures. Nothing is uploaded.

## Features

- **Upload** by drag and drop or file picker, several files at once
- **Overview** with totals, phase timing, content types, hosts and status codes; click a bar to list its requests
- **Issues** found by rule-based checks (errors, redirects, slow phases, payload size, caching, security headers, cookies) with a health score
- **Waterfall** with sortable columns and filters by text, status, type, host, size and time
- **Packet flow**: animated replay of requests and responses, with real-time mode and a Follow mode that isolates one request
- **Insights**: timing estimates, critical path, third-party cost, potential savings, latency distribution, protocols, concurrency, cache lifetime and endpoint latency
- **Compare** up to three captures
- **Request inspector** with headers, cookies, params, response preview and copy as cURL
- **Tools**: redact secrets from a HAR, export an HTML or JSON report
- Light and dark themes, keyboard shortcuts (press `?`)

## Getting started

```bash
npm install
npm run dev      # start the dev server
npm run build    # production build in dist/
npm run lint
```

Export a HAR from DevTools: Network tab, then "Save all as HAR with content".

## Configuration

Set `VITE_SITE_URL` (see `.env.example`) to your deployed origin so `og:image`, `og:url` and the canonical link become absolute URLs for link previews.

`public/_headers` and `public/_redirects` are read by Netlify and Cloudflare Pages. Other hosts need the same security headers and a single-page-app fallback to `index.html`.

## Stack

React, Vite, React Router, Framer Motion, Font Awesome Free.

## Privacy

HAR files are parsed in memory in your browser and are never sent anywhere. Files are not saved, so a reload clears them. HAR files often contain live tokens and cookies; use Tools > Scrubber before sharing one.
