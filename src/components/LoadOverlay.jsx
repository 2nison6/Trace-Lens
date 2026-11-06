import { useEffect, useSyncExternalStore } from 'react'
import { STAGE_TEXT, loadStore } from '../loadStore'

/**
 * Progress overlay for opening a file: the words "Analyzing HAR…" with a spinner on the next line, and nothing else on
 * screen. The current stage is only announced to screen readers (the visually hidden live region below).
 *
 * It subscribes to loadStore on its own, so a change of stage re-renders only this component, never the app and the page
 * behind it. It is shown by CSS alone (see .loading-wrap in layout.css): the browser keeps running that animation while
 * JavaScript is busy parsing, which a JavaScript-driven animation cannot do.
 */
export default function LoadOverlay() {
  const load = useSyncExternalStore(loadStore.subscribe, loadStore.get)
  const opening = load?.stage === 'opening' // the file dialog just closed and the file has not arrived yet
  const busy = !!load && !opening

  // The overlay blocks the mouse; this makes the app behind it unreachable by keyboard and screen reader too. (Not while
  // opening: the file input that is about to receive the file lives in the app.)
  useEffect(() => {
    const app = document.querySelector('.app')
    if (!busy || !app) return undefined
    app.setAttribute('inert', '')
    return () => app.removeAttribute('inert')
  }, [busy])

  const stage = load ? STAGE_TEXT[load.stage] || '' : ''
  const which = load && load.n > 1 ? ` (file ${load.i + 1} of ${load.n})` : ''
  return (
    <>
      {/* Always mounted: screen readers announce text changes inside an existing live region far more reliably than a new one */}
      <div className="sr-only" role="status" aria-live="polite">{load ? `Analyzing HAR. ${stage}${which}` : ''}</div>
      {/* While we only wait for the file dialog's result, a click dismisses the overlay (some browsers send no event when a dialog is cancelled) */}
      {load && (
        <div className="loading-wrap" aria-hidden="true" onClick={opening ? () => loadStore.clear() : undefined}>
          <div className="loading-card">
            <strong>Analyzing HAR…</strong>
            <span className="spinner" />
          </div>
        </div>
      )}
    </>
  )
}
