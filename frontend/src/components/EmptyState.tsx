export function EmptyState({ title, detail, tone = 'neutral' }: {
  title: string
  detail: string
  tone?: 'neutral' | 'waiting' | 'error'
}) {
  return <section className={`empty-state empty-${tone}`} role="status">
    <span className="empty-state-mark" aria-hidden="true" />
    <div><h2>{title}</h2><p>{detail}</p></div>
  </section>
}
