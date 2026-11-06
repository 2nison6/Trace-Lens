// Shared by the auth tools: severity -> CSS tone and word, and the worst severity in a list of checks.
const TONE = { critical: 'crit', warning: 'warn', info: 'info', ok: 'good' }
const WORD = { critical: 'Critical', warning: 'Warning', info: 'Note', ok: 'OK' }

export const toneOf = (severity) => TONE[severity]
export const wordOf = (severity) => WORD[severity]

/** Worst severity in a list of checks, for a summary badge. */
export function worstOf(checks) {
  for (const s of ['critical', 'warning', 'info']) if (checks.some((c) => c.severity === s)) return s
  return 'ok'
}
