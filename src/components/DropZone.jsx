import { useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCloudArrowUp, faUpload } from '@fortawesome/free-solid-svg-icons'

export default function DropZone({ onFiles, compact = false }) {
  const [over, setOver] = useState(false)
  const inputRef = useRef(null)

  const handle = (list) => {
    const files = [...list]
    if (files.length) onFiles(files)
  }

  return (
    <motion.div
      className={`dropzone${over ? ' over' : ''}${compact ? ' compact' : ''}`}
      animate={{ scale: over ? 1.02 : 1 }}
      transition={{ type: 'spring', stiffness: 300, damping: 20 }}
      onDragOver={(e) => { e.preventDefault(); setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); handle(e.dataTransfer.files) }}
    >
      {!compact && (
        <motion.div className="dz-icon" animate={{ y: over ? -8 : [0, -6, 0] }} transition={over ? {} : { repeat: Infinity, duration: 2.4, ease: 'easeInOut' }}>
          <FontAwesomeIcon icon={faCloudArrowUp} />
        </motion.div>
      )}
      <div className="dz-text">{compact ? 'Drop more HAR files or' : 'Drag & drop one or more .har files here'}</div>
      {!compact && <div className="dz-sub">or</div>}
      <div className="btn-row center">
        <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} className="btn primary" onClick={() => inputRef.current.click()}>
          <FontAwesomeIcon icon={faUpload} /> Upload HAR file
        </motion.button>
      </div>
      <input ref={inputRef} type="file" accept=".har,.json,application/json" multiple hidden onChange={(e) => { handle(e.target.files); e.target.value = '' }} />
    </motion.div>
  )
}
