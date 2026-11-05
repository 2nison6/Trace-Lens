import { afterPaint } from './paint'

// index.html ships a static splash (#boot) that covers the blank page while the JavaScript bundle downloads. <App> calls
// signalReady() once it has mounted: after its first frame has been painted the splash is removed and
// window.__harlensReady is set (end-to-end tests and monitoring can wait for it).
let started = false

/** True once the first frame of the app has been painted. */
export const isReady = () => window.__harlensReady === true

export function signalReady() {
  if (started) return // StrictMode runs mount effects twice in development
  started = true
  afterPaint(300).then(() => {
    window.__harlensReady = true
    document.getElementById('boot')?.remove()
  })
}
