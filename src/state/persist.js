// Optional "remember my files on this device". Off by default.
//
// HAR files hold live tokens and cookies, so nothing is ever stored unless the user switches this on, and it is stored only
// in this browser's IndexedDB (never sent anywhere). Loaded files are NOT reopened automatically after a reload: the start
// screen offers to restore them, so the user decides each time. Everything here fails quietly: a browser that blocks
// storage (private windows, quota) simply behaves as if the feature were off.

const KEEP = 'harlens-keep'
const DB = 'harlens'
const STORE = 'files'

export function keepEnabled() {
  try { return localStorage.getItem(KEEP) === '1' } catch { return false }
}
export function setKeep(on) {
  try { localStorage.setItem(KEEP, on ? '1' : '0') } catch { /* storage unavailable: the choice just won't persist */ }
}

function open() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable')); return }
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'name' })
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function tx(mode, run) {
  const db = await open()
  try {
    return await new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode)
      const out = run(t.objectStore(STORE))
      t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : undefined)
      t.onerror = () => reject(t.error)
      t.onabort = () => reject(t.error)
    })
  } finally {
    db.close()
  }
}

/** Saves (or replaces) a file by name. Resolves false when it could not be stored. */
export async function saveFile(name, text) {
  try { await tx('readwrite', (s) => s.put({ name, text, size: text.length, savedAt: Date.now() })); return true } catch { return false }
}
export async function deleteSaved(name) {
  try { await tx('readwrite', (s) => s.delete(name)) } catch { /* nothing to remove */ }
}
export async function clearSaved() {
  try { await tx('readwrite', (s) => s.clear()) } catch { /* nothing to remove */ }
}
/** Names and sizes of what is saved, without reading the file contents into the page. */
export async function listSaved() {
  try {
    const all = await tx('readonly', (s) => s.getAll())
    return (all || []).map(({ name, size, savedAt }) => ({ name, size, savedAt })).sort((a, b) => b.savedAt - a.savedAt)
  } catch { return [] }
}
export async function loadSaved() {
  try { return (await tx('readonly', (s) => s.getAll())) || [] } catch { return [] }
}
