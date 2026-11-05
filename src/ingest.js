import { flushSync } from 'react-dom'
import { analyzeCached } from './analyzer'
import { parseHar } from './harParser'
import { loadStore } from './loadStore'
import { afterPaint, sleep } from './paint'

// Opening a file: read -> parse -> analyze -> add to the app and open Overview.
//
// Parsing is synchronous and cannot be sliced, so the progress overlay has to be on screen BEFORE it runs, and has to keep
// animating while the main thread is blocked. That is why every stage is committed with flushSync and the first one waits
// for a painted frame, and why the overlay is animated by CSS (compositor) rather than by JavaScript.
//
// The overlay appears at once and stays for at least MIN_VISIBLE, so every upload gets visible feedback and it never flickers
// (a fast load would otherwise finish before the overlay could be seen).
const MIN_VISIBLE = 600

let tail = Promise.resolve() // runs go strictly one after another: a second drop while busy queues behind the first
let pending = 0 // runs queued or in flight; the overlay belongs to the batch and is cleared only when the last one is done
let startedAt = 0
let failures = []
let handlers = null // { commit(parsed) -> Promise, report(messages) } from the most recent caller

async function stage(patch) {
  flushSync(() => loadStore.update(patch))
  // Wait for a painted frame after every stage, so the overlay (and its new text) is on screen before the next blocking call
  await afterPaint()
}

async function run(files) {
  const parsed = []
  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    try {
      await stage({ stage: 'reading', file: file.name, i, n: files.length })
      const text = await file.text()
      await stage({ stage: 'parsing' })
      const har = parseHar(text, file.name)
      await stage({ stage: 'analyzing' })
      analyzeCached(har) // warm the findings so the first page opens instantly
      parsed.push(har)
    } catch (e) {
      failures.push(`${file.name}: ${e instanceof SyntaxError ? 'this file is not valid JSON' : e.message}`)
    }
  }
  if (!parsed.length) return
  await stage({ stage: 'rendering' })
  // Keep the overlay until the page that replaces the start screen has rendered AND painted. The timeout only guards against
  // a render that never commits (for example a failed lazy chunk) leaving the overlay up forever.
  await Promise.race([handlers.commit(parsed), sleep(3000)])
  await afterPaint()
}

async function settle() {
  await sleep(Math.max(0, MIN_VISIBLE - (performance.now() - startedAt)))
  if (pending > 0) return // another batch arrived meanwhile and now owns the overlay
  loadStore.clear()
  if (failures.length) {
    const list = failures
    failures = []
    handlers.report(list)
  }
}

/** Queue files for opening. `commit(parsed)` adds them to the app and resolves once that has rendered; `report(messages)` gets the failures. */
export function ingest(files, next) {
  if (!files.length) return
  handlers = next
  if (pending++ === 0) {
    startedAt = performance.now()
  }
  tail = tail
    .then(() => run(files))
    .catch((e) => { failures.push(e instanceof Error ? e.message : String(e)) })
    .then(() => {
      pending -= 1
      return pending === 0 ? settle() : undefined
    })
}
