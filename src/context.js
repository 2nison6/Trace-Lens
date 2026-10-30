import { createContext } from 'react'

// inspect(entryId, harIndex?) opens the request inspector drawer
export const InspectCtx = createContext(() => {})

export const DEFAULT_FILTERS = { q: '', status: 'all', type: 'all', host: 'all', minKB: '', minMs: '' }

// showList(title, entries, { filter?, harIndex? }) opens the request-list panel for a clicked bar / card
export const ListCtx = createContext(() => {})
