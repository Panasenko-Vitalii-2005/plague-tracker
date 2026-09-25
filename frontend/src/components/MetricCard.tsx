import { formatPercent, formatPopulation } from '../domain/format.ts'

export type MetricTone = 'healthy' | 'infected' | 'dead' | 'zombies'

export function MetricCard({ label, value, percent, tone, quiet = false }: {
  label: string
  value: number
  percent?: number
  tone: MetricTone
  quiet?: boolean
}) {
  return <article className={`metric-card metric-${tone}${quiet ? ' is-quiet' : ''}`}>
    <div className="metric-card-top"><span className="metric-symbol" aria-hidden="true" />
      <span className="metric-label">{label}</span></div>
    <strong className="metric-value">{formatPopulation(value)}</strong>
    <span className="metric-detail">{percent === undefined ? 'Population' : `${formatPercent(percent)} of original population`}</span>
  </article>
}
