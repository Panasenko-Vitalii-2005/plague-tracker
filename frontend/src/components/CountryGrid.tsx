import type { CountrySnapshot } from '../api/types.ts'
import { formatCountryName } from '../domain/countries.ts'
import { countryStatusComposition } from '../domain/countryDonut.ts'
import { formatPopulation } from '../domain/format.ts'
import { CountryGovernmentActions, CountryResearch } from './CountryResearch.tsx'

const sliceColors = {
  Healthy: 'var(--healthy)',
  Infected: 'var(--infected)',
  Dead: 'var(--dead)',
} as const

function CountryDonut({ country }: { country: CountrySnapshot }) {
  const { slices, total } = countryStatusComposition(country)
  const circumference = 2 * Math.PI * 40
  const label = `Recorded status mix for ${formatCountryName(country.id)}: `
    + slices.map((slice) => `${slice.name} ${formatPopulation(slice.value)}`).join(', ')
    + '. Zombies are shown separately.'

  return <div className="country-card-chart" role="img" aria-label={label}>
    {total > 0 ? <svg className="country-card-donut" viewBox="0 0 112 112" aria-hidden="true">
      <circle cx="56" cy="56" r="40" fill="none" stroke="var(--border)" strokeWidth="14" />
      {slices.map((slice, index) => {
        const length = Math.max(0, slice.value) / total * circumference
        const offset = -slices.slice(0, index)
          .reduce((sum, previous) => sum + Math.max(0, previous.value), 0) / total * circumference
        return length > 0 && <circle key={slice.name} cx="56" cy="56" r="40" fill="none"
          stroke={sliceColors[slice.name]} strokeWidth="14" strokeDasharray={`${length} ${circumference}`}
          strokeDashoffset={offset} transform="rotate(-90 56 56)">
          <title>{`${slice.name}: ${formatPopulation(slice.value)}`}</title>
        </circle>
      })}
    </svg> : <div className="country-card-empty-donut" aria-hidden="true" />}
    <span className="country-card-chart-caption">Status mix</span>
  </div>
}

function CountryCard({ country }: { country: CountrySnapshot }) {
  const metrics = [
    ['Population', country.currentPopulation],
    ['Healthy', country.healthyPopulation],
    ['Infected', country.infected],
    ['Zombies', country.zombies],
    ['Dead', country.deadPopulation],
  ] as const

  return <article className="surface country-card" aria-label={`${formatCountryName(country.id)} country card`}>
    <h3 title={formatCountryName(country.id)}>{formatCountryName(country.id)}</h3>
    <div className="country-card-body">
      <dl className="country-card-metrics">
        {metrics.map(([label, value]) => <div key={label}
          className={`country-card-metric country-card-metric-${label.toLowerCase()}`}>
          <dt>{label}</dt><dd>{formatPopulation(value)}</dd>
        </div>)}
      </dl>
      <CountryDonut country={country} />
    </div>
    <CountryResearch cureResearch={country.cureResearch} />
    <CountryGovernmentActions actions={country.governmentActions} />
  </article>
}

export function CountryGrid({ countries }: { countries: readonly CountrySnapshot[] }) {
  const ordered = [...countries].sort((left, right) => left.index - right.index)
  return <section className="countries-section" aria-label="Countries">
    <div className="section-title"><div><span className="eyebrow">COUNTRIES</span>
      <h2>Country populations</h2></div><span>{ordered.length} recorded countries</span></div>
    {ordered.length > 0 ? <div className="country-grid">
      {ordered.map((country) => <CountryCard key={country.id} country={country} />)}
    </div> : <p className="surface country-grid-empty">No countries in this snapshot.</p>}
  </section>
}
