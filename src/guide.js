// The text of the in-app Guide: how to capture each kind of trace, what each tool needs in it, and a troubleshooting checklist per
// symptom. Plain data, so the Guide page, the tools' empty states and the README can quote one source and never disagree.
//
// Steps are written for the browsers as of 2026-11 and carry a "checked" date. Browser menus change: the wording points at the
// setting by name rather than describing pixels.

export const GUIDE_CHECKED = '2026-11'

export const CAPTURE = [
  {
    id: 'har-chrome',
    title: 'A HAR file from Chrome or Edge',
    for: ['Network', 'OAuth / OIDC', 'Tokens', 'Cookies', 'Windows sign-in', 'SAML (the HAR route)'],
    steps: [
      'Open DevTools (F12, or Cmd+Option+I on a Mac) and go to the Network tab.',
      'Tick "Preserve log" (so a redirect to another page does not clear the list) and "Disable cache".',
      'Click the clear button, then reproduce the problem from the start: sign in from a signed-out state if the problem is a sign-in.',
      'Right-click the request list and choose "Save all as HAR (sanitized)", or use the Export button.',
    ],
    sensitive: [
      'Since Chrome 130 the default export is "sanitized": it removes Cookie, Set-Cookie and Authorization headers. That is safer to share, but the Cookies, Tokens and Windows sign-in tools then have little to work with.',
      'To keep them: DevTools Settings (gear icon, or F1) → Preferences → Network → tick "Allow to generate HAR with sensitive data". Then use Export → "Export HAR (with sensitive data)…".',
      'A file made this way holds live credentials. Treat it as a password: do not post it in a ticket or chat. Use Network → Tools → Scrub in TraceLens first, or share it only with the people who need it.',
    ],
  },
  {
    id: 'har-firefox',
    title: 'A HAR file from Firefox',
    for: ['Network', 'OAuth / OIDC', 'Tokens', 'Cookies'],
    steps: [
      'Open the Web Developer Tools (F12) and go to the Network tab.',
      'Open the settings cog and tick "Persist Logs".',
      'Reproduce the problem, then right-click the list and choose "Save All As HAR".',
    ],
    sensitive: ['Firefox includes cookies and authorization headers in the file. Treat it as sensitive, and scrub it before sharing.'],
  },
  {
    id: 'har-safari',
    title: 'A HAR file from Safari',
    for: ['Network', 'OAuth / OIDC'],
    steps: [
      'Enable the Develop menu: Safari → Settings → Advanced → "Show features for web developers".',
      'Develop → Show Web Inspector, then the Network tab, and tick "Preserve Log".',
      'Reproduce the problem, then use the Export button at the top of the Network tab.',
    ],
    sensitive: [],
  },
  {
    id: 'saml-tracer',
    title: 'A SAML-tracer export',
    for: ['SAML'],
    steps: [
      'Install the SAML-tracer extension for Firefox or Chrome.',
      'Open it (toolbar icon) and leave its window open.',
      'Sign in as you normally do. Requests that carry SAML are highlighted with a SAML tag.',
      'Click Export, choose a cookie profile, and save the JSON file.',
    ],
    sensitive: [
      'Choose "no filtering" if you want the messages analysed: the profiles that hash or obfuscate form values also hide the SAML.',
      'The file contains the user\'s assertion. Treat it as sensitive.',
    ],
  },
  {
    id: 'saml-paste',
    title: 'A single SAML message, without a trace',
    for: ['SAML'],
    steps: [
      'From a HAR or a network log, copy the value of the SAMLRequest or SAMLResponse field (or the whole URL or form body).',
      'Paste it on the SAML → Messages page. A redirect URL, a base64 value, raw XML and an auto-submit HTML page all work.',
    ],
    sensitive: [],
  },
  {
    id: 'token',
    title: 'A token, or a key to check it with',
    for: ['Tokens'],
    steps: [
      'An access or ID token is the long three-part string (xxxxx.yyyyy.zzzzz) after "Bearer " in an Authorization header, or in the "access_token" / "id_token" field of a token response.',
      'To verify its signature you also need the issuer\'s public key: open the provider\'s jwks_uri (found in /.well-known/openid-configuration) in a browser tab and paste what it shows.',
    ],
    sensitive: ['A token is a credential until it expires. Paste it only into tools you trust; TraceLens does not send anything anywhere.'],
  },
  {
    id: 'cert',
    title: 'A certificate or a chain',
    for: ['Certificates'],
    steps: [
      'From a server: run  openssl s_client -connect host:443 -showcerts  and copy each block from -----BEGIN CERTIFICATE----- to -----END CERTIFICATE-----. In a browser, click the padlock → certificate details → export.',
      'From a file: open the .pem or .crt file in a text editor and copy its contents. A .cer or .der file is binary: convert it with  openssl x509 -inform der -in file.cer  and copy the result.',
      'From SAML metadata or a signed message: copy the text of <X509Certificate>. It is base64 and can be pasted as it is.',
      'Paste everything you have into Certificates → Inspect. The order does not matter.',
    ],
    sensitive: ['Only certificates are needed. Never paste a PRIVATE KEY block: the tool ignores it, but it should not leave the machine it belongs to.'],
  },
  {
    id: 'windows',
    title: 'Windows integrated authentication (Kerberos / NTLM)',
    for: ['Windows sign-in'],
    steps: [
      'Capture a HAR as above, with sensitive data included, from the machine that has the problem.',
      'On the server side, the Windows Security event log (event 4625 for failures) and IIS Failed Request Tracing say why a credential was refused.',
    ],
    sensitive: ['Kerberos tickets and NTLM messages are in the Authorization header: they are sensitive until they expire.'],
  },
]

