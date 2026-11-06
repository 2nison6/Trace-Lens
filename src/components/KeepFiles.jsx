import { useCallback, useEffect, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faClockRotateLeft, faTrash } from '@fortawesome/free-solid-svg-icons'
import { clearSaved, keepEnabled, listSaved, loadSaved, setKeep } from '../persist'
import { fmtBytes } from '../utils'
import { Switch } from './ui'

/**
 * Start-screen control for "keep my files on this device". Off by default: HAR files hold live tokens and cookies, so
 * nothing is stored unless the user turns this on, and what is stored never reopens by itself. When files are saved, the
 * start screen offers to restore them (or wipe them).
 */
export default function KeepFiles({ onFiles, fileCount, toast, restoreOnly = false }) {
  const [on, setOn] = useState(keepEnabled)
  const [saved, setSaved] = useState([])
  const refresh = useCallback(() => { listSaved().then(setSaved) }, [])
  // The list is only shown while the setting is on, so there is nothing to clear when it is off
  useEffect(() => { if (on) refresh() }, [on, refresh])

  const change = async (next) => {
    setKeep(next)
    setOn(next)
    if (!next) { await clearSaved(); setSaved([]); toast?.('Saved files removed from this device') }
  }
  const restore = async () => {
    const all = await loadSaved()
    if (!all.length) return
    onFiles(all.map((f) => new File([f.text], f.name, { type: 'application/json' })))
  }
  const wipe = async () => { await clearSaved(); setSaved([]); toast?.('Saved files removed from this device') }

  const offer = on && saved.length > 0 && fileCount === 0
  // In the "No file loaded" state after a reload only the restore offer is shown, never the settings
  if (restoreOnly && !offer) return null

  return (
    <div className="keep-box">
      {!restoreOnly && <Switch checked={on} onChange={change} label="Keep my files on this device" hint="Off by default. HAR files can contain live tokens and cookies." />}
      {!restoreOnly && on && (
        <p className="hint" style={{ margin: 0 }}>
          Files you open are stored in this browser only (never uploaded) until you remove them or turn this off. Do not use it on a shared computer.
        </p>
      )}
      {offer && (
        <div className="toolrow">
          <span className="grow"><FontAwesomeIcon icon={faClockRotateLeft} /> {saved.length} saved file{saved.length === 1 ? '' : 's'}: {saved.slice(0, 2).map((f) => `${f.name} (${fmtBytes(f.size)})`).join(', ')}{saved.length > 2 ? `, +${saved.length - 2} more` : ''}</span>
          <button type="button" className="btn sm primary" onClick={restore}>Restore</button>
          <button type="button" className="btn sm" onClick={wipe}><FontAwesomeIcon icon={faTrash} /> <span>Remove</span></button>
        </div>
      )}
    </div>
  )
}
