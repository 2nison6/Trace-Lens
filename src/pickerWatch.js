import { loadStore } from './loadStore'

// Between choosing a file in the browser's file dialog and the page being handed that file there can be a gap (a file in a
// synced or network folder, a very large file). The page gets no event during it, so nothing could show progress and the app
// looked frozen. When the dialog closes the window regains focus, which is the one signal the page gets: from then until the
// file arrives (change), or the dialog is cancelled (cancel), we show an "Opening file" overlay.
const SHOW_AFTER = 200 // ms after the dialog closes: a cancel or an instant change must not flash the overlay
const GIVE_UP = 30000 // never leave the overlay up forever if neither event ever comes

let active = null // stops the watch in progress

/** Call when the file input is clicked (that opens the dialog). */
export function watchPicker(input) {
  if (!input) return
  if (active) active()
  let showTimer = 0
  let giveUpTimer = 0
  let shown = false

  function stop() {
    clearTimeout(showTimer)
    clearTimeout(giveUpTimer)
    window.removeEventListener('focus', onFocus)
    input.removeEventListener('change', onChange)
    input.removeEventListener('cancel', stop)
    if (shown && loadStore.get()?.stage === 'opening') loadStore.clear()
    active = null
  }
  function onFocus() {
    window.removeEventListener('focus', onFocus)
    showTimer = setTimeout(() => {
      if (loadStore.get()) return
      shown = true
      loadStore.update({ stage: 'opening' })
    }, SHOW_AFTER)
  }
  function onChange() {
    // With files, the upload pipeline takes the overlay over from here (it replaces the stage), so don't clear it
    if (input.files && input.files.length) shown = false
    stop()
  }

  active = stop
  window.addEventListener('focus', onFocus)
  input.addEventListener('change', onChange)
  input.addEventListener('cancel', stop)
  giveUpTimer = setTimeout(stop, GIVE_UP)
}
