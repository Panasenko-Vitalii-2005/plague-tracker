import type { CountrySnapshot, InfrastructureStatus } from '../api/types.ts'
import './CountryInfrastructure.css'

type Infrastructure = Pick<CountrySnapshot, 'borderStatus' | 'airportStatus' | 'portStatus'>

const fields = [
  ['Borders', 'borderStatus'],
  ['Airport', 'airportStatus'],
  ['Port', 'portStatus'],
] as const

function label(status: InfrastructureStatus): string {
  return status === null ? 'N/A' : status === 'open' ? 'Open' : 'Closed'
}

export function CountryInfrastructure({ country }: { country: Infrastructure }) {
  return <section className="country-infrastructure" aria-label="Infrastructure status">
    <h4>Infrastructure</h4>
    <dl className="country-infrastructure-grid">
      {fields.map(([name, field]) => <div key={field}>
        <dt>{name}</dt>
        <dd className={`is-${country[field] ?? 'unavailable'}`}>{label(country[field])}</dd>
      </div>)}
    </dl>
  </section>
}
