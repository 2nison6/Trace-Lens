// Generates the sample captures in public/demo/ (run: node scripts/make-demo-data.mjs).
//
// All of it is invented: the hosts end in .test (reserved, never resolvable), the users and tokens are placeholders, and the two
// certificates are throwaway ones made for this file whose private keys were discarded. That means the XML signatures in the
// SAML samples are PLACEHOLDERS: they have the right shape and algorithm names, but no key exists that could have produced
// them, and nothing in this app (or any other) can verify them. Output is deterministic, so regenerating gives identical files.
import { Buffer } from 'node:buffer'
import { mkdirSync, writeFileSync } from 'node:fs'
import { deflateRawSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'demo')

// Public certificates only (base64 DER). GOOD: valid 2025-01-01 to 2035-01-01. SOON: valid 2026-01-01 to 2026-11-25.
const GOOD_CERT = 'MIIC8jCCAdoCAQEwDQYJKoZIhvcNAQELBQAwPzEZMBcGA1UEAwwQaWRwLmV4YW1wbGUudGVzdDEiMCAGA1UECgwZRXhhbXBsZSBJZGVudGl0eSBQcm92aWRlcjAeFw0yNTAxMDEwMDAwMDBaFw0zNTAxMDEwMDAwMDBaMD8xGTAXBgNVBAMMEGlkcC5leGFtcGxlLnRlc3QxIjAgBgNVBAoMGUV4YW1wbGUgSWRlbnRpdHkgUHJvdmlkZXIwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQC57ee4TBxPi0XO9MYdU5ZbdjSLt+AfiV5quV/xExbvIUpsbhlOwuRAnIiJKpW86sLgERWMeK79gMKQiWNa/+FRz3GMC0CNthW0ANxM7ORgSFBgynIHHJS07mWPESex3mwrjtc7hglrRop6FqKi09VUjzpJWhy7GQhp2OySrqyxC/qbBaQ5Kh8TBlOsq4c/9p/pD+DLMkEsnUU/oOxZ3LvJd/nZko0QKnAxtK/agZGkLj+mmI+PbxqvTchEaM8OeUxkx1u6iijmscS+9w2tc7u9BQFE8vZ7U6jLC0S1rcsxkRgZcdXLLrYpSAoW84dAXRGEFas+xbuMNA4NFfalQdWDAgMBAAEwDQYJKoZIhvcNAQELBQADggEBAK+rh6E5AD3X8pfUEANSbYfBtM/lmWtCiD8Rb7wNYJ/MkNpp4ABIwtUU9NTsWkktUAVhteQif5sn8aJS7a70Ezb3Ms8NnpDYLasfb5SdRJV6YPSHtMR2s4uYT1N/QwB2/c4dLyF00xE/THlZk+YZfXKYMeMWA451X+661qeCIdI8bhmnDXPHJ5pooWbivVtEJ/DhPh20LVtuN4yU2yCYEglOu3UMAk+2RW1zbExlC+kEjAsvnGSOXs063r1rLxG5x0uyRA8ih/f4dn+MlnIn4HYLXGn2P71xTYbSoy3g0SgJ4fsxw8IgJO+JjtNT220oA2U2XWDt6bRlm+nP8k0eTvA='
const SOON_CERT = 'MIIC7jCCAdYCAQIwDQYJKoZIhvcNAQELBQAwPTEbMBkGA1UEAwwSbG9naW4uZXhhbXBsZS50ZXN0MR4wHAYDVQQKDBVFeGFtcGxlIExvZ2luIFNlcnZpY2UwHhcNMjYwMTAxMDAwMDAwWhcNMjYxMTI1MDAwMDAwWjA9MRswGQYDVQQDDBJsb2dpbi5leGFtcGxlLnRlc3QxHjAcBgNVBAoMFUV4YW1wbGUgTG9naW4gU2VydmljZTCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBALATZr9d5yggAYT5B3g1hbM1d+ncgBTjOlVUmvT41lJBoTwXyGcI7O0tdVu8JDIZTzDV/ZWWwIJCQTyE7jUGjJBsVSCqKD8l2OjdZcNRp83oijxlbW5IdefKRvCqf+/Fu7lGfuooZO0ShlS1qSdRL9ikY5C1edB0dW+FnmRfZ9rvsp6buIVWMD7m7TFg+TMDAzLPNZIRy/2jtZsoWUvso7S9S9JYP/YH5LHYheG4LzeJ7czjVoNa4FZ8DzciZIKNzBZUcItOrgcJIUebqva3DqTohUB74Gxi3pd6Pt5gL3iE7wvbu8+6rDrfUwAy0uh0IN0553mmRwcq20Q3wx6ET48CAwEAATANBgkqhkiG9w0BAQsFAAOCAQEApiz349qY995cY1WCLwv4OvUoKjjxEa5pb2vfbWXylIH7sbzjvbpEe2ILjp8GRMVzEB0YOm8RIKnSBPmMl31T9wjPRiiod8EQVPY5L8WBYrMSKt+OYeCeUOjcC52Vy30fGtSYj6pT+yQYp+p+BxTHLAOzkTisN0nPmP06/vPK7bTXX6HRpmuP0C4kUFvQYsRwhgrmc/5yGip4tsvqQSm0DL3yTNoledjOfh8QOqz1w5sUXCLF4NHH2nUox/YLNDf8dHGJMhaC02HR2SM+0w1lBfkFadszPYoGvCr0CNj44f3J4lX9Qc3bW5gBC9eQCFVkqzpxsuSlp/IulLkf4/N5RQ=='

const T = (iso) => Date.parse(iso)
const iso = (ms) => new Date(ms).toISOString()
const isoS = (ms) => iso(ms).replace(/\.\d+Z$/, 'Z')
const b64 = (s) => Buffer.from(s).toString('base64')
const H = (name, value) => ({ name, value })
const qs = (url) => [...new URL(url).searchParams.entries()].map(([name, value]) => ({ name, value }))

