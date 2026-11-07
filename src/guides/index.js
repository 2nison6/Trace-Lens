import cookies from './cookies.js'
import certs from './certs.js'
import har from './har.js'
import oauth from './oauth.js'
import saml from './saml.js'
import tokens from './tokens.js'
import windows from './windows.js'

// One guide per tool, in the order the tools appear. Each has the same shape (see saml.js), so one page renders them all.
export const GUIDES = [har, saml, oauth, tokens, certs, windows, cookies]
export const guideFor = (toolId) => GUIDES.find((g) => g.tool === toolId) || null
export const guideById = (id) => GUIDES.find((g) => g.id === id) || null