export const SYMPTOMS = [
  {
    id: 'saml-invalid-signature', title: 'SAML: "invalid signature" at the service provider',
    check: [
      ['SAML → Messages → Verify signature', 'Paste the IdP\'s CURRENT signing certificate. If the signature does not match, the IdP has rolled to a new certificate.'],
      ['SAML → Metadata', 'Paste the IdP\'s metadata: it says which certificates the IdP publishes, and whether the one in the message is among them.'],
      ['Certificate inspector', 'Check the certificate\'s dates: an expired signing certificate is the most common cause of a sign-in that suddenly stopped.'],
    ],
  },
  {
    id: 'saml-audience', title: 'SAML: "audience restriction failed" / "invalid audience"',
    check: [
      ['SAML → Messages → Checks', 'Enter your SP entity ID under "Check against what you expect". The audience in the assertion must match it exactly, including any trailing slash.'],
      ['SAML → Metadata', 'Paste the SP metadata: its entityID is what the audience must equal.'],
    ],
  },
  {
    id: 'saml-no-attrs', title: 'SAML: the user signs in but has no access, or attributes are missing',
    check: [
      ['SAML → Messages → Summary', 'Look at the attributes the assertion actually carries.'],
      ['SAML → Messages', 'Enter the attribute names your application needs under "Attributes your SP needs".'],
      ['Tokens → Inspect', 'For Microsoft Entra, check for group overage: more than 150 groups means the groups are not in the assertion.'],
    ],
  },
  {
    id: 'oauth-redirect', title: 'OAuth: "redirect_uri mismatch" or invalid_grant after sign-in',
    check: [
      ['OAuth → Flow', 'It compares the redirect_uri in the authorization request and the token request, and checks the PKCE verifier against its challenge.'],
      ['OAuth → Error lookup', 'Paste the error: it lists the usual causes.'],
      ['OAuth → Discovery & keys', 'Paste the provider\'s discovery document to confirm the endpoints and tenant are the ones the app should be using.'],
    ],
  },
  {
    id: 'api-401', title: 'An API answers 401 or 403 although the user signed in',
    check: [
      ['Tokens → Inspect', 'Decode the access token: check exp, aud, iss and scope against what the API expects.'],
      ['Tokens → Timeline', 'Was the token used after it expired?'],
      ['Tokens → Inspect → Verify the signature', 'Paste the issuer\'s JWKS. A kid that is not in the key set means the issuer rotated its keys.'],
    ],
  },
  {
    id: 'login-loop', title: 'The sign-in loops back to the login page',
    check: [
      ['Cookies → Problems', 'Was the session cookie set, accepted by the browser, and sent back on the next request?'],
      ['Cookies → Browsers', 'Does it only fail in Safari, Firefox or Incognito? That points to third-party cookie rules.'],
      ['Cookies → Size & lifetime', 'A Cookie header over about 8 KB is refused by many servers.'],
    ],
  },
  {
    id: 'windows-prompt', title: 'Windows sign-in asks for a username and password, or fails with 401',
    check: [
      ['Windows sign-in → Exchange', 'Did the browser answer the 401? Did it use Kerberos or fall back to NTLM? Did the handshake finish?'],
      ['Windows sign-in → Token & error lookup', 'Decode the Negotiate token and look up a Kerberos error code.'],
    ],
  },
  {
    id: 'slow', title: 'A page is slow, or requests fail',
    check: [
      ['Network → Overview', 'Where the time goes: queued, DNS, connect, TLS, waiting, download.'],
      ['Network → Issues', 'Errors, slow responses, large or uncompressed files, rate limiting and retry storms.'],
      ['Network → Compare', 'Capture the same page when it works and when it does not, and compare.'],
    ],
  },
  {
    id: 'cert-not-trusted', title: 'A browser or client says the certificate is not trusted, or the name does not match',
    check: [
      ['Certificate inspector', 'Paste what the server sends. It orders the chain, finds a missing intermediate, checks the names and dates.'],
    ],
  },
]

export const PRIVACY = [
  'Everything runs in your browser. Files, tokens, keys and certificates you open are not uploaded, and the app makes no network requests after it has loaded.',
  'Because it makes no requests, it cannot fetch a metadata document, a discovery document or a JWKS for you. Open the URL in a browser tab and paste what it shows.',
  'It does not keep your files unless you turn on "Keep my files on this device" on a start page, and then only in this browser.',
  'A capture can hold live credentials. Use Network → Tools → Scrub to redact them before you share a file.',
]

export const LIMITS = [
  'It reads what the browser saw. When an application\'s server makes a call (for example, exchanging an authorization code for tokens), that call is not in a browser capture.',
  'It cannot see a browser\'s settings, extensions or enterprise policies. A cookie that should have been sent and was not may have been blocked by one of them.',
  'Signature checks tell you whether a message was signed by the key you pasted, not whether you should trust that key. Check where you got it.',
  'Findings are leads, not verdicts. Confirm them against the identity provider\'s and the application\'s own logs.',
]
