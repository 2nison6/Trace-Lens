import { useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faKey, faXmark } from '@fortawesome/free-solid-svg-icons'
import usePicker from '../../hooks/usePicker'

/**
 * Shown once, after a HAR that contains SAML messages has opened: it offers to add a SAML-tracer export as well.
 * A HAR from DevTools often misses what SAML-tracer records (the redirects between sites happen across page loads, and a
 * browser can drop the page body of a redirect), so having both gives the fullest picture. Nothing is required: the SAML in
 * the HAR is analysed either way.
 */
export default function SamlPrompt({ found, hasTrace, onFiles, onClose, onOpen }) {
  const total = found.reduce((n, f) => n + f.n, 0)
  const picker = usePicker((files) => { onClose(); onFiles(files) })
  const first = useRef(null)
  useEffect(() => {
    first.current?.focus()
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return (
    <motion.div key="saml-prompt" className="modal-wrap" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} onClick={onClose}>
      <motion.div
        className="modal" role="dialog" aria-modal="true" aria-labelledby="saml-prompt-title" onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.96, y: 6 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }} transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
      >
        <header>
          <h2 id="saml-prompt-title"><FontAwesomeIcon icon={faKey} /> SAML found in your capture</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><FontAwesomeIcon icon={faXmark} /></button>
        </header>
        <p className="lede">
          {total} SAML message{total === 1 ? '' : 's'} in {found.length === 1 ? found[0].name : `${found.length} files`}.
          {hasTrace ? ' A SAML-tracer export is already loaded; you can add another.' : ' Do you also have a SAML-tracer export (the JSON file from the browser extension)? Add it to look at both together.'}
        </p>
        <div className="actions">
          <button ref={first} type="button" className="btn primary" onClick={() => { picker.open() }}>Add a SAML-tracer export</button>
          <button type="button" className="btn" onClick={onOpen}>Show the SAML in this capture</button>
          <button type="button" className="btn" onClick={onClose}>Not now</button>
        </div>
        <p className="hint">You can add one later from the SAML page, or by dropping the file anywhere. Nothing is uploaded.</p>
        {picker.input}
      </motion.div>
    </motion.div>
  )
}
