import type { LiveSnapshot } from '../api/types.ts'
import { formatGameTurn } from '../domain/gameDate.ts'
import { buildOutbreakTimeline } from '../domain/outbreakTimeline.ts'

export function OutbreakTimeline({ snapshot }: { snapshot: LiveSnapshot }) {
  const entries = buildOutbreakTimeline(snapshot)
  return <section className="surface timeline-panel" aria-label="Outbreak Timeline">
    <div className="panel-heading"><div><span className="eyebrow">CAMPAIGN EVENTS</span>
      <h2>Outbreak Timeline</h2></div>
      <span className="panel-meta">{entries.length} recorded</span></div>
    {entries.length === 0
      ? <p className="timeline-empty">No outbreak timeline events available for this snapshot.</p>
      : <ol className="timeline-list">{entries.map((event, index) =>
        <li className={`timeline-item is-${event.kind}`} key={index}>
          <span className="timeline-label">{event.label}</span>
          <span className="timeline-day">{formatGameTurn(event.turn, snapshot)}</span>
        </li>)}</ol>}
  </section>
}
