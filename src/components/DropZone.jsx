import { useState } from 'react'
import usePicker from '../hooks/usePicker'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faArrowUpFromBracket, faPlus } from '@fortawesome/free-solid-svg-icons'

/** Large drop target for the start screen. The whole surface is a button, so keyboard and screen-reader users can open the picker too. */
export default function DropZone({ onFiles }) {
  const [over, setOver] = useState(false)
  const { open, input, handle } = usePicker(onFiles)
  return (
    <div
      className={`drop${over ? ' over' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true) }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOver(false) }}
      onDrop={(e) => { e.preventDefault(); setOver(false); handle(e.dataTransfer.files) }}
    >
      <button type="button" className="drop-btn" onClick={open}>
        <span className="drop-ic"><FontAwesomeIcon icon={faArrowUpFromBracket} /></span>
        <span className="drop-title">Drop HAR files here</span>
        <span className="drop-sub">or <u>choose files</u> from your computer</span>
      </button>
      {input}
    </div>
  )
}

/** Small "add another file" control for the toolbar. Also a drop target. */
export function AddFiles({ onFiles, pickerRef }) {
  const [over, setOver] = useState(false)
  const { open, input, handle } = usePicker(onFiles, pickerRef)
  return (
    <span
      className={`add-files${over ? ' over' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); handle(e.dataTransfer.files) }}
    >
      <button type="button" className="btn" onClick={open}><FontAwesomeIcon icon={faPlus} /> <span>Add file</span></button>
      {input}
    </span>
  )
}