// ---------------------------------------------------------------------------------------------------------------- HAR builder
// timings: ms for each phase. `connect` here is the TCP time only; `ssl` is added to it as HAR requires.
function har(title, start, entries, pageTimings) {
  return {
    log: {
      version: '1.2',
      creator: { name: 'TraceLens sample data', version: '1' },
      pages: [{ startedDateTime: iso(start), id: 'page_1', title, pageTimings }],
      entries: entries.map((e) => e),
    },
  }
}

function entry(base, o) {
  const t = { blocked: 0, dns: 0, connect: 0, ssl: 0, send: 1, wait: 50, receive: 5, ...o.t }
  const time = t.blocked + t.dns + t.connect + t.ssl + t.send + t.wait + t.receive
  const res = o.headers || []
  const transfer = o.transfer ?? o.size ?? 0
  const status = o.status ?? 200
  const body = o.body
  const e = {
    pageref: 'page_1',
    startedDateTime: iso(base + o.at),
    time,
    request: {
      method: o.method || 'GET',
      url: o.url,
      httpVersion: o.http || 'h2',
      headers: [H('accept', o.accept || '*/*'), H('user-agent', 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/150 Safari/537.36'), ...(o.nav ? [H('sec-fetch-dest', 'document'), H('sec-fetch-mode', 'navigate')] : []), ...(o.send ? [H('cookie', o.send.map(([n, v]) => `${n}=${v}`).join('; '))] : []), ...(o.reqHeaders || [])],
      cookies: (o.send || []).map(([name, value]) => ({ name, value })),
      queryString: qs(o.url),
      headersSize: 420,
      bodySize: o.post ? o.post.text.length : 0,
      ...(o.post ? { postData: o.post } : {}),
    },
    response: {
      status,
      statusText: o.statusText || ({ 200: 'OK', 204: 'No Content', 301: 'Moved Permanently', 302: 'Found', 401: 'Unauthorized', 403: 'Forbidden', 500: 'Internal Server Error', 504: 'Gateway Timeout' })[status] || '',
      httpVersion: o.http || 'h2',
      headers: res,
      cookies: [],
      content: { size: o.size ?? 0, mimeType: o.mime ?? '', ...(body != null ? { text: body } : {}) },
      redirectURL: o.redirect || '',
      headersSize: 300,
      bodySize: Math.max(0, transfer - 300),
      _transferSize: transfer,
    },
    cache: {},
    timings: { blocked: t.blocked || -1, dns: t.dns || -1, connect: t.connect + t.ssl || -1, ssl: t.ssl || -1, send: t.send, wait: t.wait, receive: t.receive },
    ...(o.conn ? { connection: o.conn } : {}),
    serverIPAddress: o.ip || '203.0.113.10',
    _priority: o.priority || 'High',
    ...(o.init ? { _initiator: o.init.startsWith('http') ? { type: 'parser', url: o.init } : { type: 'other' } } : {}),
  }
  if (status === 0) e.response._error = 'net::ERR_FAILED'
  return e
}

// ---------------------------------------------------------------------------------------------------------------- shop page load
const SHOP = 'https://shop.example.test'
const CDN = 'https://cdn.example.test'
const API = 'https://api.example.test'
const STATIC_CACHE = H('cache-control', 'public, max-age=31536000, immutable')
const SEC = [
  H('strict-transport-security', 'max-age=63072000; includeSubDomains'),
  H('content-security-policy', "default-src 'self' https://cdn.example.test https://api.example.test; frame-ancestors 'none'"),
  H('x-content-type-options', 'nosniff'),
  H('x-frame-options', 'DENY'),
]
const ctype = (v) => H('content-type', v)
const enc = (v) => H('content-encoding', v)

const PRODUCT_JSON = JSON.stringify({ items: Array.from({ length: 12 }, (_, i) => ({ id: 100 + i, name: `Product ${i + 1}`, price: 19 + i * 3 })) })
const html = (title) => `<!doctype html><html lang="en"><head><title>${title}</title><link rel="stylesheet" href="/css/app.css"></head><body><div id="root"></div><script src="/js/app.js"></script></body></html>`

function shopWorking() {
  const base = T('2026-11-06T09:00:00Z')
  const images = Array.from({ length: 8 }, (_, i) => entry(base, {
    at: 760 + i * 6, url: `${CDN}/img/product-${i + 1}.webp`, mime: 'image/webp', size: 52000 + i * 3100, transfer: 52300 + i * 3100,
    headers: [ctype('image/webp'), STATIC_CACHE], conn: '101', init: `${SHOP}/js/app.js`, priority: 'Low', ip: '203.0.113.20',
    t: { send: 0.5, wait: 24 + (i % 3) * 6, receive: 14 + i * 2 },
  }))
  const list = [
    entry(base, { at: 0, url: `${SHOP}/`, mime: 'text/html', size: 41200, transfer: 9800, conn: '100', body: html('Example Shop'), nav: true,
      headers: [ctype('text/html; charset=utf-8'), enc('br'), H('cache-control', 'no-cache'), ...SEC, H('set-cookie', 'sid=demo-session; Path=/; Secure; HttpOnly; SameSite=Lax'), H('server', 'edge')],
      t: { blocked: 2, dns: 14, connect: 22, ssl: 31, send: 1, wait: 128, receive: 18 } }),
    entry(base, { at: 222, url: `${CDN}/css/app.4f1a9c2e.css`, mime: 'text/css', size: 61000, transfer: 11200, conn: '101', init: `${SHOP}/`, ip: '203.0.113.20',
      headers: [ctype('text/css'), enc('br'), STATIC_CACHE], t: { dns: 11, connect: 18, ssl: 26, send: 0.5, wait: 31, receive: 16 } }),
    entry(base, { at: 224, url: `${CDN}/js/vendor.8b7d3e10.js`, mime: 'application/javascript', size: 412000, transfer: 118000, conn: '101', init: `${SHOP}/`, ip: '203.0.113.20',
      headers: [ctype('application/javascript'), enc('br'), STATIC_CACHE], t: { blocked: 4, send: 0.5, wait: 34, receive: 96 } }),
    entry(base, { at: 224, url: `${CDN}/js/app.c2d4f6a8.js`, mime: 'application/javascript', size: 198000, transfer: 51000, conn: '101', init: `${SHOP}/`, ip: '203.0.113.20',
      headers: [ctype('application/javascript'), enc('br'), STATIC_CACHE], t: { blocked: 5, send: 0.5, wait: 33, receive: 52 } }),
    entry(base, { at: 262, url: `${CDN}/fonts/inter-var.woff2`, mime: 'font/woff2', size: 112000, transfer: 112300, conn: '101', init: `${CDN}/css/app.4f1a9c2e.css`, ip: '203.0.113.20',
      headers: [ctype('font/woff2'), STATIC_CACHE, H('access-control-allow-origin', '*')], t: { send: 0.5, wait: 29, receive: 61 } }),
    entry(base, { at: 266, url: `${CDN}/img/hero.webp`, mime: 'image/webp', size: 168000, transfer: 168300, conn: '101', init: `${SHOP}/`, ip: '203.0.113.20',
      headers: [ctype('image/webp'), STATIC_CACHE], t: { send: 0.5, wait: 30, receive: 88 } }),
    entry(base, { at: 268, url: `${CDN}/img/logo.svg`, mime: 'image/svg+xml', size: 3400, transfer: 1300, conn: '101', init: `${SHOP}/`, ip: '203.0.113.20',
      headers: [ctype('image/svg+xml'), enc('br'), STATIC_CACHE], t: { send: 0.5, wait: 22, receive: 3 } }),
    // the app starts running once its script has arrived and asks the API for data
    entry(base, { at: 540, method: 'OPTIONS', url: `${API}/v1/cart`, mime: '', size: 0, transfer: 380, status: 204, conn: '102', init: `${CDN}/js/app.c2d4f6a8.js`, ip: '203.0.113.30',
      headers: [H('access-control-allow-origin', SHOP), H('access-control-allow-headers', 'authorization, content-type'), H('access-control-max-age', '600')], t: { dns: 9, connect: 16, ssl: 24, send: 0.5, wait: 38, receive: 0.5 } }),
    entry(base, { at: 545, url: `${API}/v1/products?limit=12`, mime: 'application/json', size: PRODUCT_JSON.length, transfer: 1900, conn: '102', init: `${CDN}/js/app.c2d4f6a8.js`, ip: '203.0.113.30', body: PRODUCT_JSON,
      headers: [ctype('application/json'), enc('br'), H('cache-control', 'private, max-age=60'), H('access-control-allow-origin', SHOP)], t: { blocked: 40, send: 0.5, wait: 92, receive: 6 } }),
    entry(base, { at: 590, url: `${API}/v1/cart`, mime: 'application/json', size: 410, transfer: 700, conn: '102', init: `${CDN}/js/app.c2d4f6a8.js`, ip: '203.0.113.30', body: '{"items":[],"total":0}',
      reqHeaders: [H('authorization', 'Bearer demo-token-not-real')], headers: [ctype('application/json'), H('cache-control', 'private, no-cache'), H('access-control-allow-origin', SHOP)], t: { send: 0.5, wait: 58, receive: 3 } }),
    entry(base, { at: 592, url: `${API}/v1/me`, mime: 'application/json', size: 220, transfer: 520, conn: '102', init: `${CDN}/js/app.c2d4f6a8.js`, ip: '203.0.113.30', body: '{"name":"Guest"}',
      reqHeaders: [H('authorization', 'Bearer demo-token-not-real')], headers: [ctype('application/json'), H('cache-control', 'private, no-cache'), H('access-control-allow-origin', SHOP)], t: { send: 0.5, wait: 44, receive: 2 } }),
    ...images,
    entry(base, { at: 840, url: 'https://metrics.example-analytics.test/tag.js', mime: 'application/javascript', size: 71000, transfer: 24000, conn: '103', init: `${SHOP}/`, priority: 'Low', ip: '198.51.100.7',
      headers: [ctype('application/javascript'), enc('br'), H('cache-control', 'public, max-age=3600')], t: { dns: 18, connect: 21, ssl: 29, send: 0.5, wait: 47, receive: 21 } }),
    entry(base, { at: 1010, method: 'POST', url: 'https://metrics.example-analytics.test/collect', mime: '', size: 0, transfer: 420, status: 204, conn: '103', init: 'https://metrics.example-analytics.test/tag.js', priority: 'Low', ip: '198.51.100.7',
      post: { mimeType: 'application/json', text: '{"event":"page_view","page":"/"}' }, headers: [H('access-control-allow-origin', SHOP)], t: { send: 0.6, wait: 41, receive: 0.5 } }),
    entry(base, { at: 1015, url: `${SHOP}/favicon.ico`, mime: 'image/x-icon', size: 4286, transfer: 4500, conn: '100', priority: 'Low', send: [['sid', 'demo-session']],
      headers: [ctype('image/x-icon'), H('cache-control', 'public, max-age=86400')], t: { send: 0.5, wait: 17, receive: 2 } }),
  ]
  return har('Example Shop', base, list, { onContentLoad: 560, onLoad: 1180 })
}

function shopBroken() {
  const base = T('2026-11-06T09:20:00Z')
  const images = Array.from({ length: 8 }, (_, i) => entry(base, {
    at: 3180 + i * 8, url: `${CDN}/img/product-${i + 1}.webp`, mime: 'image/webp', size: 52000 + i * 3100, transfer: 52300 + i * 3100,
    headers: [ctype('image/webp'), STATIC_CACHE], conn: '101', init: `${SHOP}/js/app.7e33d0c1.js`, priority: 'Low', ip: '203.0.113.20',
    t: { blocked: i > 5 ? 520 : 0, send: 0.5, wait: 40 + (i % 3) * 9, receive: 20 + i * 3 },
  }))
  const productFail = (at, wait) => entry(base, {
    at, url: `${API}/v1/products?limit=12`, mime: 'application/json', size: 64, transfer: 520, status: 500, conn: '102', init: `${CDN}/js/app.7e33d0c1.js`, ip: '203.0.113.30',
    body: '{"error":"upstream database timeout","request_id":"demo-7f31"}', headers: [ctype('application/json'), H('access-control-allow-origin', SHOP)], t: { send: 0.5, wait, receive: 1 },
  })
  const list = [
    entry(base, { at: 0, url: `${SHOP}/`, mime: 'text/html', size: 41200, transfer: 9800, conn: '100', body: html('Example Shop'),
      headers: [ctype('text/html; charset=utf-8'), enc('br'), H('cache-control', 'no-cache'), H('set-cookie', 'sid=demo-session; Path=/'), H('set-cookie', 'cart=demo-cart; Path=/'), H('server', 'edge')],
      t: { blocked: 2, dns: 14, connect: 22, ssl: 31, send: 1, wait: 1650, receive: 18 } }),
    entry(base, { at: 1745, url: `${CDN}/css/app.4f1a9c2e.css`, mime: 'text/css', size: 61000, transfer: 11200, conn: '101', init: `${SHOP}/`, ip: '203.0.113.20',
      headers: [ctype('text/css'), enc('br'), STATIC_CACHE], t: { dns: 11, connect: 18, ssl: 26, send: 0.5, wait: 33, receive: 17 } }),
    // a new build: renamed bundles, no compression, and a cache header that forbids caching
    entry(base, { at: 1747, url: `${CDN}/js/vendor.19e0aa57.js`, mime: 'application/javascript', size: 412000, transfer: 412300, conn: '101', init: `${SHOP}/`, ip: '203.0.113.20',
      headers: [ctype('application/javascript'), H('cache-control', 'no-store')], t: { blocked: 4, send: 0.5, wait: 36, receive: 430 } }),
    entry(base, { at: 1747, url: `${CDN}/js/app.7e33d0c1.js`, mime: 'application/javascript', size: 198000, transfer: 198300, conn: '101', init: `${SHOP}/`, ip: '203.0.113.20',
      headers: [ctype('application/javascript'), H('cache-control', 'no-store')], t: { blocked: 5, send: 0.5, wait: 35, receive: 215 } }),
    entry(base, { at: 1790, url: `${CDN}/fonts/inter-var.woff2`, mime: 'font/woff2', size: 112000, transfer: 112300, conn: '101', init: `${CDN}/css/app.4f1a9c2e.css`, ip: '203.0.113.20',
      headers: [ctype('font/woff2'), STATIC_CACHE, H('access-control-allow-origin', '*')], t: { send: 0.5, wait: 31, receive: 63 } }),
    entry(base, { at: 1792, url: `${CDN}/img/hero.jpg`, mime: 'image/jpeg', size: 1930000, transfer: 1930300, conn: '101', init: `${SHOP}/`, ip: '203.0.113.20',
      headers: [ctype('image/jpeg'), H('cache-control', 'public, max-age=600')], t: { send: 0.5, wait: 33, receive: 2480 } }),
    entry(base, { at: 1794, url: `${CDN}/img/logo.svg`, mime: 'image/svg+xml', size: 3400, transfer: 1300, conn: '101', init: `${SHOP}/`, ip: '203.0.113.20',
      headers: [ctype('image/svg+xml'), enc('br'), STATIC_CACHE], t: { send: 0.5, wait: 23, receive: 3 } }),
    // an image still linked with http:// on an https page
    entry(base, { at: 1800, url: 'http://cdn.example.test/img/banner.png', mime: 'image/png', size: 88000, transfer: 88300, http: 'http/1.1', conn: '104', init: `${SHOP}/`, priority: 'Low', ip: '203.0.113.20',
      headers: [ctype('image/png'), H('cache-control', 'public, max-age=3600')], t: { dns: 11, connect: 19, send: 0.5, wait: 46, receive: 71 } }),
    // the app starts once its (slow, uncompressed) bundle has arrived
    entry(base, { at: 2300, method: 'OPTIONS', url: `${API}/v1/cart`, mime: 'text/plain', size: 22, transfer: 400, status: 403, conn: '102', init: `${CDN}/js/app.7e33d0c1.js`, ip: '203.0.113.30',
      body: 'CORS origin not allowed', headers: [ctype('text/plain')], t: { dns: 9, connect: 16, ssl: 24, send: 0.5, wait: 41, receive: 0.5 } }),
    productFail(2310, 3420),
    entry(base, { at: 2312, url: `${API}/v1/me?access_token=demo-expired-token`, mime: 'application/json', size: 41, transfer: 420, status: 401, conn: '102', init: `${CDN}/js/app.7e33d0c1.js`, ip: '203.0.113.30',
      body: '{"error":"token expired"}', reqHeaders: [H('authorization', 'Bearer demo-expired-token')], headers: [ctype('application/json'), H('access-control-allow-origin', SHOP)], t: { send: 0.5, wait: 61, receive: 1 } }),
    entry(base, { at: 2315, url: `${API}/v1/recommendations`, mime: '', size: 3100, transfer: 3300, conn: '102', init: `${CDN}/js/app.7e33d0c1.js`, ip: '203.0.113.30',
      headers: [H('access-control-allow-origin', SHOP)], t: { send: 0.5, wait: 760, receive: 8 } }),
    productFail(5760, 3110),
    productFail(8900, 2980),
    ...images,
    entry(base, { at: 3230, url: 'https://pixel.example-ads.test/pixel.js', mime: 'application/javascript', size: 38000, transfer: 38300, conn: '105', init: `${SHOP}/`, priority: 'Low', ip: '198.51.100.9',
      headers: [ctype('application/javascript'), H('cache-control', 'no-cache')], t: { blocked: 710, dns: 212, connect: 24, ssl: 33, send: 0.5, wait: 140, receive: 45 } }),
    entry(base, { at: 3260, url: 'https://metrics.example-analytics.test/tag.js', mime: 'application/javascript', size: 71000, transfer: 24000, conn: '103', init: `${SHOP}/`, priority: 'Low', ip: '198.51.100.7',
      headers: [ctype('application/javascript'), enc('br'), H('cache-control', 'public, max-age=3600')], t: { dns: 18, connect: 21, ssl: 29, send: 0.5, wait: 52, receive: 22 } }),
    // the shopper clicks Checkout: a chain of redirects before the login page
    entry(base, { at: 11800, url: 'http://shop.example.test/checkout', mime: '', size: 0, transfer: 380, status: 301, http: 'http/1.1', conn: '106', redirect: `${SHOP}/checkout`, priority: 'VeryHigh',
      headers: [H('location', `${SHOP}/checkout`)], t: { dns: 12, connect: 20, send: 0.5, wait: 64, receive: 0.5 } }),
    entry(base, { at: 11905, url: `${SHOP}/checkout`, mime: '', size: 0, transfer: 380, status: 301, conn: '100', redirect: `${SHOP}/checkout/`, priority: 'VeryHigh',
      headers: [H('location', `${SHOP}/checkout/`)], t: { dns: 0, connect: 0, send: 0.5, wait: 71, receive: 0.5 } }),
    entry(base, { at: 11985, url: `${SHOP}/checkout/`, mime: '', size: 0, transfer: 380, status: 302, conn: '100', redirect: `${SHOP}/login?next=%2Fcheckout%2F`, priority: 'VeryHigh',
      headers: [H('location', `${SHOP}/login?next=%2Fcheckout%2F`)], t: { send: 0.5, wait: 69, receive: 0.5 } }),
    entry(base, { at: 12065, url: `${SHOP}/login?next=%2Fcheckout%2F`, mime: 'text/html', size: 9800, transfer: 3100, conn: '100', priority: 'VeryHigh', body: html('Sign in'),
      headers: [ctype('text/html; charset=utf-8'), enc('br'), H('cache-control', 'no-cache')], t: { send: 0.5, wait: 88, receive: 7 } }),
  ]
  return har('Example Shop', base, list, { onContentLoad: 2480, onLoad: 6900 })
}

// ---------------------------------------------------------------------------------------------------------------- SAML
const NS = 'xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"'
const placeholderSig = (id, cert, sha1 = false) => `<ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#"><ds:SignedInfo><ds:CanonicalizationMethod Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"/><ds:SignatureMethod Algorithm="${sha1 ? 'http://www.w3.org/2000/09/xmldsig#rsa-sha1' : 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256'}"/><ds:Reference URI="#${id}"><ds:Transforms><ds:Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"/><ds:Transform Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"/></ds:Transforms><ds:DigestMethod Algorithm="${sha1 ? 'http://www.w3.org/2000/09/xmldsig#sha1' : 'http://www.w3.org/2001/04/xmlenc#sha256'}"/><ds:DigestValue>${Buffer.alloc(sha1 ? 20 : 32, 'DEMO').toString('base64')}</ds:DigestValue></ds:Reference></ds:SignedInfo><ds:SignatureValue>${Buffer.alloc(256, 'DEMO').toString('base64')}</ds:SignatureValue><ds:KeyInfo><ds:X509Data><ds:X509Certificate>${cert}</ds:X509Certificate></ds:X509Data></ds:KeyInfo></ds:Signature>`

function authnRequest({ id, at, issuer, acs, idpSso }) {
  return `<samlp:AuthnRequest ${NS} ID="${id}" Version="2.0" IssueInstant="${isoS(at)}" Destination="${idpSso}" AssertionConsumerServiceURL="${acs}" ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"><saml:Issuer>${issuer}</saml:Issuer><samlp:NameIDPolicy Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress" AllowCreate="true"/></samlp:AuthnRequest>`
}

function samlResponse({ id, at, inResponseTo, destination, recipient, issuer, audience, cert, sha1 = false, user, session, groups }) {
  const from = isoS(at - 30000)
  const until = isoS(at + 5 * 60000)
  return `<samlp:Response ${NS} ID="${id}" InResponseTo="${inResponseTo}" Version="2.0" IssueInstant="${isoS(at)}" Destination="${destination}"><saml:Issuer>${issuer}</saml:Issuer>${placeholderSig(id, cert, sha1)}<samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status><saml:Assertion ID="${id}_a" IssueInstant="${isoS(at)}" Version="2.0"><saml:Issuer>${issuer}</saml:Issuer><saml:Subject><saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">${user}</saml:NameID><saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData InResponseTo="${inResponseTo}" NotOnOrAfter="${until}" Recipient="${recipient}"/></saml:SubjectConfirmation></saml:Subject><saml:Conditions NotBefore="${from}" NotOnOrAfter="${until}"><saml:AudienceRestriction><saml:Audience>${audience}</saml:Audience></saml:AudienceRestriction></saml:Conditions><saml:AuthnStatement AuthnInstant="${isoS(at - 4000)}" SessionIndex="${session}"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement><saml:AttributeStatement><saml:Attribute Name="http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress" FriendlyName="mail"><saml:AttributeValue>${user}</saml:AttributeValue></saml:Attribute><saml:Attribute Name="displayName"><saml:AttributeValue>Alex Demo</saml:AttributeValue></saml:Attribute><saml:Attribute Name="groups">${groups.map((g) => `<saml:AttributeValue>${g}</saml:AttributeValue>`).join('')}</saml:Attribute></saml:AttributeStatement></saml:Assertion></samlp:Response>`
}

const redirectValue = (xml) => encodeURIComponent(deflateRawSync(Buffer.from(xml)).toString('base64'))
const autoSubmit = (acs, response, relay) => `<!doctype html><html><body onload="document.forms[0].submit()"><noscript><p>JavaScript is off: press Continue to finish signing in.</p></noscript><form method="post" action="${acs}"><input type="hidden" name="SAMLResponse" value="${b64(response)}"/><input type="hidden" name="RelayState" value="${relay}"/><noscript><input type="submit" value="Continue"/></noscript></form></body></html>`

// A working SSO sign-in as DevTools records it (a HAR)
function ssoHar() {
  const base = T('2026-11-06T09:30:00Z')
  const SP = 'https://app.example.test'
  const IDP = 'https://login.example.test'
  const reqId = '_9f3b2c1d4e5a6b7c8d9e0f1a2b3c4d5e'
  const authn = authnRequest({ id: reqId, at: base + 650, issuer: `${SP}/saml/metadata`, acs: `${SP}/saml/acs`, idpSso: `${IDP}/sso` })
  const response = samlResponse({ id: '_a8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3', at: base + 4300, inResponseTo: reqId, destination: `${SP}/saml/acs`, recipient: `${SP}/saml/acs`, issuer: `${IDP}/`, audience: `${SP}/saml/metadata`, cert: GOOD_CERT, user: 'alex@example.test', session: '_sess-7c1e9a', groups: ['engineering', 'staff'] })
  const ssoUrl = `${IDP}/sso?SAMLRequest=${redirectValue(authn)}&RelayState=%2Fdashboard`
  const loginForm = '<!doctype html><html><body><form method="post" action="/auth"><input name="username"><input name="password" type="password"></form></body></html>'
  const list = [
    entry(base, { at: 0, url: `${SP}/dashboard`, mime: '', size: 0, transfer: 420, status: 302, conn: '1', redirect: `${SP}/saml/login?return=%2Fdashboard`, headers: [H('location', `${SP}/saml/login?return=%2Fdashboard`)], t: { dns: 12, connect: 20, ssl: 28, wait: 52, receive: 0.5 } }),
    entry(base, { at: 150, url: `${SP}/saml/login?return=%2Fdashboard`, mime: '', size: 0, transfer: 700, status: 302, conn: '1', redirect: ssoUrl,
      headers: [H('location', ssoUrl), H('set-cookie', 'relay=demo; Path=/; Secure; HttpOnly; SameSite=None')], t: { wait: 61, receive: 0.5 } }),
    entry(base, { at: 330, url: ssoUrl, mime: 'text/html', size: 9300, transfer: 3100, conn: '2', ip: '203.0.113.50', body: loginForm,
      headers: [ctype('text/html; charset=utf-8'), enc('br'), H('cache-control', 'no-store'), ...SEC], t: { dns: 15, connect: 21, ssl: 30, wait: 96, receive: 9 } }),
    entry(base, { at: 540, url: `${IDP}/static/login.css`, mime: 'text/css', size: 7400, transfer: 2100, conn: '2', ip: '203.0.113.50', init: ssoUrl, headers: [ctype('text/css'), enc('br'), H('cache-control', 'public, max-age=86400')], t: { wait: 28, receive: 4 } }),
    entry(base, { at: 3900, method: 'POST', url: `${IDP}/auth`, mime: 'text/html', size: 1900, transfer: 1500, conn: '2', ip: '203.0.113.50', body: autoSubmit(`${SP}/saml/acs`, response, '/dashboard'),
      post: { mimeType: 'application/x-www-form-urlencoded', text: 'username=alex%40example.test&password=demo-password-not-real', params: [{ name: 'username', value: 'alex@example.test' }, { name: 'password', value: 'demo-password-not-real' }] },
      headers: [ctype('text/html; charset=utf-8'), H('cache-control', 'no-store'), ...SEC], t: { wait: 340, receive: 3 } }),
    entry(base, { at: 4380, method: 'POST', url: `${SP}/saml/acs`, mime: '', size: 0, transfer: 650, status: 302, conn: '1', redirect: `${SP}/dashboard`, ip: '203.0.113.40',
      post: { mimeType: 'application/x-www-form-urlencoded', text: `SAMLResponse=${encodeURIComponent(b64(response))}&RelayState=%2Fdashboard`, params: [{ name: 'SAMLResponse', value: b64(response) }, { name: 'RelayState', value: '/dashboard' }] },
      headers: [H('location', `${SP}/dashboard`), H('set-cookie', 'session=demo-app-session; Path=/; Secure; HttpOnly; SameSite=Lax')], t: { wait: 118, receive: 0.5 } }),
    entry(base, { at: 4520, url: `${SP}/dashboard`, mime: 'text/html', size: 18800, transfer: 5200, conn: '1', ip: '203.0.113.40', body: html('Dashboard'), headers: [ctype('text/html; charset=utf-8'), enc('br'), H('cache-control', 'private, no-cache'), ...SEC], t: { wait: 74, receive: 8 } }),
    entry(base, { at: 4720, url: `${SP}/api/profile`, mime: 'application/json', size: 260, transfer: 600, conn: '1', ip: '203.0.113.40', body: '{"name":"Alex Demo","email":"alex@example.test"}', headers: [ctype('application/json'), H('cache-control', 'private, no-cache')], t: { wait: 41, receive: 2 } }),
  ]
  return har('Dashboard (signed in with SSO)', base, list, { onContentLoad: 4700, onLoad: 4900 })
}

// A failed SSO sign-in as the SAML-tracer extension records it: the identity provider says Success, but the service provider answers 403
function failedTrace() {
  const base = T('2026-11-06T09:45:00Z')
  const SP = 'https://portal.example.test'
  const IDP = 'https://login.example.test'
  const reqId = '_3c2b1a0f9e8d7c6b5a4f3e2d1c0b9a8f'
  const authn = authnRequest({ id: reqId, at: base + 700, issuer: `${SP}/saml/metadata`, acs: `${SP}/saml/acs`, idpSso: `${IDP}/sso` })
  // the identity provider is configured with a different ACS URL (".../consume") and an audience with a trailing slash, signs with SHA-1,
  // and uses a certificate that is about to expire
  const response = samlResponse({ id: '_f1e2d3c4b5a6978877665544332211aa', at: base + 6200, inResponseTo: reqId, destination: `${SP}/saml/acs`, recipient: `${SP}/saml/consume`, issuer: `${IDP}/`, audience: `${SP}/`, cert: SOON_CERT, sha1: true, user: 'alex@example.test', session: '_sess-2b8d4f', groups: ['finance'] })
  const hdr = (host, extra = []) => [H('Host', host), H('User-Agent', 'Mozilla/5.0 (Macintosh) Firefox/140.0'), H('Accept', 'text/html'), ...extra]
  const res = (...a) => a.map(([n, v]) => H(n, v))
  const get = (i, url, status, text, extra = {}) => ({
    method: 'GET', url, requestId: `request-${i}-GET-demo${i}`, requestHeaders: hdr(new URL(url).host), get: [...new URL(url).searchParams.entries()], post: [],
    responseStatus: status, responseStatusText: `HTTP/1.1 ${status} ${text}`, responseHeaders: res(['Content-Type', 'text/html; charset=utf-8']), ...extra,
  })
  const requests = [
    get(1, `${SP}/reports`, 302, 'Found'),
    get(2, `${SP}/saml/login?return=%2Freports`, 302, 'Found'),
    { ...get(3, `${IDP}/sso?SAMLRequest=${redirectValue(authn)}&RelayState=%2Freports`, 200, 'OK'), protocol: 'SAML-P', saml: authn },
    get(4, `${IDP}/login`, 200, 'OK'),
    { method: 'POST', url: `${IDP}/authenticate`, requestId: 'request-5-POST-demo5', requestHeaders: hdr('login.example.test', [H('Content-Type', 'application/x-www-form-urlencoded')]), get: [], post: [['username', 'alex@example.test'], ['password', 'demo-password-not-real']], responseStatus: 302, responseStatusText: 'HTTP/1.1 302 Found', responseHeaders: res(['Location', `${IDP}/sso/continue`]) },
    get(6, `${IDP}/sso/continue`, 200, 'OK'),
    { method: 'POST', url: `${SP}/saml/acs`, requestId: 'request-7-POST-demo7', requestHeaders: hdr('portal.example.test', [H('Content-Type', 'application/x-www-form-urlencoded')]), get: [], post: [['SAMLResponse', b64(response)], ['RelayState', '/reports']], protocol: 'SAML-P', saml: response, responseStatus: 403, responseStatusText: 'HTTP/1.1 403 Forbidden', responseHeaders: res(['Content-Type', 'text/html; charset=utf-8']) },
    get(8, `${SP}/error?code=saml_recipient_mismatch`, 200, 'OK'),
  ]
  return { requests, timestamp: iso(base + 9000) }
}

// ---------------------------------------------------------------------------------------------------------------- OAuth / OIDC
// A single-page app signing in with the authorization code flow + PKCE, as DevTools records it. The token request fails with
// invalid_grant because of two bugs the OAuth tool should find: redirect_uri has a trailing slash that the authorization request
// did not, and the PKCE verifier sent is not the one the challenge was made from (a second tab overwrote the stored verifier).
import { createHash } from 'node:crypto'

function oauthHar() {
  const base = T('2026-11-06T09:50:00Z')
  const APP = 'https://spa.example.test'
  const IDP = 'https://login.example.test'
  const cb = `${APP}/callback`
  const verifier = 'q7Zr1mT0xV9bN3cK5pL8wE2hY6uA4sD1fG0jI7oM9tR'
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const state = 'st_7f3a91c2'
  const nonce = 'nc_5b8e04d7'
  const authz = `${IDP}/oauth2/v2.0/authorize?${new URLSearchParams({ client_id: 'spa-client-1', response_type: 'code', redirect_uri: cb, scope: 'openid profile email offline_access', state, nonce, code_challenge: challenge, code_challenge_method: 'S256' })}`
  const callback = `${cb}?code=demo-auth-code-9d41c7e2a5b8&state=${state}`
  const form = { grant_type: 'authorization_code', client_id: 'spa-client-1', code: 'demo-auth-code-9d41c7e2a5b8', redirect_uri: `${cb}/`, code_verifier: 'W1xK9pE3rT7yU2iO5aS8dF4gH6jL0zC3vB9nM1qA7eR' }
  const body = new URLSearchParams(form).toString()
  const failBody = JSON.stringify({ error: 'invalid_grant', error_description: 'AADSTS50148: The code_verifier does not match the code_challenge supplied in the authorization request for PKCE.' })
  const list = [
    entry(base, { at: 0, url: `${APP}/`, mime: 'text/html', size: 3200, transfer: 1400, conn: '1', body: html('Example SPA'), headers: [ctype('text/html'), enc('br'), H('cache-control', 'no-cache'), ...SEC], t: { dns: 12, connect: 20, ssl: 28, wait: 60, receive: 4 } }),
    entry(base, { at: 160, url: authz, mime: 'text/html', status: 302, size: 0, transfer: 900, conn: '2', ip: '203.0.113.50', redirect: `${IDP}/login?session=demo`, headers: [H('location', `${IDP}/login?session=demo`), H('cache-control', 'no-store')], t: { dns: 15, connect: 21, ssl: 30, wait: 88, receive: 1 } }),
    entry(base, { at: 330, url: `${IDP}/login?session=demo`, mime: 'text/html', size: 9300, transfer: 3100, conn: '2', ip: '203.0.113.50', body: '<!doctype html><title>Sign in</title>', headers: [ctype('text/html; charset=utf-8'), enc('br'), H('cache-control', 'no-store'), ...SEC], t: { wait: 70, receive: 6 } }),
    entry(base, { at: 3900, method: 'POST', url: `${IDP}/login/submit`, mime: 'text/html', status: 302, size: 0, transfer: 800, conn: '2', ip: '203.0.113.50', redirect: callback,
      post: { mimeType: 'application/x-www-form-urlencoded', text: 'username=alex%40example.test&password=demo-password-not-real', params: [{ name: 'username', value: 'alex@example.test' }, { name: 'password', value: 'demo-password-not-real' }] },
      headers: [H('location', callback), H('cache-control', 'no-store')], t: { wait: 420, receive: 1 } }),
    entry(base, { at: 4340, url: callback, mime: 'text/html', size: 3200, transfer: 1400, conn: '1', body: html('Example SPA'), headers: [ctype('text/html'), enc('br'), H('cache-control', 'no-cache'), ...SEC], t: { wait: 48, receive: 3 } }),
    entry(base, { at: 4560, method: 'POST', url: `${IDP}/oauth2/v2.0/token`, mime: 'application/json', status: 400, size: failBody.length, transfer: 620, conn: '2', ip: '203.0.113.50', body: failBody,
      post: { mimeType: 'application/x-www-form-urlencoded', text: body, params: Object.entries(form).map(([name, value]) => ({ name, value })) },
      reqHeaders: [H('content-type', 'application/x-www-form-urlencoded'), H('origin', APP)], headers: [ctype('application/json'), H('cache-control', 'no-store'), H('access-control-allow-origin', APP)], t: { wait: 156, receive: 1 } }),
  ]
  return har('Example SPA (sign-in)', base, list, { onContentLoad: 4400, onLoad: 4700 })
}

// ---------------------------------------------------------------------------------------------------------------- cookies
// A login that loops. portal_auth is stored but never sent back, portal_sso is rejected by the browser (SameSite=None without Secure),
// and portal_session is scoped to /app so it is correctly not sent to /account (the tool must NOT flag that one).
function cookieLoopHar() {
  const base = T('2026-11-06T09:55:00Z')
  const APP = 'https://portal.example.test'
  const list = [
    entry(base, { at: 0, url: `${APP}/account`, status: 302, mime: '', size: 0, transfer: 500, nav: true, send: [['theme', 'dark']], redirect: `${APP}/login`, headers: [H('location', `${APP}/login`)], t: { dns: 12, connect: 20, ssl: 28, wait: 40, receive: 0.5 } }),
    entry(base, { at: 120, url: `${APP}/login`, mime: 'text/html', size: 6100, transfer: 2100, nav: true, send: [['theme', 'dark']], body: html('Sign in'), headers: [ctype('text/html; charset=utf-8'), enc('br'), H('cache-control', 'no-store'), ...SEC], t: { wait: 52, receive: 5 } }),
    entry(base, { at: 3000, method: 'POST', url: `${APP}/login`, status: 302, mime: '', size: 0, transfer: 900, nav: true, send: [['theme', 'dark']], redirect: `${APP}/account`,
      post: { mimeType: 'application/x-www-form-urlencoded', text: 'username=alex%40example.test&password=demo-password-not-real', params: [{ name: 'username', value: 'alex@example.test' }, { name: 'password', value: 'demo-password-not-real' }] },
      headers: [H('location', `${APP}/account`),
        // accepted, but a session cookie scoped to /app: the pages below are under /account, so it is never due
        H('set-cookie', 'portal_session=demo-session-value; Path=/app; Secure; HttpOnly; SameSite=Lax'),
        // rejected by the browser: SameSite=None must come with Secure
        H('set-cookie', 'portal_sso=demo-sso-value; Path=/; HttpOnly; SameSite=None'),
        // accepted, and sent back on every later request
        H('set-cookie', 'csrf=demo-csrf-new; Path=/; Secure; SameSite=Lax')], t: { wait: 310, receive: 1 } }),
    entry(base, { at: 3330, url: `${APP}/account`, status: 302, mime: '', size: 0, transfer: 500, nav: true, send: [['theme', 'dark'], ['csrf', 'demo-csrf-new']], redirect: `${APP}/login`, headers: [H('location', `${APP}/login`)], t: { wait: 38, receive: 0.5 } }),
    entry(base, { at: 3400, url: `${APP}/login`, mime: 'text/html', size: 6100, transfer: 2100, nav: true, send: [['theme', 'dark'], ['csrf', 'demo-csrf-new']], body: html('Sign in'), headers: [ctype('text/html; charset=utf-8'), enc('br'), H('cache-control', 'no-store'), ...SEC], t: { wait: 49, receive: 5 } }),
  ]
  // a session cookie that SHOULD come back: set at the site root, then missing from the next request
  list.splice(3, 0, entry(base, { at: 3320, method: 'POST', url: `${APP}/session/refresh`, status: 204, mime: '', size: 0, transfer: 400, send: [['theme', 'dark'], ['csrf', 'demo-csrf-new']],
    headers: [H('set-cookie', 'portal_auth=demo-auth-value; Path=/; Secure; HttpOnly; SameSite=Strict')], t: { wait: 40, receive: 0.5 } }))
  return har('Portal (login loop)', base, list, { onContentLoad: 3500, onLoad: 3550 })
}

// ---------------------------------------------------------------------------------------------------------------- write
const files = {
  'shop-working.har': shopWorking(),
  'shop-broken.har': shopBroken(),
  'sso-signin.har': ssoHar(),
  'sso-failed-saml-tracer.json': failedTrace(),
  'oauth-signin-failed.har': oauthHar(),
  'cookie-login-loop.har': cookieLoopHar(),
}
mkdirSync(OUT, { recursive: true })
for (const [name, data] of Object.entries(files)) {
  const text = `${JSON.stringify(data, null, 1)}\n`
  writeFileSync(path.join(OUT, name), text)
  console.log(`${name.padEnd(30)} ${(text.length / 1024).toFixed(1)} KB`)
}
