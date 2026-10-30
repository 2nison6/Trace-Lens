import { useRef } from 'react'

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
    input: <input ref={ref} type="file" accept=".har,.json,application/json" multiple hidden onChange={(e) => { handle(e.target.files); e.target.value = '' }} />,
    handle,
  }
}
