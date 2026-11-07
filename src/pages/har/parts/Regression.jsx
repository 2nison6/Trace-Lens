import { useMemo, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCircleCheck, faCircleXmark } from '@fortawesome/free-solid-svg-icons'
import { analyze, healthScore } from '../../../har/analyzer'
import { DEFAULT_BUDGET, regressionCheck } from '../../../har/compare'
import { Card } from '../../../components/shared/ui'

const FIELDS = [
  ['loadPct', 'Load time may grow by', '%'], ['bytesPct', 'Transferred bytes may grow by', '%'], ['requestsPct', 'Request count may grow by', '%'],
  ['newErrors', 'New failed requests allowed', ''], ['scoreDrop', 'Health score may drop by', ' points'],
]

/** A pass/fail check of capture B against capture A, with a budget the user sets. */
export default function Regression({ a, b, names }) {
  const [budget, setBudget] = useState(DEFAULT_BUDGET)
  const result = useMemo(() => regressionCheck(a, b, budget, { analyze, healthScore }), [a, b, budget])
  const failed = result.checks.filter((c) => !c.pass)
  return (
    <Card title="Regression check" aside={<span className={`sev tone-${result.pass ? 'good' : 'crit'}`}><FontAwesomeIcon icon={result.pass ? faCircleCheck : faCircleXmark} /> {result.pass ? 'Within budget' : `${failed.length} over budget`}</span>}>
      <p className="lede" style={{ marginTop: 0 }}>Is {names[1]} worse than {names[0]} by more than you allow? Set the budget, and the table says which limits were broken. Use it to review a change: capture the same page before and after.</p>
      <div className="saml-expect">
        {FIELDS.map(([k, label, unit]) => (
          <label key={k}>{label}{unit ? ` (${unit.trim()})` : ''}
            <input type="number" min="0" value={budget[k]} onChange={(e) => setBudget({ ...budget, [k]: Math.max(0, Number(e.target.value) || 0) })} />
          </label>
        ))}
      </div>
      <table className="tbl saml-attrs">
        <thead><tr><th>Measure</th><th>{names[0]}</th><th>{names[1]}</th><th>Change</th><th>Allowed</th><th /></tr></thead>
        <tbody>
          {result.checks.map((c) => (
            <tr key={c.id}>
              <td>{c.label}</td><td className="num">{c.fmt(c.a)}</td><td className="num">{c.fmt(c.b)}</td>
              <td className={`num ${c.pass ? '' : 'tone-crit'}`}>{c.change === Infinity ? 'new' : `${c.change > 0 ? '+' : ''}${c.unit === '%' ? c.change.toFixed(1) : Math.round(c.change)}${c.unit}`}</td>
              <td className="num dim">{c.limit}{c.unit}</td>
              <td><span className={`sev tone-${c.pass ? 'good' : 'crit'}`}>{c.pass ? 'OK' : 'Over'}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  )
}
