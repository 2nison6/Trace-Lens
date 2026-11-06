// XML helpers for SAML. Only DOM Level 2 calls are used so the same code runs in browsers and in the Node test setup.

export const NS = {
  samlp: 'urn:oasis:names:tc:SAML:2.0:protocol',
  saml: 'urn:oasis:names:tc:SAML:2.0:assertion',
  ds: 'http://www.w3.org/2000/09/xmldsig#',
  xenc: 'http://www.w3.org/2001/04/xmlenc#',
  soap: 'http://schemas.xmlsoap.org/soap/envelope/',
}

const elements = (el) => (el ? Array.prototype.slice.call(el.childNodes).filter((n) => n.nodeType === 1) : [])
export const children = (el, ns, name) => elements(el).filter((n) => n.namespaceURI === ns && n.localName === name)
export const child = (el, ns, name) => children(el, ns, name)[0] || null
export const attr = (el, name) => (el && el.hasAttribute && el.hasAttribute(name) ? el.getAttribute(name) : null)
export const text = (el) => (el && el.textContent ? el.textContent.trim() : '')
export const firstElement = (el) => elements(el)[0] || null

/**
 * Parse XML text. Never loads anything external.
 * A DOCTYPE or ENTITY declaration is refused without parsing: SAML messages must not contain either, and entity expansion
 * is how "billion laughs" style attacks work.
 */
export function parseXml(xml) {
  if (/<!DOCTYPE/i.test(xml) || /<!ENTITY/i.test(xml)) {
    return { doctype: true, error: 'The message contains a DOCTYPE or an entity declaration. SAML messages must not, so it was not parsed.' }
  }
  const Parser = globalThis.DOMParser
  if (!Parser) return { error: 'No XML parser is available here.' }
  let doc
  try { doc = new Parser().parseFromString(xml, 'application/xml') } catch (e) {
    return { error: `The XML is not well-formed: ${String(e.message || e).split('\n')[0].slice(0, 160)}` }
  }
  // browsers do not throw: they return a document holding a <parsererror>
  const bad = doc.getElementsByTagName('parsererror')
  if (bad && bad.length) return { error: `The XML is not well-formed: ${(bad[0].textContent || '').trim().split('\n')[0].slice(0, 160)}` }
  if (!doc.documentElement) return { error: 'The XML is empty.' }
  return { doc, root: doc.documentElement }
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const escAttr = (s) => esc(s).replace(/"/g, '&quot;')

/** The XML as indented text. This is only ever shown as text (never as HTML), so nothing in the message can run. */
export function prettyXml(root) {
  const lines = []
  const walk = (el, depth) => {
    const pad = '  '.repeat(depth)
    const attrs = Array.prototype.slice.call(el.attributes || []).map((a) => ` ${a.name}="${escAttr(a.value)}"`).join('')
    const nodes = Array.prototype.slice.call(el.childNodes)
    const kids = nodes.filter((n) => n.nodeType === 1)
    const own = nodes.filter((n) => n.nodeType === 3 || n.nodeType === 4).map((n) => n.nodeValue).join('').trim()
    if (!kids.length && !own) { lines.push(`${pad}<${el.tagName}${attrs}/>`); return }
    if (!kids.length) { lines.push(`${pad}<${el.tagName}${attrs}>${esc(own)}</${el.tagName}>`); return }
    lines.push(`${pad}<${el.tagName}${attrs}>`)
    for (const n of nodes) {
      if (n.nodeType === 1) walk(n, depth + 1)
      else if (n.nodeType === 8) lines.push(`${pad}  <!--${n.nodeValue}-->`)
      else if ((n.nodeType === 3 || n.nodeType === 4) && n.nodeValue.trim()) lines.push(`${pad}  ${esc(n.nodeValue.trim())}`)
    }
    lines.push(`${pad}</${el.tagName}>`)
  }
  walk(root, 0)
  return lines.join('\n')
}
