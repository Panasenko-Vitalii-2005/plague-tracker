import type { ZombieHordeEvent } from '../api/types.ts'
import { formatCountryName } from '../domain/countries.ts'
import { formatPopulation } from '../domain/format.ts'

export function ZombieHordeMovements({ events, datesByDay }: {
  events: readonly ZombieHordeEvent[]
  datesByDay?: ReadonlyMap<number, string>
}) {
  const dayLabel = (day: number) => `Day ${day}${datesByDay?.has(day) ? ` · ${datesByDay.get(day)}` : ''}`

  return <section className="surface horde-panel" aria-label="Zombie Horde Movements">
    <div className="panel-heading"><div><span className="eyebrow">CAMPAIGN MOVEMENTS</span>
      <h2>Zombie Horde Movements</h2></div>
      <span className="panel-meta">{events.length} recorded</span></div>
    {events.length === 0 ? <p className="horde-empty">No zombie horde movements recorded yet.</p>
      : <ol className="horde-list">{events.map((event, index) => <li className="horde-item" key={index}>
        <div className="horde-main">
          <strong className="horde-route"><span>{formatCountryName(event.sourceCountryId)}</span>
            <span className="horde-arrow" aria-label="to">→</span>
            <span>{formatCountryName(event.destinationCountryId)}</span></strong>
          <span className="horde-count">{formatPopulation(event.zombies)} zombies</span>
        </div>
        <div className="horde-timing">
          <span>Departed: {dayLabel(event.turn)}</span>
          {event.arrivalTurn === null
            ? <span className="horde-state is-transit">In transit</span>
            : <span className="horde-state is-arrived">Arrived: {dayLabel(event.arrivalTurn)}</span>}
        </div>
      </li>)}</ol>}
  </section>
}
