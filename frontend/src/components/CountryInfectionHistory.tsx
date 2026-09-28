import type { CountryInfectionEvent } from '../api/types.ts'
import { formatCountryName } from '../domain/countries.ts'

export function CountryInfectionHistory({ events }: { events: readonly CountryInfectionEvent[] }) {
  return <section className="surface infection-history-panel" aria-label="Country Infection History">
    <div className="panel-heading"><div><span className="eyebrow">DETECTED SPREAD</span>
      <h2>Country Infection History</h2></div>
      <span className="panel-meta">{events.length} recorded</span></div>
    {events.length === 0
      ? <p className="infection-history-empty">No infection history available for this snapshot.</p>
      : <ol className="infection-history-list">{events.map((event, index) =>
        <li className="infection-history-item" key={index}>
          <strong>{formatCountryName(event.countryId)}</strong>
          <span>Day {event.turn}</span>
        </li>)}</ol>}
  </section>
}
