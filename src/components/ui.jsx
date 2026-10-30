import { useId } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faArrowRight, faCircleCheck, faCircleXmark, faTriangleExclamation, faXmark,
} from '@fortawesome/free-solid-svg-icons'
import { groupOfStatus } from '../theme'

/** Segmented control: equal-width segments, one indicator that slides on the compositor. */
export function Segmented({ value, onChange, options, label, size = 'm' }) {
  const idx = Math.max(0, options.findIndex((o) => o.value === value))
  return (
    <div className={`seg seg-${size}`} role="radiogroup" aria-label={label} style={{ '--n': options.length, '--i': idx }}>
      <i className="seg-ind" aria-hidden="true" />
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={o.value === value ? 'on' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.icon}
          {o.label && <span>{o.label}</span>}
        </button>
      ))}
    </div>
  )
}

/** On/off switch with a visible label. */
export function Switch({ checked, onChange, label, hint, disabled }) {
  const id = useId()
  return (
    <label className={`switch${disabled ? ' disabled' : ''}`} htmlFor={id}>
      <input id={id} type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <i className="switch-ui" aria-hidden="true" />
      <span className="switch-text">
        {label}
        {hint && <small>{hint}</small>}
      </span>
    </label>
  )
}

export function Kbd({ children }) {
  return <kbd className="kbd">{children}</kbd>
}

/** Status code with a matching icon, so the state is never colour alone. */
export function StatusCode({ status, icon = false }) {
  const g = groupOfStatus(status)
  const ic = g === '2xx' ? faCircleCheck : g === '3xx' ? faArrowRight : g === '4xx' ? faTriangleExclamation : faCircleXmark
  return (
    <span className={`code ${status >= 500 || !status ? 's-5xx' : status >= 400 ? 's-4xx' : status >= 300 ? 's-3xx' : 's-2xx'}`}>
      {icon && <FontAwesomeIcon icon={ic} />}
      {status || 'ERR'}
    </span>
  )
}

export function Card({ title, aside, children, className = '', flush = false, as: Tag = 'section' }) {
  return (
    <Tag className={`card ${flush ? 'flush' : ''} ${className}`}>
      {(title || aside) && (
        <header className="card-h">
          {title && <h2>{title}</h2>}
          {aside && <div className="card-aside">{aside}</div>}
        </header>
      )}
      {children}
    </Tag>
  )
}

export function EmptyState({ icon, title, children, action }) {
  return (
    <div className="empty">
      {icon && <span className="empty-ic"><FontAwesomeIcon icon={icon} /></span>}
      {title && <h3>{title}</h3>}
      {children && <p>{children}</p>}
      {action}
    </div>
  )
}

export function Notice({ tone = 'info', icon, children, onDismiss }) {
  return (
    <div className={`notice notice-${tone}`} role={tone === 'crit' ? 'alert' : 'status'}>
      {icon && <FontAwesomeIcon icon={icon} />}
      <div>{children}</div>
      {onDismiss && <button type="button" className="icon-btn notice-x" onClick={onDismiss} aria-label="Dismiss"><FontAwesomeIcon icon={faXmark} /></button>}
    </div>
  )
}
