import type { LiveConnectionState } from '../api/liveStore.ts'
import { liveStatus } from '../domain/dashboard.ts'

export type DashboardMode = 'live' | 'history'

export function DashboardHeader({ mode, onModeChange, connectionState }: {
  mode: DashboardMode
  onModeChange(mode: DashboardMode): void
  connectionState: LiveConnectionState
}) {
  const status = liveStatus(connectionState)
  return <header className="dashboard-header">
    <div className="brand" aria-label="Plague Inc. Tracker">
      <span className="brand-mark" aria-hidden="true">P</span>
      <span><strong>PLAGUE INC.</strong><small>TRACKER / ANALYTICS</small></span>
    </div>
    <nav className="mode-tabs" aria-label="Dashboard mode">
      <button type="button" className={mode === 'live' ? 'is-active' : ''}
        aria-current={mode === 'live' ? 'page' : undefined} onClick={() => onModeChange('live')}>LIVE</button>
      <button type="button" className={mode === 'history' ? 'is-active' : ''}
        aria-current={mode === 'history' ? 'page' : undefined} onClick={() => onModeChange('history')}>HISTORY</button>
    </nav>
    <span className={`connection-status is-${status.tone}`} role="status" title={status.description}>
      <span className="status-dot" aria-hidden="true" />{status.label}
    </span>
  </header>
}
