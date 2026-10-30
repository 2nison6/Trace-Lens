// Chart colours live in styles/tokens.css (so light/dark swap in one place); JS only refers to them by name.
export const PHASE_VAR = {
  blocked: 'var(--c-blocked)',
  dns: 'var(--c-dns)',
  connect: 'var(--c-connect)',
  ssl: 'var(--c-ssl)',
  send: 'var(--c-send)',
  wait: 'var(--c-wait)',
  receive: 'var(--c-receive)',
}

export const PHASE_LABEL = {
  blocked: 'Queued',
  dns: 'DNS',
  connect: 'TCP',
  ssl: 'TLS',
  send: 'Sent',
  wait: 'Waiting',
  receive: 'Download',
}

export const PHASE_HELP = {
  blocked: 'Waiting in the browser before the request could start',
  dns: 'Looking up the server address',
  connect: 'Opening the connection',
  ssl: 'Securing the connection',
  send: 'Sending the request',
  wait: 'Waiting for the server to respond',
  receive: 'Downloading the response',
}

export const SERIES_VAR = ['var(--c-series-1)', 'var(--c-series-2)', 'var(--c-series-3)']

// Status groups: colour plus a word and an icon name, never colour alone
export const STATUS_GROUPS = {
  '2xx': { label: 'Success', tone: 'good', css: 'var(--good-mark)' },
  '3xx': { label: 'Redirect', tone: 'info', css: 'var(--c-ssl)' },
  '4xx': { label: 'Client error', tone: 'warn', css: 'var(--warn)' },
  '5xx': { label: 'Server error', tone: 'crit', css: 'var(--crit-mark)' },
  failed: { label: 'No response', tone: 'crit', css: 'var(--crit-mark)' },
}

export const groupOfStatus = (status) =>
  status >= 500 ? '5xx' : status >= 400 ? '4xx' : status >= 300 ? '3xx' : status >= 200 ? '2xx' : 'failed'
