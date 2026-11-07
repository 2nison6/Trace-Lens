// Exclusive XML Canonicalization (RFC 3741, "exc-c14n") of a DOM subtree, which is what SAML signatures are computed over.
// Written for the SAML subset: elements, attributes, namespaces, text, CDATA. Comments are dropped (the default, without
// "#WithComments"), and processing instructions are kept. It only uses DOM Level 2, so the same code runs in browsers and in the
// Node test setup.
//
// The rules that matter, and that this follows:
//   - Only namespace declarations that are VISIBLY UTILISED by the element (its own prefix, or an attribute's prefix) are
//     rendered, plus any in the InclusiveNamespaces PrefixList. Declarations are emitted where first needed, not where written.
//   - A namespace is not re-rendered when an output ancestor already rendered the same prefix with the same URI.
//   - Namespace nodes come first, sorted by prefix (default namespace first), then attributes sorted by (namespace URI, local name).
//   - Text escapes & < > and CR; attribute values escape & < " TAB LF CR; CDATA becomes text; line endings are already normalised
//     by the XML parser.

const kids = (n) => Array.prototype.slice.call(n.childNodes)

const escText = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r/g, '&#xD;')
const escAttr = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;').replace(/\t/g, '&#x9;').replace(/\n/g, '&#xA;').replace(/\r/g, '&#xD;')
const escPi = (s) => s.replace(/\r/g, '&#xD;')

// every namespace in scope on `el`: { prefix: uri }, walking up the ancestors (nearest wins)
function inScope(el) {
  const scope = {}
  for (let n = el; n && n.nodeType === 1; n = n.parentNode) {
    for (const a of Array.prototype.slice.call(n.attributes || [])) {
      let prefix = null
      if (a.name === 'xmlns') prefix = ''
      else if (a.name.startsWith('xmlns:')) prefix = a.name.slice(6)
      if (prefix !== null && !(prefix in scope)) scope[prefix] = a.value
    }
  }
  return scope
}

/**
 * Canonicalize `el` (and everything inside it) as exclusive C14N 1.0, without comments.
 * `inclusive`: the InclusiveNamespaces PrefixList (array of prefixes, '#default' for the default namespace).
 * `skip`: a function(node) -> true for nodes to leave out entirely (the enveloped-signature transform passes the <Signature>).
 */
export function exclusiveC14n(el, { inclusive = [], skip = () => false } = {}) {
  const incl = new Set(inclusive.map((p) => (p === '#default' ? '' : p)))
  const out = []

  // `rendered`: prefix -> uri already emitted by the nearest output ancestor chain
  function walk(node, rendered, scopeOf) {
    if (node.nodeType === 3 || node.nodeType === 4) { out.push(escText(node.nodeValue)); return }
    if (node.nodeType === 7) { out.push(`<?${node.target}${node.data ? ` ${escPi(node.data)}` : ''}?>`); return }
    if (node.nodeType !== 1 || skip(node)) return

    const scope = scopeOf(node)
    const attrs = Array.prototype.slice.call(node.attributes || []).filter((a) => a.name !== 'xmlns' && !a.name.startsWith('xmlns:'))

    // prefixes visibly utilised by this element: its own, and those of its attributes
    const used = new Set()
    used.add(node.prefix || '')
    for (const a of attrs) if (a.prefix) used.add(a.prefix)
    for (const p of incl) used.add(p)

    const nsToRender = []
    for (const prefix of used) {
      if (prefix === 'xml') continue
      const uri = prefix in scope ? scope[prefix] : undefined
      if (uri === undefined) continue // the default namespace was never declared, or a prefix is unbound: nothing to render
      if (prefix === '' && uri === '' && !(prefix in rendered)) continue // xmlns="" at the top of the output is a no-op
      if (rendered[prefix] === uri) continue
      nsToRender.push([prefix, uri])
    }
    nsToRender.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))

    const sortedAttrs = attrs
      .map((a) => ({ a, ns: a.namespaceURI || '', local: a.localName || a.name }))
      .sort((x, y) => (x.ns < y.ns ? -1 : x.ns > y.ns ? 1 : x.local < y.local ? -1 : x.local > y.local ? 1 : 0))

    let tag = `<${node.tagName}`
    for (const [prefix, uri] of nsToRender) tag += prefix === '' ? ` xmlns="${escAttr(uri)}"` : ` xmlns:${prefix}="${escAttr(uri)}"`
    for (const { a } of sortedAttrs) tag += ` ${a.name}="${escAttr(a.value)}"`
    out.push(`${tag}>`)

    const next = { ...rendered }
    for (const [prefix, uri] of nsToRender) next[prefix] = uri
    for (const c of kids(node)) walk(c, next, scopeOf)
    out.push(`</${node.tagName}>`)
  }

  walk(el, {}, inScope)
  return out.join('')
}

