// What an OAuth 2.0 / OpenID Connect error means and what usually causes it.
//
// Sources: RFC 6749 (sections 4.1.2.1, 5.2), RFC 6750 (section 3.1), RFC 8628 (device flow), OpenID Connect Core 1.0 (3.1.2.6),
// and the error pages of the big providers. Provider-specific entries only cover errors whose meaning is stable and documented
// by that provider; anything else falls through to the generic code. "Causes" are the usual ones, in rough order of likelihood:
// they are leads to check, not a diagnosis.

const e = (code, source, title, meaning, causes, fix, extra = {}) => ({ code, source, title, meaning, causes, fix, ...extra })

export const ERRORS = [
  // ------------------------------------------------------------------------------------------------ Microsoft Entra ID (AADSTS)
  e('AADSTS50011', 'Microsoft Entra ID', 'Reply URL does not match', 'The redirect_uri in the request is not one of the reply URLs registered for the app.',
    ['The redirect URI differs from the registered one by a trailing slash, letter case, http vs https, or a port', 'The URI is registered under the wrong platform type (Web vs Single-page application)', 'The app registration was edited in a different tenant or environment than the one being signed in to'],
    ['In Entra admin center, open App registrations, then the app, then Authentication, and compare the redirect URI with the one in the request, character by character', 'Add the exact URI, or change the app to send a registered one']),
  e('AADSTS70011', 'Microsoft Entra ID', 'Invalid scope', 'The scope value in the request is not valid.',
    ['A scope with a typo, or one that is not exposed by the API', 'Mixing v1 (resource) and v2 (scope) styles, for example "resource/.default" with other scopes', 'Asking for scopes of more than one resource in one request'],
    ['Use the form "api://<app-id>/<scope>" or "<resource>/.default"', 'Request scopes for one resource at a time']),
  e('AADSTS65001', 'Microsoft Entra ID', 'Consent required', 'The user or an administrator has not consented to the app using the permissions it asks for.',
    ['The app needs a permission that only an admin can grant', 'The tenant blocks user consent', 'Permissions were added to the app after users consented'],
    ['Have an admin grant consent in the Entra admin center (API permissions, Grant admin consent)', 'Send the user through an interactive sign-in with prompt=consent']),
  e('AADSTS700016', 'Microsoft Entra ID', 'Application not found', 'The client_id does not match any app in the tenant that is signing in.',
    ['A wrong client_id (a copy-paste error, or the object id used instead of the application id)', 'The app lives in another tenant and is not set up as multi-tenant', 'Signing in through the wrong tenant URL'],
    ['Use the Application (client) ID from the app\'s Overview page', 'Use the right authority: the tenant id, or "organizations" / "common" for multi-tenant apps']),
  e('AADSTS7000215', 'Microsoft Entra ID', 'Invalid client secret', 'The client secret sent does not match the one stored for the app.',
    ['The secret\'s ID was used instead of its value (the value is shown once, when it is created)', 'The secret was replaced or deleted', 'Whitespace or an extra character was copied with the secret'],
    ['Create a new secret and copy its Value immediately', 'Update the secret everywhere the app runs']),
  e('AADSTS7000222', 'Microsoft Entra ID', 'Client secret expired', 'The client secret has passed its expiry date.', ['Secrets expire after at most 24 months, and often after 6 or 12'], ['Create a new secret, deploy it, then delete the old one', 'Consider a certificate or workload identity so there is nothing to rotate by hand']),
  e('AADSTS50076', 'Microsoft Entra ID', 'Multi-factor authentication required', 'A policy requires the user to complete multi-factor authentication, and the request did not allow an interactive sign-in.',
    ['A silent or non-interactive request (prompt=none, or a refresh) hit a conditional-access policy that needs MFA', 'The user moved to a new location or device'], ['Retry with an interactive sign-in so the user can complete MFA']),
  e('AADSTS50079', 'Microsoft Entra ID', 'User must enrol for multi-factor authentication', 'The tenant requires MFA and this user has not registered a method yet.', ['A new user, or MFA was just turned on'], ['Have the user register at https://aka.ms/mfasetup, then sign in again']),
  e('AADSTS90002', 'Microsoft Entra ID', 'Tenant not found', 'The tenant in the sign-in URL does not exist.', ['A typo in the tenant id or domain', 'The tenant was deleted'], ['Check the authority URL: https://login.microsoftonline.com/<tenant>/…']),
  e('AADSTS54005', 'Microsoft Entra ID', 'Authorization code already redeemed', 'An authorization code can be used once, and this one was already exchanged.',
    ['The app exchanged the same code twice (a double submit, a retry, or React running an effect twice in development)', 'Two instances of the app both handled the redirect'], ['Exchange the code exactly once and ignore repeated callbacks for the same state']),
  e('AADSTS70008', 'Microsoft Entra ID', 'Code or refresh token expired', 'The authorization code or refresh token is too old to use.', ['The code was not exchanged within its short lifetime', 'The refresh token was unused for longer than its lifetime'], ['Exchange the code immediately after the redirect', 'Sign the user in again']),
  e('AADSTS700082', 'Microsoft Entra ID', 'Refresh token expired through inactivity', 'The refresh token was not used for too long.', ['Single-page apps get shorter refresh-token lifetimes (24 hours)'], ['Sign the user in again', 'Use silent renewal more often']),
  e('AADSTS50173', 'Microsoft Entra ID', 'Grant expired or revoked', 'The user\'s tokens were invalidated, for example by a password change or an admin action.', ['Password reset', 'Sessions were revoked'], ['Sign the user in again']),
  e('AADSTS70043', 'Microsoft Entra ID', 'Sign-in frequency policy', 'The refresh token expired because of a conditional-access sign-in frequency rule.', ['A policy forces periodic re-authentication'], ['Sign the user in again interactively']),
  e('AADSTS50105', 'Microsoft Entra ID', 'User not assigned to the app', 'The app requires assignment and this user (or a group they belong to) has no role on it.', ['"Assignment required" is on in the enterprise application', 'The user was added after the group sync'], ['Assign the user or their group in Enterprise applications, then Users and groups']),
  e('AADSTS53003', 'Microsoft Entra ID', 'Blocked by conditional access', 'A conditional-access policy refused the sign-in.', ['Location, device compliance, risk or app rules in a policy'], ['Ask the tenant admin which policy applied (Sign-in logs, Conditional Access tab)']),
  e('AADSTS700054', 'Microsoft Entra ID', 'response_type id_token not enabled', 'The app asked for an ID token directly, but that is not switched on for it.', ['The implicit-grant ID token option is off'], ['In the app\'s Authentication blade, enable "ID tokens" under implicit grant, or use the authorization code flow']),
  e('AADSTS500011', 'Microsoft Entra ID', 'Resource not found in the tenant', 'The API (resource) in the request is not registered in this tenant.', ['A wrong resource or scope prefix', 'A multi-tenant API that has not been consented to yet'], ['Check the scope\'s resource part, and grant consent to the API in the tenant']),
  e('AADSTS50020', 'Microsoft Entra ID', 'User from another identity provider is not in this tenant', 'The signed-in account belongs to a different directory than the one the app is registered in.', ['A personal Microsoft account used with a single-tenant app', 'A guest user that was never invited'], ['Invite the user as a guest, or make the app multi-tenant']),
  e('AADSTS50034', 'Microsoft Entra ID', 'User account does not exist', 'The account is not in the directory.', ['A typo in the username', 'Signing in to the wrong tenant'], ['Check the username and tenant']),
  e('AADSTS50126', 'Microsoft Entra ID', 'Wrong username or password', 'The credentials were rejected.', ['A mistyped password', 'A federated user whose password is checked elsewhere'], ['Try again, or reset the password']),
  e('AADSTS700025', 'Microsoft Entra ID', 'Public client sent a secret', 'The app is registered as a public client, so it must not send a client secret or assertion.', ['A secret was sent from a single-page or mobile app', 'The platform type is wrong'], ['Remove the secret from the request (use PKCE instead), or register the app as a confidential client']),
  e('AADSTS7000218', 'Microsoft Entra ID', 'Client secret or assertion missing', 'The app is registered as a confidential client and the request carried no client_secret or client_assertion.', ['A single-page app registered under the "Web" platform', '"Allow public client flows" is off'], ['Register SPAs under the "Single-page application" platform, or send the secret from a server']),
  e('AADSTS50058', 'Microsoft Entra ID', 'No signed-in user for a silent request', 'A silent request (prompt=none, or a hidden iframe) found no session.', ['The Entra session cookie is missing or blocked (third-party cookies in an iframe)', 'The user signed out'], ['Fall back to an interactive sign-in']),
  e('AADSTS65004', 'Microsoft Entra ID', 'User declined consent', 'The user chose not to give the app the permissions it asked for.', ['The user clicked Cancel on the consent screen'], ['Explain why the permissions are needed and ask again']),
  e('AADSTS7000112', 'Microsoft Entra ID', 'Application disabled', 'The app has been turned off in this tenant.', ['An admin disabled the enterprise application'], ['Re-enable it under Enterprise applications, Properties, "Enabled for users to sign-in"']),
  e('AADSTS900144', 'Microsoft Entra ID', 'client_id missing', 'The request body has no client_id.', ['A form field was dropped or misnamed'], ['Send client_id with every token request']),
  e('AADSTS900971', 'Microsoft Entra ID', 'No reply address', 'The request had no redirect_uri and the app has no default.', ['redirect_uri was omitted'], ['Send redirect_uri']),

  // ------------------------------------------------------------------------------------------------ Google
  e('redirect_uri_mismatch', 'Google', 'Redirect URI mismatch', 'The redirect_uri in the request is not one of the authorized redirect URIs of the OAuth client.',
    ['A difference in scheme, host, port, path or trailing slash', 'The URI was added to a different OAuth client than the one whose client_id is used', 'Changes in the Google Cloud console can take from a few minutes to a few hours to apply'],
    ['In Google Cloud console, open APIs & Services, then Credentials, then the client, and compare the URI exactly', 'Allow some time after saving, then try again'], { vendor: true }),
  e('deleted_client', 'Google', 'OAuth client deleted', 'The client_id belongs to an OAuth client that was deleted.', ['The client was removed in the console'], ['Create a new client and update the client_id'], { vendor: true }),
  e('disallowed_useragent', 'Google', 'Embedded browser not allowed', 'Google does not allow sign-in from embedded web views.', ['An in-app browser or web view'], ['Open the system browser (ASWebAuthenticationSession, Custom Tabs) for sign-in'], { vendor: true }),
  e('org_internal', 'Google', 'App is internal to another organisation', 'The OAuth consent screen is set to Internal, and this user is outside that organisation.', ['A personal Gmail account used with an Internal app'], ['Set the consent screen to External, or sign in with an account from the organisation'], { vendor: true }),
  e('admin_policy_enforced', 'Google', 'Blocked by the Workspace admin', 'The Workspace administrator has restricted this app or scope.', ['Third-party app access is controlled in the admin console'], ['Ask the Workspace admin to allow the app'], { vendor: true }),

  // ------------------------------------------------------------------------------------------------ OAuth 2.0 core (RFC 6749, 6750, 8628)
  e('invalid_request', 'OAuth 2.0', 'Invalid request', 'The request is missing a required parameter, has an invalid value, repeats a parameter, or is malformed.',
    ['A missing parameter such as response_type, client_id, redirect_uri or code_challenge', 'A parameter sent twice', 'A token request sent as JSON instead of application/x-www-form-urlencoded', 'PKCE parameters the server does not support'],
    ['Read error_description: it usually names the parameter', 'Compare the request with the provider\'s documentation']),
  e('invalid_client', 'OAuth 2.0', 'Client authentication failed', 'The server could not identify the client: unknown client_id, wrong secret, or the wrong way of sending it.',
    ['A wrong or expired client secret', 'The secret is sent in the body but the provider expects HTTP Basic (or the other way round)', 'The client_id was deleted or belongs to another environment', 'A public client (no secret) registered as confidential'],
    ['Check the client_id and secret for this environment', 'Check the "token endpoint authentication method" in the app\'s settings and send credentials that way'], { status: '401' }),
  e('invalid_grant', 'OAuth 2.0', 'Grant not valid', 'The authorization code, refresh token or other grant is invalid, expired, revoked, already used, or does not match the request.',
    ['The code was used twice, or has expired (they live from about a minute to ten minutes)', 'The redirect_uri in the token request differs from the one in the authorization request', 'PKCE: the code_verifier is missing or does not match the code_challenge', 'A refresh token that expired, was revoked, or was already rotated', 'The code was issued to a different client_id', 'Clock differences, for JWT-bearer grants'],
    ['Exchange the code once, immediately', 'Send exactly the same redirect_uri in both requests', 'Send the code_verifier whose hash was sent as code_challenge', 'Start the sign-in again']),
  e('unauthorized_client', 'OAuth 2.0', 'Client not allowed to do this', 'This client is not allowed to use the requested grant type or response type.', ['The app is registered for a different flow (for example, authorization code is off)', 'Client credentials used by an app that is not confidential'], ['Enable the flow in the app\'s settings']),
  e('access_denied', 'OAuth 2.0', 'Access denied', 'The user or the server refused the request.', ['The user clicked Cancel or Deny', 'A policy or assignment rule blocked the user', 'An admin has not approved the app'], ['Ask the user to try again and accept', 'Check the user is allowed to use the app (assignments, groups, policies)']),
  e('unsupported_response_type', 'OAuth 2.0', 'Response type not supported', 'The server does not support the response_type requested.', ['Asking for token or id_token from a provider that has disabled the implicit flow', 'A misspelled response_type'], ['Use response_type=code with PKCE']),
  e('invalid_scope', 'OAuth 2.0', 'Invalid scope', 'A requested scope is unknown, invalid, or not allowed for this client.', ['A scope with a typo', 'A scope that has not been enabled for the app or API', 'Scopes separated by commas instead of spaces'], ['Check the provider\'s list of scopes, and that the app has been granted them']),
  e('server_error', 'OAuth 2.0', 'Server error', 'The authorization server hit an unexpected error.', ['A fault at the provider', 'A bad request that triggered a bug'], ['Retry; if it persists, send the provider the timestamp and request id']),
  e('temporarily_unavailable', 'OAuth 2.0', 'Temporarily unavailable', 'The authorization server is overloaded or down for maintenance.', ['An outage or rate limit'], ['Retry after a short wait']),
  e('unsupported_grant_type', 'OAuth 2.0', 'Grant type not supported', 'The server does not support the grant_type sent.', ['A misspelled grant_type', 'The provider has disabled this grant (for example, the password grant)'], ['Use authorization_code, refresh_token or client_credentials']),
  e('invalid_token', 'OAuth 2.0 (resource server)', 'Access token rejected', 'The API refused the access token: it is expired, revoked, malformed, or not meant for this API.', ['An expired access token', 'A token for a different audience', 'A token the API cannot verify (wrong issuer or key)'], ['Look at the token in the Tokens tool: exp, aud and iss', 'Get a new token'], { status: '401' }),
  e('insufficient_scope', 'OAuth 2.0 (resource server)', 'Token lacks a scope', 'The token is valid but does not carry the scope this call needs.', ['The scope was not requested, or was not granted'], ['Request the scope at sign-in, and check the user and app are allowed it'], { status: '403' }),
  e('authorization_pending', 'OAuth 2.0 device flow', 'Waiting for the user', 'The user has not finished approving the device code yet.', ['Normal while the user is still signing in on the other device'], ['Keep polling at the interval given']),
  e('slow_down', 'OAuth 2.0 device flow', 'Polling too fast', 'The device is polling faster than the server allows.', ['A poll interval shorter than the one in the response'], ['Add 5 seconds to the interval and carry on']),
  e('expired_token', 'OAuth 2.0 device flow', 'Device code expired', 'The device code was not approved in time.', ['The user took too long'], ['Start the device flow again']),

  // ------------------------------------------------------------------------------------------------ OpenID Connect
  e('login_required', 'OpenID Connect', 'Login required', 'The request needed no user interaction (prompt=none) and the user has no session.', ['A silent renew when the session has ended', 'Third-party cookies blocked, so a hidden iframe cannot see the session'], ['Fall back to an interactive sign-in, or use refresh tokens instead of hidden iframes']),
  e('interaction_required', 'OpenID Connect', 'Interaction required', 'Something needs the user (a prompt, consent, MFA) but the request said no interaction.', ['A conditional-access or MFA step', 'A new permission to consent to'], ['Retry interactively']),
  e('consent_required', 'OpenID Connect', 'Consent required', 'The user has to approve the permissions, and prompt=none forbids showing the screen.', ['The first use of the app, or new scopes'], ['Retry with prompt=consent or without prompt=none']),
  e('account_selection_required', 'OpenID Connect', 'Account choice required', 'More than one account is signed in and the user has to choose.', ['Several sessions in the browser'], ['Retry with prompt=select_account']),
  e('invalid_request_uri', 'OpenID Connect', 'request_uri invalid', 'The request_uri could not be fetched or is not valid.', ['A PAR request_uri that expired (they live seconds) or was already used', 'A request_uri the server cannot reach'], ['Push a fresh request and use its request_uri straight away']),
  e('invalid_request_object', 'OpenID Connect', 'Request object invalid', 'The signed request object is malformed or its signature or claims are wrong.', ['Wrong key, wrong issuer or audience in the request JWT'], ['Check the JWT\'s iss, aud and signature key']),
  e('request_not_supported', 'OpenID Connect', 'request parameter not supported', 'The provider does not support request objects.', ['Passing a request JWT to a provider that does not accept them'], ['Send the parameters in the URL']),
  e('request_uri_not_supported', 'OpenID Connect', 'request_uri not supported', 'The provider does not support request_uri.', ['PAR not enabled'], ['Send the parameters in the URL']),
  e('registration_not_supported', 'OpenID Connect', 'Dynamic registration not supported', 'The provider does not support the registration parameter.', ['Using registration in the request'], ['Register the client up front']),
]

