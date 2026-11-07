import { Component } from 'react'
import { NavLink } from 'react-router-dom'

/**
 * Catches a crash in the page being shown, so the sidebar stays usable and the user sees what happened instead of a blank app.
 * Keyed by the route (in App), so moving to another page tries again. Nothing is sent anywhere: the details are shown for copying.
 */
export default class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) { return { error } }

  componentDidCatch(error, info) {
    console.error('TraceLens page crashed:', error, info && info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    const e = this.state.error
    const text = `${e && e.message ? e.message : String(e)}`
    return (
      <div className="page" role="alert">
        <div className="empty">
          <h3>This page hit a problem</h3>
          <p>The rest of the app still works. The file you opened is still loaded. Try another page, or reload.</p>
          <p className="mono dim" style={{ wordBreak: 'break-word', maxWidth: '70ch' }}>{text}</p>
          <div className="actions">
            <button type="button" className="btn primary" onClick={() => this.setState({ error: null })}>Try again</button>
            <NavLink className="btn" to="/">Back to the home screen</NavLink>
          </div>
          <p className="hint">If it keeps happening, please report it with the text above (and not the file, which may contain credentials).</p>
        </div>
      </div>
    )
  }
}
