import { useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faFlask } from '@fortawesome/free-solid-svg-icons'

// Sample captures served from /demo/ (made by scripts/make-demo-data.mjs). Every host, user and token in them is invented.
const SETS = [
  { id: 'pair', label: 'Working and broken page load', hint: 'Two loads of the same shop page, one healthy and one with failures. Opens both, so Compare is ready.', files: ['shop-working.har', 'shop-broken.har'] },
  { id: 'working', label: 'Working page load', hint: 'A healthy capture: fast, compressed, cached, with security headers.', files: ['shop-working.har'] },
  { id: 'broken', label: 'Broken page load', hint: 'Slow server, 500 errors, a failed CORS call, heavy files, a redirect chain.', files: ['shop-broken.har'] },
  { id: 'sso', label: 'HAR with a SAML sign-in', hint: 'A single sign-in that works. Opens the “SAML found” prompt.', files: ['sso-signin.har'] },
  { id: 'oauth', label: 'OAuth sign-in that fails', hint: 'A single-page app signing in with PKCE. The token request fails with invalid_grant for two reasons the OAuth tool finds.', files: ['oauth-signin-failed.har'] },
  { id: 'cookies', label: 'Login loop (cookies)', hint: 'A sign-in that bounces back to the login page: one session cookie is rejected and one is never sent back.', files: ['cookie-login-loop.har'] },
  { id: 'tracer', label: 'SAML-tracer export', hint: 'A sign-in that fails: the identity provider says Success, the app answers 403.', files: ['sso-failed-saml-tracer.json'] },
]

/** "Try a sample" buttons for the start screen. Fetches same-origin files and hands them to the normal upload path. */
export default function Demos({ onFiles, onError }) {
  const [busy, setBusy] = useState('')
  const load = async (set) => {
    setBusy(set.id)
    try {
      const files = await Promise.all(set.files.map(async (name) => {
        const res = await fetch(`/demo/${name}`)
        if (!res.ok) throw new Error(`Could not load the sample ${name} (${res.status}).`)
        return new File([await res.blob()], name, { type: 'application/json' })
      }))
      onFiles(files)
    } catch (e) {
      onError?.(e.message || 'Could not load the sample.')
    } finally {
      setBusy('')
    }
  }
  return (
    <div className="demos">
      <p className="demos-h"><FontAwesomeIcon icon={faFlask} /> No capture handy? Try a sample</p>
      <div className="demos-row">
        {SETS.map((s) => (
          <button key={s.id} type="button" className="btn demo-btn" title={s.hint} disabled={!!busy} aria-busy={busy === s.id} data-demo={s.id} onClick={() => load(s)}>{s.label}</button>
        ))}
      </div>
      <p className="demos-note">Sample data is invented. The SAML signatures in it are placeholders, not real.</p>
    </div>
  )
}