// Descriptions that identify an error by what it says rather than its code (providers put these in error_description)
const PATTERNS = [
  { re: /redirect[_ ]?uri.*(must|not match|mismatch|invalid|not allowed|not registered|not whitelisted|not permitted)|callback url mismatch/i, id: 'redirect_uri_mismatch', note: 'The provider said the redirect URI is not allowed.' },
  { re: /code[_ ]verifier|pkce.*(fail|verif|mismatch)/i, id: 'invalid_grant', note: 'The description mentions the PKCE code verifier.' },
]

const byCode = new Map(ERRORS.map((x) => [x.code.toLowerCase(), x]))

/** Pull the error codes out of whatever was pasted: "error=...", a whole URL or body, an AADSTS code, or the bare code. */
export function errorCandidates(input) {
  const text = String(input || '').trim()
  if (!text) return []
  const out = []
  for (const m of text.matchAll(/AADSTS\d{3,7}/gi)) out.push(m[0].toUpperCase())
  for (const m of text.matchAll(/(?:^|[?&#"'\s,{])error["']?\s*[=:]\s*["']?([A-Za-z0-9_.:-]+)/gi)) out.push(m[1])
  if (/^[A-Za-z0-9_.:-]+$/.test(text)) out.push(text)
  return [...new Set(out)]
}

/** Entries that explain the pasted error, vendor-specific ones first. Each is { ...entry, why } where why says how it matched. */
export function lookupError(input) {
  const text = String(input || '').trim()
  const found = new Map()
  for (const c of errorCandidates(text)) {
    const hit = byCode.get(c.toLowerCase())
    if (hit) found.set(hit.code, { ...hit, why: /^AADSTS/i.test(c) ? 'Matched the AADSTS code' : 'Matched the error code' })
  }
  if (text) {
    for (const p of PATTERNS) {
      if (p.re.test(text)) {
        const hit = ERRORS.find((x) => x.code === p.id)
        if (hit && !found.has(hit.code)) found.set(hit.code, { ...hit, why: p.note })
      }
    }
  }
  return [...found.values()].sort((a, b) => (/^AADSTS/.test(b.code) - /^AADSTS/.test(a.code)) || (b.vendor === true) - (a.vendor === true))
}

/** One entry for a flow check: the AADSTS code in the description wins, then the error code. Null when nothing is known. */
export function explainError(error, description = '') {
  return lookupError(`${description} error=${error || ''}`)[0] || null
}

/** Example errors for the lookup page. */
export const EXAMPLES = ['invalid_grant', 'redirect_uri_mismatch', 'AADSTS50011', 'invalid_client', 'login_required', 'access_denied']
