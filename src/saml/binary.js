// Turning the value of a SAMLRequest / SAMLResponse parameter back into XML text.
//
// There are two bindings that matter in a browser:
//   HTTP-POST      the value is base64 of the XML
//   HTTP-Redirect  the value is base64 of the XML compressed with raw DEFLATE (and then URL-encoded)
// Real captures are messier than that (URL-encoding left on, '+' turned into a space, line breaks every 76 characters, zlib
// instead of raw DEFLATE), so decoding is forgiving about all of it and records what it did, to show the user.

// Nothing legitimate is anywhere near this large. The limit is what stops a small compressed blob from expanding into
// gigabytes (a "decompression bomb") in someone's browser tab.
export const MAX_DECODED_BYTES = 5 * 1024 * 1024

export function b64ToBytes(value) {
  // a form-decoded '+' arrives as a space; real base64 never contains one, so turn spaces back into '+'
  let t = String(value).replace(/ /g, '+').replace(/[\r\n\t]/g, '')
  t = t.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '') // base64url is accepted too
  if (!/^[A-Za-z0-9+/]*$/.test(t) || t.length % 4 === 1) throw new Error('not valid base64')
  const bin = atob(t + '='.repeat((4 - (t.length % 4)) % 4))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function bytesToB64(bytes) {
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s)
}

async function inflate(bytes, format) {
  if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot decompress data (DecompressionStream is missing). Use a current Chrome, Edge, Firefox or Safari.')
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format))
  const reader = stream.getReader()
  const chunks = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > MAX_DECODED_BYTES) {
      await reader.cancel()
      throw new Error('The message decompresses to more than 5 MB, which is not a SAML message.')
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let at = 0
  for (const c of chunks) { out.set(c, at); at += c.length }
  return out
}

function utf8(bytes) {
  // a byte-order mark would otherwise end up as a stray character before the first tag
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2))
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2))
  const start = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0
  return new TextDecoder('utf-8').decode(bytes.subarray(start))
}
const looksLikeXml = (s) => /^\s*</.test(s)

/** Safe percent-decoding: leaves the text alone when it is not valid percent-encoding. */
function unpercent(v) {
  try { return decodeURIComponent(v) } catch { return v }
}

/**
 * Decode a parameter value to XML text.
 * Returns { xml, steps } where steps lists what was done ("URL-decoded", "Base64-decoded (1,204 bytes)", "Inflated"...).
 * Throws an Error with a message fit to show the user.
 */
export async function decodePayload(value) {
  const steps = []
  let v = String(value ?? '').trim()
  if (!v) throw new Error('The value is empty.')
  if (/%[0-9a-f]{2}/i.test(v)) { v = unpercent(v); steps.push('URL-decoded') }
  if (looksLikeXml(v)) return { xml: v, steps: [...steps, 'Plain XML (no encoding)'] }

  let bytes
  try { bytes = b64ToBytes(v) } catch { throw new Error('This is not XML and not valid base64, so it cannot be a SAML message.') }
  steps.push(`Base64-decoded (${bytes.length.toLocaleString('en-US')} bytes)`)
  if (bytes.length > MAX_DECODED_BYTES) throw new Error('The message is larger than 5 MB, which is not a SAML message.')

  const direct = utf8(bytes)
  if (looksLikeXml(direct)) return { xml: direct, steps: [...steps, 'Read as XML (HTTP-POST binding: not compressed)'] }

  // HTTP-Redirect binding is raw DEFLATE; some senders wrap it in zlib instead, so try that second
  for (const [format, label] of [['deflate-raw', 'Inflated (raw DEFLATE, the HTTP-Redirect binding)'], ['deflate', 'Inflated (zlib)']]) {
    try {
      const text = utf8(await inflate(bytes, format))
      if (looksLikeXml(text)) return { xml: text, steps: [...steps, label] }
    } catch (e) {
      if (/5 MB/.test(String(e.message))) throw e
      /* not this format: try the next one */
    }
  }
  throw new Error('The data decodes, but it is not XML. It may be encrypted or in a different format.')
}
