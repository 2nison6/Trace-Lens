import { useEffect, useSyncExternalStore } from 'react'
import { STAGE_TEXT, loadStore } from '../loadStore'

/**
 * Progress overlay for opening a file. It subscribes to loadStore on its own, so a change of stage re-renders only this
 * component, never the app and the page behind it.
 *
 * The overlay is shown by CSS alone (a delayed fade, see .loading-wrap in layout.css): the browser keeps running it while
 * JavaScript is busy parsing, which a JavaScript-driven animation cannot do.
 */
export default function LoadOverlay() {
  const load = useSyncExternalStore(loadStore.subscribe, loadStore.get)
  const busy = !!load

  // The overlay blocks the mouse; this makes the app behind it unreachable by keyboard and screen reader too
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
      {load && (
        <div className="loading-wrap" aria-hidden="true">
          <div className="loading-card">
            <span className="spinner" />
            <strong>Analyzing HAR…</strong>
            <span className="loading-stage">{stage}{which}</span>
            <span className="loading-file ellipsis">{load.file}</span>
          </div>
        </div>
      )}
    </>
  )
}
