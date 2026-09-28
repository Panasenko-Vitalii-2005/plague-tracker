import type { CountrySnapshot } from '../api/types.ts'
import { formatCountryName } from '../domain/countries.ts'
import { countryOverview } from '../domain/dashboard.ts'
import { formatPercent, formatPopulation, formatPublicOrder } from '../domain/format.ts'

export function CountryOverview({ id, country, context }: {
  id: string
  country: CountrySnapshot
  context: string
}) {
  const values = countryOverview(country)
  return <section className="surface country-overview" aria-label={`${formatCountryName(id)} overview`}>
    <div className="panel-heading"><div><span className="eyebrow">COUNTRY OVERVIEW</span>
      <h2>{formatCountryName(id)}</h2></div><span className="panel-meta">{context}</span></div>
    <div className="country-stat-grid">
      <div className="country-stat country-healthy"><span>Healthy</span><strong>{formatPopulation(values.healthy)}</strong>
        <small>{formatPercent(values.healthyPercent)} of original</small></div>
      <div className="country-stat country-infected"><span>Infected</span><strong>{formatPopulation(values.infected)}</strong>
        <small>{formatPercent(values.infectedPercent)} of original</small></div>
      <div className="country-stat country-dead"><span>Dead</span><strong>{formatPopulation(values.dead)}</strong>
        <small>{formatPercent(values.deadPercent)} of original</small></div>
      <div className="country-stat country-zombies"><span>Zombies</span><strong>{formatPopulation(values.zombies)}</strong>
        <small>Recorded population</small></div>
    </div>
    <div className="country-population-foot">
      <span>Original population <strong>{formatPopulation(values.originalPopulation)}</strong></span>
      <span>Current population <strong>{formatPopulation(values.currentPopulation)}</strong></span>
      <span>Public Order <strong>{formatPublicOrder(country.publicOrder)}</strong></span>
    </div>
  </section>
}
