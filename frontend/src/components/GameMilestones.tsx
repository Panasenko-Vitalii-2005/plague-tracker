import type { GameMilestone, GameMilestoneType } from '../api/types.ts'
import { formatCountryName } from '../domain/countries.ts'

const labels: Record<GameMilestoneType, string> = {
  virus_dna_detected: 'Virus DNA detected',
  more_infectious_than_tb: 'More infectious than TB',
  more_infectious_than_hiv: 'More infectious than HIV',
  disease_detected: 'Disease detected in',
  first_death: 'First death in',
  more_infectious_than_common_cold: 'More infectious than the Common Cold',
  worse_than_black_death: 'Worse than the Black Death',
  worse_than_spanish_flu: 'Worse than Spanish Flu',
  worse_than_smallpox: 'Worse than Smallpox',
}

function milestoneLabel(event: GameMilestone): string {
  const label = labels[event.type]
  return event.countryId === null ? label : `${label} ${formatCountryName(event.countryId)}`
}

export function GameMilestones({ events }: { events: readonly GameMilestone[] }) {
  return <section className="surface milestone-panel" aria-label="Game Milestones">
    <div className="panel-heading"><div><span className="eyebrow">OUTBREAK TIMELINE</span>
      <h2>Game Milestones</h2></div>
      <span className="panel-meta">{events.length} recorded</span></div>
    {events.length === 0
      ? <p className="milestone-empty">No game milestones available for this snapshot.</p>
      : <ol className="milestone-list">{events.map((event, index) =>
        <li className="milestone-item" key={index}>
          <span className="milestone-label">{milestoneLabel(event)}</span>
          <span className="milestone-day">Day {event.turn}</span>
        </li>)}</ol>}
  </section>
}
