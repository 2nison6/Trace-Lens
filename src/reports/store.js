// What the paste-in pages (certificates, a pasted token, discovery and metadata checks) have worked out, kept outside the pages so a
// report can use it. Pages publish their latest result here; the report pages read it. Nothing is stored beyond the open tab.
import { useSyncExternalStore } from 'react'

let state = { certs: null, tokenInspect: null, discovery: null, metadata: null }
const listeners = new Set()

export const reportInputs = {
  get: () => state,
  set(key, value) {
    if (state[key] === value) return
    state = { ...state, [key]: value }
    listeners.forEach((l) => l())
  },
  subscribe(l) { listeners.add(l); return () => listeners.delete(l) },
}

export const useReportInputs = () => useSyncExternalStore(reportInputs.subscribe, reportInputs.get)
