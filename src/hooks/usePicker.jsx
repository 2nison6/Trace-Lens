import { useRef } from 'react'
import { watchPicker } from '../state/pickerWatch'

/** Hidden file input + a function that opens it. Shared by the start screen and the toolbar. */
export default function usePicker(onFiles, externalRef) {
  const own = useRef(null)
  const ref = externalRef || own
  const handle = (list) => {
    const files = [...list]
    if (files.length) onFiles(files)
  }
  return {
    open: () => ref.current && ref.current.click(),
    input: <input ref={ref} type="file" accept=".har,.json,application/json" multiple hidden onClick={(e) => watchPicker(e.currentTarget)} onChange={(e) => { handle(e.target.files); e.target.value = '' }} />,
    handle,
  }
}
