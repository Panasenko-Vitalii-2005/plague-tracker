import { formatPercent } from '../domain/format.ts'

export function CureProgress({ value }: { value: number }) {
  return <div className="cure-progress">
    <div className="cure-progress-head"><span>CURE PROGRESS</span><strong>{formatPercent(value)}</strong></div>
    <progress max={100} value={Math.max(0, Math.min(100, value))} aria-label="Cure progress" />
  </div>
}
