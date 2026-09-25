import { shortSessionId } from '../domain/dashboard.ts'

export function SessionSummary({ items, sessionId }: {
  items: readonly { label: string; value: string | number; detail?: string }[]
  sessionId: string | null
}) {
  return <section className={`summary-band${items.length % 2 === 0 ? ' is-odd' : ''}`} aria-label="Session summary">
    {items.map((item) => <div className="summary-item" key={item.label}>
      <span className="summary-label">{item.label}</span>
      <strong>{item.value}</strong>
      {item.detail && <small>{item.detail}</small>}
    </div>)}
    <div className="summary-item session-summary-id" title={sessionId ?? undefined}>
      <span className="summary-label">SESSION</span>
      <strong>{shortSessionId(sessionId)}</strong>
      <small title={sessionId ?? undefined}>Hover to see full ID</small>
    </div>
  </section>
}
