export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Resolves in the first task after the next frame has been rendered.
 *
 * Awaiting a requestAnimationFrame callback is not enough: the continuation runs in the microtask checkpoint right after
 * the callback, BEFORE style, layout and paint, so blocking work that follows would still delay the very frame we were
 * waiting for. A message event is a separate task, and the browser finishes the frame's rendering step before it runs one.
 * The timer is a fallback for hidden tabs, where requestAnimationFrame never fires.
 */
export function afterPaint(maxWait = 100) {
  return new Promise((resolve) => {
    const guard = setTimeout(resolve, maxWait)
    requestAnimationFrame(() => {
      const { port1, port2 } = new MessageChannel()
      port1.onmessage = () => {
        port1.close()
        clearTimeout(guard)
        resolve()
      }
      port2.postMessage(null)
    })
  })
}
