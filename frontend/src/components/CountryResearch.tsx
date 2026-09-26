import type { CountryCureResearch, GovernmentActionEvent } from '../api/types.ts'
import { formatGovernmentAction, formatResearchAllocation, formatResearchBudget } from '../domain/countryResearch.ts'
import './CountryResearch.css'

type FlaskState = keyof CountryCureResearch['flasks']

const flaskLabels: Record<FlaskState, string> = {
  active: 'Active research flask',
  inactive: 'Inactive research flask',
  destroyed: 'Destroyed research flask',
}

function Flask({ state }: { state: FlaskState }) {
  return <svg className={`research-flask is-${state}`} viewBox="0 0 24 26" role="img"
    aria-label={flaskLabels[state]}>
    <title>{flaskLabels[state]}</title>
    <path d="M8 2h8M10 2v8L4.8 20a2 2 0 0 0 1.8 3h10.8a2 2 0 0 0 1.8-3L14 10V2" />
    {state === 'active' && <path className="research-flask-fill" d="M7.7 18h8.6l1.8 3H5.9z" />}
    {state === 'destroyed' && <path className="research-flask-break" d="m3 24 18-20M9 17l3 2-2 3" />}
  </svg>
}

export function CountryResearch({ cureResearch }: { cureResearch: CountryCureResearch | null }) {
  if (cureResearch === null) {
    return <section className="country-research" aria-label="Cure research">
      <h4>Cure research</h4><p className="country-research-unavailable">Cure research data unavailable</p>
    </section>
  }

  const { flasks } = cureResearch
  const states: FlaskState[] = ['active', 'inactive', 'destroyed']
  return <section className="country-research" aria-label="Cure research">
    <h4>Cure research</h4>
    <dl className="country-research-metrics">
      <div><dt>Budget</dt><dd>{formatResearchBudget(cureResearch.funding)}</dd></div>
      <div><dt>Allocation</dt><dd>{formatResearchAllocation(cureResearch.allocation)}</dd></div>
      <div><dt>Rank</dt><dd>{cureResearch.rank === null ? 'Not ranked' : `#${cureResearch.rank}`}</dd></div>
    </dl>
    <div className="research-flasks" aria-label={`Research flasks: ${flasks.active} active, ${flasks.inactive} inactive, ${flasks.destroyed} destroyed`}>
      {states.flatMap((state) => Array.from({ length: flasks[state] }, (_, index) =>
        <Flask key={`${state}-${index}`} state={state} />))}
    </div>
    <p className="research-flask-counts">Active {flasks.active} · Potential {flasks.inactive} · Destroyed {flasks.destroyed}</p>
  </section>
}

export function CountryGovernmentActions({ actions }: { actions: readonly GovernmentActionEvent[] }) {
  if (actions.length === 0) {
    return <p className="country-actions-empty">No government actions</p>
  }

  return <details className="country-actions">
    <summary>Government actions <span>({actions.length})</span></summary>
    <ol className="country-actions-list">
      {[...actions].reverse().map((action, index) => <li key={`${action.id}-${action.turn}-${index}`}
        className={action.removed ? 'is-removed' : undefined}>
        <span title={action.id}>{formatGovernmentAction(action.id)}</span>
        <small>Turn {action.turn}{action.removed && <em> · Removed</em>}</small>
      </li>)}
    </ol>
  </details>
}
