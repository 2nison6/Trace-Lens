import { createContext } from 'react'

// inspect(entryId, harIndex?) opens the request inspector in the dock
export const InspectCtx = createContext(() => {})

export const DEFAULT_FILTERS = { q: '', status: 'all', type: 'all', host: 'all', minKB: '', minMs: '' }

// showList(title, entries, { filter?, harIndex? }) opens the request list in the dock
export const ListCtx = createContext(() => {})

// { id, harIndex } of the request open in the inspector, so rows can show a selected state
export const SelectedCtx = createContext(null)

// True when the last navigation came from the keyboard: those actions repeat all day, so they skip animation
export const motionState = { keyboard: false }
